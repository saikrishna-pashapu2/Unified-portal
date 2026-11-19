import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  search: vi.fn(),
  dailyPickIds: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/api-auth", () => ({ requireUserSession: mocks.auth }));
vi.mock("@/lib/article-ai/daily-feed", () => ({ getDailyArticlePickIds: mocks.dailyPickIds }));
vi.mock("@/lib/esg-article-search/repository", () => ({ searchEsgArticles: mocks.search }));

import { resetEsgArticleSearchRateForTests } from "@/lib/esg-article-search/rate-limit";
import { GET } from "./route";

function request(query = ""): NextRequest {
  return new NextRequest(`https://portal.test/api/esg/articles/search${query}`);
}

const result = {
  items: [],
  total: 0,
  page: 1,
  pageSize: 15,
  hasMore: false,
  query: "",
  typoTolerance: false,
};

beforeEach(() => {
  vi.resetAllMocks();
  resetEsgArticleSearchRateForTests();
  mocks.auth.mockResolvedValue({ userId: 7, session: { user: { id: "7" } } });
  mocks.search.mockResolvedValue(result);
  mocks.dailyPickIds.mockResolvedValue([101, 202]);
});

describe("GET /api/esg/articles/search", () => {
  it("requires a signed-in user before parsing or searching", async () => {
    mocks.auth.mockResolvedValue({
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });

    const response = await GET(request("?q=climate"));
    expect(response.status).toBe(401);
    expect(mocks.search).not.toHaveBeenCalled();
  });

  it("returns validated filters and private no-store headers", async () => {
    const response = await GET(request("?q=climate%20transition&source=Reuters&from=2024-01-01&to=2024-03-31&page=2"));

    expect(response.status).toBe(200);
    expect(mocks.search).toHaveBeenCalledWith(
      {
        q: "climate transition",
        source: "Reuters",
        from: "2024-01-01",
        to: "2024-03-31",
        sort: "relevance",
        page: 2,
      },
      { suggest: false },
    );
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
  });

  it("rejects malformed input without touching the repository", async () => {
    const response = await GET(request("?q=x"));
    expect(response.status).toBe(400);
    expect(mocks.search).not.toHaveBeenCalled();
  });

  it("passes suggestions through the bounded suggestion path", async () => {
    const response = await GET(request("?q=climat&suggest=1"));
    expect(response.status).toBe(200);
    expect(mocks.search).toHaveBeenCalledWith(
      expect.objectContaining({ q: "climat", sort: "relevance", page: 1 }),
      { suggest: true },
    );
  });

  it("scopes suggestions to shared daily picks before applying the limit", async () => {
    const response = await GET(request("?q=climat&suggest=1&ai=1"));
    expect(response.status).toBe(200);
    expect(mocks.dailyPickIds).toHaveBeenCalledWith("esg", 7);
    expect(mocks.search).toHaveBeenCalledWith(
      expect.objectContaining({ q: "climat", sort: "relevance", page: 1 }),
      { suggest: true, articleIds: [101, 202] },
    );
  });

  it("rate-limits suggestions per user without writing a database usage row", async () => {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      expect((await GET(request(`?q=climat${attempt}&suggest=1`))).status).toBe(200);
    }

    const limited = await GET(request("?q=climat-final&suggest=0"));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
    expect(mocks.search).toHaveBeenCalledTimes(60);
  });

  it("returns a sanitized service error when the database is unavailable", async () => {
    mocks.search.mockRejectedValueOnce(new Error("password=secret host=internal"));
    const response = await GET(request("?q=climate"));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toMatch(/secret|internal/);
  });
});
