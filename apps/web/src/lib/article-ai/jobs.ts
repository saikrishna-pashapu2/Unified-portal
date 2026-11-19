import "server-only";

import { randomUUID } from "node:crypto";

import { esgPrisma } from "@esgcredit/db-esg";
import { creditPrisma } from "@esgcredit/db-credit";

import {
  enqueueBackgroundJob,
  throwIfJobCancelled,
  type BackgroundJobType,
  type ClaimedBackgroundJob,
} from "@/lib/jobs/queue";
import { isArticleAiEnabled } from "./config";
import { getArticleAiDailyCalendar, getDueArticleAiDailySourceDay, isArticleAiDailyGenerationDue } from "./daily-calendar";
import { runArticleAiDailyAssessment } from "./daily";
import { getArticleAiWeeklyCalendar, isArticleAiWeeklyGenerationDue } from "./weekly-calendar";
import { runArticleAiWeeklyAssessment } from "./weekly";
import {
  ARTICLE_AI_DAILY_POLICY_VERSION,
  ARTICLE_AI_WEEKLY_POLICY_VERSION,
  type ArticleAiDomain,
  type ArticleAiDailyJobPayload,
  type ArticleAiWeeklyJobPayload,
} from "./types";

const LEGACY_ESG_JOB = "article_ai_esg_v1" as BackgroundJobType;
const LEGACY_CREDIT_JOB = "article_ai_credit_v1" as BackgroundJobType;
const RETIRED_ESG_JOB = "article_ai_esg_v2" as BackgroundJobType;
const RETIRED_CREDIT_JOB = "article_ai_credit_v2" as BackgroundJobType;
const ESG_JOB = "article_ai_esg_v3" as BackgroundJobType;
const CREDIT_JOB = "article_ai_credit_v3" as BackgroundJobType;
const DAILY_ESG_JOB = "article_ai_esg_v4" as BackgroundJobType;
const DAILY_CREDIT_JOB = "article_ai_credit_v4" as BackgroundJobType;

function isDomain(value: unknown): value is ArticleAiDomain {
  return value === "esg" || value === "credit";
}

function parseWeeklyPayload(job: ClaimedBackgroundJob): ArticleAiWeeklyJobPayload {
  const payload = job.payload as Record<string, unknown>;
  const expectedDomain = job.jobType === ESG_JOB ? "esg" : job.jobType === CREDIT_JOB ? "credit" : null;
  if (!expectedDomain || !isDomain(payload.domain) || payload.domain !== expectedDomain
      || payload.policyVersion !== ARTICLE_AI_WEEKLY_POLICY_VERSION
      || typeof payload.targetWeekKey !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(payload.targetWeekKey)) {
    throw new Error("Invalid article AI weekly job payload");
  }
  const calendar = getArticleAiWeeklyCalendar(payload.targetWeekKey);
  if (calendar.targetWeekKey !== payload.targetWeekKey) throw new Error("Invalid article AI weekly target week");
  return { domain: payload.domain, targetWeekKey: calendar.targetWeekKey, policyVersion: ARTICLE_AI_WEEKLY_POLICY_VERSION };
}

function parseDailyPayload(job: ClaimedBackgroundJob): ArticleAiDailyJobPayload {
  const payload = job.payload as Record<string, unknown>;
  const expectedDomain = job.jobType === DAILY_ESG_JOB ? "esg" : job.jobType === DAILY_CREDIT_JOB ? "credit" : null;
  if (!expectedDomain || !isDomain(payload.domain) || payload.domain !== expectedDomain
      || payload.policyVersion !== ARTICLE_AI_DAILY_POLICY_VERSION
      || typeof payload.sourceDayKey !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(payload.sourceDayKey)) {
    throw new Error("Invalid article AI daily job payload");
  }
  const calendar = getArticleAiDailyCalendar(payload.sourceDayKey);
  if (calendar.sourceDayKey !== payload.sourceDayKey) throw new Error("Invalid article AI daily source day");
  return { domain: payload.domain, sourceDayKey: calendar.sourceDayKey, policyVersion: ARTICLE_AI_DAILY_POLICY_VERSION };
}

/** Enqueue one shared daily assessment per domain; queue user_id is accounting only. */
export async function queueDueArticleAiJobs(now = new Date()): Promise<number> {
  if (!isArticleAiEnabled()) return 0;
  // Daily jobs are the source of truth for new AI picks. Existing v3 rows are
  // still accepted by runArticleAiJob so a deploy does not strand queued work.
  const sourceDayKey = getDueArticleAiDailySourceDay(now);
  if (!sourceDayKey || !isArticleAiDailyGenerationDue(sourceDayKey, now)) return 0;
  const owners = await esgPrisma.$queryRaw<Array<{ id: number }>>`
    SELECT id FROM users WHERE is_active_db = TRUE ORDER BY id ASC LIMIT 1
  `;
  const owner = owners[0];
  if (!owner) return 0;
  let queued = 0;
  for (const domain of ["esg", "credit"] as const) {
    await enqueueBackgroundJob({
      id: randomUUID(),
      jobType: domain === "esg" ? DAILY_ESG_JOB : DAILY_CREDIT_JOB,
      userId: Number(owner.id),
      payload: { domain, sourceDayKey, policyVersion: ARTICLE_AI_DAILY_POLICY_VERSION } satisfies ArticleAiDailyJobPayload,
      maxAttempts: 4,
      idempotencyKey: `article-ai:v4:${domain}:${sourceDayKey}:${ARTICLE_AI_DAILY_POLICY_VERSION}`,
    });
    queued += 1;
  }
  return queued;
}

