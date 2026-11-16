import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WeeklyArticleAlert } from './article-weekly-repository';

const integration = process.env.RUN_DB_INTEGRATION_TESTS === '1' ? describe : describe.skip;
let esg: (typeof import('@esgcredit/db-esg'))['esgPrisma'];
let credit: (typeof import('@esgcredit/db-credit'))['creditPrisma'];
const users: number[] = [];
let esgArticle: number | undefined;
let creditArticle: number | undefined;
const unique = randomUUID();
const now = new Date();
const window = { since: new Date(now.getTime() - 60_000), until: new Date(now.getTime() + 60_000) };

integration('domain-wide human article curation for weekly email', () => {
  beforeAll(async () => {
    for (const key of ['ESG_DATABASE_URL', 'CREDIT_DATABASE_URL']) {
      const url = new URL(process.env[key] ?? '');
      if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Requires disposable loopback databases');
    }
    ({ esgPrisma: esg } = await import('@esgcredit/db-esg'));
    ({ creditPrisma: credit } = await import('@esgcredit/db-credit'));
    for (let index = 0; index < 3; index++) {
      const user = await esg.users.create({ data: {
        username: `domain-curation-${unique}-${index}`, email: `domain-curation-${unique}-${index}@example.test`,
        password_hash: 'not-a-real-password', team: index === 1 ? `different-team-${unique}` : null,
        is_active_db: index !== 1,
      } });
      users.push(user.id);
    }
    const [esgRow] = await esg.$queryRaw<Array<{ id: number }>>`
      INSERT INTO esg_articles (title, summary, link, source, published)
      VALUES ('Collectively curated ESG article', 'Climate transition research.', ${`https://example.test/${unique}/esg`}, 'QA', ${now})
      RETURNING id
    `;
    esgArticle = esgRow.id;
    const [creditRow] = await credit.$queryRaw<Array<{ id: number }>>`
      INSERT INTO credit_articles (title, summary, link, source, date)
      VALUES ('Collectively curated Credit article', 'Bank credit risk research.', ${`https://example.test/${unique}/credit`}, 'QA', ${now})
      RETURNING id
    `;
    creditArticle = creditRow.id;
    for (const curatorId of users.slice(1)) {
      await esg.$executeRaw`INSERT INTO likes (user_id, content_type, content_id, created_at) VALUES (${curatorId}, 'article', ${esgArticle}, ${now})`;
      await credit.$executeRaw`INSERT INTO likes (user_id, content_type, content_id, created_at) VALUES (${curatorId}, 'article', ${creditArticle}, ${now})`;
    }
  });

  afterAll(async () => {
    if (credit && users.length) await credit.$executeRaw`DELETE FROM likes WHERE user_id = ANY(${users}::int[])`;
    if (esg && users.length) await esg.users.deleteMany({ where: { id: { in: users } } });
    if (esg && esgArticle) await esg.$executeRaw`DELETE FROM esg_articles WHERE id = ${esgArticle}`;
    if (credit && creditArticle) await credit.$executeRaw`DELETE FROM credit_articles WHERE id = ${creditArticle}`;
    await Promise.all([esg?.$disconnect(), credit?.$disconnect()]);
  });

  function recipient(): WeeklyArticleAlert {
    return {
      id: 1, user_id: users[0], domain: 'esg', domains: ['esg', 'credit'], email: 'recipient@example.test',
      email_address: null, first_name: null, last_name: null, team: null, alert_name: null,
      digest_day: 'monday', digest_hour: 9, timezone: 'UTC', last_sent_at: null, created_at: now,
      alert_articles: true, alert_events: false, alert_publications: false, sources: [], keywords: [],
    };
  }

  it('includes other users’ article likes for a recipient with no likes or team, deduplicated per domain', async () => {
    const { getHumanWeeklyItems } = await import('./article-weekly-repository');
    const result = await getHumanWeeklyItems(recipient(), ['esg', 'credit'], window);
    expect(result.unavailableDomains).toEqual([]);
    expect(result.items.filter(item => item.domain === 'esg' && item.id === esgArticle)).toHaveLength(1);
    expect(result.items.filter(item => item.domain === 'credit' && item.id === creditArticle)).toHaveLength(1);
    expect(result.items.every(item => item.origin === 'human')).toBe(true);
    for (const database of [esg, credit]) {
      const [own] = await database.$queryRaw<Array<{ count: number }>>`SELECT count(*)::int AS count FROM likes WHERE user_id = ${users[0]}`;
      expect(own.count).toBe(0);
    }
  });

  it('continues to restrict delivery to the chosen domains and weekly like window', async () => {
    const { getHumanWeeklyItems } = await import('./article-weekly-repository');
    const onlyEsg = await getHumanWeeklyItems(recipient(), ['esg'], window);
    expect(onlyEsg.items.some(item => item.domain === 'esg' && item.id === esgArticle)).toBe(true);
    expect(onlyEsg.items.every(item => item.domain === 'esg')).toBe(true);
    const beforeLikes = { since: new Date(now.getTime() - 120_000), until: new Date(now.getTime() - 60_000) };
    const old = await getHumanWeeklyItems(recipient(), ['esg', 'credit'], beforeLikes);
    expect(old.items.some(item => item.domain === 'esg' && item.id === esgArticle)).toBe(false);
    expect(old.items.some(item => item.domain === 'credit' && item.id === creditArticle)).toBe(false);
  });
});
