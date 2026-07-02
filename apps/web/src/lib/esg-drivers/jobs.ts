import "server-only";

import { randomUUID } from "crypto";
import { esgPrisma } from "@esgcredit/db-esg";
import type {
  EsgDriverJobActivity,
  EsgDriverJob,
  EsgDriverJobStatus,
  EsgDriverResult,
  EsgDriverSource,
  GenerateEsgDriversInput,
} from "./types";

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
  activity_json: EsgDriverJobActivity[] | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
  completed_at: Date | string | null;
}

let ensureTablePromise: Promise<void> | null = null;

export function isDriverJobId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export async function ensureEsgDriverJobsTable(): Promise<void> {
  if (!ensureTablePromise) {
    ensureTablePromise = (async () => {
      await esgPrisma.$executeRaw`
        CREATE TABLE IF NOT EXISTS esg_driver_jobs (
          id uuid PRIMARY KEY,
          user_id integer NULL REFERENCES users(id) ON DELETE SET NULL,
          country varchar(120) NOT NULL,
          sector varchar(160) NOT NULL,
          language varchar(80) NOT NULL DEFAULT 'English',
          status varchar(20) NOT NULL DEFAULT 'queued',
          progress integer NOT NULL DEFAULT 0,
          stage varchar(120) NOT NULL DEFAULT 'queued',
          error_message text NULL,
          result_json jsonb NULL,
          evidence_json jsonb NULL,
          activity_json jsonb NOT NULL DEFAULT '[]'::jsonb,
          created_at timestamp(6) without time zone DEFAULT now(),
          updated_at timestamp(6) without time zone DEFAULT now(),
          completed_at timestamp(6) without time zone NULL
        )
      `;

      await esgPrisma.$executeRaw`
        ALTER TABLE esg_driver_jobs
        ADD COLUMN IF NOT EXISTS activity_json jsonb NOT NULL DEFAULT '[]'::jsonb
      `;

      await esgPrisma.$executeRaw`
        CREATE INDEX IF NOT EXISTS idx_esg_driver_jobs_status
        ON esg_driver_jobs(status)
      `;

      await esgPrisma.$executeRaw`
        CREATE INDEX IF NOT EXISTS idx_esg_driver_jobs_user_created
        ON esg_driver_jobs(user_id, created_at DESC)
      `;
    })();
  }

  return ensureTablePromise;
}

export async function createEsgDriverJob(
  userId: number,
  input: GenerateEsgDriversInput,
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
  await esgPrisma.$executeRaw`
    INSERT INTO esg_driver_jobs (
      id,
      user_id,
      country,
      sector,
      language,
      status,
      progress,
      stage,
      activity_json,
      created_at,
      updated_at
    )
    VALUES (
      ${id}::uuid,
      ${userId},
      ${input.country},
      ${input.sector},
      ${input.language},
      'queued',
      0,
      'queued',
      ${JSON.stringify(initialActivity)}::jsonb,
      now(),
      now()
    )
  `;

  const job = await getEsgDriverJob(id, userId);
  if (!job) {
    throw new Error("Failed to create ESG driver job.");
  }

  return job;
}

export async function updateEsgDriverJobProgress(
  id: string,
  patch: {
    status?: EsgDriverJobStatus;
    progress?: number;
    stage?: string;
    error?: string | null;
  },
): Promise<void> {
  await ensureEsgDriverJobsTable();
  const activityEvent = buildActivityEvent(patch);

  await esgPrisma.$executeRaw`
    UPDATE esg_driver_jobs
    SET
      status = COALESCE(${patch.status ?? null}, status),
      progress = COALESCE(${patch.progress ?? null}, progress),
      stage = COALESCE(${patch.stage ?? null}, stage),
      error_message = ${patch.error ?? null},
      activity_json = activity_json || ${JSON.stringify([activityEvent])}::jsonb,
      updated_at = now(),
      completed_at = CASE
        WHEN ${patch.status ?? null} IN ('done', 'error') THEN now()
        ELSE completed_at
      END
    WHERE id = ${id}::uuid
  `;
}

export async function completeEsgDriverJob(
  id: string,
  result: EsgDriverResult,
): Promise<void> {
  await ensureEsgDriverJobsTable();

  await esgPrisma.$executeRaw`
    UPDATE esg_driver_jobs
    SET
      status = 'done',
      progress = 100,
	      stage = 'complete',
	      error_message = NULL,
	      result_json = ${JSON.stringify(result)}::jsonb,
	      evidence_json = ${JSON.stringify(result.evidence)}::jsonb,
	      activity_json = activity_json || ${JSON.stringify([
          buildActivityEvent({
            status: "done",
            progress: 100,
            stage: "complete",
          }),
        ])}::jsonb,
	      updated_at = now(),
      completed_at = now()
    WHERE id = ${id}::uuid
  `;
}

export async function failEsgDriverJob(
  id: string,
  error: string,
): Promise<void> {
  await updateEsgDriverJobProgress(id, {
    status: "error",
    progress: 100,
    stage: "error",
    error,
  });
}

export async function getEsgDriverJob(
  id: string,
  userId: number,
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
      created_at,
      updated_at,
      completed_at
    FROM esg_driver_jobs
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT ${Math.max(1, Math.min(limit, 50))}
  `;

  return rows.map(mapJobRow);
}

export async function deleteEsgDriverJob(
  id: string,
  userId: number,
): Promise<boolean> {
  if (!isDriverJobId(id)) return false;
  await ensureEsgDriverJobsTable();

  const deleted = await esgPrisma.$executeRaw`
    DELETE FROM esg_driver_jobs
    WHERE id = ${id}::uuid AND user_id = ${userId}
  `;

  return deleted > 0;
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
}): EsgDriverJobActivity {
  const timestamp = new Date().toISOString();
  const stage = patch.stage || patch.status || "processing";

  return {
    id: `${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp,
    stage,
    progress: patch.progress ?? 0,
    status: patch.status || "processing",
  };
}

function toIso(value: Date | string | null): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
