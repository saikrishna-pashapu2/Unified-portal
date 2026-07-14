import { afterEach, describe, expect, it, vi } from "vitest";

const parentId = "4c4ebf2b-a9e5-4f40-b633-740ee43ea7ec";
const childId = "9320f9d0-1091-4484-9b56-e6e695bcf653";

async function loadResumeRoute(options: {
  userId?: number | null;
  parent?: Record<string, unknown> | null;
  resumable?: boolean;
  limited?: Response | null;
  validJobId?: boolean;
  createError?: "not-found" | "conflict";
} = {}) {
  vi.resetModules();
  const parent =
    options.parent === undefined
      ? { id: parentId, status: "done", result: { completion: "partial" } }
      : options.parent;
  const child = { id: childId, parentJobId: parentId, status: "queued" };
  const getEsgDriverJob = vi.fn().mockResolvedValue(parent);
  class EsgDriverResumeParentNotFoundError extends Error {}
  class EsgDriverResumeConflictError extends Error {}
  const createEsgDriverResumeJob = vi.fn();
  if (options.createError === "not-found") {
    createEsgDriverResumeJob.mockRejectedValue(
      new EsgDriverResumeParentNotFoundError(),
    );
  } else if (options.createError === "conflict") {
    createEsgDriverResumeJob.mockRejectedValue(new EsgDriverResumeConflictError());
  } else {
    createEsgDriverResumeJob.mockResolvedValue(child);
  }
  const enforceApiUsage = vi.fn().mockResolvedValue(options.limited ?? null);
  const assertDriverGenerationConfig = vi.fn();

  class JobConcurrencyLimitError extends Error {}

  vi.doMock("@/lib/session-user", () => ({
    ensureUserId: vi
      .fn()
      .mockResolvedValue(options.userId === undefined ? 7 : options.userId),
  }));
  vi.doMock("@/lib/api-usage", () => ({ enforceApiUsage }));
  vi.doMock("@/lib/jobs/queue", () => ({ JobConcurrencyLimitError }));
  vi.doMock("@/lib/esg-drivers", () => ({
    assertDriverGenerationConfig,
    createEsgDriverResumeJob,
    EsgDriverResumeConflictError,
    EsgDriverResumeParentNotFoundError,
    getEsgDriverJob,
    isDriverJobId: vi.fn().mockReturnValue(options.validJobId ?? true),
    isResumableEsgDriverJob: vi.fn().mockReturnValue(options.resumable ?? true),
  }));

  const route = await import("../[jobId]/resume/route");
  return {
    assertDriverGenerationConfig,
    createEsgDriverResumeJob,
    enforceApiUsage,
    getEsgDriverJob,
    route,
  };
}

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("ESG driver resume route", () => {
  it("requires authentication", async () => {
    const { getEsgDriverJob, route } = await loadResumeRoute({ userId: null });
    const response = await route.POST(request(), context());

    expect(response.status).toBe(401);
    expect(getEsgDriverJob).not.toHaveBeenCalled();
  });

  it("returns 404 when the parent is outside the ownership scope", async () => {
    const { enforceApiUsage, getEsgDriverJob, route } = await loadResumeRoute({
      parent: null,
    });
    const response = await route.POST(request(), context());

    expect(response.status).toBe(404);
    expect(getEsgDriverJob).toHaveBeenCalledWith(parentId, 7, {
      includeCheckpoint: true,
    });
    expect(enforceApiUsage).not.toHaveBeenCalled();
  });

  it("returns 404 for malformed parent identifiers without querying", async () => {
    const { enforceApiUsage, getEsgDriverJob, route } = await loadResumeRoute({
      validJobId: false,
    });
    const response = await route.POST(request(), context());

    expect(response.status).toBe(404);
    expect(getEsgDriverJob).not.toHaveBeenCalled();
    expect(enforceApiUsage).not.toHaveBeenCalled();
  });

  it("returns 409 for complete or otherwise non-partial parents", async () => {
    const { createEsgDriverResumeJob, route } = await loadResumeRoute({
      resumable: false,
    });
    const response = await route.POST(request(), context());

    expect(response.status).toBe(409);
    expect(createEsgDriverResumeJob).not.toHaveBeenCalled();
  });

  it("applies normal generation limits and creates a linked child job", async () => {
    const {
      assertDriverGenerationConfig,
      createEsgDriverResumeJob,
      enforceApiUsage,
      route,
    } = await loadResumeRoute();
    const response = await route.POST(request(), context());
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({
      success: true,
      jobId: childId,
      parentJobId: parentId,
      job: { id: childId, parentJobId: parentId },
    });
    expect(assertDriverGenerationConfig).toHaveBeenCalledTimes(1);
    expect(enforceApiUsage).toHaveBeenCalledWith(
      expect.any(Request),
      expect.objectContaining({
        feature: "esg_driver_generation",
        userId: 7,
        perMinute: 2,
        maxConcurrentJobs: 1,
        jobType: "esg_driver",
      }),
    );
    expect(createEsgDriverResumeJob).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ id: parentId }),
    );
  });

  it("passes through existing 429 rate and concurrency responses", async () => {
    const limited = Response.json(
      { error: "Too many active jobs" },
      { status: 429, headers: { "Retry-After": "30" } },
    );
    const { createEsgDriverResumeJob, route } = await loadResumeRoute({ limited });
    const response = await route.POST(request(), context());

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("30");
    expect(createEsgDriverResumeJob).not.toHaveBeenCalled();
  });

  it("returns a stable 404 when the parent disappears during child creation", async () => {
    const { enforceApiUsage, route } = await loadResumeRoute({
      createError: "not-found",
    });
    const response = await route.POST(request(), context());

    expect(enforceApiUsage).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Job not found" });
  });

  it("returns 409 when the locked parent is no longer resumable", async () => {
    const { route } = await loadResumeRoute({ createError: "conflict" });
    const response = await route.POST(request(), context());

    expect(response.status).toBe(409);
  });
});

function request() {
  return new Request(`http://localhost/api/esg/drivers/${parentId}/resume`, {
    method: "POST",
  });
}

function context() {
  return { params: Promise.resolve({ jobId: parentId }) };
}
