import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@esgcredit/db-esg", () => ({ esgPrisma: { $queryRaw: vi.fn(), $executeRaw: vi.fn(), $transaction: vi.fn() } }));
vi.mock("@/lib/jobs/queue", () => ({ JobLeaseLostError: class extends Error {}, throwIfJobCancelled: vi.fn() }));
vi.mock("./weekly-inputs", () => ({ loadWeeklyManifestInputs: vi.fn() }));

import {
  countArticleAiWeeklyMergeNodes,
  estimateArticleAiWeeklyStructuredOutputBytes,
} from "./weekly";

describe("weekly Article AI DAG planning", () => {
  it.each([[0, 0], [1, 0], [2, 1], [3, 2], [4, 3], [99, 98]])(
    "uses a deterministic binary merge tree for %i leaves",
    (leaves, expected) => expect(countArticleAiWeeklyMergeNodes(leaves)).toBe(expected),
  );

  it("bounds candidate leaf response coverage without capping the cohort", () => {
    expect(estimateArticleAiWeeklyStructuredOutputBytes("candidate_evaluation", 20, 20)).toBeLessThanOrEqual(24_000);
    expect(estimateArticleAiWeeklyStructuredOutputBytes("candidate_evaluation", 22, 22)).toBeGreaterThan(24_000);
    // The planner splits batches; it never drops candidates from the manifest.
    expect(estimateArticleAiWeeklyStructuredOutputBytes("candidate_evaluation", 100, 100)).toBeGreaterThan(24_000);
  });

  it("keeps history fragment coverage bounded independently of full text size", () => {
    expect(estimateArticleAiWeeklyStructuredOutputBytes("history_profile", 1, 100)).toBeLessThan(24_000);
    expect(estimateArticleAiWeeklyStructuredOutputBytes("history_profile", 50, 50)).toBeLessThan(24_000);
  });
});
