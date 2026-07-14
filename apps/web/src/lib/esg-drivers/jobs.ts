import "server-only";

import { randomUUID } from "crypto";
import { esgPrisma } from "@esgcredit/db-esg";
import {
  type BackgroundJobStatus,
  type BackgroundJobTransition,
  type ClaimedBackgroundJob,
  enqueueBackgroundJob,
  JobLeaseLostError,
  throwIfJobCancelled,
} from "@/lib/jobs/queue";
import type {
  EsgDriverCheckpoint,
  EsgDriverJobActivity,
  EsgDriverJob,
  EsgDriverJobStatus,
  EsgDriverProgressDetail,
  EsgDriverResult,
  EsgDriverSource,
  GenerateEsgDriversInput,
} from "./types";
import { isTransientEsgDriverError } from "./errors";

interface EsgDriverJobRow {
  id: string;
  user_id: number | null;
  country: string;
  sector: string;
  language: string;
  status: EsgDriverJobStatus;
  progress: number;
  stage: string;
  error_message: string | null;
  result_json: EsgDriverResult | null;
  evidence_json: EsgDriverSource[] | null;
  checkpoint_json: EsgDriverCheckpoint | null;
  catalog_version: string | null;
  parent_job_id: string | null;
  activity_json: EsgDriverJobActivity[] | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
  completed_at: Date | string | null;
}

interface LockedQueueRow {
  attempts: number;
  cancel_requested: boolean;
  lease_owner: string | null;
  lease_valid: boolean;
  max_attempts: number;
  status: BackgroundJobStatus;
  user_id: number;
}

interface ResumeParentJobRow {
  id: string;
  user_id: number | null;
  country: string;
  sector: string;
  language: string;
  status: EsgDriverJobStatus;
  result_json: EsgDriverResult | null;
  checkpoint_json: EsgDriverCheckpoint | null;
}

export interface EsgDriverJobsPage {
  completed: number;
  jobs: EsgDriverJob[];
  needsAttention: number;
  nextCursor: string | null;
  total: number;
}

export interface CreateEsgDriverJobOptions {
  checkpoint?: EsgDriverCheckpoint;
  catalogVersion?: string;
}

export class InvalidEsgDriverJobsCursorError extends Error {
  constructor() {
    super("Invalid ESG driver history cursor.");
    this.name = "InvalidEsgDriverJobsCursorError";
  }
}

export class EsgDriverResumeParentNotFoundError extends Error {
  constructor() {
    super("ESG driver parent job was not found.");
    this.name = "EsgDriverResumeParentNotFoundError";
  }
}

export class EsgDriverResumeConflictError extends Error {
  constructor() {
    super("ESG driver job is not resumable.");
    this.name = "EsgDriverResumeConflictError";
  }
}

export function isDriverJobId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export async function ensureEsgDriverJobsTable(): Promise<void> {
  // Kept for source compatibility. The table is now owned by Prisma migrations;
  // request handlers must never mutate schema at runtime.
}

export async function createEsgDriverJob(
  userId: number,
  input: GenerateEsgDriversInput,
  options: CreateEsgDriverJobOptions = {},
): Promise<EsgDriverJob> {
  await ensureEsgDriverJobsTable();

  const id = randomUUID();
  const initialActivity = [
    buildActivityEvent({
      status: "queued",
      progress: 0,
      stage: "queued",
    }),
  ];
  await esgPrisma.$transaction(async (transaction) => {
    await transaction.$executeRaw`
      INSERT INTO esg_driver_jobs (
        id, user_id, country, sector, language, status, progress, stage,
        checkpoint_json, catalog_version, parent_job_id,
        activity_json, created_at, updated_at
      ) VALUES (
        ${id}::uuid, ${userId}, ${input.country}, ${input.sector},
        ${input.language}, 'queued', 0, 'queued',
        ${options.checkpoint ? JSON.stringify(options.checkpoint) : null}::jsonb,
        ${options.catalogVersion ?? options.checkpoint?.catalogVersion ?? null},
        NULL,
        ${JSON.stringify(initialActivity)}::jsonb, now(), now()
      )
    `;
    await enqueueBackgroundJob(
      {
        id,
        jobType: "esg_driver",
        userId,
        payload: input,
        maxAttempts: 2,
      },
      transaction,
    );
  });

  const job = await getEsgDriverJob(id, userId);
  if (!job) {
    throw new Error("Failed to create ESG driver job.");
  }

  return job;
}

