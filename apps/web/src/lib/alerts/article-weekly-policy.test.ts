import { describe, expect, it } from 'vitest';
import { canonicalDigestUrl, deduplicateWeeklyItems, isPersonalDigestRecipient, matchesWeeklyFilters, normalizeWeeklyDomains, type WeeklyArticleItem } from './article-weekly-policy';
import { renderArticleWeeklyEmail } from './article-weekly-template';

const item = (overrides: Partial<WeeklyArticleItem> = {}): WeeklyArticleItem => ({
  id: 1, domain: 'esg', kind: 'article', origin: 'human', title: 'Climate disclosure',
  url: 'https://example.org/article', source: 'Publisher', publishedAt: null, ...overrides,
});

describe('private weekly email policy', () => {
  it('falls back from an empty domain array and rejects unrecognized domains', () => {
    expect(normalizeWeeklyDomains([], 'credit')).toEqual(['credit']);
    expect(normalizeWeeklyDomains(['esg', 'credit', 'esg'], 'credit')).toEqual(['esg', 'credit']);
    expect(() => normalizeWeeklyDomains(['esg', 'other'], 'esg')).toThrow();
    expect(() => normalizeWeeklyDomains([], 'other')).toThrow();
  });
  it('allows AI only at the account mailbox, never a list or different override', () => {
    expect(isPersonalDigestRecipient(' Member@example.org ', 'member@example.org')).toBe(true);
    for (const address of ['team@example.org', 'member@example.org,other@example.org', 'Member <member@example.org>', 'member@example.org\nBcc:x@example.org']) {
      expect(isPersonalDigestRecipient(address, 'member@example.org')).toBe(false);
    }
    expect(isPersonalDigestRecipient('member@example.org', null)).toBe(false);
  });
  it('keeps domain IDs separate while removing repeated story links and preferring human choices', () => {
    const result = deduplicateWeeklyItems([
      item({ origin: 'ai', reason: 'Private reason' }),
      item({ id: 2, url: 'https://example.org/article?utm_source=email#top' }),
      item({ domain: 'credit', url: 'https://example.org/credit' }),
      item({ id: 3, url: 'javascript:alert(1)' }),
      item({ id: 4, url: 'https://user:secret@example.org/private' }),
    ]);
    expect(result.map(row => [row.domain, row.id, row.origin])).toEqual([['esg', 2, 'human'], ['credit', 1, 'human']]);
    expect(canonicalDigestUrl('https://example.org/a?b=2&utm_campaign=x&a=1#heading')).toBe('https://example.org/a?a=1&b=2');
  });
  it('applies explicit alert filters to both human and private selections', () => {
    expect(matchesWeeklyFilters(item(), { sources: ['publisher'], keywords: ['climate'] })).toBe(true);
    expect(matchesWeeklyFilters(item({ origin: 'ai' }), { sources: ['Other'] })).toBe(false);
    expect(matchesWeeklyFilters(item(), { keywords: ['bank'] })).toBe(false);
  });
  it('escapes article/model content, rejects unsafe links, and labels AI separately', () => {
    const email = renderArticleWeeklyEmail({ name: '<User>', alertName: 'Research\nBcc: bad', items: [
      item({ title: '<script>alert(1)</script>', source: '<img onerror=x>' }),
      item({ id: 2, origin: 'ai', url: 'javascript:alert(1)', reason: '<b>Injected</b>' }),
    ] });
    expect(email.html).toContain('AI picks for you');
    expect(email.html).toContain('Articles liked by users');
    expect(email.html).toContain('Shared AI selections based on articles liked by users across each domain.');
    expect(email.html).toContain('&lt;script&gt;');
    expect(email.html).toContain('&lt;b&gt;Injected&lt;/b&gt;');
    expect(email.html).not.toContain('<script>');
    expect(email.html).not.toContain('href="javascript:');
    expect(email.subject).not.toMatch(/[\r\n]/);
    expect(email.text).toContain('AI picks for you');
  });
});
