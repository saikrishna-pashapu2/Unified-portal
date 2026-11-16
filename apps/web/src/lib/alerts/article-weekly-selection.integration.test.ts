import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const integration = process.env.RUN_DB_INTEGRATION_TESTS === "1" ? describe : describe.skip;
let esg: (typeof import("@esgcredit/db-esg"))["esgPrisma"];
let credit: (typeof import("@esgcredit/db-credit"))["creditPrisma"];
const users: number[] = [];
const articles: number[] = [];
const sharedIds: string[] = [];
let legacyArticleId: number | undefined;
const assessmentId = randomUUID();
const unique = randomUUID();
const now = new Date();
const since = new Date(now.getTime() - 86_400_000);
const until = new Date(now.getTime() + 60_000);

integration("shared selections with private weekly email eligibility", () => {
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
    await esg.$executeRaw`
      INSERT INTO article_ai_domain_assessments
        (id, domain, assessment_date, policy_version, status, profile_source, history_count, completed_at)
      VALUES (${assessmentId}::uuid, 'esg', ${now}::date, 2, 'ready', 'domain', 2, ${now})
    `;
    for (let index = 0; index < 2; index++) {
      const user = await esg.users.create({ data: {
        username: `private-${unique}-${index}`, email: `private-${unique}-${index}@example.test`,
        password_hash: "not-a-real-password", team: index ? `different-${unique}` : null, is_active_db: true,
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
      const title = `Shared recommendation ${index}`;
      const url = `https://example.test/${unique}/${index}`;
      const [article] = await esg.$queryRaw<Array<{ id: number }>>`
        INSERT INTO esg_articles (title, summary, link, source, published)
        VALUES (${title}, 'Evidence about climate finance and transition risk.', ${url}, 'QA', ${since}) RETURNING id
      `;
      articles.push(article.id);
      const hash = normalizeArticle({ id: article.id, title, summary: "Evidence about climate finance and transition risk.", content: null, url, source: "QA", publishedAt: since }).contentHash;
      const [selection] = await esg.$queryRaw<Array<{ id: string }>>`
        INSERT INTO article_ai_domain_selections (assessment_id, domain, article_id, reason, selected_at, expires_at, content_hash, relevance_score)
        VALUES (${assessmentId}::uuid, 'esg', ${article.id}, ${`Shared ESG evidence ${index}`}, ${now}, ${new Date(now.getTime() + 86_400_000)}, ${hash}, 0.9)
        RETURNING id
      `;
      sharedIds.push(selection.id);
    }
    const [legacy] = await esg.$queryRaw<Array<{ id: number }>>`
      INSERT INTO esg_articles (title, summary, link, source, published)
      VALUES ('Legacy personalized pick', 'Old account-specific recommendation that must not enter the new shared digest.',
        ${`https://example.test/${unique}/legacy`}, 'QA', ${since}) RETURNING id
    `;
    legacyArticleId = legacy.id;
    const legacyHash = normalizeArticle({ id: legacy.id, title: 'Legacy personalized pick',
      summary: 'Old account-specific recommendation that must not enter the new shared digest.',
      content: null, url: `https://example.test/${unique}/legacy`, source: 'QA', publishedAt: since }).contentHash;
    await esg.$executeRaw`
      INSERT INTO article_ai_selections (user_id, domain, article_id, reason, selected_at, expires_at, content_hash)
      VALUES (${users[0]}, 'esg', ${legacy.id}, 'Retired personal profile', ${now}, ${new Date(now.getTime() + 86_400_000)}, ${legacyHash})
    `;
  });

  afterAll(async () => {
    if (esg && users.length) await esg.users.deleteMany({ where: { id: { in: users } } });
    if (esg) await esg.$executeRaw`DELETE FROM article_ai_domain_assessments WHERE id = ${assessmentId}::uuid`;
    const allArticleIds = legacyArticleId ? [...articles, legacyArticleId] : articles;
    if (esg && allArticleIds.length) await esg.$executeRaw`DELETE FROM esg_articles WHERE id = ANY(${allArticleIds}::int[])`;
    await Promise.all([esg?.$disconnect(), credit?.$disconnect()]);
    vi.unstubAllEnvs();
  });

  it("shares the domain assessment while enforcing private dismissals, opt-out locks, hashes, and email settings", async () => {
    const { getArticleAiDigestPicks, getArticleAiSelections, getArticleAiPreference, filterArticleAiDigestPicksForCommit, recordArticleAiFeedback } = await import("@/lib/article-ai/service");
    const picks = await getArticleAiDigestPicks(users[0], ["esg", "credit"], { since, until }, now);
    expect(picks.map(pick => pick.articleId).sort()).toEqual([...articles].sort());
    expect(await getArticleAiSelections(users[0], 'esg', [legacyArticleId!])).toEqual([]);
    const otherPicks = await getArticleAiDigestPicks(users[1], ["esg"], { since, until }, now);
    expect(otherPicks.map(pick => pick.sharedSelectionId).sort()).toEqual(picks.map(pick => pick.sharedSelectionId).sort());
    expect(await getArticleAiDigestPicks(users[0], ["credit"], { since, until }, now)).toEqual([]);

    const accepted = await esg.$transaction(tx => filterArticleAiDigestPicksForCommit(tx, users[0], picks));
    expect(accepted).toHaveLength(2);
    const [firstSelection] = await getArticleAiSelections(users[1], "esg", [articles[0]]);
    await recordArticleAiFeedback(users[1], "esg", articles[0], "dismiss", firstSelection.version, sharedIds[0]);
    const privateFiltered = await esg.$transaction(tx => filterArticleAiDigestPicksForCommit(tx, users[1], picks));
    expect(privateFiltered.map(pick => pick.articleId)).toEqual([articles[1]]);
    expect(await esg.$transaction(tx => filterArticleAiDigestPicksForCommit(tx, users[0], picks))).toHaveLength(2);

    await esg.$executeRaw`UPDATE article_ai_preferences SET enabled = false WHERE user_id = ${users[0]} AND domain = 'esg'`;
    expect(await esg.$transaction(tx => filterArticleAiDigestPicksForCommit(tx, users[0], picks))).toEqual([]);
    expect(await getArticleAiDigestPicks(users[0], ["esg"], { since, until }, now)).toEqual([]);
    expect(await getArticleAiSelections(users[0], "esg", articles)).toHaveLength(2);
    await esg.$executeRaw`UPDATE article_ai_preferences SET enabled = true WHERE user_id = ${users[0]} AND domain = 'esg'`;
    await esg.$executeRaw`UPDATE esg_articles SET summary = 'Changed by scraper after the model decision.' WHERE id = ${articles[0]}`;
    expect((await getArticleAiDigestPicks(users[0], ["esg"], { since, until }, now)).map(pick => pick.articleId)).toEqual([articles[1]]);
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