export function isResumableEsgDriverJob(job: EsgDriverJob): boolean {
  return (
    job.status === "done" &&
    job.result?.completion === "partial" &&
    job.checkpoint?.version === 1
  );
}

export async function createEsgDriverResumeJob(
  userId: number,
  parent: EsgDriverJob,
): Promise<EsgDriverJob> {
  if (parent.userId !== userId || !isDriverJobId(parent.id)) {
    throw new EsgDriverResumeParentNotFoundError();
  }

  const childId = randomUUID();
  await esgPrisma.$transaction(async (transaction) => {
    // Lock and re-read the parent in the same transaction that creates the
    // child. This closes the read/delete race and ensures the child is always
    // seeded from the durable canonical checkpoint, not a stale route object.
    const parentRows = await transaction.$queryRaw<ResumeParentJobRow[]>`
      SELECT id::text, user_id, country, sector, language, status,
             result_json, checkpoint_json
      FROM esg_driver_jobs
      WHERE id = ${parent.id}::uuid AND user_id = ${userId}
      FOR UPDATE
    `;
    const lockedParent = parentRows[0];
    if (!lockedParent) {
      throw new EsgDriverResumeParentNotFoundError();
    }
    if (
      lockedParent.status !== "done" ||
      lockedParent.result_json?.completion !== "partial" ||
      lockedParent.checkpoint_json?.version !== 1
    ) {
      throw new EsgDriverResumeConflictError();
    }

    const requestedAt = new Date().toISOString();
    const checkpoint = JSON.parse(
      JSON.stringify(lockedParent.checkpoint_json),
    ) as EsgDriverCheckpoint;
    checkpoint.updatedAt = requestedAt;
    checkpoint.resume = {
      parentJobId: lockedParent.id,
      requestedAt,
      revalidateAcceptedSources: true,
    };
    const input: GenerateEsgDriversInput = {
      country: lockedParent.country,
      sector: lockedParent.sector,
      language: lockedParent.language,
    };
    const initialActivity = [
      buildActivityEvent({
        status: "queued",
        progress: 0,
        stage: "queued",
      }),
    ];

    await transaction.$executeRaw`
      INSERT INTO esg_driver_jobs (
        id, user_id, country, sector, language, status, progress, stage,
        checkpoint_json, catalog_version, parent_job_id,
        activity_json, created_at, updated_at
      ) VALUES (
        ${childId}::uuid, ${userId}, ${input.country}, ${input.sector},
        ${input.language}, 'queued', 0, 'queued',
        ${JSON.stringify(checkpoint)}::jsonb, ${checkpoint.catalogVersion},
        ${lockedParent.id}::uuid,
        ${JSON.stringify(initialActivity)}::jsonb, now(), now()
      )
    `;
    await enqueueBackgroundJob(
      {
        id: childId,
        jobType: "esg_driver",
        userId,
        payload: input,
        maxAttempts: 2,
      },
      transaction,
    );
  });

  const child = await getEsgDriverJob(childId, userId);
  if (!child) {
    throw new Error("Failed to create ESG driver resume job.");
  }
  return child;
}

