import { creditPrisma } from "@esgcredit/db-credit";
import { queueDueArticleWeeklyDigests } from "@/lib/alerts/article-weekly";
import { queueDueArticleAiJobs, reconcileArticleAiFeedback, runArticleAiJob } from "@/lib/article-ai/jobs";
import { reconcileDomainArticleAiFeedback } from "@/lib/article-ai/service";
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
  reconcileEsgDriverDomainJobs,
  reconcileTerminalDomainJobs,
  throwIfJobCancelled,
  type ClaimedBackgroundJob,
  type BackgroundJobType,
} from "@/lib/jobs/queue";
import {
  PDF_TRANSLATION_MAX_ATTEMPTS,
  processPdfTranslationV2Job,
} from "@/lib/pdfx-v2/pipeline";
import {
  isPdfxV2QueueJobType,
  PDFX_V2_MODEL,
  PDFX_V2_PIPELINE_VERSION,
  PDFX_V2_QUEUE_JOB_TYPE,
  PDFX_V2_QUEUE_JOB_TYPES,
} from "@/lib/pdfx-v2/constants";
import { isPdfxTerminalError } from "@/lib/pdfx-v2/request-budget";
import {
  ExcelRequestBudgetError,
  ExcelSelectionError,
  processExcelTranslation,
} from "@/lib/xlsx-translator/jobs";
import {
  createTransientPollState,
  pollWithTransientBackoff,
} from "@/lib/jobs/worker-resilience";

