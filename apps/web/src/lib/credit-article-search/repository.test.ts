import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), executeRaw: vi.fn(), queryRawUnsafe: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@esgcredit/db-credit", () => ({ creditPrisma: { $transaction: mocks.transaction } }));

import { resetCreditArticleSearchCachesForTests, searchCreditArticles } from "./repository";

const filters = { q: "BBB-", source: "", from: "", to: "", sort: "relevance" as const, page: 1, region: "" as const, sector: "" as const };
const row = { id: 9, title: "BBB- outlook", source: "Ratings", published: "2024-02-29", url: "https://example.test/a", summary: "<b>Rating</b>", matched_keywords: "BBB-", region: "global", sector: "sovereigns" };

beforeEach(() => {
  vi.resetAllMocks();
  resetCreditArticleSearchCachesForTests();
  mocks.executeRaw.mockResolvedValue(0);
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({ $executeRaw: mocks.executeRaw, $queryRawUnsafe: mocks.queryRawUnsafe }));
});

describe("Credit article search repository", () => {
  it("preserves rating punctuation and returns bounded mapped results", async () => {
    mocks.queryRawUnsafe.mockResolvedValueOnce([row]).mockResolvedValueOnce([{ total: 1 }]);
    const response = await searchCreditArticles(filters);
    expect(response.total).toBe(1);
    expect(response.items[0]).toMatchObject({ id: 9, title: "BBB- outlook", snippet: "Rating", region: "global", sector: "sovereigns" });
    const sql = mocks.queryRawUnsafe.mock.calls.map((call) => String(call[0])).join("\n");
    expect(sql).toContain("searchable.search_text ~ $1");
    expect(mocks.queryRawUnsafe.mock.calls[0]?.[1]).toBe("(^|[^[:alnum:]])bbb-([^[:alnum:]]|$)");
  });

  it("does not count or duplicate concurrent suggestions", async () => {
    mocks.queryRawUnsafe.mockResolvedValue([row]);
    const [first, second] = await Promise.all([
      searchCreditArticles(filters, { suggest: true }),
      searchCreditArticles(filters, { suggest: true }),
    ]);
    expect(first).toEqual(second);
    expect(first.total).toBeNull();
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.queryRawUnsafe).toHaveBeenCalledTimes(1);
  });
});