export async function updateEsgDriverJobProgress(
  id: string,
  leaseOwner: string,
  patch: {
    status?: EsgDriverJobStatus;
    progress?: number;
    stage?: string;
    error?: string | null;
    detail?: EsgDriverProgressDetail;
  },
): Promise<void> {
  await ensureEsgDriverJobsTable();
  if (patch.status && patch.status !== "processing") {
    throw new Error("Worker progress may only set the processing state.");
  }
  const progress = Math.max(0, Math.min(99, Math.floor(patch.progress ?? 0)));
  const activityEvent = buildActivityEvent(patch);

  const rows = await esgPrisma.$queryRaw<Array<{ id: string }>>`
    WITH owned_queue AS (
      UPDATE background_jobs
      SET progress = ${progress},
          progress_json = ${JSON.stringify({ stage: patch.stage ?? "processing" })}::jsonb,
          heartbeat_at = now(),
          lease_expires_at = now() + (90 * INTERVAL '1 second'),
          updated_at = now()
      WHERE id = ${id}::uuid
        AND job_type = 'esg_driver'
        AND status = 'processing'
        AND lease_owner = ${leaseOwner}
        AND lease_expires_at >= now()
        AND cancel_requested = FALSE
      RETURNING id
    )
    UPDATE esg_driver_jobs AS domain
    SET
      status = 'processing',
      progress = ${progress},
      stage = ${patch.stage ?? "processing"},
      error_message = ${patch.error ?? null},
      activity_json = (
        SELECT COALESCE(jsonb_agg(recent.item ORDER BY recent.ordinal), '[]'::jsonb)
        FROM (
          SELECT entry.item, entry.ordinal
          FROM jsonb_array_elements(
            domain.activity_json || ${JSON.stringify([activityEvent])}::jsonb
          ) WITH ORDINALITY AS entry(item, ordinal)
          ORDER BY entry.ordinal DESC
          LIMIT 180
        ) AS recent
      ),
      updated_at = now(),
      completed_at = NULL
    FROM owned_queue
    WHERE domain.id = owned_queue.id
      AND domain.status IN ('queued', 'processing')
    RETURNING domain.id::text
  `;
  if (rows.length === 0) {
    await throwIfJobCancelled(id, leaseOwner);
    throw new Error("ESG driver domain row is missing or already terminal.");
  }
}

export async function updateEsgDriverJobCheckpoint(
  id: string,
  leaseOwner: string,
  checkpoint: EsgDriverCheckpoint,
): Promise<void> {
  await ensureEsgDriverJobsTable();

  const rows = await esgPrisma.$queryRaw<Array<{ id: string }>>`
    WITH owned_queue AS (
      UPDATE background_jobs
      SET heartbeat_at = now(),
          lease_expires_at = now() + (90 * INTERVAL '1 second'),
          updated_at = now()
      WHERE id = ${id}::uuid
        AND job_type = 'esg_driver'
        AND status = 'processing'
        AND lease_owner = ${leaseOwner}
        AND lease_expires_at >= now()
        AND cancel_requested = FALSE
      RETURNING id
    )
    UPDATE esg_driver_jobs AS domain
    SET checkpoint_json = ${JSON.stringify(checkpoint)}::jsonb,
        catalog_version = ${checkpoint.catalogVersion},
        updated_at = now()
    FROM owned_queue
    WHERE domain.id = owned_queue.id
      AND domain.status IN ('queued', 'processing')
    RETURNING domain.id::text
  `;
  if (rows.length === 0) {
    await throwIfJobCancelled(id, leaseOwner);
    throw new JobLeaseLostError();
  }
}

