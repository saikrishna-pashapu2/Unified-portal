import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type {
  ArticleAiWeeklyCandidateBatchRequest,
  ArticleAiWeeklyCandidateBatchResult,
  ArticleAiWeeklyHistoryBatchRequest,
  ArticleAiWeeklyHistoryBatchResult,
  ArticleAiWeeklyInputSnapshot,
  ArticleAiWeeklyManifestResult,
  ArticleAiWeeklyMergeRequest,
  ArticleAiWeeklyMergeResult,
} from "./types";
import type { ArticleAiWeeklyCalendar } from "./weekly-calendar";
import type { ClaimedBackgroundJob } from "@/lib/jobs/queue";

vi.mock("server-only", () => ({}));

const integration = process.env.RUN_DB_INTEGRATION_TESTS === "1" ? describe : describe.skip;

const mocks = vi.hoisted(() => ({
  mode: "normal" as "normal" | "invalid-candidate" | "stale-assessment" | "stale-batch" | "fail-final-merge",
  manifestVariant: "shared",
  volume: false,
  getCalendar: vi.fn(),
  loadManifest: vi.fn(),
  historyProvider: vi.fn(),
  candidateProvider: vi.fn(),
  mergeProvider: vi.fn(),
  cancelCheck: vi.fn(),
}));

vi.mock("./weekly-calendar", async () => {
  const actual = await vi.importActual<typeof import("./weekly-calendar")>("./weekly-calendar");
  return { ...actual, getArticleAiWeeklyCalendar: mocks.getCalendar };
});

vi.mock("./weekly-inputs", async () => {
  const actual = await vi.importActual<typeof import("./weekly-inputs")>("./weekly-inputs");
  return { ...actual, loadWeeklyManifestInputs: mocks.loadManifest };
});

vi.mock("./weekly-provider", async () => {
  const actual = await vi.importActual<typeof import("./weekly-provider")>("./weekly-provider");
  return {
    ...actual,
    requestWeeklyHistoryProfile: mocks.historyProvider,
    requestWeeklyCandidateBatch: mocks.candidateProvider,
    requestWeeklyMerge: mocks.mergeProvider,
  };
});

vi.mock("@/lib/jobs/queue", async () => {
  const actual = await vi.importActual<typeof import("@/lib/jobs/queue")>("@/lib/jobs/queue");
  return { ...actual, throwIfJobCancelled: mocks.cancelCheck };
});

const marker = randomUUID();
const targets = {
  esg: "2098-01-06",
  credit: "2098-01-13",
  cache: "2098-01-20",
  invalid: "2098-01-27",
  budget: "2098-02-03",
  staleAssessment: "2098-02-10",
  staleBatch: "2098-02-17",
  volume: "2098-02-24",
} as const;
let esg: (typeof import("@esgcredit/db-esg"))["esgPrisma"];
let credit: (typeof import("@esgcredit/db-credit"))["creditPrisma"];
let runWeekly: typeof import("./weekly")["runArticleAiWeeklyAssessment"];
let userId: number;

function controlledCalendar(targetWeekKey: string): ArticleAiWeeklyCalendar {
  const now = Date.now();
  return {
    targetWeekKey,
    sourceStart: new Date(now - 7 * 86_400_000),
    sourceEnd: new Date(now - 2 * 86_400_000),
    processingAt: new Date(now - 60_000),
    emailAt: new Date(now + 24 * 60 * 60_000),
    validUntil: new Date(now + 8 * 86_400_000),
    timezone: "Asia/Dubai",
  };
}

function fixtureInput(
  domain: "esg" | "credit",
  kind: "history" | "candidate",
  articleId: number,
): ArticleAiWeeklyInputSnapshot {
  const text = `${mocks.manifestVariant}-${domain}-${kind}-${marker}`;
  const observedAt = new Date().toISOString();
  const longTail = ` ${"long-fragment-evidence ".repeat(1_200)}`;
  return {
    manifestId: `${kind}-${articleId}`,
    kind,
    domain,
    articleId,
    contentHash: `${text}-hash`,
    title: `${domain.toUpperCase()} ${kind} fixture`,
    summary: `${text} summary`,
    content: `${text} full article content${longTail}`,
    source: "weekly-integration-fixture",
    url: `https://example.test/article-ai/${marker}/${domain}/${kind}`,
    publishedAt: observedAt,
    observedAt,
    eligibleAt: observedAt,
    firstSeenAt: observedAt,
    firstSeenKnown: true,
    sourcePeriodStart: "2097-12-29T20:00:00.000Z",
    sourcePeriodEnd: "2098-01-05T20:00:00.000Z",
    carryoverFromWeek: null,
    exclusionReason: null,
  };
}

