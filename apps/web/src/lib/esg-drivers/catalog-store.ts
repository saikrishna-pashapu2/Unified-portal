import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { esgPrisma } from "@esgcredit/db-esg";
import bundledCatalogJson from "./workbook.generated.json";
import type {
  ActiveDriverCatalog,
  DriverCatalogActivation,
  DriverCatalogDiff,
  DriverCatalogListResponse,
  DriverCatalogPreviewResponse,
  DriverCatalogVersion,
  DriverWorkbookOptions,
  WorkbookValidationIssue,
} from "./catalog-contracts";
import { parseDriverCatalogUpload } from "./catalog-import";
import { buildWorkbookOptions, compareDriverCatalogs } from "./catalog-utils";
import type { DriverWorkbook } from "./workbook-types";

export const DRIVER_CATALOG_FILE_MAX_BYTES = 5 * 1024 * 1024;
export const DRIVER_CATALOG_REQUEST_MAX_BYTES = DRIVER_CATALOG_FILE_MAX_BYTES + 256 * 1024;
export const DRIVER_CATALOG_PAGE_SIZE = 50;
export const DRIVER_CATALOG_MAX_VERSIONS = 200;
export const DRIVER_CATALOG_MAX_STORAGE_BYTES = 256 * 1024 * 1024;

// This identifier is intentionally stable. It is the rollback anchor for every
// deployment and is inserted after the migration has created the catalog tables.
export const BUNDLED_DRIVER_CATALOG_ID = "00000000-0000-4000-8000-000000000001";
const BUNDLED_DRIVER_CATALOG_UPLOADED_AT = "2026-09-01T00:00:00.000Z";
const BUNDLED_DRIVER_CATALOG_NAME = "ESG_Drivers_September.xlsx";

const bundledCatalog = bundledCatalogJson as unknown as DriverWorkbook;

/** Minimal transaction surface used by job creation to snapshot under its lock. */
export interface DriverCatalogDatabase {
  $queryRaw: (...args: any[]) => Promise<unknown>;
  $executeRaw: (...args: any[]) => Promise<unknown>;
}

export type DriverCatalogErrorCode =
  | "invalid_catalog_id"
  | "invalid_cursor"
  | "invalid_workbook"
  | "catalog_not_found"
  | "stale_revision"
  | "catalog_unavailable"
  | "payload_too_large"
  | "history_capacity_reached";

export class DriverCatalogStoreError extends Error {
  readonly code: DriverCatalogErrorCode;
  readonly status: number;
  readonly issues?: WorkbookValidationIssue[];

  constructor(
    code: DriverCatalogErrorCode,
    status: number,
    message: string,
    issues?: WorkbookValidationIssue[],
  ) {
    super(message);
    this.name = "DriverCatalogStoreError";
    this.code = code;
    this.status = status;
    this.issues = issues;
  }
}

export class DriverCatalogValidationError extends DriverCatalogStoreError {
  constructor(issues: WorkbookValidationIssue[]) {
    super("invalid_workbook", 400, "Invalid ESG Driver workbook.", issues);
    this.name = "DriverCatalogValidationError";
  }
}

export class DriverCatalogNotFoundError extends DriverCatalogStoreError {
  constructor() {
    super("catalog_not_found", 404, "Workbook catalog version not found.");
    this.name = "DriverCatalogNotFoundError";
  }
}

export class DriverCatalogStaleRevisionError extends DriverCatalogStoreError {
  readonly currentRevision: number;

  constructor(currentRevision: number) {
    super("stale_revision", 409, "The workbook catalog changed. Refresh and try again.");
    this.name = "DriverCatalogStaleRevisionError";
    this.currentRevision = currentRevision;
  }
}

export class DriverCatalogUnavailableError extends DriverCatalogStoreError {
  constructor(cause?: unknown) {
    super("catalog_unavailable", 503, "The workbook catalog is temporarily unavailable.");
    this.name = "DriverCatalogUnavailableError";
    if (cause) this.cause = cause;
  }
}

