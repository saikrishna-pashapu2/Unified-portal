import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@esgcredit/db-esg", () => ({ esgPrisma: { $queryRaw: vi.fn(), $executeRaw: vi.fn(), $transaction: vi.fn() } }));
vi.mock("@/lib/jobs/queue", () => ({ JobLeaseLostError: class extends Error {}, throwIfJobCancelled: vi.fn() }));
vi.mock("./weekly-inputs", () => ({ loadWeeklyManifestInputs: vi.fn() }));

import {
  countArticleAiWeeklyMergeNodes,
  estimateArticleAiWeeklyStructuredOutputBytes,
  planArticleAiWeeklyLeafBatches,
} from "./weekly";
import type { ArticleAiWeeklyInputSnapshot } from "./types";

function productionShapedInput(kind: "history" | "candidate", articleId: number, contentBytes: number): ArticleAiWeeklyInputSnapshot {
  const content = "x".repeat(contentBytes);
  return {
    manifestId: `${kind}-${articleId}`,
    kind,
    domain: "credit",
    articleId,
    contentHash: `${articleId}`.padStart(64, "0"),
    title: "A production-shaped article title with normal metadata".slice(0, 95),
    summary: null,
    content,
    source: "Production source",
    url: `https://example.test/article/${articleId}`,
    publishedAt: "2026-11-18T00:00:00.000Z",
    observedAt: "2026-11-19T00:15:00.000Z",
    eligibleAt: "2026-11-18T00:00:00.000Z",
    firstSeenAt: "2026-11-18T00:00:00.000Z",
    firstSeenKnown: true,
    sourcePeriodStart: "2026-11-17T20:00:00.000Z",
    sourcePeriodEnd: "2026-11-18T20:00:00.000Z",
    carryoverFromWeek: null,
    exclusionReason: null,
  };
}

describe("weekly Article AI DAG planning", () => {
  it.each([[0, 0], [1, 0], [2, 1], [3, 2], [4, 3], [99, 98]])(
    "uses a deterministic binary merge tree for %i leaves",
    (leaves, expected) => expect(countArticleAiWeeklyMergeNodes(leaves)).toBe(expected),
  );

  it("bounds candidate leaf response coverage without capping the cohort", () => {
    expect(estimateArticleAiWeeklyStructuredOutputBytes("candidate_evaluation", 14, 15)).toBeLessThanOrEqual(24_000);
    expect(estimateArticleAiWeeklyStructuredOutputBytes("candidate_evaluation", 16, 16)).toBeGreaterThan(24_000);
    // The planner splits batches; it never drops candidates from the manifest.
    expect(estimateArticleAiWeeklyStructuredOutputBytes("candidate_evaluation", 100, 100)).toBeGreaterThan(24_000);
  });

  it("splits fragment-heavy candidates to leave room for required evidence notes", () => {
    expect(estimateArticleAiWeeklyStructuredOutputBytes("candidate_evaluation", 1, 46)).toBeLessThanOrEqual(24_000);
    expect(estimateArticleAiWeeklyStructuredOutputBytes("candidate_evaluation", 1, 47)).toBeGreaterThan(24_000);
  });

  it("keeps history fragment coverage bounded independently of full text size", () => {
    expect(estimateArticleAiWeeklyStructuredOutputBytes("history_profile", 1, 100)).toBeLessThan(24_000);
    expect(estimateArticleAiWeeklyStructuredOutputBytes("history_profile", 50, 50)).toBeLessThan(24_000);
  });

  it("plans production-shaped 42-candidate leaves against the exact keyed schema bytes", () => {
    const candidates = Array.from({ length: 42 }, (_, index) => productionShapedInput("candidate", 10_000 + index, 11_263));
    const plans = planArticleAiWeeklyLeafBatches("candidate_evaluation", candidates, 60_000);
    expect(plans.length).toBeGreaterThan(1);
    expect(Math.max(...plans.map((plan) => plan.providerInputBytes))).toBeLessThanOrEqual(60_000);
  });

  it("plans the larger production-shaped history set without undercounting fragments", () => {
    const history = Array.from({ length: 53 }, (_, index) => productionShapedInput("history", 20_000 + index, 23_862));
    const plans = planArticleAiWeeklyLeafBatches("history_profile", history, 60_000);
    expect(plans.length).toBeGreaterThan(1);
    expect(Math.max(...plans.map((plan) => plan.providerInputBytes))).toBeLessThanOrEqual(60_000);
  });
});
