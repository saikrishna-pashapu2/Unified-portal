import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  esgQuery: vi.fn(), esgExecute: vi.fn(), esgTransaction: vi.fn(), creditExecute: vi.fn(),
  enqueue: vi.fn(), cancelled: vi.fn(), enabled: vi.fn(), weekly: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@esgcredit/db-esg", () => ({ esgPrisma: { $queryRaw: mocks.esgQuery, $executeRaw: mocks.esgExecute, $transaction: mocks.esgTransaction } }));
vi.mock("@esgcredit/db-credit", () => ({ creditPrisma: { $executeRaw: mocks.creditExecute } }));
vi.mock("@/lib/jobs/queue", () => ({ enqueueBackgroundJob: mocks.enqueue, throwIfJobCancelled: mocks.cancelled }));
vi.mock("./config", () => ({ isArticleAiEnabled: mocks.enabled }));
vi.mock("./weekly", () => ({ runArticleAiWeeklyAssessment: mocks.weekly }));

import { queueDueArticleAiJobs, reconcileArticleAiFeedback, runArticleAiJob } from "./jobs";

function fakeJob(jobType: string, payload: Record<string, unknown> = {}) {
  return { id: "00000000-0000-0000-0000-000000000001", jobType, userId: 7, payload,
    attempts: 1, maxAttempts: 4, leaseOwner: "qa-worker", cancelRequested: false } as never;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-20T20:30:00Z"));
  mocks.enabled.mockReturnValue(true); mocks.cancelled.mockResolvedValue(undefined); mocks.enqueue.mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

describe("article AI weekly jobs", () => {
  it("enqueues one shared v3 job per domain for the due Dubai cohort", async () => {
    mocks.esgQuery.mockResolvedValue([{ id: 7 }]);
    expect(await queueDueArticleAiJobs()).toBe(2);
    expect(mocks.esgQuery).toHaveBeenCalledTimes(1);
    expect(mocks.enqueue).toHaveBeenNthCalledWith(1, expect.objectContaining({ jobType: "article_ai_esg_v3", userId: 7,
      idempotencyKey: "article-ai:v3:esg:2026-11-23:3", payload: { domain: "esg", targetWeekKey: "2026-11-23", policyVersion: 3 } }));
    expect(mocks.enqueue).toHaveBeenNthCalledWith(2, expect.objectContaining({ jobType: "article_ai_credit_v3", userId: 7,
      idempotencyKey: "article-ai:v3:credit:2026-11-23:3", payload: { domain: "credit", targetWeekKey: "2026-11-23", policyVersion: 3 } }));
  });

  it("does not query an owner outside the Saturday-to-Monday window", async () => {
    vi.setSystemTime(new Date("2026-11-20T20:14:59Z"));
    expect(await queueDueArticleAiJobs()).toBe(0); expect(mocks.esgQuery).not.toHaveBeenCalled();
  });

  it.each(["article_ai_esg_v1", "article_ai_credit_v1", "article_ai_esg_v2", "article_ai_credit_v2"])("drains %s before provider/query work", async (jobType) => {
    const result = await runArticleAiJob(fakeJob(jobType, { domain: "esg", targetWeekKey: "2026-11-23", policyVersion: 3 }));
    expect(result.result).toEqual({ status: "stale_policy", jobType });
    expect(mocks.esgQuery).not.toHaveBeenCalled(); expect(mocks.weekly).not.toHaveBeenCalled(); expect(mocks.cancelled).not.toHaveBeenCalled();
  });

  it.each([["article_ai_esg_v3", "credit"], ["article_ai_credit_v3", "esg"]])("rejects %s domain mismatch", async (jobType, domain) => {
    await expect(runArticleAiJob(fakeJob(jobType, { domain, targetWeekKey: "2026-11-23", policyVersion: 3 }))).rejects.toThrow("Invalid article AI weekly job payload");
    expect(mocks.weekly).not.toHaveBeenCalled();
  });

  it("rejects a wrong policy before provider work", async () => {
    await expect(runArticleAiJob(fakeJob("article_ai_esg_v3", { domain: "esg", targetWeekKey: "2026-11-23", policyVersion: 2 }))).rejects.toThrow("Invalid article AI weekly job payload");
    expect(mocks.weekly).not.toHaveBeenCalled();
  });

  it("passes the exact weekly payload to the shared runner", async () => {
    mocks.weekly.mockResolvedValue({ status: "ready", domain: "credit", targetWeekKey: "2026-11-23", selectionCount: 2, coverage: {}, model: "gpt-6-luna" });
    const result = await runArticleAiJob(fakeJob("article_ai_credit_v3", { domain: "credit", targetWeekKey: "2026-11-23", policyVersion: 3 }));
    expect(result.result).toMatchObject({ status: "ready", domain: "credit", targetWeekKey: "2026-11-23" });
    expect(mocks.weekly).toHaveBeenCalledWith(expect.anything(), { domain: "credit", targetWeekKey: "2026-11-23", policyVersion: 3 });
  });

  it("keeps the legacy Credit confirmation outbox fence", async () => {
    mocks.esgQuery.mockResolvedValueOnce([{ id: "feedback-1", user_id: 7, article_id: 11, selection_id: "selection-1", expected_version: 2 }]);
    mocks.esgQuery.mockResolvedValueOnce([{ version: 3, pending_confirmation: true, state: "selected" }]);
    mocks.esgTransaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({ $queryRaw: mocks.esgQuery, $executeRaw: mocks.esgExecute }));
    await reconcileArticleAiFeedback();
    expect(mocks.creditExecute).not.toHaveBeenCalled(); expect(mocks.esgExecute).toHaveBeenCalled();
  });
});
