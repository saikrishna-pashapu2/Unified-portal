import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { ClaimedBackgroundJob } from "@/lib/jobs/queue";
import type {
  ArticleAiWeeklyCandidateBatchRequest,
  ArticleAiWeeklyHistoryBatchRequest,
  ArticleAiWeeklyInputSnapshot,
  ArticleAiWeeklyManifestResult,
} from "./types";
import type { ArticleAiWeeklyCalendar } from "./weekly-calendar";

vi.mock("server-only", () => ({}));

const provider = vi.hoisted(() => ({
  history: vi.fn(),
  candidates: vi.fn(),
  merge: vi.fn(),
  cancel: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./weekly-provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./weekly-provider")>()),
  requestWeeklyHistoryProfile: provider.history,
  requestWeeklyCandidateBatch: provider.candidates,
  requestWeeklyMerge: provider.merge,
}));

vi.mock("@/lib/jobs/queue", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/jobs/queue")>()),
  throwIfJobCancelled: provider.cancel,
}));

const integration = process.env.RUN_DB_INTEGRATION_TESTS === "1" ? describe : describe.skip;
const marker = randomUUID();
function dubaiDay(offset: number): string {
  const value = new Date(Date.now() + 4 * 3_600_000);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}
const sourceDay = dubaiDay(-1);
const earlierSourceDay = dubaiDay(-2);
const assessmentId = randomUUID();
const earlierAssessmentId = randomUUID();
const staleSelectionId = randomUUID();
const userSelectionId = randomUUID();
const articleIds = {
  weakerDuplicate: 91_001,
  strongerDuplicate: 91_002,
  distinct: 91_003,
  crossDayDuplicate: 91_004,
};
let esg: (typeof import("@esgcredit/db-esg"))["esgPrisma"];
let userId = 0;

function input(kind: "history" | "candidate", articleId: number, summary: string): ArticleAiWeeklyInputSnapshot {
  const observedAt = new Date().toISOString();
  return {
    manifestId: `${kind}-${articleId}-${marker}`,
    kind,
    domain: "esg",
    articleId,
    contentHash: `${marker}-${articleId}`,
    title: `QA article ${articleId}`,
    summary,
    content: null,
    source: "QA source",
    url: `https://example.test/${marker}/${articleId}`,
    publishedAt: observedAt,
    observedAt,
    eligibleAt: observedAt,
    firstSeenAt: observedAt,
    firstSeenKnown: true,
    sourcePeriodStart: null,
    sourcePeriodEnd: null,
    carryoverFromWeek: null,
    exclusionReason: null,
  };
}

const duplicateBody = "A substantive duplicate ESG article body about transition finance and emissions.";
const history = [input("history", 90_001, `Historical ESG evidence ${marker}`)];
const candidates = [
  input("candidate", articleIds.weakerDuplicate, duplicateBody),
  input("candidate", articleIds.strongerDuplicate, `  Ａ​${duplicateBody.slice(1).toUpperCase()}  `),
  input("candidate", articleIds.distinct, "A distinct ESG article body about water resilience and governance."),
];

function manifest(): ArticleAiWeeklyManifestResult {
  return {
    history,
    candidates,
    coverage: {
      historyTotal: 1,
      historyResolved: 1,
      historyProcessed: 0,
      historyUnusable: 0,
      historyExcluded: 0,
      candidateTotal: 3,
      candidateProcessed: 0,
      candidateUnusable: 0,
      candidateExcluded: 0,
      candidateCarryover: 0,
      mergeLeaves: 0,
      mergeNodes: 0,
      mergeNodesCompleted: 0,
      status: "incomplete",
    },
    manifestHash: `daily-dedup-${marker}`,
    manifestCutoffAt: new Date(),
  };
}

function calendar(targetWeekKey = sourceDay): ArticleAiWeeklyCalendar {
  const now = Date.now();
  return {
    targetWeekKey,
    sourceStart: new Date(now - 86_400_000),
    sourceEnd: new Date(now - 60_000),
    processingAt: new Date(now - 30_000),
    emailAt: new Date(now + 3_600_000),
    validUntil: new Date(now + 30 * 86_400_000),
    timezone: "Asia/Dubai",
  };
}

function job(sourceDayKey = sourceDay): ClaimedBackgroundJob {
  const now = new Date();
  return {
    id: randomUUID(),
    jobType: "article_ai_esg_v4",
    userId,
    payload: { domain: "esg", sourceDayKey, policyVersion: 4 },
    inputData: null,
    outputData: null,
    result: null,
    status: "processing",
    progress: 0,
    progressData: null,
    attempts: 1,
    maxAttempts: 1,
    availableAt: now,
    leaseOwner: `daily-dedup-${marker}`,
    leaseExpiresAt: new Date(now.getTime() + 300_000),
    cancelRequested: false,
    lastError: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };
}

