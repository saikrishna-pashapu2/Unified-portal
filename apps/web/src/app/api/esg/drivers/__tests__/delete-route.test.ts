import { afterEach, describe, expect, it, vi } from "vitest";

const jobId = "4c4ebf2b-a9e5-4f40-b633-740ee43ea7ec";

async function loadDeleteRoute(
  outcome: "deleted" | "cancelling" | "linked" | false,
) {
  vi.resetModules();
  const deleteEsgDriverJob = vi.fn().mockResolvedValue(outcome);
  vi.doMock("@/lib/session-user", () => ({
    ensureUserId: vi.fn().mockResolvedValue(7),
  }));
  vi.doMock("@/lib/esg-drivers", () => ({
    deleteEsgDriverJob,
    isDriverJobId: vi.fn().mockReturnValue(true),
  }));

  const route = await import("../[jobId]/route");
  return { deleteEsgDriverJob, route };
}

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("ESG driver delete route", () => {
  it("returns 409 instead of deleting a parent with resume children", async () => {
    const { deleteEsgDriverJob, route } = await loadDeleteRoute("linked");
    const response = await route.DELETE(new Request("http://localhost"), {
      params: Promise.resolve({ jobId }),
    });

    expect(deleteEsgDriverJob).toHaveBeenCalledWith(jobId, 7);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error:
        "This driver pack is the parent of a retry job and must be retained for provenance.",
    });
  });
});
