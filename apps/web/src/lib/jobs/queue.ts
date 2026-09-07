import { randomUUID } from "node:crypto";
import { esgPrisma } from "@esgcredit/db-esg";

export const BACKGROUND_JOB_TYPES = [
  "pdf_translation_v2",
  "pdf_translation_v3",
  "pdf_translation_v4",
  "pdf_translation_v5",
  "esg_workbook",
  "fitch_workbook",
  "esg_driver",
] as const;

export type BackgroundJobType = (typeof BACKGROUND_JOB_TYPES)[number];
export type BackgroundWorkerKind = "generic" | "esg_driver";
export type BackgroundJobStatus =
  | "queued"
  | "processing"
  | "done"
  | "error"
  | "cancelled";

export interface BackgroundJob<TPayload = Record<string, unknown>> {
  id: string;
  jobType: BackgroundJobType;
  userId: number;
  payload: TPayload;
  inputData: Buffer | null;
  outputData: Buffer | null;
  result: unknown;
  status: BackgroundJobStatus;
  progress: number;
  progressData: unknown;
  attempts: number;
  maxAttempts: number;
  availableAt: Date;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  cancelRequested: boolean;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

/** A queue row returned by claimBackgroundJobs with an attempt-scoped fence. */
export type ClaimedBackgroundJob<TPayload = Record<string, unknown>> = Omit<
  BackgroundJob<TPayload>,
  "leaseOwner"
> & {
  leaseOwner: string;
};

interface BackgroundJobRow {
  id: string;
  job_type: BackgroundJobType;
  user_id: number;
  payload_json: Record<string, unknown>;
  input_data: Uint8Array | null;
  output_data: Uint8Array | null;
  result_json: unknown;
  status: BackgroundJobStatus;
  progress: number;
  progress_json: unknown;
  attempts: number;
  max_attempts: number;
  available_at: Date;
  lease_owner: string | null;
  lease_expires_at: Date | null;
  cancel_requested: boolean;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
}

type RawDatabaseClient = {
  $executeRaw: typeof esgPrisma.$executeRaw;
  $queryRaw: typeof esgPrisma.$queryRaw;
};

export class JobCancelledError extends Error {
  constructor() {
    super("Job was cancelled");
    this.name = "JobCancelledError";
  }
}

export class JobLeaseLostError extends Error {
  constructor() {
    super("Background job lease is no longer owned by this worker");
    this.name = "JobLeaseLostError";
  }
}

export interface BackgroundJobTransition {
  status: BackgroundJobStatus;
  transitioned: boolean;
}

export class JobConcurrencyLimitError extends Error {
  constructor() {
    super("Too many active jobs for this feature");
    this.name = "JobConcurrencyLimitError";
  }
}

export interface EnqueueBackgroundJobArgs {
  id: string;
  jobType: BackgroundJobType;
  userId: number;
  payload?: object;
  inputData?: Buffer;
  maxAttempts?: number;
  idempotencyKey?: string;
}

/**
 * Build the strict Prisma create payload used when a queue row must be committed
 * atomically with a feature-specific domain row. Unlike the standalone raw
 * enqueue helper, Prisma's create fails on an idempotency conflict so the whole
 * batch rolls back instead of leaving a domain row without a queue row.
 */
export function createBackgroundJobData(args: EnqueueBackgroundJobArgs) {
  const queuedAt = new Date();
  return {
    id: args.id,
    job_type: args.jobType,
    user_id: args.userId,
    payload_json: (args.payload ?? {}) as any,
    input_data: args.inputData ?? null,
    max_attempts: args.maxAttempts ?? 3,
    idempotency_key: args.idempotencyKey ?? `${args.jobType}:${args.id}`,
    status: "queued",
    available_at: queuedAt,
    created_at: queuedAt,
    updated_at: queuedAt,
  };
}

export function rethrowBackgroundJobEnqueueError(error: unknown): never {
  if (
    error instanceof Error &&
    error.message.includes("background_job_concurrency_limit")
  ) {
    throw new JobConcurrencyLimitError();
  }
  throw error;
}

export async function enqueueBackgroundJob(
  args: EnqueueBackgroundJobArgs,
  database: RawDatabaseClient = esgPrisma,
): Promise<void> {
  try {
    await database.$executeRaw`
      INSERT INTO background_jobs (
        id, job_type, user_id, payload_json, input_data, max_attempts,
        idempotency_key, status, available_at, created_at, updated_at
      ) VALUES (
        ${args.id}::uuid,
        ${args.jobType},
        ${args.userId},
        ${JSON.stringify(args.payload ?? {})}::jsonb,
        ${args.inputData ?? null},
        ${args.maxAttempts ?? 3},
        ${args.idempotencyKey ?? `${args.jobType}:${args.id}`},
        'queued',
        now(),
        now(),
        now()
      )
      ON CONFLICT (idempotency_key) DO NOTHING
    `;
  } catch (error) {
    rethrowBackgroundJobEnqueueError(error);
  }
}

export async function claimBackgroundJobs(
  workerId: string,
  limit = 2,
  leaseSeconds = 90,
  jobTypes: readonly BackgroundJobType[] = BACKGROUND_JOB_TYPES,
  workerKind: BackgroundWorkerKind = "generic",
): Promise<ClaimedBackgroundJob[]> {
  if (!workerId.trim()) throw new Error("Background job worker id is required");
  const safeJobTypes = Array.from(new Set(jobTypes));
  if (safeJobTypes.length === 0) return [];
  if (safeJobTypes.some((jobType) => !BACKGROUND_JOB_TYPES.includes(jobType))) {
    throw new Error("Unsupported background job type filter");
  }
  if (
    workerKind === "esg_driver" &&
    safeJobTypes.some((jobType) => jobType !== "esg_driver")
  ) {
    throw new Error("The ESG Drivers worker may only claim esg_driver jobs");
  }
  const safeLimit = Math.max(1, Math.min(limit, 20));
  const safeLease = Math.max(30, Math.min(leaseSeconds, 600));
  // The process id is diagnostic identity, not a fencing token. Rotate an
  // opaque attempt token on every claim call. The worker-kind prefix is also
  // enforced by the database routing guard so an obsolete specialized worker
  // cannot steal a PDF or workbook job.
  const leaseOwner = `${workerKind}:${randomUUID()}`;

  // Finalize abandoned jobs that were cancelled while their previous worker was
  // unavailable. Active workers observe cancel_requested via checkpoints.
  const cancelled = await esgPrisma.$queryRaw<Array<{
    id: string;
    job_type: BackgroundJobType;
    user_id: number;
  }>>`
    UPDATE background_jobs
    SET status = 'cancelled', completed_at = now(), lease_owner = NULL,
        lease_expires_at = NULL, updated_at = now()
    WHERE cancel_requested = TRUE
      AND job_type = ANY(${safeJobTypes}::text[])
      AND status IN ('queued', 'processing')
      AND (status = 'queued' OR lease_expires_at IS NULL OR lease_expires_at < now())
    RETURNING id::text, job_type, user_id
  `;
  await synchronizeReapedJobs(cancelled, "cancelled", "Cancelled");

  const exhausted = await esgPrisma.$queryRaw<Array<{
    id: string;
    job_type: BackgroundJobType;
    user_id: number;
  }>>`
    UPDATE background_jobs
    SET status = 'error', completed_at = now(), lease_owner = NULL,
        lease_expires_at = NULL,
        last_error = COALESCE(last_error, 'Worker lease expired after final attempt'),
        updated_at = now()
    WHERE status = 'processing'
      AND job_type = ANY(${safeJobTypes}::text[])
      AND attempts >= max_attempts
      AND (lease_expires_at IS NULL OR lease_expires_at < now())
    RETURNING id::text, job_type, user_id
  `;
  await synchronizeReapedJobs(
    exhausted,
    "error",
    "Worker lease expired after final attempt",
  );
  const rows = await esgPrisma.$queryRaw<BackgroundJobRow[]>`
    WITH candidates AS (
      SELECT id
      FROM background_jobs
      WHERE (
        (status = 'queued' AND available_at <= now())
        OR (
          status = 'processing'
          AND (lease_expires_at IS NULL OR lease_expires_at < now())
        )
      )
        AND job_type = ANY(${safeJobTypes}::text[])
        AND attempts < max_attempts
        AND cancel_requested = FALSE
      ORDER BY available_at ASC, created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${safeLimit}
    )
    UPDATE background_jobs AS job
    SET status = 'processing',
        attempts = job.attempts + 1,
        lease_owner = ${leaseOwner},
        lease_expires_at = now() + (${safeLease} * INTERVAL '1 second'),
        heartbeat_at = now(),
        updated_at = now()
    FROM candidates
    WHERE job.id = candidates.id
    RETURNING job.*
  `;

  return rows.map((row) => {
    const job = mapBackgroundJob(row);
    if (!job.leaseOwner) {
      throw new Error(`Claimed background job ${job.id} is missing its lease token`);
    }
    return { ...job, leaseOwner: job.leaseOwner };
  });
}

export async function getBackgroundJob(
  id: string,
  userId?: number,
): Promise<BackgroundJob | null> {
  if (!isUuid(id)) return null;

  const rows = userId === undefined
    ? await esgPrisma.$queryRaw<BackgroundJobRow[]>`
        SELECT * FROM background_jobs WHERE id = ${id}::uuid LIMIT 1
      `
    : await esgPrisma.$queryRaw<BackgroundJobRow[]>`
        SELECT * FROM background_jobs
        WHERE id = ${id}::uuid AND user_id = ${userId}
        LIMIT 1
      `;
  return rows[0] ? mapBackgroundJob(rows[0]) : null;
}

export async function updateBackgroundJobProgress(
  id: string,
  leaseOwner: string,
  progress: number,
  progressData?: unknown,
  leaseSeconds = 90,
): Promise<void> {
  const safeProgress = Math.max(0, Math.min(99, Math.floor(progress)));
  const safeLease = Math.max(30, Math.min(leaseSeconds, 600));
  const updated = await esgPrisma.$executeRaw`
    UPDATE background_jobs
    SET progress = ${safeProgress},
        progress_json = ${JSON.stringify(progressData ?? null)}::jsonb,
        heartbeat_at = now(),
        lease_expires_at = now() + (${safeLease} * INTERVAL '1 second'),
        updated_at = now()
    WHERE id = ${id}::uuid
      AND status = 'processing'
      AND lease_owner = ${leaseOwner}
      AND lease_expires_at >= now()
  `;
  if (updated === 0) throw new JobLeaseLostError();
}

export async function heartbeatBackgroundJob(
  id: string,
  leaseOwner: string,
  leaseSeconds = 90,
): Promise<boolean> {
  const safeLease = Math.max(30, Math.min(leaseSeconds, 600));
  const updated = await esgPrisma.$executeRaw`
    UPDATE background_jobs
    SET heartbeat_at = now(),
        lease_expires_at = now() + (${safeLease} * INTERVAL '1 second'),
        updated_at = now()
    WHERE id = ${id}::uuid
      AND status = 'processing'
      AND lease_owner = ${leaseOwner}
      AND lease_expires_at >= now()
  `;
  return updated > 0;
}

export async function throwIfJobCancelled(
  id: string,
  leaseOwner: string,
): Promise<void> {
  const rows = await esgPrisma.$queryRaw<Array<{
    cancel_requested: boolean;
    lease_owner: string | null;
    lease_valid: boolean;
    status: string;
  }>>`
    SELECT cancel_requested, lease_owner,
           lease_expires_at >= now() AS lease_valid, status
    FROM background_jobs
    WHERE id = ${id}::uuid
    LIMIT 1
  `;
  const row = rows[0];
  if (
    row?.cancel_requested &&
    row.lease_owner === leaseOwner &&
    row.status === "processing" &&
    row.lease_valid
  ) {
    throw new JobCancelledError();
  }
  if (
    !row ||
    row.status !== "processing" ||
    row.lease_owner !== leaseOwner ||
    !row.lease_valid
  ) {
    throw new JobLeaseLostError();
  }
}

export async function completeBackgroundJob(
  id: string,
  leaseOwner: string,
  args: { outputData?: Buffer; result?: unknown } = {},
): Promise<boolean> {
  const updated = await esgPrisma.$executeRaw`
    UPDATE background_jobs
    SET status = 'done', progress = 100,
        output_data = COALESCE(${args.outputData ?? null}, output_data),
        result_json = ${JSON.stringify(args.result ?? null)}::jsonb,
        lease_owner = NULL, lease_expires_at = NULL,
        heartbeat_at = now(), completed_at = now(), updated_at = now()
    WHERE id = ${id}::uuid
      AND status = 'processing'
      AND lease_owner = ${leaseOwner}
      AND lease_expires_at >= now()
      AND cancel_requested = FALSE
  `;
  return updated > 0;
}

export async function completePdfTranslationV2Job(
  id: string,
  userId: number,
  leaseOwner: string,
  args: {
    jobType: Extract<BackgroundJobType, "pdf_translation_v2" | "pdf_translation_v3" | "pdf_translation_v4" | "pdf_translation_v5">;
    outputPdf: Buffer;
    metrics: unknown;
    result: unknown;
    message: string;
  },
): Promise<void> {
  const completion = await esgPrisma.$queryRaw<Array<{
    queue_eligible: boolean;
    domain_updated: boolean;
    queue_completed: boolean;
  }>>`
    WITH eligible_queue AS MATERIALIZED (
      SELECT id
      FROM background_jobs
      WHERE id = ${id}::uuid
        AND job_type = ${args.jobType}
        AND user_id = ${userId}
        AND status = 'processing'
        AND lease_owner = ${leaseOwner}
        AND lease_expires_at >= now()
        AND cancel_requested = FALSE
      FOR UPDATE
    ),
    updated_domain AS (
      UPDATE pdf_translation_v2_jobs AS domain
      SET status = 'completed',
          stage = 'completed',
          message = ${args.message},
          progress = 100,
          current_page = domain.total_pages,
          output_pdf = ${args.outputPdf},
          metrics = ${JSON.stringify(args.metrics ?? {})}::jsonb,
          completed_at = now(),
          updated_at = now()
      FROM eligible_queue AS queue
      WHERE domain.id = queue.id
        AND domain.user_id = ${userId}
        AND domain.status IN ('queued', 'processing', 'completed')
      RETURNING domain.id
    ),
    completed_queue AS (
      UPDATE background_jobs AS queue
      SET status = 'done',
          progress = 100,
          output_data = NULL,
          result_json = ${JSON.stringify(args.result ?? null)}::jsonb,
          lease_owner = NULL,
          lease_expires_at = NULL,
          heartbeat_at = now(),
          completed_at = now(),
          updated_at = now()
      FROM updated_domain AS domain
      WHERE queue.id = domain.id
      RETURNING queue.id
    )
    SELECT
      EXISTS (SELECT 1 FROM eligible_queue) AS queue_eligible,
      EXISTS (SELECT 1 FROM updated_domain) AS domain_updated,
      EXISTS (SELECT 1 FROM completed_queue) AS queue_completed
  `;

  const result = completion[0];
  if (result?.queue_completed) return;
  if (result?.queue_eligible && !result.domain_updated) {
    throw new Error("PDF Translator record is missing or already terminal");
  }
  throw new JobLeaseLostError();
}

export async function failBackgroundJob(
  job: ClaimedBackgroundJob,
  error: string,
  options: { minimumAttempts?: number; keepRetrying?: boolean; maximumAttempts?: number; forceTerminal?: boolean } = {},
): Promise<BackgroundJobTransition> {
  const effectiveMaxAttempts = Math.min(options.maximumAttempts ?? Infinity, Math.max(
    job.maxAttempts,
    Math.max(1, Math.floor(options.minimumAttempts ?? job.maxAttempts)),
    options.keepRetrying ? job.attempts + 2 : 1,
  ));
  const retry = !options.forceTerminal && job.attempts < effectiveMaxAttempts;
  const delaySeconds = Math.min(300, 5 * 2 ** Math.max(0, job.attempts - 1));
  const rows = await esgPrisma.$queryRaw<Array<{ status: BackgroundJobStatus }>>`
    UPDATE background_jobs
    SET max_attempts = GREATEST(max_attempts, ${effectiveMaxAttempts}),
        status = CASE
          WHEN cancel_requested THEN 'cancelled'
          WHEN ${retry} THEN 'queued'
          ELSE 'error'
        END,
        progress = CASE
          WHEN cancel_requested OR NOT ${retry} THEN 100
          ELSE LEAST(progress, 99)
        END,
        last_error = ${error.slice(0, 10_000)},
        available_at = CASE
          WHEN NOT cancel_requested AND ${retry}
            THEN now() + (${delaySeconds} * INTERVAL '1 second')
          ELSE available_at
        END,
        lease_owner = NULL,
        lease_expires_at = NULL,
        completed_at = CASE
          WHEN cancel_requested OR NOT ${retry} THEN now()
          ELSE NULL
        END,
        updated_at = now()
    WHERE id = ${job.id}::uuid
      AND status = 'processing'
      AND lease_owner = ${job.leaseOwner}
      AND lease_expires_at >= now()
    RETURNING status
  `;
  return {
    status: rows[0]?.status ?? (retry ? "queued" : "error"),
    transitioned: rows.length > 0,
  };
}

export async function markBackgroundJobCancelled(
  id: string,
  leaseOwner: string,
): Promise<boolean> {
  const updated = await esgPrisma.$executeRaw`
    UPDATE background_jobs
    SET status = 'cancelled', cancel_requested = TRUE,
        progress = 100,
        lease_owner = NULL, lease_expires_at = NULL,
        completed_at = now(), updated_at = now()
    WHERE id = ${id}::uuid
      AND status = 'processing'
      AND lease_owner = ${leaseOwner}
      AND lease_expires_at >= now()
  `;
  return updated > 0;
}

export async function requestBackgroundJobCancellation(
  id: string,
  userId: number,
): Promise<BackgroundJobStatus | null> {
  if (!isUuid(id)) return null;
  const rows = await esgPrisma.$queryRaw<Array<{ status: BackgroundJobStatus }>>`
    WITH requested AS (
      UPDATE background_jobs
      SET cancel_requested = TRUE,
          status = CASE WHEN status = 'queued' THEN 'cancelled' ELSE status END,
          progress = CASE WHEN status = 'queued' THEN 100 ELSE progress END,
          lease_owner = CASE WHEN status = 'queued' THEN NULL ELSE lease_owner END,
          lease_expires_at = CASE WHEN status = 'queued' THEN NULL ELSE lease_expires_at END,
          completed_at = CASE WHEN status = 'queued' THEN now() ELSE completed_at END,
          updated_at = now()
      WHERE id = ${id}::uuid
        AND user_id = ${userId}
        AND status IN ('queued', 'processing')
      RETURNING status
    )
    SELECT status FROM requested
    UNION ALL
    SELECT status FROM background_jobs
    WHERE id = ${id}::uuid AND user_id = ${userId}
      AND NOT EXISTS (SELECT 1 FROM requested)
    LIMIT 1
  `;
  return rows[0]?.status ?? null;
}

/** Clear stale queue blobs after the domain record has become authoritative. */
export async function cleanupTerminalPdfJobBlobs(
  retentionHours = 24 * 7,
): Promise<number> {
  const safeHours = Number.isFinite(retentionHours)
    ? Math.max(1, Math.min(Math.floor(retentionHours), 24 * 365))
    : 24 * 7;
  const retentionSeconds = safeHours * 60 * 60;
  return esgPrisma.$executeRaw`
    UPDATE background_jobs
    SET input_data = NULL, output_data = NULL, updated_at = now()
    WHERE job_type IN ('pdf_translation_v2', 'pdf_translation_v3', 'pdf_translation_v4', 'pdf_translation_v5')
      AND status IN ('done', 'error', 'cancelled')
      AND completed_at < now() - (${retentionSeconds} * INTERVAL '1 second')
      AND (input_data IS NOT NULL OR output_data IS NOT NULL)
  `;
}

export async function deleteBackgroundJob(
  id: string,
  userId: number,
): Promise<boolean> {
  if (!isUuid(id)) return false;
  const deleted = await esgPrisma.$executeRaw`
    DELETE FROM background_jobs
    WHERE id = ${id}::uuid
      AND user_id = ${userId}
      AND status IN ('done', 'error', 'cancelled')
  `;
  return deleted > 0;
}

export async function countActiveJobs(
  userId: number,
  jobType?: BackgroundJobType,
): Promise<number> {
  const rows = jobType
    ? await esgPrisma.$queryRaw<Array<{ count: number }>>`
        SELECT COUNT(*)::int AS count FROM background_jobs
        WHERE user_id = ${userId}
          AND job_type = ${jobType}
          AND status IN ('queued', 'processing')
      `
    : await esgPrisma.$queryRaw<Array<{ count: number }>>`
        SELECT COUNT(*)::int AS count FROM background_jobs
        WHERE user_id = ${userId} AND status IN ('queued', 'processing')
      `;
  return Number(rows[0]?.count ?? 0);
}

function mapBackgroundJob(row: BackgroundJobRow): BackgroundJob {
  return {
    id: row.id,
    jobType: row.job_type,
    userId: row.user_id,
    payload: row.payload_json ?? {},
    inputData: row.input_data ? Buffer.from(row.input_data) : null,
    outputData: row.output_data ? Buffer.from(row.output_data) : null,
    result: row.result_json,
    status: row.status,
    progress: row.progress,
    progressData: row.progress_json,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    availableAt: row.available_at,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    cancelRequested: row.cancel_requested,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function synchronizeReapedJobs(
  jobs: Array<{ id: string; job_type: BackgroundJobType; user_id: number }>,
  status: "cancelled" | "error",
  message: string,
): Promise<void> {
  for (const job of jobs) {
    if (job.job_type === "esg_workbook") {
      await esgPrisma.file_uploads.updateMany({
        where: {
          task_id: job.id,
          user_id: job.user_id,
          status: { in: ["queued", "processing"] },
        },
        data: {
          status,
          progress: 100,
          error_message: status === "error" ? message : null,
          updated_at: new Date(),
        },
      });
    } else if (
      job.job_type === "pdf_translation_v2" ||
      job.job_type === "pdf_translation_v3" ||
      job.job_type === "pdf_translation_v4" ||
      job.job_type === "pdf_translation_v5"
    ) {
      await esgPrisma.pdf_translation_v2_jobs.updateMany({
        where: {
          id: job.id,
          user_id: job.user_id,
          status: { in: ["queued", "processing", "cancelling"] },
        },
        data: {
          status,
          stage: status,
          message,
          progress: 100,
          completed_at: new Date(),
        },
      });
    } else if (job.job_type === "esg_driver") {
      await esgPrisma.$executeRaw`
        UPDATE esg_driver_jobs
        SET status = ${status}, progress = 100, stage = ${status},
            error_message = ${status === "error" ? message : null},
            completed_at = now(), updated_at = now()
        WHERE id = ${job.id}::uuid AND user_id = ${job.user_id}
          AND status IN ('queued', 'processing')
      `;
    }
  }
}

export async function reconcileTerminalDomainJobs(): Promise<void> {
  // A process can die after the queue reaper commits but before its domain row
  // is synchronized. Reconcile from the queue (the lifecycle source of truth)
  // without ever replacing an already-terminal domain result.
  await esgPrisma.$executeRaw`
    UPDATE esg_driver_jobs AS domain
    SET status = queue.status,
        progress = 100,
        stage = queue.status,
        error_message = CASE
          WHEN queue.status = 'error' THEN COALESCE(queue.last_error, 'Worker failed')
          ELSE NULL
        END,
        completed_at = COALESCE(domain.completed_at, queue.completed_at, now()),
        updated_at = now()
    FROM background_jobs AS queue
    WHERE queue.id = domain.id
      AND queue.job_type = 'esg_driver'
      AND queue.status IN ('error', 'cancelled')
      AND domain.status IN ('queued', 'processing')
  `;
  await esgPrisma.$executeRaw`
    UPDATE file_uploads AS domain
    SET status = queue.status,
        progress = 100,
        error_message = CASE
          WHEN queue.status = 'error' THEN COALESCE(queue.last_error, 'Worker failed')
          ELSE NULL
        END,
        updated_at = now()
    FROM background_jobs AS queue
    WHERE queue.id::text = domain.task_id
      AND queue.job_type = 'esg_workbook'
      AND queue.status IN ('error', 'cancelled')
      AND domain.status IN ('queued', 'processing')
  `;
  await esgPrisma.$executeRaw`
    UPDATE pdf_translation_v2_jobs AS domain
    SET status = queue.status,
        stage = queue.status,
        progress = 100,
        message = CASE
          WHEN queue.status = 'error' THEN COALESCE(queue.last_error, 'Worker failed')
          ELSE 'Cancelled'
        END,
        completed_at = COALESCE(domain.completed_at, queue.completed_at, now()),
        updated_at = now()
    FROM background_jobs AS queue
    WHERE queue.id = domain.id
      AND queue.job_type IN ('pdf_translation_v2', 'pdf_translation_v3', 'pdf_translation_v4', 'pdf_translation_v5')
      AND queue.status IN ('error', 'cancelled')
      AND domain.status IN ('queued', 'processing', 'cancelling')
  `;
}
