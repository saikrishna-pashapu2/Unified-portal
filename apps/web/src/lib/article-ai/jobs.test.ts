import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  esgQuery: vi.fn(),
  esgExecute: vi.fn(),
  esgTransaction: vi.fn(),
  creditExecute: vi.fn(),
  enqueue: vi.fn(),
  cancelled: vi.fn(),
  enabled: vi.fn(),
  shared: vi.fn(),
  reconcileShared: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@esgcredit/db-esg", () => ({
  esgPrisma: { $queryRaw: mocks.esgQuery, $executeRaw: mocks.esgExecute, $transaction: mocks.esgTransaction },
}));
vi.mock("@esgcredit/db-credit", () => ({ creditPrisma: { $executeRaw: mocks.creditExecute } }));
vi.mock("@/lib/jobs/queue", () => ({ enqueueBackgroundJob: mocks.enqueue, throwIfJobCancelled: mocks.cancelled }));
vi.mock("./config", () => ({ isArticleAiEnabled: mocks.enabled }));
vi.mock("./shared", () => ({ runSharedArticleAiAssessment: mocks.shared }));
vi.mock("./service-v2", () => ({ reconcileDomainArticleAiFeedbackV2: mocks.reconcileShared }));

import { queueDueArticleAiJobs, reconcileArticleAiFeedback, runArticleAiJob } from "./jobs";

function fakeJob(jobType: string, payload: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-0000-0000-000000000001", jobType, userId: 7, payload,
    attempts: 1, maxAttempts: 2, leaseOwner: "qa-worker", cancelRequested: false,
  } as never;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-16T05:00:00Z"));
  mocks.enabled.mockReturnValue(true);
  mocks.cancelled.mockResolvedValue(undefined);
  mocks.enqueue.mockResolvedValue(undefined);
});

afterEach(() => vi.useRealTimers());

describe("article AI v2 jobs", () => {
  it("enqueues one global job per domain/day without reading recipient preferences", async () => {
    mocks.esgQuery.mockResolvedValue([{ id: 7 }]);
    expect(await queueDueArticleAiJobs(new Date("2026-11-16T05:00:00Z"))).toBe(2);
    expect(mocks.esgQuery).toHaveBeenCalledTimes(1);
    expect(mocks.enqueue).toHaveBeenNthCalledWith(1, expect.objectContaining({
      jobType: "article_ai_esg_v2",
      userId: 7,
      idempotencyKey: "article-ai:v2:esg:2026-11-16:2",
      payload: { domain: "esg", runDate: "2026-11-16", policyVersion: 2 },
    }));
    expect(mocks.enqueue).toHaveBeenNthCalledWith(2, expect.objectContaining({
      jobType: "article_ai_credit_v2",
      userId: 7,
      idempotencyKey: "article-ai:v2:credit:2026-11-16:2",
      payload: { domain: "credit", runDate: "2026-11-16", policyVersion: 2 },
    }));
  });

  it.each(["article_ai_esg_v1", "article_ai_credit_v1"])("drains %s before any state/provider query", async (jobType) => {
    const result = await runArticleAiJob(fakeJob(jobType, { domain: "esg", settingsVersion: 9, runDate: "2026-11-16" }));
    expect(result.result).toEqual({ status: "stale_policy", jobType });
    expect(mocks.esgQuery).not.toHaveBeenCalled();
    expect(mocks.shared).not.toHaveBeenCalled();
    expect(mocks.cancelled).not.toHaveBeenCalled();
  });

  it("fences old dates before shared assessment work", async () => {
    const result = await runArticleAiJob(fakeJob("article_ai_esg_v2", { domain: "esg", runDate: "2026-11-15", policyVersion: 2 }));
    expect(result.result).toEqual({ status: "expired_run", domain: "esg", runDate: "2026-11-15" });
    expect(mocks.shared).not.toHaveBeenCalled();
  });

  it("passes only the domain payload to the shared fenced assessment", async () => {
    mocks.shared.mockResolvedValue({ status: "ready", domain: "credit", runDate: "2026-11-16", selected: 3 });
    const result = await runArticleAiJob(fakeJob("article_ai_credit_v2", { domain: "credit", runDate: "2026-11-16", policyVersion: 2 }));
    expect(result.result).toEqual({ status: "ready", domain: "credit", runDate: "2026-11-16", selected: 3 });
    expect(mocks.shared).toHaveBeenCalledWith(expect.anything(), { domain: "credit", runDate: "2026-11-16", policyVersion: 2 });
  });

  it.each([
    ["article_ai_esg_v2", "credit"],
    ["article_ai_credit_v2", "esg"],
  ])("rejects %s payload domain mismatch before shared work", async (jobType, domain) => {
    await expect(runArticleAiJob(fakeJob(jobType, { domain, runDate: "2026-11-16", policyVersion: 2 }))).rejects.toThrow("Invalid article AI domain job payload");
    expect(mocks.shared).not.toHaveBeenCalled();
  });

  it("keeps the legacy Credit outbox fence", async () => {
    mocks.esgQuery.mockResolvedValueOnce([{ id: "feedback-1", user_id: 7, article_id: 11, selection_id: "selection-1", expected_version: 2 }]);
    mocks.esgQuery.mockResolvedValueOnce([{ version: 3, pending_confirmation: true, state: "selected" }]);
    mocks.esgTransaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({ $queryRaw: mocks.esgQuery, $executeRaw: mocks.esgExecute }));
    await reconcileArticleAiFeedback();
    expect(mocks.creditExecute).not.toHaveBeenCalled();
    expect(mocks.esgExecute).toHaveBeenCalled();
    expect(mocks.reconcileShared).not.toHaveBeenCalled();
  });
});
