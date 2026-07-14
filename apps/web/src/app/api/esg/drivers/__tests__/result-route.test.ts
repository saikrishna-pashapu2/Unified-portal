import { afterEach, describe, expect, it, vi } from "vitest";

const jobId = "4c4ebf2b-a9e5-4f40-b633-740ee43ea7ec";

async function loadResultRoute(resumable: boolean) {
  vi.resetModules();
  const job = {
    id: jobId,
    status: "done",
    progress: 100,
    stage: "complete with omissions",
    error: null,
    result: { completion: "partial", drivers: [] },
  };
  const getEsgDriverJob = vi.fn().mockResolvedValue(job);
  const isResumableEsgDriverJob = vi.fn().mockReturnValue(resumable);

  vi.doMock("@/lib/session-user", () => ({
    ensureUserId: vi.fn().mockResolvedValue(7),
  }));
  vi.doMock("@/lib/esg-drivers", () => ({
    getEsgDriverJob,
    isResumableEsgDriverJob,
  }));

  const route = await import("../result/route");
  return { getEsgDriverJob, isResumableEsgDriverJob, job, route };
}

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("ESG driver result route", () => {
  it.each([true, false])(
    "returns checkpoint-backed resumability as %s",
    async (resumable) => {
      const { getEsgDriverJob, isResumableEsgDriverJob, job, route } =
        await loadResultRoute(resumable);
      const response = await route.GET(
        new Request(`http://localhost/api/esg/drivers/result?jobId=${jobId}`),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(getEsgDriverJob).toHaveBeenCalledWith(jobId, 7, {
        includeCheckpoint: true,
      });
      expect(isResumableEsgDriverJob).toHaveBeenCalledWith(job);
      expect(body).toMatchObject({ success: true, jobId, resumable });
    },
  );
});