export async function runArticleAiJob(job: ClaimedBackgroundJob): Promise<{ result: unknown }> {
  // Drain old rows without reading preferences/history, touching Credit,
  // reserving budget, or calling the provider.
  if (job.jobType === LEGACY_ESG_JOB || job.jobType === LEGACY_CREDIT_JOB
      || job.jobType === RETIRED_ESG_JOB || job.jobType === RETIRED_CREDIT_JOB) {
    return { result: { status: "stale_policy", jobType: job.jobType } };
  }
  if (job.jobType !== ESG_JOB && job.jobType !== CREDIT_JOB) {
    if (job.jobType !== DAILY_ESG_JOB && job.jobType !== DAILY_CREDIT_JOB) {
      throw new Error(`Unsupported article AI job type: ${job.jobType}`);
    }
  }
  if (job.jobType === DAILY_ESG_JOB || job.jobType === DAILY_CREDIT_JOB) {
    const payload = parseDailyPayload(job);
    if (!isArticleAiEnabled()) return { result: { status: "disabled" } };
    if (!isArticleAiDailyGenerationDue(payload.sourceDayKey, new Date())) {
      return { result: { status: "expired_run", domain: payload.domain, sourceDayKey: payload.sourceDayKey } };
    }
    await throwIfJobCancelled(job.id, job.leaseOwner);
    return { result: await runArticleAiDailyAssessment(job, payload) };
  }
  const payload = parseWeeklyPayload(job);
  if (!isArticleAiEnabled()) return { result: { status: "disabled" } };
  if (!isArticleAiWeeklyGenerationDue(payload.targetWeekKey, new Date())) {
    return { result: { status: "expired_run", domain: payload.domain, targetWeekKey: payload.targetWeekKey } };
  }
  await throwIfJobCancelled(job.id, job.leaseOwner);
  return { result: await runArticleAiWeeklyAssessment(job, payload) };
}

/** Drain only legacy Credit confirmations created before the v2 cutover. */
export async function reconcileArticleAiFeedback(): Promise<void> {
  if (!isArticleAiEnabled()) return;
  const rows = await esgPrisma.$queryRaw<Array<{
    id: string; user_id: number; article_id: number; selection_id: string; expected_version: number;
  }>>`
    SELECT id, user_id, article_id, selection_id, expected_version
    FROM article_ai_feedback
    WHERE domain = 'credit' AND action = 'confirm' AND status = 'pending'
    ORDER BY created_at ASC LIMIT 50
  `;
  for (const feedback of rows) {
    try {
      await esgPrisma.$transaction(async (tx) => {
        const selections = await tx.$queryRaw<Array<{ version: number; pending_confirmation: boolean; state: string }>>`
          SELECT version, pending_confirmation, state
          FROM article_ai_selections
          WHERE id = ${feedback.selection_id}::uuid AND user_id = ${feedback.user_id}
          FOR UPDATE
        `;
        const selection = selections[0];
        if (!selection || Number(selection.version) !== feedback.expected_version || !selection.pending_confirmation || selection.state === "dismissed") {
          await tx.$executeRaw`
            UPDATE article_ai_feedback
            SET status = 'error', error = 'Selection version changed during Credit confirmation', applied_at = now()
            WHERE id = ${feedback.id}::uuid AND status = 'pending'
          `;
          return;
        }
        await creditPrisma.$executeRaw`
          INSERT INTO likes (user_id, content_type, content_id, created_at)
          VALUES (${feedback.user_id}, 'article', ${feedback.article_id}, now())
          ON CONFLICT (user_id, content_type, content_id) DO NOTHING
        `;
        await tx.$executeRaw`
          UPDATE article_ai_selections
          SET state = 'confirmed', pending_confirmation = FALSE, version = version + 1, updated_at = now()
          WHERE id = ${feedback.selection_id}::uuid
            AND version = ${feedback.expected_version} AND pending_confirmation = TRUE
        `;
        await tx.$executeRaw`
          UPDATE article_ai_feedback
          SET status = 'confirmed', applied_at = now(), error = NULL
          WHERE id = ${feedback.id}::uuid AND status = 'pending'
        `;
      }, { timeout: 15_000, maxWait: 5_000 });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Credit like reconciliation failed";
      await esgPrisma.$executeRaw`
        UPDATE article_ai_feedback SET error = ${message.slice(0, 2_000)}
        WHERE id = ${feedback.id}::uuid AND status = 'pending'
      `;
    }
  }
}
