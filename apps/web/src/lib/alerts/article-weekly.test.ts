import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WeeklyArticleAlert } from './article-weekly-repository';

const mocks = vi.hoisted(() => ({
  list: vi.fn(), human: vi.fn(), picks: vi.fn(), filter: vi.fn(), enqueue: vi.fn(), query: vi.fn(), execute: vi.fn(), transaction: vi.fn(),
}));
vi.mock('@esgcredit/db-esg', () => ({ esgPrisma: { $transaction: mocks.transaction } }));
vi.mock('./article-weekly-repository', () => ({ listWeeklyArticleAlerts: mocks.list, getHumanWeeklyItems: mocks.human }));
vi.mock('@/lib/article-ai/service', () => ({ getArticleAiDigestPicks: mocks.picks, filterArticleAiDigestPicksForCommit: mocks.filter }));
vi.mock('./email-queue', () => ({ enqueueEmailWithHistory: mocks.enqueue }));
import { queueDueArticleWeeklyDigests } from './article-weekly';

const now = new Date('2026-11-16T05:01:00Z');
function alert(overrides: Partial<WeeklyArticleAlert> = {}): WeeklyArticleAlert {
  return {
    id: 9, user_id: 7, domain: 'esg', domains: ['esg', 'credit'], email: 'member@example.org', email_address: null,
    first_name: 'Member', last_name: null, team: 'research', alert_name: 'Research', digest_day: 'monday', digest_hour: 9,
    timezone: 'Asia/Dubai', last_sent_at: null, created_at: new Date('2026-01-01T00:00:00Z'),
    alert_articles: true, alert_events: false, alert_publications: false, sources: [], keywords: [], ...overrides,
  };
}
const pick = { articleId: 21, domain: 'credit', title: 'Bank ratings', url: 'https://example.org/bank', source: 'Ratings', publishedAt: null, reason: 'Matches the shared credit-risk history.', contentHash: 'hash' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('ARTICLE_WEEKLY_DIGEST_ENABLED', 'true');
  mocks.list.mockResolvedValue([alert()]);
  mocks.query.mockResolvedValue([alert()]);
  mocks.execute.mockResolvedValue(1);
  mocks.transaction.mockImplementation(async callback => callback({ $queryRaw: mocks.query, $executeRaw: mocks.execute }));
  mocks.human.mockResolvedValue({ items: [{ id: 1, domain: 'esg', kind: 'article', origin: 'human', title: 'Human choice', source: 'Research', url: 'https://example.org/human', publishedAt: null }], unavailableDomains: [] });
  mocks.picks.mockResolvedValue([pick]);
  mocks.filter.mockImplementation(async (_tx, _user, picks) => picks);
  mocks.enqueue.mockResolvedValue({ queueId: 20, historyId: 30, deduplicated: false });
});
afterEach(() => vi.unstubAllEnvs());

