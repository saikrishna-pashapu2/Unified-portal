import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  completeEsgDriverJob: vi.fn().mockResolvedValue(true),
  generateEsgDriverResult: vi.fn(),
  getEsgDriverJob: vi.fn(),
  throwIfJobCancelled: vi.fn().mockResolvedValue(undefined),
  updateEsgDriverJobCheckpoint: vi.fn().mockResolvedValue(undefined),
  updateEsgDriverJobProgress: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("server-only", () => ({}));
vi.mock("../generator", () => ({
  generateEsgDriverResult: mocks.generateEsgDriverResult,
}));
vi.mock("../jobs", () => ({
  completeEsgDriverJob: mocks.completeEsgDriverJob,
  getEsgDriverJob: mocks.getEsgDriverJob,
  updateEsgDriverJobCheckpoint: mocks.updateEsgDriverJobCheckpoint,
  updateEsgDriverJobProgress: mocks.updateEsgDriverJobProgress,
}));
vi.mock("@/lib/jobs/queue", () => ({
  throwIfJobCancelled: mocks.throwIfJobCancelled,
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("ESG driver checkpoint runner", () => {
  it("loads a saved checkpoint and persists every harness checkpoint callback", async () => {
    const savedCheckpoint = checkpoint("2026-07-14T00:00:00.000Z");
    const nextCheckpoint = checkpoint("2026-07-14T00:01:00.000Z");
    mocks.getEsgDriverJob.mockResolvedValue({
      status: "queued",
      progress: 64,
      result: null,
      checkpoint: savedCheckpoint,
    });
    mocks.generateEsgDriverResult.mockImplementation(
      async (_input, options) => {
        await options.onProgress("reviewing D7", 55, {
          kind: "review",
          title: "Reviewing D7 against quality gates",
          outcome: "running",
          driverId: "D7",
          reasons: ["Checking claim support and citation scope."],
        });
        await options.onCheckpoint(nextCheckpoint);
        return result();
      },
    );

    const { runEsgDriverGenerationJob } = await import("../runner");
    const outcome = await runEsgDriverGenerationJob({
      id: "4c4ebf2b-a9e5-4f40-b633-740ee43ea7ec",
      userId: 7,
      payload: {
        country: "United Arab Emirates",
        sector: "Banking",
        language: "English",
      },
      leaseOwner: "lease-token-a",
      attempts: 1,
      maxAttempts: 2,
      progress: 5,
    } as any);

    expect(mocks.generateEsgDriverResult).toHaveBeenCalledWith(
      expect.objectContaining({ sector: "Banking" }),
      expect.objectContaining({ checkpoint: savedCheckpoint }),
    );
    expect(mocks.updateEsgDriverJobCheckpoint).toHaveBeenCalledWith(
      "4c4ebf2b-a9e5-4f40-b633-740ee43ea7ec",
      "lease-token-a",
      nextCheckpoint,
    );
    expect(mocks.updateEsgDriverJobProgress).toHaveBeenNthCalledWith(
      1,
      "4c4ebf2b-a9e5-4f40-b633-740ee43ea7ec",
      "lease-token-a",
      expect.objectContaining({
        progress: 64,
        stage: "resuming from checkpoint",
      }),
    );
    expect(mocks.updateEsgDriverJobProgress).toHaveBeenNthCalledWith(
      2,
      "4c4ebf2b-a9e5-4f40-b633-740ee43ea7ec",
      "lease-token-a",
      expect.objectContaining({
        progress: 64,
        stage: "reviewing D7",
        detail: expect.objectContaining({
          kind: "review",
          driverId: "D7",
          reasons: ["Checking claim support and citation scope."],
        }),
      }),
    );
    expect(mocks.completeEsgDriverJob).toHaveBeenCalledWith(
      "4c4ebf2b-a9e5-4f40-b633-740ee43ea7ec",
      "lease-token-a",
      expect.objectContaining({ catalogVersion: "2026-07-14" }),
    );
    expect(outcome).toMatchObject({
      queueCompleted: true,
      result: { catalogVersion: "2026-07-14" },
    });
  });
});

function checkpoint(updatedAt: string) {
  return {
    version: 1 as const,
    catalogVersion: "2026-07-14",
    selectionPlan: {} as any,
    canonicalDrivers: [],
    evidencePacks: [],
    completedSlotIds: [],
    failedSlots: [],
    attemptedCandidateIds: [],
    slotStates: [],
    updatedAt,
  };
}

function result() {
  return {
    country: "United Arab Emirates",
    sector: "Banking",
    language: "English",
    catalogVersion: "2026-07-14",
    generatedAt: "2026-07-14T00:02:00.000Z",
    drivers: [],
    evidence: [],
    warnings: [],
    completion: "partial" as const,
    expectedDriverCount: 12,
  };
}
