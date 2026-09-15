import { afterEach, describe, expect, it, vi } from "vitest";

async function loadHistoryRoute(userId: number | null = 7) {
  vi.resetModules();
  const listEsgDriverJobsPage = vi.fn().mockResolvedValue({
    jobs: [],
    nextCursor: null,
    total: 0,
    completed: 0,
    needsAttention: 0,
  });

  class InvalidEsgDriverJobsCursorError extends Error {
    constructor() {
      super("Invalid ESG driver history cursor.");
      this.name = "InvalidEsgDriverJobsCursorError";
    }
  }

  vi.doMock("@/lib/session-user", () => ({
    ensureUserId: vi.fn().mockResolvedValue(userId),
  }));
  vi.doMock("@/lib/esg-drivers", () => ({
    InvalidEsgDriverJobsCursorError,
    listEsgDriverJobsPage,
  }));

  const route = await import("../history/route");
  return { InvalidEsgDriverJobsCursorError, listEsgDriverJobsPage, route };
}

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("ESG driver history route", () => {
  it("requires authentication before reading history", async () => {
    const { listEsgDriverJobsPage, route } = await loadHistoryRoute(null);
    const response = await route.GET(
      new Request("http://localhost/api/esg/drivers/history"),
    );

    expect(response.status).toBe(401);
    expect(listEsgDriverJobsPage).not.toHaveBeenCalled();
  });

  it('exposes published and candidate counts and research gaps on a complete ranked report', async () => {
    const { listEsgDriverJobsPage, route } = await loadHistoryRoute();
    listEsgDriverJobsPage.mockResolvedValue({ jobs: [{ id: 'ranked', status: 'done', activity: [],
      selectionPolicy: 'relevance-top15-v1', candidateCount: 52, publishedDriverCount: 15,
      result: { drivers: Array.from({ length: 15 }, () => ({})), completion: 'complete', selection: { excluded: [{ reason: 'unavailable' }] } },
    }], nextCursor: null, total: 1, completed: 1, needsAttention: 1 });
    const response = await route.GET(new Request('http://localhost/api/esg/drivers/history'));
    expect((await response.json()).jobs[0]).toMatchObject({ selectionPolicy: 'relevance-top15-v1', candidateCount: 52, publishedDriverCount: 15, driverCount: 15, needsAttention: true });
  });

  it("returns an ownership-scoped cursor page and aggregate counts", async () => {
    const { listEsgDriverJobsPage, route } = await loadHistoryRoute();
    listEsgDriverJobsPage.mockResolvedValue({
      jobs: [
        {
          id: "9dc7ad8f-54f3-490c-a912-8df958df65ca",
          country: "UAE",
          sector: "Banking",
          language: "English",
          status: "done",
          progress: 100,
          stage: "done",
          error: null,
          result: { drivers: [{}, {}], completion: "partial" },
          activity: [],
          createdAt: "2026-07-13T00:00:00.000Z",
          updatedAt: "2026-07-13T00:01:00.000Z",
          completedAt: "2026-07-13T00:01:00.000Z",
        },
      ],
      nextCursor: "next_page",
      total: 27,
      completed: 24,
      needsAttention: 2,
    });

    const response = await route.GET(
      new Request(
        "http://localhost/api/esg/drivers/history?limit=10&cursor=current_page",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(listEsgDriverJobsPage).toHaveBeenCalledWith(7, {
      limit: 10,
      cursor: "current_page",
    });
    expect(body).toMatchObject({
      nextCursor: "next_page",
      total: 27,
      completed: 24,
      needsAttention: 2,
      jobs: [{ driverCount: 2, needsAttention: true }],
    });
  });

  it.each([
    "limit=0",
    "limit=51",
    "limit=1.5",
    "limit=ten",
    "cursor=",
    "cursor=%25invalid",
  ])("rejects invalid pagination input: %s", async (query) => {
    const { listEsgDriverJobsPage, route } = await loadHistoryRoute();
    const response = await route.GET(
      new Request(`http://localhost/api/esg/drivers/history?${query}`),
    );

    expect(response.status).toBe(400);
    expect(listEsgDriverJobsPage).not.toHaveBeenCalled();
  });

  it("maps a structurally invalid opaque cursor to HTTP 400", async () => {
    const {
      InvalidEsgDriverJobsCursorError,
      listEsgDriverJobsPage,
      route,
    } = await loadHistoryRoute();
    listEsgDriverJobsPage.mockRejectedValue(
      new InvalidEsgDriverJobsCursorError(),
    );

    const response = await route.GET(
      new Request(
        "http://localhost/api/esg/drivers/history?cursor=valid_shape_invalid_payload",
      ),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invalid ESG driver history cursor.",
    });
  });
});