const workerId = `${os.hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
const runOnce = process.argv.includes("--once");
const checkDatabasesOnly = process.argv.includes("--check-db");
const esgDriversOnly = process.argv.includes("--esg-drivers-only");
const concurrency = boundedInteger(process.env.WORKER_CONCURRENCY, 2, 1, 10);
const emailPollMs = boundedInteger(process.env.WORKER_EMAIL_POLL_MS, 5_000, 1_000, 60_000);
const esgEventsDigestPollMs = 60_000;
const esgDriverJobTypes = [
  "esg_driver",
  "esg_driver_excel_v3",
  "esg_driver_excel_v4",
  "esg_driver_excel_v5",
  "esg_driver_excel_v6",
  "esg_driver_excel_v7",
  "esg_driver_excel_v8",
] as const;
const baseJobTypes: readonly BackgroundJobType[] = esgDriversOnly
  ? (["esg_driver_excel_v5", "esg_driver_excel_v6", "esg_driver_excel_v7", "esg_driver_excel_v8"] as const)
  : [
      ...esgDriverJobTypes,
      "xlsx_translation_v1",
      ...PDFX_V2_QUEUE_JOB_TYPES,
      ...(process.env.ARTICLE_AI_ENABLED === "true" ? [
        "article_ai_esg_v1" as const, "article_ai_esg_v2" as const, "article_ai_esg_v3" as const,
        "article_ai_credit_v1" as const, "article_ai_credit_v2" as const,
      ] : []),
    ];
let enabledJobTypes: BackgroundJobType[] = [...baseJobTypes];
let creditReady = false;
let lastCreditCheck = 0;
let lastArticlePoll = 0;
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
  if (!esgDriversOnly && process.env.ARTICLE_AI_ENABLED === "true") await refreshCreditCapability();
  if (esgDriversOnly) await reconcileEsgDriverDomainJobs();
  else await reconcileTerminalDomainJobs();
  console.log(`[esg-driver-worker] started ${workerId} (concurrency=${concurrency}, jobTypes=${enabledJobTypes.join(",")})`);
  if ((enabledJobTypes as readonly string[]).includes(PDFX_V2_QUEUE_JOB_TYPE)) {
    console.log(
      `[esg-driver-worker] PDF Translator ready (queue=${PDFX_V2_QUEUE_JOB_TYPE}, pipeline=${PDFX_V2_PIPELINE_VERSION}, model=${PDFX_V2_MODEL})`,
    );
  }

  const activeJobs = new Set<Promise<void>>();
  const claimPollState = createTransientPollState();
  let emailWork: Promise<void> | null = null;
  let esgEventsDigestWork: Promise<void> | null = null;
  let articleWork: Promise<void> | null = null;
  let creditCheckWork: Promise<void> | null = null;
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
            enabledJobTypes,
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
            if (isPdfxV2QueueJobType(job.jobType)) {
              console.log(`[esg-driver-worker] claimed PDF Translator job ${job.id} (${job.jobType}) on ${workerId}`);
            }
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

    if (!esgDriversOnly && !articleWork && Date.now() - lastArticlePoll >= 60_000) {
      lastArticlePoll = Date.now();
      articleWork = Promise.allSettled([
        queueDueArticleAiJobs(), queueDueArticleWeeklyDigests(),
        ...(creditReady ? [reconcileArticleAiFeedback(), reconcileDomainArticleAiFeedback()] : []),
      ]).then(results => {
        for (const result of results) {
          if (result.status === 'rejected') console.error('[esg-driver-worker] Article selection/digest check failed; will retry');
        }
      }).finally(() => { articleWork = null; });
    }
    if (!esgDriversOnly && process.env.ARTICLE_AI_ENABLED === 'true' && !creditCheckWork && Date.now() - lastCreditCheck >= 60_000) {
      creditCheckWork = refreshCreditCapability().finally(() => { creditCheckWork = null; });
    }
    if (!esgDriversOnly && !emailWork && Date.now() - lastEmailPoll >= emailPollMs) {
      lastEmailPoll = Date.now();
      emailWork = processEmailQueue(`${workerId}:email`, 10)
        .then(() => undefined)
        .catch((error) => console.error("[esg-driver-worker] email queue poll failed", error))
        .finally(() => {
          emailWork = null;
        });
    }
    if (
      !esgDriversOnly &&
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
    ...(articleWork ? [articleWork] : []),
    ...(creditCheckWork ? [creditCheckWork] : []),
    ...(esgEventsDigestWork ? [esgEventsDigestWork] : []),
  ]);
  await Promise.all([esgPrisma.$disconnect(), creditPrisma.$disconnect()]);
  console.log(`[esg-driver-worker] stopped ${workerId}`);
}

async function refreshCreditCapability(): Promise<void> {
  lastCreditCheck = Date.now();
  try {
    await creditPrisma.$connect();
    await creditPrisma.$queryRaw`SELECT user_id, content_id, content_type, created_at FROM likes LIMIT 0`;
    const restored = !creditReady;
    creditReady = true;
    enabledJobTypes = [...baseJobTypes, 'article_ai_credit_v3'];
    if (restored) console.log('[esg-driver-worker] Credit article AI ready');
  } catch {
    creditReady = false;
    enabledJobTypes = [...baseJobTypes];
    await creditPrisma.$disconnect().catch(() => undefined);
    console.warn('[esg-driver-worker] Credit article AI unavailable; retrying later');
  }
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
    const output = isEsgDriverJobType(job.jobType)
      ? await runEsgDriverGenerationJob(job as any)
      : job.jobType === "article_ai_esg_v1" || job.jobType === "article_ai_credit_v1"
        || job.jobType === "article_ai_esg_v2" || job.jobType === "article_ai_credit_v2"
        || job.jobType === "article_ai_esg_v3" || job.jobType === "article_ai_credit_v3"
        ? await runArticleAiJob(job)
      : job.jobType === "xlsx_translation_v1"
        ? await processExcelTranslation(job)
        : isPdfxV2QueueJobType(job.jobType)
        ? await processPdfTranslationV2Job(job as any)
        : (() => {
            throw new Error(`Unsupported job type for worker: ${job.jobType}`);
          })();
    if ("queueCompleted" in output && output.queueCompleted) return;
    if (heartbeatObservedLeaseLoss) {
      await throwIfJobCancelled(job.id, job.leaseOwner);
    }
    const completed = await completeBackgroundJob(job.id, job.leaseOwner, output);
    if (!completed) {
      await throwIfJobCancelled(job.id, job.leaseOwner);
      throw new JobLeaseLostError();
    }
  } catch (error) {
    if ((job.jobType === 'article_ai_credit_v1' || job.jobType === 'article_ai_credit_v2' || job.jobType === 'article_ai_credit_v3') && isTransientPrismaConnectivityError(error)) {
      creditReady = false;
      enabledJobTypes = [...baseJobTypes];
      await creditPrisma.$disconnect().catch(() => undefined);
    }
    if (error instanceof JobCancelledError) {
      const transitioned = isEsgDriverJobType(job.jobType)
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
    const transition = isEsgDriverJobType(job.jobType)
      ? await failEsgDriverJob(job, message, {
          retryable: isRetryableEsgDriverFailure(error),
        })
      : await failBackgroundJob(
          job,
          message,
          isPdfxV2QueueJobType(job.jobType)
            ? {
                maximumAttempts: PDF_TRANSLATION_MAX_ATTEMPTS,
                forceTerminal: isPdfxTerminalError(error),
              }
            : error instanceof ExcelRequestBudgetError || error instanceof ExcelSelectionError
              ? { forceTerminal: true }
              : undefined,
        );
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
      error,
    );
  } finally {
    clearInterval(heartbeat);
  }
}

async function verifyWorkerSchema(): Promise<void> {
  const requiredTables = [
    ...(process.env.ARTICLE_AI_ENABLED === "true" ? [
      "article_ai_preferences", "article_ai_profiles", "article_ai_article_features",
      "article_ai_runs", "article_ai_budgets", "article_ai_selections", "article_ai_feedback",
      "article_ai_domain_assessments", "article_ai_domain_selections",
      "article_ai_user_selections", "article_ai_domain_feedback",
      "article_ai_weekly_inputs", "article_ai_weekly_batches", "article_ai_weekly_batch_cache",
    ] : []),
    "background_jobs",
    "esg_driver_jobs",
    ...(esgDriversOnly ? [] : ["pdf_translation_v2_jobs", "pdf_translation_v2_pages"]),
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
  if (process.env.ARTICLE_AI_ENABLED === 'true') {
    const required = ['source_start_at', 'source_cutoff_at', 'processing_at', 'email_at',
      'valid_until', 'manifest_cutoff_at', 'phase', 'coverage_json', 'manifest_hash'];
    const columns = await esgPrisma.$queryRaw<Array<{ name: string }>>`
      SELECT column_name AS name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'article_ai_domain_assessments'
        AND column_name = ANY(${required}::text[])
    `;
    const present = new Set(columns.map((row) => row.name));
    if (required.some((name) => !present.has(name))) {
      throw new Error('Weekly article AI migrations are not deployed. Run pnpm db:migrate:deploy.');
    }
  }
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

function isEsgDriverJobType(jobType: string): boolean {
  return (
    jobType === "esg_driver" ||
    jobType === "esg_driver_excel_v3" ||
    jobType === "esg_driver_excel_v4" ||
    jobType === "esg_driver_excel_v5" ||
    jobType === "esg_driver_excel_v6" ||
    jobType === "esg_driver_excel_v7" ||
    jobType === "esg_driver_excel_v8"
  );
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
    .then(async () => {
      if (process.env.ARTICLE_AI_ENABLED === 'true') {
        await refreshCreditCapability();
        if (!creditReady) throw new Error('Article AI preflight requires the Credit database and likes schema');
      }
      console.log('[esg-driver-worker] database and migration check passed');
    })
    .finally(() => Promise.all([esgPrisma.$disconnect(), creditPrisma.$disconnect()]))
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