describe('canonical weekly article emails', () => {
  it('is opt-in at deployment and does no work when disabled', async () => {
    vi.stubEnv('ARTICLE_WEEKLY_DIGEST_ENABLED', 'false');
    expect(await queueDueArticleWeeklyDigests(now)).toEqual({ queued: 0, deduplicated: 0, skipped: 0, failed: 0 });
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it('fetches only the recipient’s AI selections and records domain-qualified provenance', async () => {
    expect((await queueDueArticleWeeklyDigests(now)).queued).toBe(1);
    expect(mocks.picks).toHaveBeenCalledWith(7, ['esg', 'credit'], expect.objectContaining({ since: expect.any(Date), until: expect.any(Date) }), now);
    expect(mocks.filter).toHaveBeenCalledWith(expect.anything(), 7, [pick]);
    const args = mocks.enqueue.mock.calls[0][0];
    expect(args.to).toBe('member@example.org');
    expect(args.deliveryKey).toBe('article-weekly:9:2026-11-16');
    expect(args.metadata.items).toEqual([
      { domain: 'esg', contentType: 'article', id: 1, origin: 'human', contentHash: null },
      { domain: 'credit', contentType: 'article', id: 21, origin: 'ai', contentHash: 'hash' },
    ]);
    expect(args.html).toContain('AI picks for you');
    expect(mocks.enqueue.mock.calls[0][1]).toEqual(expect.objectContaining({ $queryRaw: mocks.query }));
  });
  it('never adds private picks to a group/alternate mailbox', async () => {
    const groupAlert = alert({ email_address: 'team@example.org' });
    mocks.list.mockResolvedValue([groupAlert]); mocks.query.mockResolvedValue([groupAlert]);
    await queueDueArticleWeeklyDigests(now);
    expect(mocks.picks).not.toHaveBeenCalled();
    expect(mocks.enqueue.mock.calls[0][0].html).not.toContain('AI picks for you');
    expect(mocks.enqueue.mock.calls[0][0].to).toBe('team@example.org');
  });
  it('uses human content when AI is unavailable or was disabled before assembly commits', async () => {
    mocks.picks.mockRejectedValueOnce(new Error('AI unavailable'));
    expect((await queueDueArticleWeeklyDigests(now)).queued).toBe(1);
    expect(mocks.enqueue.mock.calls[0][0].totalItems).toBe(1);
    mocks.filter.mockResolvedValueOnce([]);
    expect((await queueDueArticleWeeklyDigests(now)).queued).toBe(1);
    expect(mocks.enqueue.mock.calls[1][0].totalItems).toBe(1);
  });
  it('respects alert domains and article switches independently of AI opt-in', async () => {
    const noArticles = alert({ domain: 'credit', domains: [], alert_articles: false });
    mocks.list.mockResolvedValue([noArticles]); mocks.query.mockResolvedValue([noArticles]);
    await queueDueArticleWeeklyDigests(now);
    expect(mocks.human).toHaveBeenCalledWith(noArticles, ['credit'], expect.anything());
    expect(mocks.picks).not.toHaveBeenCalled();
  });
  it('does not assemble outside the current due window or replay months of missed sends', async () => {
    expect((await queueDueArticleWeeklyDigests(new Date('2026-11-16T04:59:00Z'))).skipped).toBe(1);
    mocks.list.mockResolvedValue([alert({ last_sent_at: new Date('2026-11-16T05:00:00Z') })]);
    expect((await queueDueArticleWeeklyDigests(now)).skipped).toBe(1);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it('aborts an assembly if its owner/recipient/preferences changed while content loaded', async () => {
    mocks.query.mockResolvedValueOnce([]);
    expect((await queueDueArticleWeeklyDigests(now)).skipped).toBe(1);
    mocks.query.mockResolvedValueOnce([alert({ email_address: 'changed@example.org' })]);
    expect((await queueDueArticleWeeklyDigests(now)).skipped).toBe(1);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it('does not update last-send when enqueue fails, allowing a later due-check to retry', async () => {
    mocks.enqueue.mockRejectedValueOnce(new Error('database unavailable'));
    expect((await queueDueArticleWeeklyDigests(now)).failed).toBe(1);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('sends available ESG content with an explicit notice during a Credit outage', async () => {
    mocks.human.mockResolvedValue({ items: [{ id: 1, domain: 'esg', kind: 'article', origin: 'human', title: 'ESG', url: 'https://example.org/esg', source: 'Publisher', publishedAt: null }], unavailableDomains: ['credit'] });
    mocks.picks.mockResolvedValue([]);
    expect((await queueDueArticleWeeklyDigests(now)).queued).toBe(1);
    expect(mocks.picks).toHaveBeenCalledWith(7, ['esg'], expect.anything(), now);
    expect(mocks.enqueue.mock.calls[0][0].html).toContain('Credit content was temporarily unavailable');
    expect(mocks.enqueue.mock.calls[0][0].metadata.unavailableDomains).toEqual(['credit']);
  });
  it('keeps a Credit-only email due during an outage instead of sending a false empty digest', async () => {
    mocks.list.mockResolvedValue([alert({ domain: 'credit', domains: ['credit'] })]);
    mocks.human.mockResolvedValue({ items: [], unavailableDomains: ['credit'] });
    expect((await queueDueArticleWeeklyDigests(now)).failed).toBe(1);
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('does not send empty weekly mail when there are no eligible human or AI picks', async () => {
    mocks.human.mockResolvedValue({ items: [], unavailableDomains: [] });
    mocks.picks.mockResolvedValue([]);
    expect((await queueDueArticleWeeklyDigests(now)).skipped).toBe(1);
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