export async function completeEsgDriverJob(
  id: string,
  leaseOwner: string,
  result: EsgDriverResult,
): Promise<boolean> {
  await ensureEsgDriverJobsTable();
  const completionStage =
    result.completion === "partial" ? "complete with omissions" : "complete";
  const queueResult = {
    generatedDrivers: result.drivers.length,
    expectedDrivers: result.expectedDriverCount ?? result.drivers.length,
    completion: result.completion ?? "complete",
    catalogVersion: result.catalogVersion,
  };
  return esgPrisma.$transaction(async (transaction) => {
    const queueRows = await transaction.$queryRaw<LockedQueueRow[]>`
      SELECT user_id, status, attempts, max_attempts, cancel_requested,
             lease_owner, lease_expires_at >= now() AS lease_valid
      FROM background_jobs
      WHERE id = ${id}::uuid AND job_type = 'esg_driver'
      FOR UPDATE
    `;
    const queue = queueRows[0];
    if (
      !queue ||
      queue.status !== "processing" ||
      queue.lease_owner !== leaseOwner ||
      !queue.lease_valid ||
      queue.cancel_requested
    ) {
      return false;
    }

    const domainRows = await transaction.$queryRaw<Array<{ status: EsgDriverJobStatus }>>`
      SELECT status FROM esg_driver_jobs
      WHERE id = ${id}::uuid AND user_id = ${queue.user_id}
      FOR UPDATE
    `;
    if (
      !domainRows[0] ||
      !["queued", "processing"].includes(domainRows[0].status)
    ) {
      return false;
    }

    const domainUpdated = await transaction.$executeRaw`
      UPDATE esg_driver_jobs
      SET status = 'done', progress = 100, stage = ${completionStage},
          error_message = NULL,
          result_json = ${JSON.stringify(result)}::jsonb,
          evidence_json = ${JSON.stringify(result.evidence)}::jsonb,
          catalog_version = ${result.catalogVersion},
          activity_json = activity_json || ${JSON.stringify([
            buildActivityEvent({
              status: "done",
              progress: 100,
              stage: completionStage,
            }),
          ])}::jsonb,
          updated_at = now(), completed_at = now()
      WHERE id = ${id}::uuid AND user_id = ${queue.user_id}
        AND status IN ('queued', 'processing')
    `;
    if (domainUpdated === 0) return false;

    const queueUpdated = await transaction.$executeRaw`
      UPDATE background_jobs
      SET status = 'done', progress = 100,
          result_json = ${JSON.stringify(queueResult)}::jsonb,
          lease_owner = NULL, lease_expires_at = NULL,
          heartbeat_at = now(), completed_at = now(), updated_at = now()
      WHERE id = ${id}::uuid
        AND job_type = 'esg_driver'
        AND status = 'processing'
        AND lease_owner = ${leaseOwner}
        AND lease_expires_at >= now()
        AND cancel_requested = FALSE
    `;
    if (queueUpdated === 0) {
      // Throwing is intentional: it rolls back the domain result written above.
      throw new JobLeaseLostError();
    }
    return true;
  });
}

export async function failEsgDriverJob(
  job: ClaimedBackgroundJob,
  error: string,
  options: { retryable?: boolean } = {},
): Promise<BackgroundJobTransition> {
  const retryAllowed = options.retryable !== false;
  const fallbackStatus: BackgroundJobStatus =
    retryAllowed && job.attempts < job.maxAttempts ? "queued" : "error";
  return esgPrisma.$transaction(async (transaction) => {
    const queueRows = await transaction.$queryRaw<LockedQueueRow[]>`
      SELECT user_id, status, attempts, max_attempts, cancel_requested,
             lease_owner, lease_expires_at >= now() AS lease_valid
      FROM background_jobs
      WHERE id = ${job.id}::uuid AND job_type = 'esg_driver'
      FOR UPDATE
    `;
    const queue = queueRows[0];
    if (
      !queue ||
      queue.status !== "processing" ||
      queue.lease_owner !== job.leaseOwner ||
      !queue.lease_valid
    ) {
      return { status: fallbackStatus, transitioned: false };
    }

    const retry =
      retryAllowed &&
      !queue.cancel_requested &&
      queue.attempts < queue.max_attempts;
    const status: BackgroundJobStatus = queue.cancel_requested
      ? "cancelled"
      : retry
        ? "queued"
        : "error";
    const delaySeconds = Math.min(
      300,
      5 * 2 ** Math.max(0, queue.attempts - 1),
    );
    const message = error.slice(0, 10_000);
    const queueUpdated = await transaction.$executeRaw`
      UPDATE background_jobs
      SET status = ${status},
          progress = CASE WHEN ${retry} THEN LEAST(progress, 99) ELSE 100 END,
          last_error = ${message},
          available_at = CASE
            WHEN ${retry} THEN now() + (${delaySeconds} * INTERVAL '1 second')
            ELSE available_at
          END,
          lease_owner = NULL, lease_expires_at = NULL,
          completed_at = CASE WHEN ${retry} THEN NULL ELSE now() END,
          updated_at = now()
      WHERE id = ${job.id}::uuid
        AND job_type = 'esg_driver'
        AND status = 'processing'
        AND lease_owner = ${job.leaseOwner}
        AND lease_expires_at >= now()
    `;
    if (queueUpdated === 0) {
      return { status: fallbackStatus, transitioned: false };
    }
    const stage = status === "queued" ? "retry scheduled" : status;
    await transaction.$executeRaw`
      UPDATE esg_driver_jobs
      SET status = ${status},
          progress = CASE WHEN ${retry} THEN LEAST(progress, 99) ELSE 100 END,
          stage = ${stage},
          error_message = ${status === "cancelled" ? null : message},
          activity_json = activity_json || ${JSON.stringify([
            buildActivityEvent({
              status: status as EsgDriverJobStatus,
              progress: retry ? Math.min(job.progress, 99) : 100,
              stage,
            }),
          ])}::jsonb,
          completed_at = CASE WHEN ${retry} THEN NULL ELSE now() END,
          updated_at = now()
      WHERE id = ${job.id}::uuid AND user_id = ${queue.user_id}
        AND status IN ('queued', 'processing')
    `;
    return { status, transitioned: true };
  });
}

