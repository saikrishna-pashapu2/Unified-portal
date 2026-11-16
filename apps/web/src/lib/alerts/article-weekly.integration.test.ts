import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ picks: new Map<number, unknown[]>() }));
vi.mock('server-only', () => ({}));
// This suite exercises real delivery transactions without any AI/provider calls.
vi.mock('@/lib/article-ai/service', () => ({
  getArticleAiDigestPicks: async (userId: number) => fixture.picks.get(userId) ?? [],
  filterArticleAiDigestPicksForCommit: async (_tx: unknown, userId: number, picks: unknown[]) =>
    fixture.picks.has(userId) ? picks : [],
}));

const integration = process.env.RUN_DB_INTEGRATION_TESTS === '1' ? describe : describe.skip;
let esg: (typeof import('@esgcredit/db-esg'))['esgPrisma'];
let credit: (typeof import('@esgcredit/db-credit'))['creditPrisma'];
const users: number[] = [];
const articles: number[] = [];
let creditArticle: number | undefined;
const unique = randomUUID();

integration('private weekly mail on disposable databases', () => {
  beforeAll(async () => {
    for (const key of ['ESG_DATABASE_URL', 'CREDIT_DATABASE_URL']) {
      const url = new URL(process.env[key] ?? '');
      if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Integration suite requires disposable loopback databases');
    }
    ({ esgPrisma: esg } = await import('@esgcredit/db-esg'));
    ({ creditPrisma: credit } = await import('@esgcredit/db-credit'));
    vi.stubEnv('ARTICLE_WEEKLY_DIGEST_ENABLED', 'true');
    for (let index = 0; index < 2; index++) {
      const user = await esg.users.create({ data: {
        username: `weekly-${unique}-${index}`, email: `weekly-${unique}-${index}@example.test`,
        password_hash: 'not-a-real-password', team: `qa-${unique}`, is_active_db: true,
      } });
      users.push(user.id);
      await esg.$executeRaw`
        INSERT INTO alert_preferences (user_id, domain, domains, alert_name, alert_type,
          is_active, email_enabled, alert_articles, alert_events, alert_publications,
          sources, keywords, digest_day, digest_hour, timezone, created_at)
        VALUES (${user.id}, 'esg', ARRAY['esg','credit']::varchar[], 'QA article digest', 'weekly_digest',
          true, true, true, false, false, ARRAY[]::text[], ARRAY[]::text[], 'monday', 9,
          'Asia/Dubai', '2026-01-01'::timestamp)
      `;
    }
    const [human] = await esg.$queryRaw<Array<{ id: number }>>`
      INSERT INTO esg_articles (title, link, source, summary, published)
      VALUES ('Shared human article', ${`https://example.test/${unique}/human`}, 'QA', 'Real human evidence', '2026-11-14'::timestamptz)
      RETURNING id
    `;
    articles.push(human.id);
    const [rated] = await credit.$queryRaw<Array<{ id: number }>>`
      INSERT INTO credit_articles (title, link, source, content, date)
      VALUES ('Shared Credit human article', ${`https://example.test/${unique}/credit`}, 'QA', 'Rating evidence', '2026-11-14'::date)
      RETURNING id
    `;
    creditArticle = rated.id;
    await esg.$executeRaw`
      INSERT INTO likes (user_id, content_type, content_id, created_at)
      VALUES (${users[0]}, 'article', ${human.id}, '2026-11-15T12:00:00'::timestamp)
    `;
    await credit.$executeRaw`
      INSERT INTO likes (user_id, content_type, content_id, created_at)
      VALUES (${users[0]}, 'article', ${rated.id}, '2026-11-15T12:00:00'::timestamp)
    `;
    users.forEach((id, index) => fixture.picks.set(id, [{
      articleId: 900_000 + index, domain: 'esg', title: `PRIVATE PICK ${index}`,
      url: `https://example.test/${unique}/private-${index}`, source: 'QA',
      publishedAt: '2026-11-15T00:00:00Z', reason: `Private reason ${index}`, contentHash: `hash-${index}`,
      sharedSelectionId: randomUUID(), assessmentDate: '2026-11-16', policyVersion: 3, targetWeekKey: '2026-11-16',
    }]));
  });

  afterAll(async () => {
    if (credit && users.length) await credit.$executeRaw`DELETE FROM likes WHERE user_id = ANY(${users}::integer[])`;
    if (credit && creditArticle) await credit.$executeRaw`DELETE FROM credit_articles WHERE id = ${creditArticle}`;
    if (esg && users.length) await esg.users.deleteMany({ where: { id: { in: users } } });
    if (esg && articles.length) await esg.$executeRaw`DELETE FROM esg_articles WHERE id = ANY(${articles}::integer[])`;
    await Promise.all([esg?.$disconnect(), credit?.$disconnect()]);
    vi.unstubAllEnvs();
  });

  it('queues one private snapshot per recipient under concurrent schedulers and never manufactures likes', async () => {
    const { queueDueArticleWeeklyDigests } = await import('./article-weekly');
    const now = new Date('2026-11-16T05:01:00Z');
    await Promise.all([queueDueArticleWeeklyDigests(now), queueDueArticleWeeklyDigests(now)]);
    const queues = await esg.$queryRaw<Array<{ user_id: number; email_html: string; status: string }>>`
      SELECT user_id, email_html, status FROM email_queue WHERE user_id = ANY(${users}::integer[]) ORDER BY user_id
    `;
    expect(queues).toHaveLength(2);
    queues.forEach(row => {
      const index = users.indexOf(row.user_id);
      expect(row.status).toBe('queued');
      expect(row.email_html).toContain(`PRIVATE PICK ${index}`);
      expect(row.email_html).not.toContain(`PRIVATE PICK ${1 - index}`);
      expect(row.email_html).toContain('Shared human article');
      expect(row.email_html).toContain('Shared Credit human article');
    });
    const histories = await esg.$queryRaw<Array<{ count: number }>>`
      SELECT count(*)::integer AS count FROM alert_history WHERE user_id = ANY(${users}::integer[])
    `;
    expect(histories[0].count).toBe(2);
    const [humanLikes] = await esg.$queryRaw<Array<{ count: number }>>`
      SELECT count(*)::integer AS count FROM likes WHERE user_id = ANY(${users}::integer[])
    `;
    expect(humanLikes.count).toBe(1);
    const [creditLikes] = await credit.$queryRaw<Array<{ count: number }>>`
      SELECT count(*)::integer AS count FROM likes WHERE user_id = ANY(${users}::integer[])
    `;
    expect(creditLikes.count).toBe(1);
  });
});
