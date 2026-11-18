import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), search: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/api-auth", () => ({ requireUserSession: mocks.auth }));
vi.mock("@/lib/credit-article-search/repository", () => ({ searchCreditArticles: mocks.search }));

import { resetCreditArticleSearchRateForTests } from "@/lib/credit-article-search/rate-limit";
import { GET } from "./route";

function request(query = ""): NextRequest { return new NextRequest(`https://portal.test/api/credit/articles/search${query}`); }
const result = { items: [], total: 0, page: 1, pageSize: 15, hasMore: false, query: "", typoTolerance: false };

beforeEach(() => {
  vi.resetAllMocks();
  resetCreditArticleSearchRateForTests();
  mocks.auth.mockResolvedValue({ userId: 7, session: { user: { id: "7" } } });
  mocks.search.mockResolvedValue(result);
});

describe("GET /api/credit/articles/search", () => {
  it("authenticates before searching and passes credit filters", async () => {
    const response = await GET(request("?q=BBB-%20outlook&region=CentralAsia&sector=sovereigns&from=2024-01-01"));
    expect(response.status).toBe(200);
    expect(mocks.search).toHaveBeenCalledWith({ q: "BBB- outlook", source: "", from: "2024-01-01", to: "", sort: "relevance", page: 1, region: "CentralAsia", sector: "sovereigns" }, { suggest: false });
  });

  it("rejects invalid region without repository access", async () => {
    const response = await GET(request("?q=climate&region=other"));
    expect(response.status).toBe(400);
    expect(mocks.search).not.toHaveBeenCalled();
  });

  it("returns 401 before parsing for anonymous users", async () => {
    mocks.auth.mockResolvedValue({ response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) });
    const response = await GET(request("?q=climate"));
    expect(response.status).toBe(401);
    expect(mocks.search).not.toHaveBeenCalled();
  });

  it("keeps service failures distinct from zero matches and does not expose DB details", async () => {
    mocks.search.mockRejectedValueOnce(new Error("sensitive connection information"));
    const response = await GET(request("?q=AA%2B&suggest=1"));
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.text()).not.toContain("sensitive");
  });

  it("shares the per-user request budget between suggestions and full results", async () => {
    for (let i=0; i<60; i++) await GET(request("?q=BBB-&suggest=1"));
    const response = await GET(request("?q=BBB-"));
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(mocks.search).toHaveBeenCalledTimes(60);
  });
});