export function isRetryableEsgDriverFailure(error: unknown): boolean {
  return isTransientEsgDriverError(error);
}

export async function markEsgDriverJobCancelled(
  id: string,
  leaseOwner: string,
): Promise<boolean> {
  return esgPrisma.$transaction(async (transaction) => {
    const queueRows = await transaction.$queryRaw<LockedQueueRow[]>`
      SELECT user_id, status, attempts, max_attempts, cancel_requested,
             lease_owner, lease_expires_at >= now() AS lease_valid
      FROM background_jobs
      WHERE id = ${id}::uuid AND job_type = 'esg_driver'
      FOR UPDATE
    `;
    const queue = queueRows[0];
    if (
      !queue ||
      queue.status !== "processing" ||
      queue.lease_owner !== leaseOwner ||
      !queue.lease_valid ||
      !queue.cancel_requested
    ) {
      return false;
    }

    const queueUpdated = await transaction.$executeRaw`
      UPDATE background_jobs
      SET status = 'cancelled', progress = 100,
          lease_owner = NULL, lease_expires_at = NULL,
          completed_at = now(), updated_at = now()
      WHERE id = ${id}::uuid
        AND job_type = 'esg_driver'
        AND status = 'processing'
        AND lease_owner = ${leaseOwner}
        AND lease_expires_at >= now()
    `;
    if (queueUpdated === 0) return false;
    await transaction.$executeRaw`
      UPDATE esg_driver_jobs
      SET status = 'cancelled', progress = 100, stage = 'cancelled',
          error_message = NULL,
          activity_json = activity_json || ${JSON.stringify([
            buildActivityEvent({
              status: "cancelled",
              progress: 100,
              stage: "cancelled",
            }),
          ])}::jsonb,
          completed_at = now(), updated_at = now()
      WHERE id = ${id}::uuid AND user_id = ${queue.user_id}
        AND status IN ('queued', 'processing')
    `;
    return true;
  });
}

export async function getEsgDriverJob(
  id: string,
  userId: number,
  options: { includeCheckpoint?: boolean } = {},
): Promise<EsgDriverJob | null> {
  if (!isDriverJobId(id)) return null;
  await ensureEsgDriverJobsTable();

  const rows = await esgPrisma.$queryRaw<EsgDriverJobRow[]>`
    SELECT
      id::text,
      user_id,
      country,
      sector,
	      language,
	      status,
	      progress,
	      stage,
	      activity_json,
	      error_message,
      result_json,
      evidence_json,
      CASE
        WHEN ${options.includeCheckpoint === true} THEN checkpoint_json
        ELSE NULL::jsonb
      END AS checkpoint_json,
      catalog_version,
      parent_job_id::text,
      created_at,
      updated_at,
      completed_at
    FROM esg_driver_jobs
    WHERE id = ${id}::uuid AND user_id = ${userId}
    LIMIT 1
  `;

  return rows[0] ? mapJobRow(rows[0]) : null;
}

export async function listEsgDriverJobs(
  userId: number,
  limit = 20,
): Promise<EsgDriverJob[]> {
  return (await listEsgDriverJobsPage(userId, { limit })).jobs;
}