integration("daily Article AI duplicate publication", () => {
  beforeAll(async () => {
    const url = new URL(process.env.ESG_DATABASE_URL ?? "");
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      throw new Error("Requires a disposable loopback ESG database");
    }
    vi.stubEnv("ARTICLE_AI_ENABLED", "true");
    vi.stubEnv("ARTICLE_AI_WEEKLY_REQUEST_LIMIT", "16");
    vi.stubEnv("ARTICLE_AI_WEEKLY_TOKEN_LIMIT", "1000000");
    ({ esgPrisma: esg } = await import("@esgcredit/db-esg"));
    const user = await esg.users.create({
      data: {
        username: `daily-dedup-${marker}`,
        email: `daily-dedup-${marker}@example.test`,
        password_hash: "not-a-real-password",
        is_active_db: true,
      },
    });
    userId = user.id;

    const runCalendar = calendar();
    await esg.$executeRaw`
      INSERT INTO article_ai_domain_assessments (
        id, domain, assessment_date, policy_version, status, profile_source,
        request_limit, token_limit, source_start_at, source_cutoff_at,
        processing_at, email_at, valid_until, phase
      ) VALUES (
        ${assessmentId}::uuid, 'esg', ${sourceDay}::date, 4, 'queued', 'insufficient',
        16, 1000000, ${runCalendar.sourceStart}, ${runCalendar.sourceEnd},
        ${runCalendar.processingAt}, ${runCalendar.emailAt}, ${runCalendar.validUntil}, 'manifest'
      )
    `;
    await esg.$executeRaw`
      INSERT INTO article_ai_domain_selections (
        id, assessment_id, domain, article_id, reason, relevance_score,
        selected_at, expires_at, content_hash, model
      ) VALUES (
        ${staleSelectionId}::uuid, ${assessmentId}::uuid, 'esg',
        ${articleIds.weakerDuplicate}, 'Previously selected duplicate', 0.80,
        now(), ${runCalendar.validUntil}, ${candidates[0].contentHash}, 'gpt-6-luna'
      )
    `;
    await esg.$executeRaw`
      INSERT INTO article_ai_user_selections (
        id, user_id, domain_selection_id, domain, article_id, state, version, pending_confirmation
      ) VALUES (
        ${userSelectionId}::uuid, ${userId}, ${staleSelectionId}::uuid,
        'esg', ${articleIds.weakerDuplicate}, 'dismissed', 1, false
      )
    `;
    await esg.$executeRaw`
      INSERT INTO article_ai_domain_feedback (
        user_id, domain, article_id, domain_selection_id, user_selection_id,
        action, expected_version, status, idempotency_key, applied_at
      ) VALUES (
        ${userId}, 'esg', ${articleIds.weakerDuplicate}, ${staleSelectionId}::uuid,
        ${userSelectionId}::uuid, 'dismiss', 1, 'confirmed', ${`daily-dedup:${marker}`}, now()
      )
    `;

    provider.history.mockImplementation(async (request: ArticleAiWeeklyHistoryBatchRequest) => ({
      status: "complete",
      coveredManifestIds: request.articles.map((article) => article.manifestId),
      coveredFragmentIds: request.fragments.map((fragment) => fragment.fragmentId),
      profileFacets: [{
        name: "fixture",
        evidenceManifestIds: request.articles.map((article) => article.manifestId),
        summary: "ESG fixture evidence",
      }],
      summary: "ESG fixture evidence",
      coverage: "complete",
      model: "gpt-6-luna",
      inputTokens: 10,
      outputTokens: 5,
    }));
    provider.candidates.mockImplementation(async (request: ArticleAiWeeklyCandidateBatchRequest) => ({
      status: "complete",
      decisions: request.candidates.map((candidate) => ({
        manifestId: candidate.manifestId,
        articleId: candidate.articleId,
        action: "select" as const,
        confidence: candidate.articleId === articleIds.strongerDuplicate ? 0.95
          : candidate.articleId === articleIds.weakerDuplicate ? 0.80 : 0.70,
        reason: `QA selected ${candidate.articleId}`,
      })),
      coveredManifestIds: request.candidates.map((candidate) => candidate.manifestId),
      coveredFragmentIds: request.fragments.map((fragment) => fragment.fragmentId),
      eliminated: [],
      coverage: "complete",
      model: "gpt-6-luna",
      inputTokens: 12,
      outputTokens: 6,
    }));
  });

  afterAll(async () => {
    if (!esg) return;
    const batches = await esg.$queryRaw<Array<{ phase: string; input_hash: string }>>`
      SELECT phase, input_hash FROM article_ai_weekly_batches
      WHERE assessment_id IN (${assessmentId}::uuid, ${earlierAssessmentId}::uuid)
    `;
    for (const batch of batches) {
      await esg.$executeRaw`
        DELETE FROM article_ai_weekly_batch_cache
        WHERE domain = 'esg' AND policy_version = 4
          AND phase = ${batch.phase} AND input_hash = ${batch.input_hash}
      `;
    }
    await esg.$executeRaw`
      DELETE FROM article_ai_domain_assessments
      WHERE id IN (${assessmentId}::uuid, ${earlierAssessmentId}::uuid)
    `;
    if (userId) await esg.users.deleteMany({ where: { id: userId } });
    await esg.$disconnect();
    vi.unstubAllEnvs();
  });

  it("publishes one normalized-body winner and expires stale rows without erasing feedback", async () => {
    const { runArticleAiAssessmentWithRuntime } = await import("./weekly");
    const result = await runArticleAiAssessmentWithRuntime(
      job(),
      "esg",
      calendar(),
      { policyVersion: 4, promptVersion: `daily-dedup-qa-${marker}`, manifestLoader: async () => manifest() },
    );
    expect(result).toMatchObject({ status: "ready", selectionCount: 2 });
    expect(provider.merge).not.toHaveBeenCalled();

    const rows = await esg.$queryRaw<Array<{ article_id: number; active: boolean }>>`
      SELECT article_id, expires_at > now() AS active
      FROM article_ai_domain_selections
      WHERE assessment_id = ${assessmentId}::uuid
      ORDER BY article_id
    `;
    expect(rows).toEqual([
      { article_id: articleIds.weakerDuplicate, active: false },
      { article_id: articleIds.strongerDuplicate, active: true },
      { article_id: articleIds.distinct, active: true },
    ]);
    const [retained] = await esg.$queryRaw<Array<{ user_selections: number; feedback: number }>>`
      SELECT
        (SELECT count(*)::int FROM article_ai_user_selections WHERE id = ${userSelectionId}::uuid) AS user_selections,
        (SELECT count(*)::int FROM article_ai_domain_feedback WHERE domain_selection_id = ${staleSelectionId}::uuid) AS feedback
    `;
    expect(retained).toEqual({ user_selections: 1, feedback: 1 });

    const earlierCalendar = calendar(earlierSourceDay);
    await esg.$executeRaw`
      INSERT INTO article_ai_domain_assessments (
        id, domain, assessment_date, policy_version, status, profile_source,
        request_limit, token_limit, source_start_at, source_cutoff_at,
        processing_at, email_at, valid_until, phase
      ) VALUES (
        ${earlierAssessmentId}::uuid, 'esg', ${earlierSourceDay}::date, 4, 'queued', 'insufficient',
        16, 1000000, ${earlierCalendar.sourceStart}, ${earlierCalendar.sourceEnd},
        ${earlierCalendar.processingAt}, ${earlierCalendar.emailAt}, ${earlierCalendar.validUntil}, 'manifest'
      )
    `;
    const earlierCandidate = input("candidate", articleIds.crossDayDuplicate, duplicateBody);
    const earlierManifest: ArticleAiWeeklyManifestResult = {
      ...manifest(),
      candidates: [earlierCandidate],
      coverage: { ...manifest().coverage, candidateTotal: 1 },
      manifestHash: `daily-dedup-earlier-${marker}`,
    };
    const earlierResult = await runArticleAiAssessmentWithRuntime(
      job(earlierSourceDay),
      "esg",
      earlierCalendar,
      { policyVersion: 4, promptVersion: `daily-dedup-earlier-qa-${marker}`, manifestLoader: async () => earlierManifest },
    );
    expect(earlierResult).toMatchObject({ status: "ready", selectionCount: 0 });
    const [earlierSelectionCount] = await esg.$queryRaw<Array<{ count: number }>>`
      SELECT count(*)::int AS count
      FROM article_ai_domain_selections
      WHERE assessment_id = ${earlierAssessmentId}::uuid AND expires_at > now()
    `;
    expect(earlierSelectionCount?.count).toBe(0);
  });
});