export class DriverCatalogPayloadTooLargeError extends DriverCatalogStoreError {
  constructor() {
    super("payload_too_large", 413, "The workbook upload is too large.");
    this.name = "DriverCatalogPayloadTooLargeError";
  }
}

export class DriverCatalogHistoryCapacityError extends DriverCatalogStoreError {
  constructor() {
    super(
      "history_capacity_reached",
      409,
      "Workbook catalog history capacity has been reached.",
    );
    this.name = "DriverCatalogHistoryCapacityError";
  }
}

export class InvalidDriverCatalogCursorError extends DriverCatalogStoreError {
  constructor() {
    super("invalid_cursor", 400, "Invalid workbook catalog cursor.");
    this.name = "InvalidDriverCatalogCursorError";
  }
}

export class InvalidDriverCatalogIdError extends DriverCatalogStoreError {
  constructor() {
    super("invalid_catalog_id", 400, "Invalid workbook catalog version id.");
    this.name = "InvalidDriverCatalogIdError";
  }
}

interface CatalogVersionRow {
  id: string;
  version: string;
  workbook: string;
  sha256: string;
  display_name: string;
  catalog_json: unknown;
  warnings_json: unknown;
  driver_count: number;
  sheet_count: number;
  source_count: number;
  is_bundled: boolean;
  uploaded_at: Date | string;
  uploaded_by_user_id: number | null;
  uploader_username?: string | null;
  uploader_email?: string | null;
  uploader_first_name?: string | null;
  uploader_last_name?: string | null;
}

interface ActiveVersionRow extends CatalogVersionRow {
  active_version_id: string;
  revision: number;
}

interface ActivationRow {
  id: string;
  version_id: string;
  workbook: string;
  activated_at: Date | string;
  activated_by_user_id: number | null;
  revision: number;
  uploader_username?: string | null;
  uploader_email?: string | null;
  uploader_first_name?: string | null;
  uploader_last_name?: string | null;
}

interface CatalogCursor {
  uploadedAt: string;
  id: string;
}

/**
 * Return the currently active catalog used by server-side ESG Driver jobs.
 * The first successful read inserts the bundled rollback anchor and singleton
 * pointer, but never creates schema objects or silently falls back on errors.
 */
export async function getActiveDriverCatalog(
  database?: DriverCatalogDatabase,
): Promise<ActiveDriverCatalog> {
  await ensureCatalogBootstrap(database);
  const row = database
    ? await readActiveVersion(database, true)
    : await readActiveVersion();
  const catalog = readStoredCatalog(row);
  const options = buildOptions(catalog);

  return {
    summary: toVersionSummary(row, true),
    catalog,
    options,
    revision: toNumber(row.revision),
  };
}

