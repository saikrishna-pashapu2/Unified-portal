import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  executeRaw: vi.fn(),
  queryRaw: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@esgcredit/db-esg", () => ({
  esgPrisma: {
    $transaction: mocks.transaction,
  },
}));

import {
  resetEsgArticleSearchCachesForTests,
  searchEsgArticles,
} from "./repository";

type FakeTransaction = {
  $executeRaw: typeof mocks.executeRaw;
  $queryRaw: typeof mocks.queryRaw;
};

const filters = {
  q: "climate",
  source: "",
  from: "",
  to: "",
  sort: "relevance" as const,
  page: 1,
};

const articleRow = {
  id: 7,
  title: "<em>Climate</em> title",
  source: "Search Test",
  published: "2024-02-29",
  url: "javascript:alert(1)",
  summary: "<b>Greenhouse</b> &amp; gases <script>bad()</script>",
  matched_keywords: "<i>climate</i>, transition",
};

function sqlText(call: unknown[]): string {
  const template = call[0];
  return Array.isArray(template) ? template.join(" ") : "";
}

beforeEach(() => {
  vi.resetAllMocks();
  resetEsgArticleSearchCachesForTests();

  const tx: FakeTransaction = {
    $executeRaw: mocks.executeRaw,
    $queryRaw: mocks.queryRaw,
  };
  mocks.executeRaw.mockResolvedValue(0);
  mocks.transaction.mockImplementation(async (callback: (value: FakeTransaction) => Promise<unknown>) => callback(tx));
});

describe("ESG article search repository", () => {
  it("uses a conservative unindexed prefilter and returns the exact count", async () => {
    mocks.queryRaw
      .mockResolvedValueOnce([{ has_pg_trgm: false, has_title_trgm_index: false, has_full_text_index: false }])
      .mockResolvedValueOnce([articleRow])
      .mockResolvedValueOnce([{ total: 1 }]);

    const response = await searchEsgArticles(filters);

    expect(response.total).toBe(1);
    expect(response.items).toHaveLength(1);
    expect(response.typoTolerance).toBe(false);
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
    expect(mocks.transaction.mock.calls[0]?.[1]).toMatchObject({ isolationLevel: "RepeatableRead" });
    expect(mocks.executeRaw).toHaveBeenCalledWith(expect.anything());

    const searchSql = mocks.queryRaw.mock.calls.map(sqlText).join("\n");
    expect(searchSql).toContain("concat_ws");
    expect(searchSql).toContain("unnest");
    expect(searchSql).toContain("!~");
    expect(searchSql).not.toContain("to_tsvector");
  });

  it("maps snippets to bounded plain text and rejects unsafe URLs", async () => {
    mocks.queryRaw
      .mockResolvedValueOnce([{ has_pg_trgm: false, has_title_trgm_index: false, has_full_text_index: true }])
      .mockResolvedValueOnce([articleRow])
      .mockResolvedValueOnce([{ total: 1 }]);

    const response = await searchEsgArticles(filters);
    const item = response.items[0];

    expect(item).toMatchObject({
      id: 7,
      title: "Climate title",
      source: "Search Test",
      published: "2024-02-29",
      url: null,
      snippet: "Greenhouse & gases bad()",
      matched_keywords: "climate, transition",
    });
    expect(item?.snippet.length).toBeLessThanOrEqual(320);
  });

  it("does not count or sample suggestion results and deduplicates concurrent requests", async () => {
    mocks.queryRaw.mockImplementation(async (template: unknown[]) => {
      const text = sqlText(template);
      if (text.includes("pg_extension")) {
        return [{ has_pg_trgm: false, has_title_trgm_index: false, has_full_text_index: true }];
      }
      return [articleRow];
    });

    const [first, second] = await Promise.all([
      searchEsgArticles(filters, { suggest: true }),
      searchEsgArticles(filters, { suggest: true }),
    ]);

    expect(first.total).toBeNull();
    expect(first.pageSize).toBe(6);
    expect(first.hasMore).toBe(false);
    expect(second).toEqual(first);
    // One capability transaction and one deduplicated suggestion transaction.
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
    expect(mocks.queryRaw.mock.calls.every((call) => !sqlText(call).includes("COUNT(*)"))).toBe(true);
  });

  it("propagates capability outages instead of returning an empty corpus", async () => {
    mocks.queryRaw.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(searchEsgArticles(filters)).rejects.toThrow("database unavailable");
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });
});
