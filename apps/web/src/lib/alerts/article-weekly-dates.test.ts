import { describe, expect, it } from 'vitest';
import { articleWeeklyDeliveryKey, getArticleWeeklyWindow } from './article-weekly-dates';

describe('weekly article schedule', () => {
  it('sends from Monday 09:00 Dubai, with a stable lookback and retry window', () => {
    const before = getArticleWeeklyWindow(new Date('2026-11-16T04:59:59Z'), {});
    const due = getArticleWeeklyWindow(new Date('2026-11-16T05:00:00Z'), {});
    const recovered = getArticleWeeklyWindow(new Date('2026-11-18T12:00:00Z'), {});
    expect(before.due).toBe(false);
    expect(due.due).toBe(true);
    expect(due.since.toISOString()).toBe('2026-11-09T05:00:00.000Z');
    expect(due.until.toISOString()).toBe('2026-11-16T05:00:00.000Z');
    expect(recovered.until).toEqual(due.until);
    expect(articleWeeklyDeliveryKey(8, recovered)).toBe(articleWeeklyDeliveryKey(8, due));
  });
  it('does not catch up a previous week before the current scheduled day', () => {
    const week = getArticleWeeklyWindow(new Date('2026-11-16T10:00:00Z'), { digest_day: 'friday' });
    expect(week.due).toBe(false);
    expect(week.weekKey).toBe('2026-11-16');
    expect(week.until.toISOString()).toBe('2026-11-20T05:00:00.000Z');
  });
  it('honors midnight rather than silently substituting 09:00', () => {
    const week = getArticleWeeklyWindow(new Date('2026-11-15T20:00:00Z'), { digest_hour: 0 });
    expect(week.due).toBe(true);
    expect(week.until.toISOString()).toBe('2026-11-15T20:00:00.000Z');
  });
  it('handles spring gaps and autumn repeated hours without duplicate windows', () => {
    const spring = getArticleWeeklyWindow(new Date('2026-03-08T08:00:00Z'), { timezone: 'America/New_York', digest_day: 'sunday', digest_hour: 2 });
    expect(spring.until.toISOString()).toBe('2026-03-08T07:00:00.000Z');
    const fall = getArticleWeeklyWindow(new Date('2026-11-01T06:30:00Z'), { timezone: 'America/New_York', digest_day: 'sunday', digest_hour: 1 });
    expect(fall.until.toISOString()).toBe('2026-11-01T05:00:00.000Z');
    expect(fall.nextScheduledAt.toISOString()).toBe('2026-11-08T06:00:00.000Z');
  });
  it('rejects invalid clocks and schedule fields instead of falling into a different domain/time', () => {
    expect(() => getArticleWeeklyWindow(new Date('bad'), {})).toThrow();
    expect(() => getArticleWeeklyWindow(new Date(), { timezone: 'Invalid/Zone' })).toThrow();
    expect(() => getArticleWeeklyWindow(new Date(), { digest_day: 'holiday' })).toThrow();
    expect(() => getArticleWeeklyWindow(new Date(), { digest_hour: 24 })).toThrow();
  });
});