export async function listDriverCatalogs(
  cursor?: string | null,
): Promise<DriverCatalogListResponse> {
  const decodedCursor = decodeCursor(cursor);
  await ensureCatalogBootstrap();

  const activeRow = await readActiveVersion();
  const activeCatalog = readStoredCatalog(activeRow);
  const activeSummary = toVersionSummary(activeRow, true);

  const rows = decodedCursor
    ? await runCatalogQuery<CatalogVersionRow[]>`
        SELECT
          v.id,
          v.version,
          v.workbook,
          v.sha256,
          v.display_name,
          v.driver_count,
          v.sheet_count,
          v.source_count,
          v.is_bundled,
          v.uploaded_at,
          v.uploaded_by_user_id,
          u.username AS uploader_username,
          u.email AS uploader_email,
          u.first_name AS uploader_first_name,
          u.last_name AS uploader_last_name
        FROM "esg_driver_catalog_versions" v
        LEFT JOIN "users" u ON u.id = v.uploaded_by_user_id
        WHERE (v.uploaded_at, v.id) < (${decodedCursor.uploadedAt}::timestamptz, ${decodedCursor.id}::uuid)
        ORDER BY v.uploaded_at DESC, v.id DESC
        LIMIT ${DRIVER_CATALOG_PAGE_SIZE + 1}
      `
    : await runCatalogQuery<CatalogVersionRow[]>`
        SELECT
          v.id,
          v.version,
          v.workbook,
          v.sha256,
          v.display_name,
          v.driver_count,
          v.sheet_count,
          v.source_count,
          v.is_bundled,
          v.uploaded_at,
          v.uploaded_by_user_id,
          u.username AS uploader_username,
          u.email AS uploader_email,
          u.first_name AS uploader_first_name,
          u.last_name AS uploader_last_name
        FROM "esg_driver_catalog_versions" v
        LEFT JOIN "users" u ON u.id = v.uploaded_by_user_id
        ORDER BY v.uploaded_at DESC, v.id DESC
        LIMIT ${DRIVER_CATALOG_PAGE_SIZE + 1}
      `;

  const hasNextPage = rows.length > DRIVER_CATALOG_PAGE_SIZE;
  const pageRows = hasNextPage ? rows.slice(0, DRIVER_CATALOG_PAGE_SIZE) : rows;
  const versions = pageRows.map((row) =>
    toVersionSummary(row, row.id === activeRow.active_version_id),
  );
  const lastRow = pageRows[pageRows.length - 1];
  const nextCursor = hasNextPage && lastRow ? encodeCursor(lastRow) : null;

  const activationRows = await runCatalogQuery<ActivationRow[]>`
    SELECT
      a.id,
      a.version_id,
      v.workbook,
      a.activated_at,
      a.activated_by_user_id,
      a.revision,
      u.username AS uploader_username,
      u.email AS uploader_email,
      u.first_name AS uploader_first_name,
      u.last_name AS uploader_last_name
    FROM "esg_driver_catalog_activations" a
    INNER JOIN "esg_driver_catalog_versions" v ON v.id = a.version_id
    LEFT JOIN "users" u ON u.id = a.activated_by_user_id
    ORDER BY a.activated_at DESC, a.id DESC
    LIMIT ${DRIVER_CATALOG_PAGE_SIZE}
  `;

  return {
    active: activeSummary,
    options: activeCatalogOptions(activeCatalog),
    revision: toNumber(activeRow.revision),
    versions,
    nextCursor,
    activations: activationRows.map(toActivation),
  };
}

export async function getDriverCatalogPreview(
  id: string,
): Promise<DriverCatalogPreviewResponse> {
  assertCatalogId(id);
  await ensureCatalogBootstrap();

  const row = await readVersion(id);
  if (!row) throw new DriverCatalogNotFoundError();

  const activeRow = await readActiveVersion();
  const targetCatalog = readStoredCatalog(row);
  const activeCatalog = readStoredCatalog(activeRow);
  const diff = compareCatalogs(activeCatalog, targetCatalog);

  return {
    version: toVersionSummary(row, row.id === activeRow.active_version_id),
    active: toVersionSummary(activeRow, true),
    revision: toNumber(activeRow.revision),
    diff,
    warnings: readWarnings(row.warnings_json),
  };
}