export async function listEsgDriverJobsPage(
  userId: number,
  options: { cursor?: string | null; limit?: number } = {},
): Promise<EsgDriverJobsPage> {
  await ensureEsgDriverJobsTable();
  const limit = Math.max(1, Math.min(options.limit ?? 20, 50));
  const cursor = decodeJobsCursor(options.cursor);

  const rows = cursor
    ? await esgPrisma.$queryRaw<EsgDriverJobRow[]>`
        SELECT id::text, user_id, country, sector, language, status, progress,
               stage, activity_json, error_message, result_json, evidence_json,
               NULL::jsonb AS checkpoint_json, catalog_version, parent_job_id::text,
               created_at, updated_at, completed_at
        FROM esg_driver_jobs
        WHERE user_id = ${userId}
          AND (
            COALESCE(created_at, to_timestamp(0)) < ${cursor.createdAt}::timestamptz
            OR (
              COALESCE(created_at, to_timestamp(0)) = ${cursor.createdAt}::timestamptz
              AND id < ${cursor.id}::uuid
            )
          )
        ORDER BY COALESCE(created_at, to_timestamp(0)) DESC, id DESC
        LIMIT ${limit + 1}
      `
    : await esgPrisma.$queryRaw<EsgDriverJobRow[]>`
        SELECT id::text, user_id, country, sector, language, status, progress,
               stage, activity_json, error_message, result_json, evidence_json,
               NULL::jsonb AS checkpoint_json, catalog_version, parent_job_id::text,
               created_at, updated_at, completed_at
        FROM esg_driver_jobs
        WHERE user_id = ${userId}
        ORDER BY COALESCE(created_at, to_timestamp(0)) DESC, id DESC
        LIMIT ${limit + 1}
      `;
  const [aggregate] = await esgPrisma.$queryRaw<Array<{
    completed: number;
    needs_attention: number;
    total: number;
  }>>`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE status = 'done')::int AS completed,
           COUNT(*) FILTER (
             WHERE status = 'error'
                OR (status = 'done' AND result_json->>'completion' = 'partial')
           )::int AS needs_attention
    FROM esg_driver_jobs
    WHERE user_id = ${userId}
  `;

  const hasMore = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  const last = hasMore ? pageRows.at(-1) : undefined;
  return {
    jobs: pageRows.map(mapJobRow),
    nextCursor: last ? encodeJobsCursor(last) : null,
    total: Number(aggregate?.total ?? 0),
    completed: Number(aggregate?.completed ?? 0),
    needsAttention: Number(aggregate?.needs_attention ?? 0),
  };
}

export async function deleteEsgDriverJob(
  id: string,
  userId: number,
): Promise<"deleted" | "cancelling" | "linked" | false> {
  if (!isDriverJobId(id)) return false;
  await ensureEsgDriverJobsTable();
  return esgPrisma.$transaction(async (transaction) => {
    // Locking the queue row closes the claim/delete race: SKIP LOCKED claimers
    // cannot acquire this job until the cancellation or deletion commits.
    const queueRows = await transaction.$queryRaw<Array<{ status: BackgroundJobStatus }>>`
      SELECT status FROM background_jobs
      WHERE id = ${id}::uuid AND user_id = ${userId} AND job_type = 'esg_driver'
      FOR UPDATE
    `;
    const queue = queueRows[0];

    // The queue row is locked first to preserve the worker/delete lock order.
    // Locking the domain row next also serializes deletion with child creation,
    // whose foreign key depends on this parent row remaining durable.
    const domainRows = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT id::text
      FROM esg_driver_jobs
      WHERE id = ${id}::uuid AND user_id = ${userId}
      FOR UPDATE
    `;
    if (!domainRows[0]) return false;

    const childRows = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT id::text
      FROM esg_driver_jobs
      WHERE parent_job_id = ${id}::uuid
      LIMIT 1
    `;
    const hasChildren = childRows.length > 0;
    if (!queue) {
      // Pre-queue legacy records have no worker capable of owning them. Permit
      // their owner to remove them instead of leaving an undeletable zombie.
      if (hasChildren) return "linked";
      const legacyDeleted = await transaction.$executeRaw`
        DELETE FROM esg_driver_jobs
        WHERE id = ${id}::uuid AND user_id = ${userId}
      `;
      return legacyDeleted > 0 ? "deleted" : false;
    }

    if (queue.status === "processing") {
      await transaction.$executeRaw`
        UPDATE background_jobs
        SET cancel_requested = TRUE, updated_at = now()
        WHERE id = ${id}::uuid AND user_id = ${userId} AND status = 'processing'
      `;
      await transaction.$executeRaw`
        UPDATE esg_driver_jobs
        SET stage = 'cancelling', updated_at = now()
        WHERE id = ${id}::uuid AND user_id = ${userId}
          AND status IN ('queued', 'processing')
      `;
      return "cancelling";
    }

    if (!["queued", "done", "error", "cancelled"].includes(queue.status)) {
      return false;
    }
    if (hasChildren) return "linked";
    await transaction.$executeRaw`
      DELETE FROM background_jobs
      WHERE id = ${id}::uuid AND user_id = ${userId}
    `;
    const deleted = await transaction.$executeRaw`
      DELETE FROM esg_driver_jobs
      WHERE id = ${id}::uuid AND user_id = ${userId}
    `;
    return deleted > 0 ? "deleted" : false;
  });
}