function fixtureManifest(domain: "esg" | "credit"): ArticleAiWeeklyManifestResult {
  const history = mocks.volume
    ? Array.from({ length: 201 }, (_, index) => ({ ...fixtureInput(domain, "history", 980_001 + index), content: "History evidence ".repeat(64) }))
    : [fixtureInput(domain, "history", domain === "esg" ? 980_001 : 980_101)];
  const candidates = mocks.volume
    ? Array.from({ length: 131 }, (_, index) => ({ ...fixtureInput(domain, "candidate", 990_001 + index), content: "Current credit evidence ".repeat(170) }))
    : [fixtureInput(domain, "candidate", domain === "esg" ? 990_001 : 990_101)];
  return {
    history,
    candidates,
    coverage: {
      historyTotal: history.length,
      historyResolved: history.length,
      historyProcessed: 0,
      historyUnusable: 0,
      historyExcluded: 0,
      candidateTotal: candidates.length,
      candidateProcessed: 0,
      candidateUnusable: 0,
      candidateExcluded: 0,
      candidateCarryover: 0,
      mergeLeaves: 0,
      mergeNodes: 0,
      mergeNodesCompleted: 0,
      status: "incomplete",
    },
    manifestHash: `${mocks.manifestVariant}-${domain}-${marker}`,
    manifestCutoffAt: new Date(),
  };
}

function historyResult(request: ArticleAiWeeklyHistoryBatchRequest): ArticleAiWeeklyHistoryBatchResult {
  return {
    status: "complete",
    coveredManifestIds: request.articles.map((article) => article.manifestId),
    coveredFragmentIds: request.fragments.map((fragment) => fragment.fragmentId),
    profileFacets: [{
      name: "fixture-theme",
      evidenceManifestIds: request.articles.map((article) => article.manifestId),
      summary: "A persisted aggregate fixture profile",
    }],
    summary: "A persisted aggregate fixture profile",
    coverage: "complete",
    model: "gpt-6-luna",
    inputTokens: 11,
    outputTokens: 7,
  };
}

function candidateResult(request: ArticleAiWeeklyCandidateBatchRequest): ArticleAiWeeklyCandidateBatchResult {
  const result: ArticleAiWeeklyCandidateBatchResult = {
    status: "complete",
    decisions: request.candidates.map((candidate) => ({
      manifestId: candidate.manifestId,
      articleId: candidate.articleId,
      action: "select" as const,
      confidence: 0.91,
      reason: "Fixture candidate matches the aggregate profile",
    })),
    coveredManifestIds: request.candidates.map((candidate) => candidate.manifestId),
    coveredFragmentIds: request.fragments.map((fragment) => fragment.fragmentId),
    eliminated: [],
    coverage: "complete",
    model: "gpt-6-luna",
    inputTokens: 13,
    outputTokens: 9,
  };
  return mocks.mode === "invalid-candidate"
    ? { ...result, coverage: "incomplete" } as unknown as ArticleAiWeeklyCandidateBatchResult
    : result;
}

function mergeResult(request: ArticleAiWeeklyMergeRequest): ArticleAiWeeklyMergeResult {
  const survivors = Array.from(new Set(request.childOutputs.flatMap((child) => {
    const output = child.output as { selectedManifestIds?: string[]; decisions?: Array<{ action: string; manifestId: string }> };
    return output.selectedManifestIds ?? output.decisions?.filter((item) => item.action === "select").map((item) => item.manifestId) ?? [];
  })));
  const selected = survivors.slice(0, 20);
  return {
    status: "complete",
    mergedProfile: "A merged fixture profile",
    selectedManifestIds: selected,
    rationale: selected.map((manifestId) => ({ manifestId, reason: "Merged fixture rationale" })),
    eliminated: survivors.slice(20).map((manifestId) => ({ manifestId, reason: "Other candidates were stronger" })),
    coveredChildBatchIds: request.childOutputs.map((child) => child.batchId),
    childOutputHashes: request.childOutputs.map((child) => child.outputHash),
    coverage: "complete",
    model: "gpt-6-luna",
    inputTokens: 17,
    outputTokens: 11,
  };
}

