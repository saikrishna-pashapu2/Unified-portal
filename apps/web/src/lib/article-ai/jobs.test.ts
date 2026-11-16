import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  esgQuery: vi.fn(),
  esgExecute: vi.fn(),
  esgTransaction: vi.fn(),
  creditExecute: vi.fn(),
  enqueue: vi.fn(),
  cancelled: vi.fn(),
  enabled: vi.fn(),
  config: vi.fn(),
  provider: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@esgcredit/db-esg", () => ({
  esgPrisma: {
    $queryRaw: mocks.esgQuery,
    $executeRaw: mocks.esgExecute,
    $transaction: mocks.esgTransaction,
  },
}));
vi.mock("@esgcredit/db-credit", () => ({
  creditPrisma: { $queryRaw: vi.fn(), $executeRaw: mocks.creditExecute },
}));
vi.mock("@/lib/jobs/queue", () => ({
  enqueueBackgroundJob: mocks.enqueue,
  throwIfJobCancelled: mocks.cancelled,
}));
vi.mock("./config", () => ({
  getArticleAiConfig: mocks.config,
  isArticleAiEnabled: mocks.enabled,
}));
vi.mock("./provider", () => ({
  buildArticleAiProviderRequest: vi.fn(),
  requestArticleAiDecisions: mocks.provider,
}));

import { queueDueArticleAiJobs, reconcileArticleAiFeedback, runArticleAiJob } from "./jobs";

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-16T05:00:00Z"));
  mocks.enabled.mockReturnValue(true);
  mocks.config.mockReturnValue({
    model: "test-model",
    maxCandidates: 10,
    dailyRequestLimit: 2,
    dailyTokenLimit: 12_000,
    selectionTtlDays: 8,
    maxHistoryExamples: 50,
  });
  mocks.esgTransaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
    $queryRaw: mocks.esgQuery,
    $executeRaw: mocks.esgExecute,
  }));
  mocks.cancelled.mockResolvedValue(undefined);
});

afterEach(() => vi.useRealTimers());

describe("article AI jobs", () => {
  it("does not query new tables while deployment AI is disabled", async () => {
    mocks.enabled.mockReturnValue(false);
    await reconcileArticleAiFeedback();
    expect(mocks.esgQuery).not.toHaveBeenCalled();
    expect(mocks.creditExecute).not.toHaveBeenCalled();
  });

  it("includes settingsVersion in daily queue idempotency", async () => {
    mocks.esgQuery.mockResolvedValue([{ user_id: 7, domain: "esg", settings_version: 4 }]);
    mocks.enqueue.mockResolvedValue(undefined);
    const count = await queueDueArticleAiJobs(new Date("2026-11-16T05:00:00Z"));
    expect(count).toBe(1);
    expect(mocks.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: "article-ai:esg:7:2026-11-16:4",
      payload: { domain: "esg", settingsVersion: 4, runDate: "2026-11-16" },
    }));
  });

  it.each(["2026-11-15", "2026-11-16", "2026-11-17"])("fences expired dates and stale settings before provider calls (%s)", async (runDate) => {
    mocks.esgQuery.mockResolvedValueOnce([{ enabled: true, settings_version: 8 }]);
    const result = await runArticleAiJob({
      id: "00000000-0000-0000-0000-000000000001",
      jobType: "article_ai_esg_v1",
      userId: 7,
      payload: { domain: "esg", settingsVersion: 3, runDate },
      inputData: null,
      outputData: null,
      result: null,
      status: "processing",
      progress: 0,
      progressData: null,
      attempts: 1,
      maxAttempts: 2,
      availableAt: new Date(),
      leaseExpiresAt: new Date(Date.now() + 60_000),
      cancelRequested: false,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      completedAt: null,
      leaseOwner: "generic:test",
    });
    if (runDate === "2026-11-16") {
      expect(result.result).toEqual({ status: "stale_settings", domain: "esg" });
    } else {
      expect(result.result).toEqual({ status: "expired_run", domain: "esg", runDate });
      expect(mocks.esgQuery).not.toHaveBeenCalled();
    }
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it("does not write Credit when the locked ESG selection version is stale", async () => {
    mocks.esgQuery.mockResolvedValueOnce([{
      id: "feedback-1", user_id: 7, article_id: 11, selection_id: "selection-1", expected_version: 2,
    }]);
    mocks.esgQuery.mockResolvedValueOnce([{ version: 3, pending_confirmation: true, state: "selected" }]);
    await reconcileArticleAiFeedback();
    expect(mocks.creditExecute).not.toHaveBeenCalled();
    expect(mocks.esgExecute).toHaveBeenCalled();
  });
});
