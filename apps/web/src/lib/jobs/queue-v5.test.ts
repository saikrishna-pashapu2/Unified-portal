import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeRaw: vi.fn(),
  queryRaw: vi.fn(),
}));

vi.mock("@esgcredit/db-esg", () => ({
  esgPrisma: {
    $executeRaw: mocks.executeRaw,
    $queryRaw: mocks.queryRaw,
  },
}));

describe("ESG Driver v5 queue routing", () => {
  it("registers v5 and applies the cross-version enqueue guard", async () => {
    const {
      BACKGROUND_JOB_TYPES,
      enqueueBackgroundJob,
      isEsgDriverQueueType,
      JobConcurrencyLimitError,
    } = await import("@/lib/jobs/queue");

    expect(BACKGROUND_JOB_TYPES).toContain("esg_driver_excel_v5");
    expect(isEsgDriverQueueType("esg_driver_excel_v5")).toBe(true);
    expect(isEsgDriverQueueType("xlsx_translation_v1")).toBe(false);

    mocks.queryRaw.mockResolvedValueOnce([{ id: "active-v4" }]);
    await expect(
      enqueueBackgroundJob(
        {
          id: "00000000-0000-4000-8000-000000000005",
          jobType: "esg_driver_excel_v5",
          userId: 7,
        },
        { $executeRaw: mocks.executeRaw, $queryRaw: mocks.queryRaw },
      ),
    ).rejects.toBeInstanceOf(JobConcurrencyLimitError);
    expect(mocks.executeRaw).toHaveBeenCalledTimes(1);
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
  });

  it("keeps the obsolete specialized worker fenced to legacy esg_driver claims", async () => {
    const { claimBackgroundJobs } = await import("@/lib/jobs/queue");

    await expect(
      claimBackgroundJobs(
        "legacy-worker",
        1,
        90,
        ["esg_driver_excel_v5"],
        "esg_driver",
      ),
    ).rejects.toThrow("may only claim esg_driver jobs");
  });

  it("makes the production ESG-only worker claim v5 exclusively", () => {
    const worker = readFileSync(
      fileURLToPath(new URL("../../esg-driver-worker.mts", import.meta.url)),
      "utf8",
    );
    expect(worker).toContain('? (["esg_driver_excel_v5"] as const)');
    expect(worker).toContain('jobType === "esg_driver_excel_v5"');
  });
});