export async function uploadDriverCatalog(
  userId: number,
  bytes: Buffer,
  filename: string,
): Promise<DriverCatalogPreviewResponse> {
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new DriverCatalogStoreError("catalog_unavailable", 503, "The workbook catalog is temporarily unavailable.");
  }
  if (!Buffer.isBuffer(bytes) || bytes.length > DRIVER_CATALOG_FILE_MAX_BYTES) {
    throw new DriverCatalogPayloadTooLargeError();
  }

  const safeFilename = normalizeFilename(filename);
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  await ensureCatalogBootstrap();

  const existing = await readVersionBySha256(sha256);
  if (existing) return getDriverCatalogPreview(existing.id);

  let parsed: Awaited<ReturnType<typeof parseDriverCatalogUpload>>;
  try {
    parsed = await parseDriverCatalogUpload(bytes, safeFilename);
  } catch (error) {
    const parserStatus =
      error && typeof error === "object" && "status" in error
        ? Number((error as { status?: unknown }).status)
        : 400;
    if (parserStatus === 413) throw new DriverCatalogPayloadTooLargeError();
    if (parserStatus === 503) throw new DriverCatalogUnavailableError();
    throw new DriverCatalogValidationError(extractValidationIssues(error));
  }

  const catalog = assertUploadedCatalog(parsed.catalog);
  const warnings = normalizeIssues(parsed.warnings);
  const counts = countCatalog(catalog);
  const versionId = randomUUID();

  await runCatalogMutation(async () => {
    await esgPrisma.$transaction(async (transaction) => {
      // Every uploader serializes against the same advisory lock. The
      // duplicate check and quota check therefore cover concurrent requests.
      await transaction.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext('esg_driver_catalog_upload_quota'))
      `;
      const duplicate = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "esg_driver_catalog_versions"
        WHERE "sha256" = ${sha256}
        LIMIT 1
      `;
      if (duplicate[0]) return;

      const quotaRows = await transaction.$queryRaw<Array<{
        version_count: number;
        storage_bytes: number | string;
        candidate_bytes: number | string;
      }>>`
        SELECT
          COUNT(*)::integer AS version_count,
          COALESCE(
            SUM(
              pg_column_size(COALESCE("file_data", ''::bytea))
              + pg_column_size("catalog_json")
            ),
            0
          )::bigint AS storage_bytes,
          (
            pg_column_size(${JSON.stringify(catalog)}::jsonb)
            + pg_column_size(${bytes}::bytea)
          )::bigint AS candidate_bytes
        FROM "esg_driver_catalog_versions"
      `;
      const quota = quotaRows[0];
      const storageBytes = Number(quota?.storage_bytes ?? 0);
      const candidateBytes = Number(quota?.candidate_bytes ?? 0);
      if (
        Number(quota?.version_count ?? 0) >= DRIVER_CATALOG_MAX_VERSIONS ||
        !Number.isSafeInteger(storageBytes) ||
        !Number.isSafeInteger(candidateBytes) ||
        storageBytes + candidateBytes > DRIVER_CATALOG_MAX_STORAGE_BYTES
      ) {
        throw new DriverCatalogHistoryCapacityError();
      }

      await transaction.$executeRaw`
        INSERT INTO "esg_driver_catalog_versions" (
          "id",
          "version",
          "workbook",
          "sha256",
          "display_name",
          "catalog_json",
          "file_data",
          "warnings_json",
          "driver_count",
          "sheet_count",
          "source_count",
          "is_bundled",
          "uploaded_at",
          "uploaded_by_user_id"
        ) VALUES (
          ${versionId}::uuid,
          ${catalog.version},
          ${catalog.workbook},
          ${sha256},
          ${safeFilename},
          ${JSON.stringify(catalog)}::jsonb,
          ${bytes},
          ${JSON.stringify(warnings)}::jsonb,
          ${counts.driverCount},
          ${counts.sheetCount},
          ${counts.sourceCount},
          FALSE,
          NOW(),
          ${userId}
        )
        ON CONFLICT ("sha256") DO NOTHING
      `;
    });
  });

  const insertedOrExisting = await readVersionBySha256(sha256);
  if (!insertedOrExisting) throw new DriverCatalogUnavailableError();
  return getDriverCatalogPreview(insertedOrExisting.id);
}

