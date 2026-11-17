import { describe, expect, it, vi } from "vitest";

const testDatabaseUrl = process.env.ESG_ARTICLE_SEARCH_TEST_DATABASE_URL;

function isApprovedLocalTestDatabase(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    const databaseName = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    const localHost = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1";
    const approvedDatabase = /^esg_article_search_test_20261117(?:[_-][a-z0-9-]+)?$/i.test(databaseName);
    return localHost && url.port === "55471" && approvedDatabase;
  } catch {
    return false;
  }
}

const integrationEnabled =
  process.env.RUN_ESG_ARTICLE_SEARCH_DB_TESTS === "1" &&
  isApprovedLocalTestDatabase(testDatabaseUrl);

// Keep the server-only boundary explicit for Vitest's Node environment. This
// mock is evaluated before the repository's dynamic import below.
vi.mock("server-only", () => ({}));

describe("ESG article search repository (local PostgreSQL only)", () => {
  it.skipIf(!integrationEnabled)("searches the complete archive with filters and suggestions", async () => {
    if (!testDatabaseUrl) throw new Error("ESG_ARTICLE_SEARCH_TEST_DATABASE_URL is required");

    const previousDatabaseUrl = process.env.ESG_DATABASE_URL;
    process.env.ESG_DATABASE_URL = testDatabaseUrl;

    const { esgPrisma } = await import("@esgcredit/db-esg");
    const { resetEsgArticleSearchCachesForTests, searchEsgArticles } = await import("./repository");
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const fixtureIds: number[] = [];
    let fullTextIndexHidden = false;
    const fixtureRows = [
      {
        title: "Local GHG climate transition",
        summary: "<b>Greenhouse gases</b> and transition evidence.",
        keywords: "climate, ghg",
        published: "2024-02-29",
      },
      {
        title: "Newest archive article",
        summary: "A later local archive record.",
        keywords: "keywordterm",
        published: "2026-11-16",
      },
      {
        title: "Local solar governance",
        summary: "A governance research note.",
        keywords: "renewables",
        published: "2025-06-01",
      },
      {
        title: "Carbon title match",
        summary: "An unrelated evidence note.",
        keywords: "",
        published: "2025-01-01",
      },
      {
        title: "Archive summary match",
        summary: "The carbon summary match is lower weighted.",
        keywords: "",
        published: "2025-01-02",
      },
      {
        title: "Deep summary entry",
        summary: `${"Neutral background. ".repeat(3_000)}deeplystoredterm`,
        keywords: "",
        published: "2010-01-01",
      },
      ...Array.from({ length: 16 }, (_, index) => ({
        title: `Archive filler ${index + 1}`,
        summary: "A bounded archive fixture.",
        keywords: "",
        published: `2023-01-${String(index + 1).padStart(2, "0")}`,
      })),
    ];

    try {
      for (let index = 0; index < fixtureRows.length; index += 1) {
        const fixture = fixtureRows[index];
        const link = `https://article-search.test/${suffix}/${index}`;
        const inserted = await esgPrisma.$queryRaw<{ id: number }[]>`
          INSERT INTO esg_articles (title, summary, matched_keywords, source, link, published, save_time)
          VALUES (
            ${fixture.title},
            ${fixture.summary},
            ${fixture.keywords},
            'Search Test',
            ${link},
            ${fixture.published}::date,
            ${`${fixture.published} 08:00:00`}::timestamp
          )
          RETURNING id
        `;
        const id = inserted[0]?.id;
        if (!id) throw new Error("Fixture insert did not return an article ID");
        fixtureIds.push(id);
      }

      const [firstId, secondId, solarId, carbonTitleId] = fixtureIds;

      resetEsgArticleSearchCachesForTests();
      const browse = await searchEsgArticles({
        q: "",
        source: "Search Test",
        from: "",
        to: "",
        sort: "newest",
        page: 1,
      });
      expect(browse.total).toBe(fixtureRows.length);
      expect(browse.items[0]?.id).toBe(secondId);
      expect(browse.items).toHaveLength(15);
      expect(browse.items.some((item) => item.id === firstId)).toBe(true);

      const secondPage = await searchEsgArticles({
        q: "",
        source: "Search Test",
        from: "",
        to: "",
        sort: "newest",
        page: 2,
      });
      expect(secondPage.items).toHaveLength(fixtureRows.length - 15);
      expect(secondPage.hasMore).toBe(false);

      const filtered = await searchEsgArticles({
        q: "climat",
        source: "Search Test",
        from: "2024-02-29",
        to: "2024-02-29",
        sort: "relevance",
        page: 1,
      });
      expect(filtered.total).toBe(1);
      expect(filtered.items[0]?.id).toBe(firstId);
      expect(filtered.items[0]?.snippet).toContain("Greenhouse gases");
      expect(filtered.items[0]?.snippet).not.toContain("<b>");
      expect(filtered.items[0]?.snippet.length).toBeLessThanOrEqual(320);
      expect(filtered.typoTolerance).toBe(true);

      const typo = await searchEsgArticles({
        q: "climatte",
        source: "Search Test",
        from: "",
        to: "",
        sort: "relevance",
        page: 1,
      });
      expect(typo.items[0]?.id).toBe(firstId);

      const fuzzyWithRequiredTerm = await searchEsgArticles({
        q: "solar governnce",
        source: "Search Test",
        from: "",
        to: "",
        sort: "relevance",
        page: 1,
      });
      expect(fuzzyWithRequiredTerm.items[0]?.id).toBe(solarId);

      const titleWeighted = await searchEsgArticles({
        q: "carbon",
        source: "Search Test",
        from: "",
        to: "",
        sort: "relevance",
        page: 1,
      });
      expect(titleWeighted.items[0]?.id).toBe(carbonTitleId);

      const keywordMatch = await searchEsgArticles({
        q: "keywordterm",
        source: "Search Test",
        from: "",
        to: "",
        sort: "relevance",
        page: 1,
      });
      expect(keywordMatch.items[0]?.id).toBe(secondId);

      const suggestions = await searchEsgArticles(
        {
          q: "climat",
          source: "Search Test",
          from: "",
          to: "",
          sort: "relevance",
          page: 1,
        },
        { suggest: true },
      );
      expect(suggestions.total).toBeNull();
      expect(suggestions.pageSize).toBe(6);

      const deep = await searchEsgArticles({ q: "deeplystoredterm", source: "Search Test", from: "", to: "", sort: "relevance", page: 1 });
      expect(deep.total).toBe(1);
      expect(deep.items[0]?.id).toBe(fixtureIds[5]);
      const wrongContext = await searchEsgArticles({ q: "solar climatte", source: "Search Test", from: "", to: "", sort: "relevance", page: 1 });
      expect(wrongContext.total).toBe(0);

      // This test can only run in the explicit disposable loopback database.
      // Temporarily hide the index name to exercise an unmigrated/partial
      // capability state, then restore it even if an assertion fails.
      await esgPrisma.$executeRaw`ALTER INDEX esg_articles_search_fts_idx RENAME TO esg_articles_search_fts_test_hidden_idx`;
      fullTextIndexHidden = true;
      resetEsgArticleSearchCachesForTests();
      const literal = await searchEsgArticles({ q: "CARBON", source: "Search Test", from: "", to: "", sort: "relevance", page: 1 });
      expect(literal.total).toBe(2);
      expect(literal.items[0]?.id).toBe(carbonTitleId);
      expect(literal.typoTolerance).toBe(false);
      const literalDeep = await searchEsgArticles({ q: "deeplystoredterm", source: "Search Test", from: "", to: "", sort: "relevance", page: 1 });
      expect(literalDeep.items[0]?.id).toBe(fixtureIds[5]);
      const literalRequiredTerms = await searchEsgArticles({ q: "solar climate", source: "Search Test", from: "", to: "", sort: "relevance", page: 1 });
      expect(literalRequiredTerms.total).toBe(0);
    } finally {
      if (fullTextIndexHidden) {
        await esgPrisma.$executeRaw`ALTER INDEX esg_articles_search_fts_test_hidden_idx RENAME TO esg_articles_search_fts_idx`;
        resetEsgArticleSearchCachesForTests();
      }
      if (fixtureIds.length) {
        await esgPrisma.$executeRaw`DELETE FROM esg_articles WHERE id = ANY(${fixtureIds}::int[])`;
      }
      await esgPrisma.$disconnect();
      if (previousDatabaseUrl === undefined) delete process.env.ESG_DATABASE_URL;
      else process.env.ESG_DATABASE_URL = previousDatabaseUrl;
    }
  });
});
