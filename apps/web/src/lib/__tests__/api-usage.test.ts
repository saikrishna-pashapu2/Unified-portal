import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  countActiveJobs: vi.fn(),
  queryRaw: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/jobs/queue", () => ({
  countActiveJobs: mocks.countActiveJobs,
}));
vi.mock("@esgcredit/db-esg", () => ({
  esgPrisma: {
    $queryRaw: mocks.queryRaw,
  },
}));

import { enforceApiUsage } from "@/lib/api-usage";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.countActiveJobs.mockResolvedValue(0);
  mocks.queryRaw.mockResolvedValue([{ request_count: 1 }]);
});

describe("authenticated API usage limits", () => {
  it("skips the daily bucket when perDay is omitted", async () => {
    const response = await enforceApiUsage(request(), {
      feature: "esg_driver_generation",
      userId: 7,
      perMinute: 2,
      maxConcurrentJobs: 1,
      jobType: "esg_driver",
    });

    expect(response).toBeNull();
    expect(mocks.countActiveJobs).toHaveBeenCalledWith(7, "esg_driver");
    expect(mocks.queryRaw).toHaveBeenCalledTimes(2);
  });

  it("continues enforcing a configured daily bucket for other features", async () => {
    mocks.queryRaw
      .mockResolvedValueOnce([{ request_count: 1 }])
      .mockResolvedValueOnce([{ request_count: 1 }])
      .mockResolvedValueOnce([]);

    const response = await enforceApiUsage(request(), {
      feature: "another_feature",
      userId: 7,
      perMinute: 2,
      perDay: 5,
    });

    expect(response?.status).toBe(429);
    await expect(response?.json()).resolves.toEqual({
      error: "Daily feature budget exceeded",
    });
    expect(mocks.queryRaw).toHaveBeenCalledTimes(3);
  });
});

function request(): Request {
  return new Request("http://localhost/api/test", {
    headers: { "x-real-ip": "203.0.113.10" },
  });
}
