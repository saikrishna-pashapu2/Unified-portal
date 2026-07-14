import os from "node:os";
import { randomUUID } from "node:crypto";
import { esgPrisma } from "@esgcredit/db-esg";
import { runEsgDriverGenerationJob } from "@/lib/esg-drivers/runner";
import {
  failEsgDriverJob,
  isRetryableEsgDriverFailure,
  markEsgDriverJobCancelled,
} from "@/lib/esg-drivers/jobs";
import {
  claimBackgroundJobs,
  completeBackgroundJob,
  failBackgroundJob,
  heartbeatBackgroundJob,
  JobCancelledError,
  JobLeaseLostError,
  reconcileTerminalDomainJobs,
  throwIfJobCancelled,
  type ClaimedBackgroundJob,
} from "@/lib/jobs/queue";

const workerId = `${os.hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
const runOnce = process.argv.includes("--once");
const checkDatabasesOnly = process.argv.includes("--check-db");
const concurrency = boundedInteger(process.env.WORKER_CONCURRENCY, 2, 1, 10);
let stopping = false;

process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});

async function main(): Promise<void> {
  await esgPrisma.$connect();
  await verifyWorkerSchema();
  await reconcileTerminalDomainJobs();
  console.log(`[esg-driver-worker] started ${workerId} (concurrency=${concurrency})`);

  const activeJobs = new Set<Promise<void>>();
  do {
    if (!stopping) {
      const availableSlots = concurrency - activeJobs.size;
      if (availableSlots > 0) {
        const jobs = await claimBackgroundJobs(workerId, availableSlots, 90);
        for (const job of jobs) {
          let task!: Promise<void>;
          task = executeJob(job)
            .catch((error) => {
              console.error(
                `[esg-driver-worker] unhandled execution error for ${job.id}`,
                error,
              );
            })
            .finally(() => activeJobs.delete(task));
          activeJobs.add(task);
        }
      }
    }

    if (runOnce || stopping) break;
    await Promise.race([
      ...activeJobs,
      new Promise<void>((resolve) => setTimeout(resolve, 500)),
    ]);
  } while (!stopping);

  await Promise.allSettled(activeJobs);
  await esgPrisma.$disconnect();
  console.log(`[esg-driver-worker] stopped ${workerId}`);
}

async function executeJob(job: ClaimedBackgroundJob): Promise<void> {
  let heartbeatObservedLeaseLoss = false;
  const heartbeat = setInterval(() => {
    void heartbeatBackgroundJob(job.id, job.leaseOwner)
      .then((owned) => {
        if (!owned) heartbeatObservedLeaseLoss = true;
      })
      .catch((error) => {
        console.error(`[esg-driver-worker] heartbeat failed for ${job.id}`, error);
      });
  }, 20_000);
  heartbeat.unref();

  try {
    if (job.jobType !== "esg_driver") {
      throw new Error(`Unsupported job type for ESG Drivers worker: ${job.jobType}`);
    }

    const output = await runEsgDriverGenerationJob(job as any);
    if (output.queueCompleted) return;
    if (heartbeatObservedLeaseLoss) {
      await throwIfJobCancelled(job.id, job.leaseOwner);
    }
    const completed = await completeBackgroundJob(job.id, job.leaseOwner, output);
    if (!completed) {
      await throwIfJobCancelled(job.id, job.leaseOwner);
      throw new JobLeaseLostError();
    }
  } catch (error) {
    if (error instanceof JobCancelledError) {
      const transitioned = await markEsgDriverJobCancelled(job.id, job.leaseOwner);
      if (!transitioned) {
        console.warn(`[esg-driver-worker] cancellation lease lost for ${job.id}`);
      }
      return;
    }
    if (error instanceof JobLeaseLostError) {
      console.warn(`[esg-driver-worker] lease lost for ${job.id}; stale result discarded`);
      return;
    }

    const message = error instanceof Error ? error.message : "Worker failure";
    const transition =
      job.jobType === "esg_driver"
        ? await failEsgDriverJob(job, message, {
            retryable: isRetryableEsgDriverFailure(error),
          })
        : await failBackgroundJob(job, message);
    if (!transition.transitioned) {
      console.warn(`[esg-driver-worker] failure lease lost for ${job.id}`);
      return;
    }
    console.error(
      `[esg-driver-worker] ${job.id} failed (${transition.status}): ${message}`,
    );
  } finally {
    clearInterval(heartbeat);
  }
}

async function verifyWorkerSchema(): Promise<void> {
  const requiredTables = [
    "background_jobs",
    "esg_driver_jobs",
    "api_usage_buckets",
  ];
  const tables = await esgPrisma.$queryRaw<Array<{ name: string; present: boolean }>>`
    SELECT name, to_regclass('public.' || name) IS NOT NULL AS present
    FROM unnest(${requiredTables}::text[]) AS name
  `;
  const missingTables = tables.filter((row) => !row.present).map((row) => row.name);
  const requiredColumns = ["checkpoint_json", "catalog_version", "parent_job_id"];
  const columns = await esgPrisma.$queryRaw<Array<{ name: string }>>`
    SELECT column_name AS name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'esg_driver_jobs'
      AND column_name = ANY(${requiredColumns}::text[])
  `;
  const presentColumns = new Set(columns.map((row) => row.name));
  const missingColumns = requiredColumns.filter((name) => !presentColumns.has(name));

  if (missingTables.length || missingColumns.length) {
    throw new Error(
      `ESG Drivers migrations are not deployed (${[
        ...missingTables.map((name) => `table ${name}`),
        ...missingColumns.map((name) => `column esg_driver_jobs.${name}`),
      ].join(", ")}). Run pnpm db:migrate:deploy.`,
    );
  }
}

function boundedInteger(
  raw: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(minimum, Math.min(parsed, maximum));
}

if (checkDatabasesOnly) {
  esgPrisma
    .$connect()
    .then(verifyWorkerSchema)
    .then(() => console.log("[esg-driver-worker] database and migration check passed"))
    .then(() => esgPrisma.$disconnect())
    .catch((error) => {
      console.error("[esg-driver-worker] database connectivity check failed", error);
      process.exitCode = 1;
    });
} else {
  main().catch((error) => {
    console.error("[esg-driver-worker] fatal error", error);
    process.exitCode = 1;
  });
}
