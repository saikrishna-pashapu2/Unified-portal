import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { parseCreditArticleSearchParams } from "./query";

vi.mock("server-only", () => ({}));

// Exact isolated target, including port and database name. Never use the app's
// configured DB (even when opt-in is set); fixtures are scoped to a unique source.
const fixtureUrl = "postgresql://postgres@127.0.0.1:55472/credit_article_search_test";
it.skipIf(process.env.RUN_CREDIT_ARTICLE_SEARCH_DB_TESTS !== "1")(
  "searches historical Credit records, preserves rating signs, filters, ranking and paging", async () => {
    if (globalThis.__creditPrisma) throw new Error("Refusing to reuse an existing database client in the fixture");
    vi.stubEnv("CREDIT_DATABASE_URL", fixtureUrl);
    const { creditPrisma } = await import("@esgcredit/db-credit");
    const { searchCreditArticles } = await import("./repository");
    const source = `Credit search fixture ${randomUUID()}`;
    const find = (params: Record<string,string> = {}, suggest = false) => {
      const parsed = parseCreditArticleSearchParams({source, ...params});
      if (!parsed.ok) throw Error(parsed.error);
      return searchCreditArticles(parsed.filters, {suggest});
    };
    let disposableTargetVerified = false;
    try {
      const [target] = await creditPrisma.$queryRaw<{ name: string; local: boolean }[]>`
        SELECT current_database() AS name,
          (inet_server_addr() = inet '127.0.0.1' AND inet_server_port() = 55472) AS local`;
      disposableTargetVerified = target?.local === true && target.name === "credit_article_search_test";
      if (!disposableTargetVerified) throw new Error("Expected the disposable loopback Credit database");
      const fixture = [
        ["Issuer AA+ raised", "Stable outlook", "MiddleEast", "banks", "2008-10-02"],
        ["Issuer AA- lowered", "BBB- rating under review", "CentralAsia", "sovereignsRACS", "2019-10-02"],
        ["Other issuer", "AA+ outlook", "MiddleEast", "banks", "2020-10-02"],
        ["Another issuer AAA+", "Different grade", "MiddleEast", "banks", "2020-10-02"],
        ...Array.from({length:15}, (_,i) => [`Archive note ${i}`, "Oil markets", "global", "corporates", "2018-01-01"]),
      ];
      for(const [title,summary,region,sector,date] of fixture) {
        await creditPrisma.$executeRaw`INSERT INTO credit_articles (title,summary,region,sector,date,source,matched_keywords)
          VALUES (${title},${summary},${region},${sector},${date}::date,${source},'Example')`;
      }
      const browse = await find();
      expect(browse.total).toBe(19);
      expect(browse.items.length).toBe(15);
      const next = await find({page:"2"});
      expect(next.items.length).toBe(4);
      expect(new Set([...browse.items,...next.items].map(item=>item.id)).size).toBe(19);
      const ratings = await find({q:"AA+"});
      expect(ratings.total).toBe(2);
      expect(ratings.items[0].title).toBe("Issuer AA+ raised");
      expect((await find({q:"AA+",sort:"newest"})).items[0].title).toBe("Other issuer");
      expect((await find({q:"AA+ issuer"})).items.map(row => row.title))
        .toEqual(["Issuer AA+ raised", "Other issuer"]);
      const suggestions = await find({q:"BBB-",region:"CentralAsia",sector:"sovereignsRACS",from:"2019-10-02",to:"2019-10-02"},true);
      expect(suggestions.total).toBeNull();
      expect(suggestions.items.map(item=>item.title)).toEqual(["Issuer AA- lowered"]);
      expect((await find({q:"BBB-",region:"MiddleEast"},true)).items).toEqual([]);
      expect((await find({q:"example"})).total).toBe(19);
      expect((await find({q:"archive"},true)).items.length).toBe(6);
    } finally {
      try { if (disposableTargetVerified) await creditPrisma.$executeRaw`DELETE FROM credit_articles WHERE source=${source}`; }
      finally { await creditPrisma.$disconnect(); vi.unstubAllEnvs(); }
    }
  },30_000,
);