function encodeJobsCursor(row: EsgDriverJobRow): string {
  const createdAt = toIso(row.created_at) ?? new Date(0).toISOString();
  return Buffer.from(JSON.stringify({ createdAt, id: row.id }), "utf8").toString(
    "base64url",
  );
}

function decodeJobsCursor(
  cursor: string | null | undefined,
): { createdAt: string; id: string } | null {
  if (!cursor) return null;
  if (cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(cursor)) {
    throw new InvalidEsgDriverJobsCursorError();
  }
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      !parsed ||
      typeof parsed.createdAt !== "string" ||
      !Number.isFinite(new Date(parsed.createdAt).getTime()) ||
      typeof parsed.id !== "string" ||
      !isDriverJobId(parsed.id)
    ) {
      throw new InvalidEsgDriverJobsCursorError();
    }
    return { createdAt: new Date(parsed.createdAt).toISOString(), id: parsed.id };
  } catch (error) {
    if (error instanceof InvalidEsgDriverJobsCursorError) throw error;
    throw new InvalidEsgDriverJobsCursorError();
  }
}

function mapJobRow(row: EsgDriverJobRow): EsgDriverJob {
  return {
    id: row.id,
    userId: row.user_id,
    country: row.country,
    sector: row.sector,
    language: row.language,
	    status: row.status,
	    progress: row.progress,
	    stage: row.stage,
	    error: row.error_message,
	    result: row.result_json,
	    evidence: row.evidence_json || row.result_json?.evidence || [],
	    checkpoint: row.checkpoint_json,
	    catalogVersion: row.catalog_version,
	    parentJobId: row.parent_job_id,
	    activity: row.activity_json || [],
	    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    completedAt: toIso(row.completed_at),
  };
}

function buildActivityEvent(patch: {
  status?: EsgDriverJobStatus;
  progress?: number;
  stage?: string;
  detail?: EsgDriverProgressDetail;
}): EsgDriverJobActivity {
  const timestamp = new Date().toISOString();
  const stage = patch.stage || patch.status || "processing";

  return {
    id: randomUUID(),
    timestamp,
    stage,
    progress: patch.progress ?? 0,
    status: patch.status || "processing",
    ...(patch.detail ? { detail: sanitizeProgressDetail(patch.detail) } : {}),
  };
}

function sanitizeProgressDetail(
  detail: EsgDriverProgressDetail,
): EsgDriverProgressDetail {
  const clean = (value: string | undefined, limit: number) =>
    value?.replace(/\s+/g, " ").trim().slice(0, limit) || undefined;
  const safeUrl = (value: string | undefined) => {
    if (!value) return undefined;
    try {
      const url = new URL(value);
      return url.protocol === "https:" || url.protocol === "http:"
        ? url.toString().slice(0, 1_500)
        : undefined;
    } catch {
      return undefined;
    }
  };

  return {
    ...detail,
    title: clean(detail.title, 160),
    detail: clean(detail.detail, 800),
    driverId: clean(detail.driverId, 24),
    candidateId: clean(detail.candidateId, 180),
    query: clean(detail.query, 500),
    reasons: detail.reasons
      ?.map((reason) => clean(reason, 300))
      .filter((reason): reason is string => Boolean(reason))
      .slice(0, 6),
    results: detail.results?.slice(0, 6).map((result) => ({
      title: clean(result.title, 220) || "Source result",
      url: safeUrl(result.url),
      domain: clean(result.domain, 180),
      outcome: result.outcome,
    })),
  };
}

function toIso(value: Date | string | null): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
