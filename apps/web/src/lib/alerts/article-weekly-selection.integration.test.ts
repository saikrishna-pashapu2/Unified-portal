import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const integration = process.env.RUN_DB_INTEGRATION_TESTS === "1" ? describe : describe.skip;
let esg: (typeof import("@esgcredit/db-esg"))["esgPrisma"];
let credit: (typeof import("@esgcredit/db-credit"))["creditPrisma"];
const users: number[] = [];
const articles: number[] = [];
const unique = randomUUID();
const now = new Date();
const since = new Date(now.getTime() - 86_400_000);
const until = new Date(now.getTime() + 60_000);

integration("real private selection reads for weekly email", () => {
  beforeAll(async () => {
    for (const key of ["ESG_DATABASE_URL", "CREDIT_DATABASE_URL"]) {
      const url = new URL(process.env[key] ?? "");
      if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Requires disposable loopback databases");
    }
    ({ esgPrisma: esg } = await import("@esgcredit/db-esg"));
    ({ creditPrisma: credit } = await import("@esgcredit/db-credit"));
    vi.stubEnv("ARTICLE_AI_ENABLED", "true");
    vi.stubEnv("ARTICLE_AI_EMAIL_ENABLED", "true");
    const { normalizeArticle } = await import("@/lib/article-ai/policy");
    for (let index = 0; index < 2; index++) {
      const user = await esg.users.create({ data: {
        username: `private-${unique}-${index}`, email: `private-${unique}-${index}@example.test`,
        password_hash: "not-a-real-password", team: `private-${unique}`, is_active_db: true,
      } });
      users.push(user.id);
      await esg.$executeRaw`
        INSERT INTO alert_preferences (user_id, domain, domains, alert_type, is_active, email_enabled, alert_articles)
        VALUES (${user.id}, 'esg', ARRAY['esg','credit']::varchar[], 'weekly_digest', true, true, true)
      `;
      for (const domain of ["esg", "credit"]) {
        await esg.$executeRaw`
          INSERT INTO article_ai_preferences (user_id, domain, enabled, status)
          VALUES (${user.id}, ${domain}, true, 'ready')
        `;
      }
      const title = `Private recommendation ${index}`;
      const url = `https://example.test/${unique}/${index}`;
      const [article] = await esg.$queryRaw<Array<{ id: number }>>`
        INSERT INTO esg_articles (title, summary, link, source, published)
        VALUES (${title}, 'Evidence about climate finance and transition risk.', ${url}, 'QA', ${since}) RETURNING id
      `;
      articles.push(article.id);
      const hash = normalizeArticle({ id: article.id, title, summary: "Evidence about climate finance and transition risk.", content: null, url, source: "QA", publishedAt: since }).contentHash;
      await esg.$executeRaw`
        INSERT INTO article_ai_selections (user_id, domain, article_id, reason, selected_at, expires_at, content_hash, relevance_score)
        VALUES (${user.id}, 'esg', ${article.id}, ${`Reason only for ${index}`}, ${now}, ${new Date(now.getTime() + 86_400_000)}, ${hash}, 0.9)
      `;
    }
  });

  afterAll(async () => {
    if (esg && users.length) await esg.users.deleteMany({ where: { id: { in: users } } });
    if (esg && articles.length) await esg.$executeRaw`DELETE FROM esg_articles WHERE id = ANY(${articles}::int[])`;
    await Promise.all([esg?.$disconnect(), credit?.$disconnect()]);
    vi.unstubAllEnvs();
  });

  it("enforces owner/domain isolation, content hashes, opt-out locks, and the email feature switch", async () => {
    const { getArticleAiDigestPicks, getArticleAiSelections, getArticleAiPreference, filterArticleAiDigestPicksForCommit } = await import("@/lib/article-ai/service");
    const picks = await getArticleAiDigestPicks(users[0], ["esg", "credit"], { since, until }, now);
    expect(picks.map(pick => [pick.domain, pick.articleId])).toEqual([["esg", articles[0]]]);
    expect(JSON.stringify(picks)).not.toContain("Reason only for 1");
    expect(await getArticleAiDigestPicks(users[0], ["credit"], { since, until }, now)).toEqual([]);

    const accepted = await esg.$transaction(tx => filterArticleAiDigestPicksForCommit(tx, users[0], picks));
    expect(accepted).toHaveLength(1);
    expect(await esg.$transaction(tx => filterArticleAiDigestPicksForCommit(tx, users[1], picks))).toEqual([]);

    await esg.$executeRaw`UPDATE article_ai_preferences SET enabled = false WHERE user_id = ${users[0]} AND domain = 'esg'`;
    expect(await esg.$transaction(tx => filterArticleAiDigestPicksForCommit(tx, users[0], picks))).toEqual([]);
    await esg.$executeRaw`UPDATE article_ai_preferences SET enabled = true WHERE user_id = ${users[0]} AND domain = 'esg'`;
    await esg.$executeRaw`UPDATE esg_articles SET summary = 'Changed by scraper after the model decision.' WHERE id = ${articles[0]}`;
    expect(await getArticleAiDigestPicks(users[0], ["esg"], { since, until }, now)).toEqual([]);
    expect(await getArticleAiSelections(users[0], "esg", [articles[0]])).toEqual([]);

    await esg.$executeRaw`UPDATE alert_preferences SET alert_articles = false WHERE user_id = ${users[1]}`;
    expect((await getArticleAiPreference(users[1], "esg")).weeklyDigestConfigured).toBe(false);
    expect(await getArticleAiDigestPicks(users[1], ["esg"], { since, until }, now)).toEqual([]);
    await esg.$executeRaw`UPDATE alert_preferences SET alert_articles = true WHERE user_id = ${users[1]}`;

    vi.stubEnv("ARTICLE_AI_EMAIL_ENABLED", "false");
    expect(await getArticleAiDigestPicks(users[1], ["esg"], { since, until }, now)).toEqual([]);
    const [likes] = await esg.$queryRaw<Array<{ count: number }>>`SELECT count(*)::int AS count FROM likes WHERE user_id = ANY(${users}::int[])`;
    expect(likes.count).toBe(0);
  });
});
