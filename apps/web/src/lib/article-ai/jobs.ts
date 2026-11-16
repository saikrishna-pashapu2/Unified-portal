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
import { runSharedArticleAiAssessment } from "./shared";
import {
  ARTICLE_AI_POLICY_VERSION,
  type ArticleAiDomain,
  type ArticleAiDomainJobPayload,
} from "./types";

const LEGACY_ESG_JOB = "article_ai_esg_v1" as BackgroundJobType;
const LEGACY_CREDIT_JOB = "article_ai_credit_v1" as BackgroundJobType;
const ESG_JOB = "article_ai_esg_v2" as BackgroundJobType;
const CREDIT_JOB = "article_ai_credit_v2" as BackgroundJobType;

function isDomain(value: unknown): value is ArticleAiDomain {
  return value === "esg" || value === "credit";
}

function utcDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function parseDomainPayload(job: ClaimedBackgroundJob): ArticleAiDomainJobPayload {
  const payload = job.payload as Record<string, unknown>;
  const expectedDomain = job.jobType === ESG_JOB ? "esg" : job.jobType === CREDIT_JOB ? "credit" : null;
  if (!expectedDomain || !isDomain(payload.domain) || payload.domain !== expectedDomain || payload.policyVersion !== ARTICLE_AI_POLICY_VERSION || typeof payload.runDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(payload.runDate)) {
    throw new Error("Invalid article AI domain job payload");
  }
  return { domain: payload.domain, runDate: payload.runDate, policyVersion: ARTICLE_AI_POLICY_VERSION };
}

/** Enqueue one domain assessment per day; queue user_id is accounting only. */
export async function queueDueArticleAiJobs(now = new Date()): Promise<number> {
  if (!isArticleAiEnabled()) return 0;
  const owners = await esgPrisma.$queryRaw<Array<{ id: number }>>`
    SELECT id FROM users WHERE is_active_db = TRUE ORDER BY id ASC LIMIT 1
  `;
  const owner = owners[0];
  if (!owner) return 0;
  const runDate = utcDate(now);
  let queued = 0;
  for (const domain of ["esg", "credit"] as const) {
    await enqueueBackgroundJob({
      id: randomUUID(),
      jobType: domain === "esg" ? ESG_JOB : CREDIT_JOB,
      userId: Number(owner.id),
      payload: { domain, runDate, policyVersion: ARTICLE_AI_POLICY_VERSION } satisfies ArticleAiDomainJobPayload,
      maxAttempts: 2,
      idempotencyKey: `article-ai:v2:${domain}:${runDate}:${ARTICLE_AI_POLICY_VERSION}`,
    });
    queued += 1;
  }
  return queued;
}

export async function runArticleAiJob(job: ClaimedBackgroundJob): Promise<{ result: unknown }> {
  // Drain old rows without reading preferences/history, touching Credit,
  // reserving budget, or calling the provider.
  if (job.jobType === LEGACY_ESG_JOB || job.jobType === LEGACY_CREDIT_JOB) {
    return { result: { status: "stale_policy", jobType: job.jobType } };
  }
  if (job.jobType !== ESG_JOB && job.jobType !== CREDIT_JOB) {
    throw new Error(`Unsupported article AI job type: ${job.jobType}`);
  }
  if (!isArticleAiEnabled()) return { result: { status: "disabled" } };
  const payload = parseDomainPayload(job);
  if (payload.runDate !== utcDate(new Date())) {
    return { result: { status: "expired_run", domain: payload.domain, runDate: payload.runDate } };
  }
  await throwIfJobCancelled(job.id, job.leaseOwner);
  return { result: await runSharedArticleAiAssessment(job, payload) };
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