function resetProviderMocks(mode: typeof mocks.mode = "normal"): void {
  mocks.mode = mode;
  mocks.historyProvider.mockClear();
  mocks.candidateProvider.mockClear();
  mocks.mergeProvider.mockClear();
  mocks.cancelCheck.mockClear();
}

function makeJob(domain: "esg" | "credit", targetWeekKey: string): ClaimedBackgroundJob {
  const id = randomUUID();
  return {
    id,
    jobType: domain === "esg" ? "article_ai_esg_v3" : "article_ai_credit_v3",
    userId,
    payload: { domain, targetWeekKey, policyVersion: 3 },
    inputData: null,
    outputData: null,
    result: null,
    status: "processing",
    progress: 0,
    progressData: null,
    attempts: 1,
    maxAttempts: 3,
    availableAt: new Date(),
    leaseOwner: `weekly-integration-${marker}`,
    leaseExpiresAt: new Date(Date.now() + 300_000),
    cancelRequested: false,
    lastError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    completedAt: null,
  };
}

async function run(domain: "esg" | "credit", targetWeekKey: string) {
  mocks.manifestVariant = "shared";
  return runWeekly(makeJob(domain, targetWeekKey), {
    domain,
    targetWeekKey,
    policyVersion: 3,
  });
}

async function assessmentFor(domain: "esg" | "credit", targetWeekKey: string) {
  const rows = await esg.$queryRaw<Array<{
    id: string;
    status: string;
    phase: string | null;
    history_count: number;
    completed_at: Date | null;
    coverage_json: { status?: string } | null;
    profile_json: { summary?: string } | null;
  }>>`
    SELECT id::text, status, phase, history_count, completed_at, coverage_json, profile_json
    FROM article_ai_domain_assessments
    WHERE domain = ${domain} AND assessment_date = ${targetWeekKey}::date AND policy_version = 3
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) throw new Error(`Missing test assessment ${domain}/${targetWeekKey}`);
  return row;
}

async function clearOwnedCohorts(): Promise<void> {
  const keys = Object.values(targets);
  await esg.$executeRaw`
    DELETE FROM article_ai_weekly_batch_cache c USING article_ai_weekly_batches b, article_ai_domain_assessments a
    WHERE b.assessment_id = a.id AND a.policy_version = 3 AND a.assessment_date = ANY(${keys}::date[])
      AND a.domain = c.domain AND b.phase = c.phase AND b.input_hash = c.input_hash
  `;
  await esg.$executeRaw`
    DELETE FROM article_ai_domain_assessments WHERE policy_version = 3
      AND domain IN ('esg', 'credit') AND assessment_date = ANY(${keys}::date[])
  `;
}

integration("weekly Article AI generation lifecycle", () => {
  beforeAll(async () => {
    for (const key of ["ESG_DATABASE_URL", "CREDIT_DATABASE_URL"] as const) {
      const url = new URL(process.env[key] ?? "");
      if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
        throw new Error("Requires disposable loopback databases");
      }
    }
    ({ esgPrisma: esg } = await import("@esgcredit/db-esg"));
    ({ creditPrisma: credit } = await import("@esgcredit/db-credit"));
    await esg.$queryRaw`SELECT 1`;
    await credit.$queryRaw`SELECT 1`;
    await clearOwnedCohorts();
    ({ runArticleAiWeeklyAssessment: runWeekly } = await import("./weekly"));

    vi.stubEnv("ARTICLE_AI_ENABLED", "true");
    vi.stubEnv("ARTICLE_AI_EMAIL_ENABLED", "true");
    mocks.getCalendar.mockImplementation((targetWeekKey: string) => controlledCalendar(targetWeekKey));
    mocks.loadManifest.mockImplementation(async (domain: "esg" | "credit") => fixtureManifest(domain));
    mocks.historyProvider.mockImplementation(async (request: ArticleAiWeeklyHistoryBatchRequest) => {
      if (mocks.mode === "stale-assessment") {
        await esg.$executeRaw`
          UPDATE article_ai_domain_assessments
          SET lease_expires_at = now() - interval '1 second'
          WHERE id = ${request.runId}::uuid
        `;
      }
      if (mocks.mode === "stale-batch") {
        await esg.$executeRaw`
          UPDATE article_ai_weekly_batches
          SET lease_expires_at = now() - interval '1 second'
          WHERE id = ${request.batchId}::uuid
        `;
      }
      return historyResult(request);
    });
    mocks.candidateProvider.mockImplementation(async (request: ArticleAiWeeklyCandidateBatchRequest) => candidateResult(request));
    mocks.mergeProvider.mockImplementation(async (request: ArticleAiWeeklyMergeRequest) => {
      if (mocks.mode === "fail-final-merge" && request.mergeKind === "candidate") {
        const [counts] = await esg.$queryRaw<Array<{ leaves: number; completed: number }>>`
          SELECT count(*) FILTER (WHERE phase = 'candidate_evaluation')::int AS leaves,
                 count(*) FILTER (WHERE phase = 'candidate_merge' AND state = 'ready')::int AS completed
          FROM article_ai_weekly_batches WHERE assessment_id = ${request.runId}::uuid
        `;
        if (counts.completed === counts.leaves - 2) throw new Error("Fixture final merge interruption");
      }
      return mergeResult(request);
    });
    mocks.cancelCheck.mockImplementation(async () => undefined);

    const user = await esg.users.create({ data: {
      username: `weekly-generation-${marker}`,
      email: `weekly-generation-${marker}@example.test`,
      password_hash: "fixture-only",
      is_active_db: false,
      team: null,
    } });
    userId = user.id;
  });

  afterAll(async () => {
    if (esg) await clearOwnedCohorts();
    if (esg && userId) await esg.users.delete({ where: { id: userId } });
    await Promise.allSettled([esg?.$disconnect(), credit?.$disconnect()]);
    vi.unstubAllEnvs();
  });

  it("runs ESG and Credit through real leases, batches, coverage, cache, and shared selections", async () => {
    resetProviderMocks();
    const esgResult = await run("esg", targets.esg);
    const creditResult = await run("credit", targets.credit);
    expect(esgResult).toMatchObject({ status: "ready", domain: "esg", targetWeekKey: targets.esg, selectionCount: 1, model: "gpt-6-luna" });
    expect(creditResult).toMatchObject({ status: "ready", domain: "credit", targetWeekKey: targets.credit, selectionCount: 1, model: "gpt-6-luna" });
    expect(esgResult.coverage).toMatchObject({ historyResolved: 1, historyProcessed: 1, candidateProcessed: 1, status: "complete" });
    expect(creditResult.coverage).toMatchObject({ historyResolved: 1, historyProcessed: 1, candidateProcessed: 1, status: "complete" });
    expect(mocks.historyProvider).toHaveBeenCalledTimes(2);
    expect(mocks.candidateProvider).toHaveBeenCalledTimes(2);
    expect(mocks.mergeProvider).not.toHaveBeenCalled();
    expect(mocks.cancelCheck.mock.calls.length).toBeGreaterThan(0);

    const esgAssessment = await assessmentFor("esg", targets.esg);
    const creditAssessment = await assessmentFor("credit", targets.credit);
    expect(esgAssessment).toMatchObject({ status: "ready", phase: "finalize", history_count: 1 });
    expect(creditAssessment).toMatchObject({ status: "ready", phase: "finalize", history_count: 1 });
    expect(esgAssessment.completed_at).not.toBeNull();
    expect(creditAssessment.completed_at).not.toBeNull();
    expect(esgAssessment.coverage_json?.status).toBe("complete");
    expect(creditAssessment.coverage_json?.status).toBe("complete");
    expect(esgAssessment.profile_json?.summary).toContain("persisted aggregate");
    expect(creditAssessment.profile_json?.summary).toContain("persisted aggregate");

    const [batchCounts] = await esg.$queryRaw<Array<{ ready: number; persisted: number }>>`
      SELECT count(*) FILTER (WHERE state = 'ready')::int AS ready,
             count(*) FILTER (WHERE output_json IS NOT NULL)::int AS persisted
      FROM article_ai_weekly_batches
      WHERE assessment_id IN (${esgAssessment.id}::uuid, ${creditAssessment.id}::uuid)
    `;
    expect(batchCounts).toEqual({ ready: 4, persisted: 4 });
    const [inputCounts] = await esg.$queryRaw<Array<{ processed: number }>>`
      SELECT count(*) FILTER (WHERE state = 'processed')::int AS processed
      FROM article_ai_weekly_inputs
      WHERE assessment_id IN (${esgAssessment.id}::uuid, ${creditAssessment.id}::uuid)
    `;
    expect(inputCounts.processed).toBe(4);
    const [selectionCounts] = await esg.$queryRaw<Array<{ count: number }>>`
      SELECT count(*)::int AS count
      FROM article_ai_domain_selections
      WHERE assessment_id IN (${esgAssessment.id}::uuid, ${creditAssessment.id}::uuid)
    `;
    expect(selectionCounts.count).toBe(2);

    const callsBeforeTerminalRetry = {
      history: mocks.historyProvider.mock.calls.length,
      candidate: mocks.candidateProvider.mock.calls.length,
      merge: mocks.mergeProvider.mock.calls.length,
    };
    const terminalRetry = await run("esg", targets.esg);
    expect(terminalRetry.status).toBe("ready");
    expect(mocks.historyProvider).toHaveBeenCalledTimes(callsBeforeTerminalRetry.history);
    expect(mocks.candidateProvider).toHaveBeenCalledTimes(callsBeforeTerminalRetry.candidate);
    expect(mocks.mergeProvider).toHaveBeenCalledTimes(callsBeforeTerminalRetry.merge);
  });

  it("reuses completed batch cache work on a new cohort without provider calls", async () => {
    resetProviderMocks();
    const result = await run("esg", targets.cache);
    expect(result).toMatchObject({ status: "ready", selectionCount: 1 });
    expect(mocks.historyProvider).not.toHaveBeenCalled();
    expect(mocks.candidateProvider).not.toHaveBeenCalled();
    expect(mocks.mergeProvider).not.toHaveBeenCalled();
    const assessment = await assessmentFor("esg", targets.cache);
    const [cacheRows] = await esg.$queryRaw<Array<{ count: number }>>`
      SELECT count(*)::int AS count
      FROM article_ai_weekly_batch_cache
      WHERE domain = 'esg' AND policy_version = 3 AND model = 'gpt-6-luna'
    `;
    expect(cacheRows.count).toBeGreaterThanOrEqual(2);
    const [batchRows] = await esg.$queryRaw<Array<{ ready: number; request_count: number }>>`
      SELECT count(*) FILTER (WHERE state = 'ready')::int AS ready,
             coalesce(sum(request_count), 0)::int AS request_count
      FROM article_ai_weekly_batches WHERE assessment_id = ${assessment.id}::uuid
    `;
    expect(batchRows).toEqual({ ready: 2, request_count: 0 });
  });

  it("rejects incomplete provider coverage without publishing a ready cohort", async () => {
    resetProviderMocks("invalid-candidate");
    mocks.manifestVariant = `invalid-${marker}`;
    await expect(runWeekly(makeJob("esg", targets.invalid), {
      domain: "esg", targetWeekKey: targets.invalid, policyVersion: 3,
    })).rejects.toThrow("Weekly candidate provider did not complete coverage");
    const assessment = await assessmentFor("esg", targets.invalid);
    expect(assessment.status).toBe("error");
    const [rows] = await esg.$queryRaw<Array<{ ready: number; error: number; selections: number }>>`
      SELECT
        (SELECT count(*) FROM article_ai_weekly_batches WHERE assessment_id = ${assessment.id}::uuid AND state = 'ready')::int AS ready,
        (SELECT count(*) FROM article_ai_weekly_batches WHERE assessment_id = ${assessment.id}::uuid AND state = 'error')::int AS error,
        (SELECT count(*) FROM article_ai_domain_selections WHERE assessment_id = ${assessment.id}::uuid)::int AS selections
    `;
    expect(rows).toEqual({ ready: 1, error: 1, selections: 0 });
    expect(mocks.historyProvider).toHaveBeenCalledTimes(1);
    expect(mocks.candidateProvider).toHaveBeenCalledTimes(1);
  });

  it("fails preflight before making provider calls when the complete DAG cannot fit the budget", async () => {
    resetProviderMocks();
    mocks.manifestVariant = `budget-${marker}`;
    const previousLimit = process.env.ARTICLE_AI_WEEKLY_REQUEST_LIMIT;
    vi.stubEnv("ARTICLE_AI_WEEKLY_REQUEST_LIMIT", "1");
    try {
      const result = await runWeekly(makeJob("esg", targets.budget), {
        domain: "esg", targetWeekKey: targets.budget, policyVersion: 3,
      });
      expect(result.status).toBe("budget_exhausted");
    } finally {
      if (previousLimit === undefined) delete process.env.ARTICLE_AI_WEEKLY_REQUEST_LIMIT;
      else vi.stubEnv("ARTICLE_AI_WEEKLY_REQUEST_LIMIT", previousLimit);
    }
    const assessment = await assessmentFor("esg", targets.budget);
    expect(assessment.status).toBe("budget_exhausted");
    expect(mocks.historyProvider).not.toHaveBeenCalled();
    expect(mocks.candidateProvider).not.toHaveBeenCalled();
    const [rows] = await esg.$queryRaw<Array<{ batches: number; selections: number }>>`
      SELECT
        (SELECT count(*) FROM article_ai_weekly_batches WHERE assessment_id = ${assessment.id}::uuid)::int AS batches,
        (SELECT count(*) FROM article_ai_domain_selections WHERE assessment_id = ${assessment.id}::uuid)::int AS selections
    `;
    expect(rows).toEqual({ batches: 0, selections: 0 });
  });

  it("does not publish or cache a provider response after the assessment lease expires", async () => {
    resetProviderMocks("stale-assessment");
    mocks.manifestVariant = `stale-assessment-${marker}`;
    await expect(runWeekly(makeJob("esg", targets.staleAssessment), {
      domain: "esg", targetWeekKey: targets.staleAssessment, policyVersion: 3,
    })).rejects.toThrow("Background job lease is no longer owned");
    const assessment = await assessmentFor("esg", targets.staleAssessment);
    expect(assessment.status).toBe("running");
    const [batch] = await esg.$queryRaw<Array<{ input_hash: string; state: string; output_json: unknown }>>`
      SELECT input_hash, state, output_json
      FROM article_ai_weekly_batches WHERE assessment_id = ${assessment.id}::uuid
      ORDER BY created_at ASC LIMIT 1
    `;
    expect(batch.state).toBe("running");
    expect(batch.output_json).toBeNull();
    const [cache] = await esg.$queryRaw<Array<{ count: number }>>`
      SELECT count(*)::int AS count FROM article_ai_weekly_batch_cache WHERE input_hash = ${batch.input_hash}
    `;
    expect(cache.count).toBe(0);
    const [selections] = await esg.$queryRaw<Array<{ count: number }>>`
      SELECT count(*)::int AS count FROM article_ai_domain_selections WHERE assessment_id = ${assessment.id}::uuid
    `;
    expect(selections.count).toBe(0);
  });

  it("does not publish or cache a response after the batch lease expires", async () => {
    resetProviderMocks("stale-batch");
    mocks.manifestVariant = `stale-batch-${marker}`;
    await expect(runWeekly(makeJob("esg", targets.staleBatch), {
      domain: "esg", targetWeekKey: targets.staleBatch, policyVersion: 3,
    })).rejects.toThrow("Background job lease is no longer owned");
    const assessment = await assessmentFor("esg", targets.staleBatch);
    expect(assessment.status).toBe("running");
    const [batch] = await esg.$queryRaw<Array<{ input_hash: string; state: string; output_json: unknown }>>`
      SELECT input_hash, state, output_json
      FROM article_ai_weekly_batches WHERE assessment_id = ${assessment.id}::uuid
      ORDER BY created_at ASC LIMIT 1
    `;
    expect(batch.state).toBe("running");
    expect(batch.output_json).toBeNull();
    const [cache] = await esg.$queryRaw<Array<{ count: number }>>`
      SELECT count(*)::int AS count FROM article_ai_weekly_batch_cache WHERE input_hash = ${batch.input_hash}
    `;
    expect(cache.count).toBe(0);
    const [selections] = await esg.$queryRaw<Array<{ count: number }>>`
      SELECT count(*)::int AS count FROM article_ai_domain_selections WHERE assessment_id = ${assessment.id}::uuid
    `;
    expect(selections.count).toBe(0);
  });

  it("covers 201 history articles and 131 candidates, then resumes only the final merge within the remaining budget", async () => {
    resetProviderMocks("fail-final-merge");
    mocks.manifestVariant = `volume-${marker}`;
    mocks.volume = true;
    try {
      await expect(runWeekly(makeJob("credit", targets.volume), {
        domain: "credit", targetWeekKey: targets.volume, policyVersion: 3,
      })).rejects.toThrow("Fixture final merge interruption");
      const assessment = await assessmentFor("credit", targets.volume);
      expect(assessment.status).toBe("error");
      const historyIds = new Set(mocks.historyProvider.mock.calls.flatMap((call) => (call[0] as ArticleAiWeeklyHistoryBatchRequest).articles.map((article) => article.articleId)));
      const candidateIds = new Set(mocks.candidateProvider.mock.calls.flatMap((call) => (call[0] as ArticleAiWeeklyCandidateBatchRequest).candidates.map((article) => article.articleId)));
      expect(historyIds.size).toBe(201);
      expect(candidateIds.size).toBe(131);
      expect(mocks.mergeProvider.mock.calls.length).toBeGreaterThan(3);
      const [budget] = await esg.$queryRaw<Array<{ requests_reserved: number; tokens_reserved: number }>>`
        SELECT requests_reserved, tokens_reserved FROM article_ai_domain_assessments WHERE id = ${assessment.id}::uuid
      `;
      expect(budget.requests_reserved).toBeLessThan(128);
      expect(budget.tokens_reserved).toBeLessThan(4_000_000);
      const [unpublished] = await esg.$queryRaw<Array<{ count: number }>>`
        SELECT count(*)::int AS count FROM article_ai_domain_selections WHERE assessment_id = ${assessment.id}::uuid
      `;
      expect(unpublished.count).toBe(0);
      // A retry has room for exactly the interrupted merge, not for re-reserving
      // already completed leaves or any of its persisted merge ancestors.
      await esg.$executeRaw`
        UPDATE article_ai_domain_assessments
        SET request_limit = requests_reserved + 1, token_limit = tokens_reserved + 100000
        WHERE id = ${assessment.id}::uuid
      `;
      resetProviderMocks();
      const result = await runWeekly(makeJob("credit", targets.volume), {
        domain: "credit", targetWeekKey: targets.volume, policyVersion: 3,
      });
      expect(result).toMatchObject({ status: "ready", selectionCount: 20, coverage: {
        historyTotal: 201, historyProcessed: 201, candidateTotal: 131, candidateProcessed: 131, status: "complete",
      } });
      expect(mocks.historyProvider).not.toHaveBeenCalled();
      expect(mocks.candidateProvider).not.toHaveBeenCalled();
      expect(mocks.mergeProvider).toHaveBeenCalledTimes(1);
      const [inputs] = await esg.$queryRaw<Array<{ total: number; processed: number }>>`
        SELECT count(*)::int AS total, count(*) FILTER (WHERE state = 'processed')::int AS processed
        FROM article_ai_weekly_inputs WHERE assessment_id = ${assessment.id}::uuid
      `;
      expect(inputs).toEqual({ total: 332, processed: 332 });
    } finally {
      mocks.volume = false;
    }
  });
});
