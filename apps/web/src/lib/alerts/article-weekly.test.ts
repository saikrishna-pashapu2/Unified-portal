import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WeeklyArticleAlert } from './article-weekly-repository';

const mocks = vi.hoisted(() => ({
  list: vi.fn(), human: vi.fn(), picks: vi.fn(), filter: vi.fn(), enqueue: vi.fn(), query: vi.fn(), execute: vi.fn(), transaction: vi.fn(),
}));
vi.mock('@esgcredit/db-esg', () => ({ esgPrisma: { $transaction: mocks.transaction } }));
vi.mock('./article-weekly-repository', () => ({ listWeeklyArticleAlerts: mocks.list, getHumanWeeklyItems: mocks.human }));
vi.mock('@/lib/article-ai/service', () => ({ getArticleAiDigestPicks: mocks.picks, filterArticleAiDigestPicksForCommit: mocks.filter }));
vi.mock('./email-queue', () => ({ enqueueEmailWithHistory: mocks.enqueue }));
import { getArticleWeeklyDigestStartAt, queueDueArticleWeeklyDigests } from './article-weekly';

const now = new Date('2026-11-16T05:01:00Z');
function alert(overrides: Partial<WeeklyArticleAlert> = {}): WeeklyArticleAlert {
  return {
    id: 9, user_id: 7, domain: 'esg', domains: ['esg', 'credit'], email: 'member@example.org', email_address: null,
    first_name: 'Member', last_name: null, team: 'research', alert_name: 'Research', digest_day: 'monday', digest_hour: 9,
    timezone: 'Asia/Dubai', last_sent_at: null, created_at: new Date('2026-01-01T00:00:00Z'),
    alert_articles: true, alert_events: false, alert_publications: false, sources: [], keywords: [], ...overrides,
  };
}
const pick = {
  articleId: 21, domain: 'credit', title: 'Bank ratings', url: 'https://example.org/bank', source: 'Ratings',
  publishedAt: null, reason: 'Matches the shared credit-risk history.', contentHash: 'hash',
  sharedSelectionId: '11111111-1111-4111-8111-111111111111', assessmentDate: '2026-11-16',
  policyVersion: 3, targetWeekKey: '2026-11-16',
};

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
  it('does no work before the configured activation instant', async () => {
    vi.stubEnv('ARTICLE_WEEKLY_DIGEST_START_AT', '2026-11-23T05:00:00.000Z');
    const result = await queueDueArticleWeeklyDigests(new Date('2026-11-23T04:59:59.999Z'));
    expect(result).toEqual({ queued: 0, deduplicated: 0, skipped: 0, failed: 0 });
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it('allows the first cohort exactly at the configured activation instant', async () => {
    vi.stubEnv('ARTICLE_WEEKLY_DIGEST_START_AT', '2026-11-23T05:00:00.000Z');
    const activation = new Date('2026-11-23T05:00:00.000Z');
    const configured = getArticleWeeklyDigestStartAt();
    expect(configured).toBeInstanceOf(Date);
    expect(configured instanceof Date ? configured.toISOString() : null).toBe(activation.toISOString());
    expect((await queueDueArticleWeeklyDigests(activation)).queued).toBe(1);
    expect(mocks.enqueue.mock.calls[0][0].deliveryKey).toBe('article-weekly:9:2026-11-23');
  });
  it('does not backfill a digest window that ended before activation', async () => {
    vi.stubEnv('ARTICLE_WEEKLY_DIGEST_START_AT', '2026-11-16T06:00:00.000Z');
    const afterActivation = new Date('2026-11-16T06:01:00.000Z');
    expect((await queueDueArticleWeeklyDigests(afterActivation)).skipped).toBe(1);
    expect(mocks.list).toHaveBeenCalledOnce();
    expect(mocks.human).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it('fails closed on an invalid activation value before reading schedules', async () => {
    vi.stubEnv('ARTICLE_WEEKLY_DIGEST_START_AT', 'not-a-timestamp');
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await queueDueArticleWeeklyDigests(now)).toEqual({ queued: 0, deduplicated: 0, skipped: 0, failed: 0 });
    expect(mocks.list).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith('[article-weekly] invalid ARTICLE_WEEKLY_DIGEST_START_AT; delivery remains disabled');
    error.mockRestore();
  });
  it('requires an explicit timezone on the activation value', () => {
    vi.stubEnv('ARTICLE_WEEKLY_DIGEST_START_AT', '2026-11-23T05:00:00');
    expect(getArticleWeeklyDigestStartAt()).toBe('invalid');
  });
  it('rejects normalized calendar dates and non-UTC offsets', () => {
    for (const value of [
      '2026-02-31T05:00:00.000Z',
      '2026-11-23T24:00:00.000Z',
      '2026-11-23T05:00:00.000+00:00',
    ]) {
      vi.stubEnv('ARTICLE_WEEKLY_DIGEST_START_AT', value);
      expect(getArticleWeeklyDigestStartAt()).toBe('invalid');
    }
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
  it('keeps AI out of a custom-scheduled human digest', async () => {
    const custom = alert({ digest_day: 'friday', digest_hour: 9 });
    mocks.list.mockResolvedValue([custom]); mocks.query.mockResolvedValue([custom]);
    await queueDueArticleWeeklyDigests(new Date('2026-11-20T05:01:00Z'));
    expect(mocks.picks).not.toHaveBeenCalled();
    expect(mocks.enqueue.mock.calls[0][0].html).not.toContain('AI picks for you');
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
