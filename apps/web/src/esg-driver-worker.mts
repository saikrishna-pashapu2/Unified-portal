import os from "node:os";
import { randomUUID } from "node:crypto";
import {
  connectEsgWithRetry,
  esgPrisma,
  isTransientPrismaConnectivityError,
} from "@esgcredit/db-esg";
import { processEmailQueue } from "@/lib/alerts/email-queue";
import { runEsgDriverGenerationJob } from "@/lib/esg-drivers/runner";
import { queueDueEsgEventsWeeklyDigest } from "@/lib/esg-events/weekly-digest";
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
  markBackgroundJobCancelled,
  reconcileTerminalDomainJobs,
  throwIfJobCancelled,
  type ClaimedBackgroundJob,
} from "@/lib/jobs/queue";
import {
  PDF_TRANSLATION_MAX_ATTEMPTS,
  processPdfTranslationV2Job,
} from "@/lib/pdfx-v2/pipeline";
import { isPdfxV2QueueJobType } from "@/lib/pdfx-v2/constants";
import { isPdfxBudgetError } from "@/lib/pdfx-v2/request-budget";
import {
  createTransientPollState,
  pollWithTransientBackoff,
} from "@/lib/jobs/worker-resilience";

const workerId = `${os.hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
const runOnce = process.argv.includes("--once");
const checkDatabasesOnly = process.argv.includes("--check-db");
const concurrency = boundedInteger(process.env.WORKER_CONCURRENCY, 2, 1, 10);
const emailPollMs = boundedInteger(process.env.WORKER_EMAIL_POLL_MS, 5_000, 1_000, 60_000);
const esgEventsDigestPollMs = 60_000;
let stopping = false;
let lastEmailPoll = 0;
let lastEsgEventsDigestPoll = 0;

process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});

async function main(): Promise<void> {
  await connectEsgWithRetry();
  await verifyWorkerSchema();
  await reconcileTerminalDomainJobs();
  console.log(`[esg-driver-worker] started ${workerId} (concurrency=${concurrency})`);

  const activeJobs = new Set<Promise<void>>();
  const claimPollState = createTransientPollState();
  let emailWork: Promise<void> | null = null;
  let esgEventsDigestWork: Promise<void> | null = null;
  do {
    if (!stopping) {
      const availableSlots = concurrency - activeJobs.size;
      if (availableSlots > 0) {
        const claimResult = await pollWithTransientBackoff(
          claimPollState,
          () => claimBackgroundJobs(
            workerId,
            availableSlots,
            90,
            [
              "esg_driver",
              "pdf_translation_v2",
              "pdf_translation_v3",
              "pdf_translation_v4",
              "pdf_translation_v5",
            ],
            "generic",
          ),
          isTransientPrismaConnectivityError,
          { retryTransientErrors: !runOnce },
        );

        if (claimResult.status === "unavailable" && claimResult.firstFailure) {
          console.warn(
            `[esg-driver-worker] ESG database unavailable; queue polling paused and will ` +
            `retry in ${claimResult.retryDelayMs}ms: ${workerErrorMessage(claimResult.error)}`,
          );
        } else if (claimResult.status === "success") {
          if (claimResult.recovered) {
            console.log("[esg-driver-worker] ESG database connection restored; queue polling resumed");
          }
          for (const job of claimResult.value) {
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
    }

    if (!emailWork && Date.now() - lastEmailPoll >= emailPollMs) {
      lastEmailPoll = Date.now();
      emailWork = processEmailQueue(`${workerId}:email`, 10)
        .then(() => undefined)
        .catch((error) => console.error("[esg-driver-worker] email queue poll failed", error))
        .finally(() => {
          emailWork = null;
        });
    }
    if (
      !esgEventsDigestWork &&
      Date.now() - lastEsgEventsDigestPoll >= esgEventsDigestPollMs
    ) {
      lastEsgEventsDigestPoll = Date.now();
      esgEventsDigestWork = Promise.resolve()
        .then(() => queueDueEsgEventsWeeklyDigest())
        .then(() => undefined)
        .catch((error) => {
          console.error("[esg-driver-worker] ESG events digest due-check failed", error);
        })
        .finally(() => {
          esgEventsDigestWork = null;
        });
    }

    if (runOnce || stopping) break;
    await Promise.race([
      ...activeJobs,
      new Promise<void>((resolve) => setTimeout(resolve, 500)),
    ]);
  } while (!stopping);

  await Promise.allSettled([
    ...activeJobs,
    ...(emailWork ? [emailWork] : []),
    ...(esgEventsDigestWork ? [esgEventsDigestWork] : []),
  ]);
  await esgPrisma.$disconnect();
  console.log(`[esg-driver-worker] stopped ${workerId}`);
}

function workerErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
    const output = job.jobType === "esg_driver"
      ? await runEsgDriverGenerationJob(job as any)
      : isPdfxV2QueueJobType(job.jobType)
        ? await processPdfTranslationV2Job(job as any)
        : (() => {
            throw new Error(`Unsupported job type for worker: ${job.jobType}`);
          })();
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
      const transitioned = job.jobType === "esg_driver"
        ? await markEsgDriverJobCancelled(job.id, job.leaseOwner)
        : await markBackgroundJobCancelled(job.id, job.leaseOwner);
      if (transitioned && isPdfxV2QueueJobType(job.jobType)) {
        await synchronizePdfV2DomainJob(job, "cancelled", "Cancelled");
      }
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
    const transition = job.jobType === "esg_driver"
      ? await failEsgDriverJob(job, message, {
          retryable: isRetryableEsgDriverFailure(error),
        })
      : await failBackgroundJob(job, message, {
          maximumAttempts: PDF_TRANSLATION_MAX_ATTEMPTS,
          forceTerminal: isPdfxBudgetError(error),
        });
    if (!transition.transitioned) {
      console.warn(`[esg-driver-worker] failure lease lost for ${job.id}`);
      return;
    }
    if (isPdfxV2QueueJobType(job.jobType)) {
      await synchronizePdfV2DomainJob(
        job,
        transition.status === "error" ? "error" : "queued",
        transition.status === "error"
          ? "Translation could not continue automatically. Please contact support; completed pages were retained."
          : "This page needs another accuracy pass. Retrying automatically…",
      );
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
    "pdf_translation_v2_jobs",
    "pdf_translation_v2_pages",
    "api_usage_buckets",
    "alert_history",
    "email_queue",
    "esg_event_digest_recipients",
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
      `Worker migrations are not deployed (${[
        ...missingTables.map((name) => `table ${name}`),
        ...missingColumns.map((name) => `column esg_driver_jobs.${name}`),
      ].join(", ")}). Run pnpm db:migrate:deploy.`,
    );
  }
}

async function synchronizePdfV2DomainJob(
  job: ClaimedBackgroundJob,
  status: "queued" | "error" | "cancelled",
  message: string,
): Promise<void> {
  const terminal = status !== "queued";
  await esgPrisma.pdf_translation_v2_jobs.updateMany({
    where: {
      id: job.id,
      user_id: job.userId,
      status: { in: ["queued", "processing", "cancelling"] },
    },
    data: {
      status,
      stage: status,
      message,
      progress: terminal ? 100 : Math.min(job.progress, 99),
      completed_at: terminal ? new Date() : null,
    },
  });
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
  connectEsgWithRetry()
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
