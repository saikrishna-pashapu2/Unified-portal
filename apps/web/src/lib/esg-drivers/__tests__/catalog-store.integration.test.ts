import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";

vi.mock("server-only", () => ({}));

function isDisposableCatalogDatabase(): boolean {
  try {
    const url = new URL(process.env.ESG_DATABASE_URL || "");
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    return loopback && (
      url.pathname === "/esg_catalog_test" ||
      (process.env.CI === "true" && url.pathname === "/portal_esg")
    );
  } catch { return false; }
}
// This suite clears catalog fixture tables. Require both explicit opt-in and a
// dedicated local database (or the disposable database provisioned by CI).
const enabled = process.env.RUN_DB_INTEGRATION_TESTS === "1" && isDisposableCatalogDatabase();
const integration = enabled ? describe.sequential : describe.skip;

type EsgPrisma = (typeof import("@esgcredit/db-esg"))["esgPrisma"];
type CatalogStore = typeof import("../catalog-store");

let prisma: EsgPrisma;
let store: CatalogStore;
let testUserId: number;

const BUNDLED_ID = "00000000-0000-4000-8000-000000000001";
const TEST_USERNAME = "catalog-store-integration";
const TEST_EMAIL = "catalog-store-integration@example.test";

beforeAll(async () => {
  if (!enabled) return;
  ({ esgPrisma: prisma } = await import("@esgcredit/db-esg"));
  store = await import("../catalog-store");
  const users = await prisma.$queryRaw<Array<{ id: number }>>`
    INSERT INTO "users" ("username", "email", "password_hash", "is_active_db")
    VALUES (${TEST_USERNAME}, ${TEST_EMAIL}, 'integration-only', TRUE)
    ON CONFLICT ("username") DO UPDATE SET "is_active_db" = TRUE
    RETURNING "id"
  `;
  testUserId = users[0]!.id;
  await resetCatalog();
});

afterAll(async () => {
  if (!enabled || !prisma) return;
  await resetCatalog();
  await prisma.$executeRaw`DELETE FROM "users" WHERE "id" = ${testUserId}`;
  await prisma.$disconnect();
});