export async function activateDriverCatalog(
  userId: number,
  id: string,
  expectedRevision: number,
): Promise<DriverCatalogListResponse> {
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new DriverCatalogStoreError("catalog_unavailable", 503, "The workbook catalog is temporarily unavailable.");
  }
  assertCatalogId(id);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new DriverCatalogStoreError("stale_revision", 409, "The workbook catalog changed. Refresh and try again.");
  }

  await ensureCatalogBootstrap();

  await runCatalogMutation(async () => {
    await esgPrisma.$transaction(async (transaction) => {
      const stateRows = await transaction.$queryRaw<Array<{ active_version_id: string; revision: number }>>`
        SELECT "active_version_id", "revision"
        FROM "esg_driver_catalog_state"
        WHERE "id" = 1
        FOR UPDATE
      `;
      const state = stateRows[0];
      if (!state) throw new DriverCatalogUnavailableError();

      const revision = toNumber(state.revision);
      if (revision !== expectedRevision) {
        throw new DriverCatalogStaleRevisionError(revision);
      }

      const target = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "esg_driver_catalog_versions"
        WHERE "id" = ${id}::uuid
        LIMIT 1
      `;
      if (!target[0]) throw new DriverCatalogNotFoundError();

      if (state.active_version_id === id) return;

      const nextRevision = revision + 1;
      await transaction.$executeRaw`
        UPDATE "esg_driver_catalog_state"
        SET "active_version_id" = ${id}::uuid, "revision" = ${nextRevision}
        WHERE "id" = 1
      `;
      await transaction.$executeRaw`
        INSERT INTO "esg_driver_catalog_activations" (
          "version_id", "activated_by_user_id", "revision"
        ) VALUES (
          ${id}::uuid, ${userId}, ${nextRevision}
        )
      `;
    });
  });

  return listDriverCatalogs(null);
}

async function ensureCatalogBootstrap(database?: DriverCatalogDatabase): Promise<void> {
  const catalog = assertBundledCatalog();
  const counts = countCatalog(catalog);

  if (database) {
    await runCatalogMutation(() => bootstrapCatalogRows(database, catalog, counts));
    return;
  }

  await runCatalogMutation(async () => {
    await esgPrisma.$transaction(async (transaction) => {
      await bootstrapCatalogRows(transaction, catalog, counts);
    });
  });
}

async function bootstrapCatalogRows(
  database: DriverCatalogDatabase,
  catalog: DriverWorkbook,
  counts: ReturnType<typeof countCatalog>,
): Promise<void> {
  await database.$executeRaw`
    INSERT INTO "esg_driver_catalog_versions" (
      "id",
      "version",
      "workbook",
      "sha256",
      "display_name",
      "catalog_json",
      "file_data",
      "warnings_json",
      "driver_count",
      "sheet_count",
      "source_count",
      "is_bundled",
      "uploaded_at",
      "uploaded_by_user_id"
    ) VALUES (
      ${BUNDLED_DRIVER_CATALOG_ID}::uuid,
      ${catalog.version},
      ${catalog.workbook},
      ${catalog.sha256},
      ${BUNDLED_DRIVER_CATALOG_NAME},
      ${JSON.stringify(catalog)}::jsonb,
      NULL,
      '[]'::jsonb,
      ${counts.driverCount},
      ${counts.sheetCount},
      ${counts.sourceCount},
      TRUE,
      ${BUNDLED_DRIVER_CATALOG_UPLOADED_AT}::timestamptz,
      NULL
    )
    ON CONFLICT ("id") DO NOTHING
  `;
  await database.$executeRaw`
    INSERT INTO "esg_driver_catalog_state" ("id", "active_version_id", "revision")
    SELECT 1, ${BUNDLED_DRIVER_CATALOG_ID}::uuid, 0
    WHERE EXISTS (
      SELECT 1 FROM "esg_driver_catalog_versions"
      WHERE "id" = ${BUNDLED_DRIVER_CATALOG_ID}::uuid
    )
    ON CONFLICT ("id") DO NOTHING
  `;
}

async function readActiveVersion(
  database?: DriverCatalogDatabase,
  lock = false,
): Promise<ActiveVersionRow> {
  const rows = database
    ? lock
      ? await queryCatalogDatabase(database)<ActiveVersionRow[]>`
          SELECT
            s."active_version_id",
            s."revision",
            v.id,
            v.version,
            v.workbook,
            v.sha256,
            v.display_name,
            v.catalog_json,
            v.warnings_json,
            v.driver_count,
            v.sheet_count,
            v.source_count,
            v.is_bundled,
            v.uploaded_at,
            v.uploaded_by_user_id,
            u.username AS uploader_username,
            u.email AS uploader_email,
            u.first_name AS uploader_first_name,
            u.last_name AS uploader_last_name
          FROM "esg_driver_catalog_state" s
          INNER JOIN "esg_driver_catalog_versions" v ON v.id = s."active_version_id"
          LEFT JOIN "users" u ON u.id = v.uploaded_by_user_id
          WHERE s."id" = 1
          LIMIT 1
          FOR UPDATE OF s
        `
      : await queryCatalogDatabase(database)<ActiveVersionRow[]>`
          SELECT
            s."active_version_id",
            s."revision",
            v.id,
            v.version,
            v.workbook,
            v.sha256,
            v.display_name,
            v.catalog_json,
            v.warnings_json,
            v.driver_count,
            v.sheet_count,
            v.source_count,
            v.is_bundled,
            v.uploaded_at,
            v.uploaded_by_user_id,
            u.username AS uploader_username,
            u.email AS uploader_email,
            u.first_name AS uploader_first_name,
            u.last_name AS uploader_last_name
          FROM "esg_driver_catalog_state" s
          INNER JOIN "esg_driver_catalog_versions" v ON v.id = s."active_version_id"
          LEFT JOIN "users" u ON u.id = v.uploaded_by_user_id
          WHERE s."id" = 1
          LIMIT 1
        `
    : await runCatalogQuery<ActiveVersionRow[]>`
        SELECT
          s."active_version_id",
          s."revision",
          v.id,
          v.version,
          v.workbook,
          v.sha256,
          v.display_name,
          v.catalog_json,
          v.warnings_json,
          v.driver_count,
          v.sheet_count,
          v.source_count,
          v.is_bundled,
          v.uploaded_at,
          v.uploaded_by_user_id,
          u.username AS uploader_username,
          u.email AS uploader_email,
          u.first_name AS uploader_first_name,
          u.last_name AS uploader_last_name
        FROM "esg_driver_catalog_state" s
        INNER JOIN "esg_driver_catalog_versions" v ON v.id = s."active_version_id"
        LEFT JOIN "users" u ON u.id = v.uploaded_by_user_id
        WHERE s."id" = 1
        LIMIT 1
      `;
  if (!rows[0]) throw new DriverCatalogUnavailableError();
  return rows[0];
}

async function readVersion(id: string): Promise<CatalogVersionRow | null> {
  const rows = await runCatalogQuery<CatalogVersionRow[]>`
    SELECT
      v.id,
      v.version,
      v.workbook,
      v.sha256,
      v.display_name,
      v.catalog_json,
      v.warnings_json,
      v.driver_count,
      v.sheet_count,
      v.source_count,
      v.is_bundled,
      v.uploaded_at,
      v.uploaded_by_user_id,
      u.username AS uploader_username,
      u.email AS uploader_email,
      u.first_name AS uploader_first_name,
      u.last_name AS uploader_last_name
    FROM "esg_driver_catalog_versions" v
    LEFT JOIN "users" u ON u.id = v.uploaded_by_user_id
    WHERE v.id = ${id}::uuid
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function readVersionBySha256(sha256: string): Promise<CatalogVersionRow | null> {
  const rows = await runCatalogQuery<CatalogVersionRow[]>`
    SELECT
      v.id,
      v.version,
      v.workbook,
      v.sha256,
      v.display_name,
      v.catalog_json,
      v.warnings_json,
      v.driver_count,
      v.sheet_count,
      v.source_count,
      v.is_bundled,
      v.uploaded_at,
      v.uploaded_by_user_id,
      u.username AS uploader_username,
      u.email AS uploader_email,
      u.first_name AS uploader_first_name,
      u.last_name AS uploader_last_name
    FROM "esg_driver_catalog_versions" v
    LEFT JOIN "users" u ON u.id = v.uploaded_by_user_id
    WHERE v.sha256 = ${sha256}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

function toVersionSummary(row: CatalogVersionRow, isActive: boolean): DriverCatalogVersion {
  return {
    id: row.id,
    version: row.version,
    workbook: row.workbook,
    sha256: row.sha256,
    uploadedAt: toIso(row.uploaded_at),
    uploadedBy: {
      id: row.uploaded_by_user_id,
      name: uploaderName(row, row.is_bundled),
    },
    driverCount: toNumber(row.driver_count),
    sheetCount: toNumber(row.sheet_count),
    sourceCount: toNumber(row.source_count),
    isActive,
    isBundled: Boolean(row.is_bundled),
  };
}

function toActivation(row: ActivationRow): DriverCatalogActivation {
  return {
    id: row.id,
    versionId: row.version_id,
    workbook: row.workbook,
    activatedAt: toIso(row.activated_at),
    activatedBy: {
      id: row.activated_by_user_id,
      name: uploaderName({
        uploaded_by_user_id: row.activated_by_user_id,
        uploader_username: row.uploader_username,
        uploader_email: row.uploader_email,
        uploader_first_name: row.uploader_first_name,
        uploader_last_name: row.uploader_last_name,
      }, false),
    },
    revision: toNumber(row.revision),
  };
}

function uploaderName(row: {
  uploaded_by_user_id: number | null;
  uploader_username?: string | null;
  uploader_email?: string | null;
  uploader_first_name?: string | null;
  uploader_last_name?: string | null;
}, isBundled = false): string {
  if (isBundled) return "Bundled catalog";
  if (row.uploaded_by_user_id === null) return "Former user";
  const fullName = [row.uploader_first_name, row.uploader_last_name]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");
  return fullName || row.uploader_username?.trim() || row.uploader_email?.trim() || `User ${row.uploaded_by_user_id}`;
}

function readStoredCatalog(row: CatalogVersionRow): DriverWorkbook {
  const parsed = parseJson(row.catalog_json);
  if (!isDriverWorkbook(parsed)) throw new DriverCatalogUnavailableError();
  return parsed;
}

function assertBundledCatalog(): DriverWorkbook {
  if (!isDriverWorkbook(bundledCatalog)) {
    throw new DriverCatalogUnavailableError();
  }
  return bundledCatalog;
}

function assertUploadedCatalog(value: unknown): DriverWorkbook {
  if (!isDriverWorkbook(value)) {
    throw new DriverCatalogValidationError([
      { message: "The workbook did not produce a valid ESG Driver catalog." },
    ]);
  }
  return value;
}

function isDriverWorkbook(value: unknown): value is DriverWorkbook {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DriverWorkbook>;
  if (
    typeof candidate.version !== "string" ||
    typeof candidate.workbook !== "string" ||
    typeof candidate.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/i.test(candidate.sha256) ||
    !Array.isArray(candidate.sheets) ||
    candidate.sheets.length === 0
  ) {
    return false;
  }
  return candidate.sheets.every(
    (sheet) =>
      Boolean(sheet) &&
      typeof sheet.name === "string" &&
      Array.isArray(sheet.drivers) &&
      Array.isArray(sheet.sources),
  );
}

function countCatalog(catalog: DriverWorkbook) {
  return {
    driverCount: catalog.sheets.reduce((total, sheet) => total + sheet.drivers.length, 0),
    sheetCount: catalog.sheets.length,
    sourceCount: catalog.sheets.reduce((total, sheet) => total + sheet.sources.length, 0),
  };
}

function buildOptions(catalog: DriverWorkbook): DriverWorkbookOptions {
  try {
    return buildWorkbookOptions(catalog);
  } catch (error) {
    throw new DriverCatalogUnavailableError(error);
  }
}

function activeCatalogOptions(catalog: DriverWorkbook): DriverWorkbookOptions {
  return buildOptions(catalog);
}

function compareCatalogs(before: DriverWorkbook, after: DriverWorkbook): DriverCatalogDiff {
  try {
    return compareDriverCatalogs(before, after);
  } catch (error) {
    throw new DriverCatalogUnavailableError(error);
  }
}

function readWarnings(value: unknown): WorkbookValidationIssue[] {
  const parsed = parseJson(value);
  return normalizeIssues(parsed);
}

function normalizeIssues(value: unknown): WorkbookValidationIssue[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 100).flatMap((issue) => {
    if (typeof issue === "string") return [{ message: issue.slice(0, 500) }];
    if (!issue || typeof issue !== "object") return [];
    const candidate = issue as Record<string, unknown>;
    if (typeof candidate.message !== "string" || !candidate.message.trim()) return [];
    return [
      {
        ...(typeof candidate.sheet === "string" ? { sheet: candidate.sheet.slice(0, 120) } : {}),
        ...(typeof candidate.cell === "string" ? { cell: candidate.cell.slice(0, 32) } : {}),
        message: candidate.message.slice(0, 500),
      },
    ];
  });
}

function extractValidationIssues(error: unknown): WorkbookValidationIssue[] {
  if (error && typeof error === "object") {
    const candidate = error as { issues?: unknown; message?: unknown };
    const issues = normalizeIssues(candidate.issues);
    if (issues.length) return issues;
    if (typeof candidate.message === "string" && candidate.message.trim()) {
      return candidate.message
        .split(/\r?\n/)
        .slice(0, 100)
        .map((message) => ({ message: message.slice(0, 500) }));
    }
  }
  return [{ message: "The workbook could not be parsed." }];
}

function normalizeFilename(value: string): string {
  const filename = String(value ?? "")
    .replace(/^.*[\\/]/, "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim();
  if (!filename || filename.length > 255) {
    throw new DriverCatalogValidationError([
      { message: "The workbook filename is missing or too long." },
    ]);
  }
  return filename;
}

function assertCatalogId(value: string): asserts value is string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw new InvalidDriverCatalogIdError();
  }
}

function encodeCursor(row: Pick<CatalogVersionRow, "uploaded_at" | "id">): string {
  const payload: CatalogCursor = { uploadedAt: toIso(row.uploaded_at), id: row.id };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeCursor(cursor: string | null | undefined): CatalogCursor | null {
  if (cursor === undefined || cursor === null) return null;
  if (cursor === "") throw new InvalidDriverCatalogCursorError();
  if (cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(cursor)) {
    throw new InvalidDriverCatalogCursorError();
  }
  try {
    const payload = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<CatalogCursor>;
    if (
      typeof payload.uploadedAt !== "string" ||
      Number.isNaN(Date.parse(payload.uploadedAt)) ||
      typeof payload.id !== "string"
    ) {
      throw new Error("Invalid cursor");
    }
    assertCatalogId(payload.id);
    return { uploadedAt: new Date(payload.uploadedAt).toISOString(), id: payload.id };
  } catch {
    throw new InvalidDriverCatalogCursorError();
  }
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function toNumber(value: number | string | null | undefined): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
}

function toIso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

async function runCatalogQuery<T>(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<T> {
  try {
    return await (esgPrisma.$queryRaw as unknown as (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ) => Promise<T>)(strings, ...values);
  } catch (error) {
    if (error instanceof DriverCatalogStoreError) throw error;
    throw new DriverCatalogUnavailableError(error);
  }
}

async function runCatalogQueryWithDatabase<T>(
  database: DriverCatalogDatabase,
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<T> {
  try {
    return await (database.$queryRaw as unknown as (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ) => Promise<T>)(strings, ...values);
  } catch (error) {
    if (error instanceof DriverCatalogStoreError) throw error;
    throw new DriverCatalogUnavailableError(error);
  }
}

function queryCatalogDatabase(database: DriverCatalogDatabase) {
  return function query<T>(strings: TemplateStringsArray, ...values: unknown[]) {
    return runCatalogQueryWithDatabase<T>(database, strings, ...values);
  };
}

async function runCatalogMutation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof DriverCatalogStoreError) throw error;
    throw new DriverCatalogUnavailableError(error);
  }
}
