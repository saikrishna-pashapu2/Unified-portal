import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

it.runIf(process.env.RUN_DB_INTEGRATION_TESTS === "1")(
  "exposes published daily picks across views and includes only the opted-in recipient's target week in email",
  async () => {
    for (const key of ["ESG_DATABASE_URL", "CREDIT_DATABASE_URL"]) {
      if (!["localhost", "127.0.0.1"].includes(new URL(process.env[key] ?? "").hostname)) {
        throw new Error("Requires disposable loopback databases");
      }
    }
    vi.stubEnv("ARTICLE_AI_ENABLED", "true");
    vi.stubEnv("ARTICLE_AI_EMAIL_ENABLED", "true");
    const { esgPrisma: db } = await import("@esgcredit/db-esg");
    const { weeklyArticleContentHash } = await import("../article-ai/weekly-inputs");
    const { getDailyArticlePickFeed, getDailyArticlePickIds } = await import("../article-ai/daily-feed");
    const { getArticleAiDigestPicks, filterArticleAiDigestPicksForCommit, getArticleAiSelections, recordArticleAiFeedback } = await import("../article-ai/service");

    const [{ monday, sunday }] = await db.$queryRaw<{ monday: string; sunday: string }[]>`
      SELECT date_trunc('week', now() AT TIME ZONE 'Asia/Dubai')::date::text AS monday,
        (date_trunc('week', now() AT TIME ZONE 'Asia/Dubai')::date - 1)::text AS sunday
    `;
    const due = new Date(monday + "T05:00:00Z");
    const window = { since: new Date(due.getTime() - 7 * 86400000), until: due, targetWeekKey: monday };
    const id = randomUUID();
    const title = "Daily transition risk " + id;
    const url = "https://example.test/" + id;
    const source = "Test";
    const reason = "Provides evidence about transition risk.";
    const runId = randomUUID();
    let userId: number | undefined;
    let articleId: number | undefined;
    try {
      const user = await db.users.create({ data: { username: id, email: id + "@example.test", password_hash: "test", is_active_db: true } });
      userId = user.id;
      await db.$executeRaw`INSERT INTO alert_preferences (user_id, domain, alert_type, is_active, email_enabled, alert_articles)
        VALUES (${userId}, 'esg', 'weekly_digest', true, true, true)`;
      const [article] = await db.$queryRaw<{ id: number }[]>`
        INSERT INTO esg_articles (title, link, source) VALUES (${title}, ${url}, ${source}) RETURNING id`;
      articleId = article.id;
      const hash = weeklyArticleContentHash({ domain: "esg", articleId, title, summary: null, content: null, source, url, publishedAt: null });
      await db.$executeRaw`INSERT INTO article_ai_domain_assessments
        (id,domain,assessment_date,policy_version,status,profile_source,completed_at,email_at,valid_until,coverage_json)
        VALUES (${runId}::uuid,'esg',${sunday}::date,4,'running','domain',${due},${due},now()+interval '30 days','{"status":"complete"}'::jsonb)`;
      await db.$executeRaw`INSERT INTO article_ai_weekly_inputs
        (assessment_id,kind,domain,article_id,content_hash,title,source,state,ordinal)
        VALUES (${runId}::uuid,'candidate','esg',${articleId},${hash},${title},${source},'processed',0)`;
      await db.$executeRaw`INSERT INTO article_ai_domain_selections
        (assessment_id,domain,article_id,reason,expires_at,content_hash)
        VALUES (${runId}::uuid,'esg',${articleId},${reason},now()+interval '30 days',${hash})`;

      expect(await getDailyArticlePickIds("esg", user.id)).not.toContain(articleId);
      await db.$executeRaw`UPDATE article_ai_domain_assessments SET status='ready' WHERE id=${runId}::uuid`;
      expect(await getDailyArticlePickIds("esg", user.id)).toContain(articleId);
      expect((await getDailyArticlePickFeed("esg", { viewerId: user.id, sourceDay: sunday })).picks).toContainEqual({
        articleId, domain: "esg", sourceDay: sunday, title, source, reason,
      });
      expect((await getDailyArticlePickFeed("credit", { viewerId: user.id })).picks.some(p => p.title === title)).toBe(false);
      expect(await getArticleAiDigestPicks(userId, ["esg"], window, due)).toEqual([]);
      await db.$executeRaw`INSERT INTO article_ai_preferences (user_id,domain,enabled,status) VALUES (${userId},'esg',true,'ready')`;
      await db.users.update({ where: { id: user.id }, data: { is_active_db: false } });
      expect(await getDailyArticlePickIds("esg", user.id)).toEqual([]);
      expect(await getDailyArticlePickFeed("esg", { viewerId: user.id })).toEqual({ runs: [], picks: [] });
      await db.users.update({ where: { id: user.id }, data: { is_active_db: true } });
      const picks = await getArticleAiDigestPicks(userId, ["esg"], window, due);
      expect(picks).toContainEqual(expect.objectContaining({ articleId, assessmentDate: sunday, targetWeekKey: monday, policyVersion: 4 }));
      expect(await db.$transaction(tx => filterArticleAiDigestPicksForCommit(tx, user.id, picks))).toEqual(picks);
      await db.$executeRaw`UPDATE article_ai_domain_assessments SET completed_at=${new Date(due.getTime() + 1000)} WHERE id=${runId}::uuid`;
      expect(await getArticleAiDigestPicks(userId, ["esg"], window, due)).toEqual([]);
      expect(await db.$transaction(tx => filterArticleAiDigestPicksForCommit(tx, user.id, picks))).toEqual([]);
      await db.$executeRaw`UPDATE article_ai_domain_assessments SET completed_at=${due} WHERE id=${runId}::uuid`;
      const followingMonday = new Date(due.getTime() + 7 * 86400000);
      expect(await getArticleAiDigestPicks(userId, ["esg"], {
        since: due, until: followingMonday, targetWeekKey: followingMonday.toISOString().slice(0, 10),
      }, followingMonday)).toEqual([]);
      const [selection] = await getArticleAiSelections(userId, "esg", [articleId]);
      expect(selection.assessmentDate).toBe(sunday);
      await recordArticleAiFeedback(userId, "esg", articleId, "dismiss", selection.version, selection.sharedSelectionId!);
      expect(await db.$transaction(tx => filterArticleAiDigestPicksForCommit(tx, user.id, picks))).toEqual([]);
      expect(await getDailyArticlePickIds("esg", user.id)).toContain(articleId);
      await db.$executeRaw`UPDATE esg_articles SET title='Updated contents' WHERE id=${articleId}`;
      expect(await getDailyArticlePickIds("esg", user.id)).not.toContain(articleId);
      expect((await getDailyArticlePickFeed("esg", { viewerId: user.id, sourceDay: sunday })).picks[0].title).toBe(title);
      await db.$executeRaw`UPDATE esg_articles SET title=${title} WHERE id=${articleId}`;
      await db.$executeRaw`UPDATE article_ai_domain_selections SET expires_at=now() WHERE assessment_id=${runId}::uuid`;
      expect(await getDailyArticlePickIds("esg", user.id)).not.toContain(articleId);
      expect((await getDailyArticlePickFeed("esg", { viewerId: user.id, sourceDay: sunday })).picks).toEqual([]);
    } finally {
      if (userId) await db.users.deleteMany({ where: { id: userId } });
      await db.$executeRaw`DELETE FROM article_ai_domain_assessments WHERE id=${runId}::uuid`;
      if (articleId) await db.$executeRaw`DELETE FROM esg_articles WHERE id=${articleId}`;
      vi.unstubAllEnvs();
    }
  },
);