integration("shared ESG Driver catalog persistence", () => {
  it("bootstraps, deduplicates, activates, rolls back, and rejects stale revisions", async () => {
    const bundled = await store.getActiveDriverCatalog();
    expect(bundled.summary.id).toBe(BUNDLED_ID);
    expect(bundled.revision).toBe(0);

    const firstBytes = makeWorkbookBytes("one");
    const first = await store.uploadDriverCatalog(testUserId, firstBytes, "catalog-one.xlsx");
    expect(first.version.isBundled).toBe(false);
    expect(first.version.isActive).toBe(false);
    expect(first.warnings).toEqual([]);

    const duplicate = await store.uploadDriverCatalog(testUserId, firstBytes, "renamed-copy.xlsx");
    expect(duplicate.version.id).toBe(first.version.id);

    const firstActivation = await store.activateDriverCatalog(
      testUserId,
      first.version.id,
      bundled.revision,
    );
    expect(firstActivation.active.id).toBe(first.version.id);
    expect(firstActivation.revision).toBe(1);
    expect(firstActivation.activations[0]?.versionId).toBe(first.version.id);

    await expect(
      store.activateDriverCatalog(testUserId, BUNDLED_ID, bundled.revision),
    ).rejects.toMatchObject({ code: "stale_revision", status: 409 });

    const second = await store.uploadDriverCatalog(
      testUserId,
      makeWorkbookBytes("two"),
      "catalog-two.xlsx",
    );
    const secondActivation = await store.activateDriverCatalog(
      testUserId,
      second.version.id,
      firstActivation.revision,
    );
    expect(secondActivation.active.id).toBe(second.version.id);

    const history = await store.listDriverCatalogs();
    expect(history.versions.map((version) => version.id)).toEqual(
      expect.arrayContaining([BUNDLED_ID, first.version.id, second.version.id]),
    );
    expect(history.activations.map((activation) => activation.versionId)).toEqual(
      expect.arrayContaining([first.version.id, second.version.id]),
    );

    const current = await store.getActiveDriverCatalog();
    const rollback = await store.activateDriverCatalog(testUserId, BUNDLED_ID, current.revision);
    expect(rollback.active.id).toBe(BUNDLED_ID);
    expect(rollback.revision).toBe(current.revision + 1);
  });

  it("serializes concurrent activation and holds the active-state lock for job snapshots", async () => {
    const first = await store.uploadDriverCatalog(testUserId, makeWorkbookBytes("lock-one"), "lock-one.xlsx");
    const second = await store.uploadDriverCatalog(testUserId, makeWorkbookBytes("lock-two"), "lock-two.xlsx");
    const before = await store.getActiveDriverCatalog();

    const concurrent = await Promise.allSettled([
      store.activateDriverCatalog(testUserId, first.version.id, before.revision),
      store.activateDriverCatalog(testUserId, second.version.id, before.revision),
    ]);
    expect(concurrent.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(concurrent.filter((result) => result.status === "rejected")).toHaveLength(1);
    const rejected = concurrent.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: expect.objectContaining({ code: "stale_revision", status: 409 }),
    });

    const lockedSnapshot = await prisma.$transaction(async (transaction) => {
      const snapshot = await store.getActiveDriverCatalog(transaction);
      expect(snapshot.revision).toBe(before.revision + 1);

      const target = snapshot.summary.id === first.version.id ? second.version.id : first.version.id;
      let activationFinished = false;
      const pendingActivation = store
        .activateDriverCatalog(testUserId, target, snapshot.revision)
        .finally(() => {
          activationFinished = true;
        });

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(activationFinished).toBe(false);
      return { snapshot, pendingActivation };
    });

    await lockedSnapshot.pendingActivation;
    const after = await store.getActiveDriverCatalog();
    expect(after.revision).toBe(before.revision + 2);
  });

  it("enforces the serialized global history capacity", async () => {
    await resetCatalog();
    await prisma.$executeRaw`
      INSERT INTO "esg_driver_catalog_versions" (
        "id", "version", "workbook", "sha256", "display_name", "catalog_json",
        "file_data", "warnings_json", "driver_count", "sheet_count", "source_count",
        "is_bundled", "uploaded_by_user_id"
      )
      SELECT
        gen_random_uuid(),
        'integration-capacity-' || n,
        'capacity.xlsx',
        lpad(to_hex(n), 64, '0'),
        'capacity.xlsx',
        ('{"version":"capacity","workbook":"capacity.xlsx","sha256":"' || lpad(to_hex(n), 64, '0') || '","sheets":[]}')::jsonb,
        decode('00', 'hex'),
        '[]'::jsonb,
        0,
        0,
        0,
        FALSE,
        ${testUserId}
      FROM generate_series(1, 199) AS n
    `;

    await expect(
      store.uploadDriverCatalog(testUserId, makeWorkbookBytes("capacity"), "capacity.xlsx"),
    ).rejects.toMatchObject({ code: "history_capacity_reached", status: 409 });
  });
});

async function resetCatalog(): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "esg_driver_catalog_state"
    SET "active_version_id" = ${BUNDLED_ID}::uuid, "revision" = 0
    WHERE "id" = 1
  `;
  await prisma.$executeRaw`DELETE FROM "esg_driver_catalog_activations"`;
  await prisma.$executeRaw`
    DELETE FROM "esg_driver_catalog_versions"
    WHERE "id" <> ${BUNDLED_ID}::uuid
  `;
}

function makeWorkbookBytes(suffix: string): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet([
    [
      "Driver Section/Country",
      "Driver Type",
      "Driver Name",
      "Driver Logic",
      "Evidence/KPI",
      "Key Sources",
      "Links",
    ],
    ["Global Drivers", "Agreement", `Global driver ${suffix}`, "Logic", "KPI", "Example", `https://example.com/${suffix}/global`],
    ["UAE", "Agreement", `UAE driver ${suffix}`, "Logic", "KPI", "Example", `https://example.com/${suffix}/uae`],
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Banking");
  return Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
}
