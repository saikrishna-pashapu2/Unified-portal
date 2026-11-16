import { describe, expect, it } from "vitest";

import {
  getArticleAiWeeklyCalendar,
  getDueArticleAiWeeklyTarget,
  getNextArticleAiWeeklySchedule,
  isArticleAiWeeklyGenerationDue,
} from "./weekly-calendar";

const target = "2026-11-23";

describe("Article AI weekly Dubai calendar", () => {
  it("derives the immutable Monday cohort boundaries", () => {
    const calendar = getArticleAiWeeklyCalendar(target);
    expect(calendar.sourceStart.toISOString()).toBe("2026-11-15T20:00:00.000Z");
    expect(calendar.sourceEnd.toISOString()).toBe("2026-11-20T20:00:00.000Z");
    expect(calendar.processingAt.toISOString()).toBe("2026-11-20T20:15:00.000Z");
    expect(calendar.emailAt.toISOString()).toBe("2026-11-23T05:00:00.000Z");
    expect(calendar.validUntil.toISOString()).toBe("2026-11-29T20:00:00.000Z");
  });

  it("opens only at Saturday 00:15 and closes before Monday 09:00", () => {
    expect(getDueArticleAiWeeklyTarget(new Date("2026-11-20T19:59:59.000Z"))).toBeNull();
    expect(getDueArticleAiWeeklyTarget(new Date("2026-11-20T20:14:59.000Z"))).toBeNull();
    expect(getDueArticleAiWeeklyTarget(new Date("2026-11-20T20:15:00.000Z"))).toBe(target);
    expect(getDueArticleAiWeeklyTarget(new Date("2026-11-22T08:00:00.000Z"))).toBe(target);
    expect(getDueArticleAiWeeklyTarget(new Date("2026-11-23T04:59:59.000Z"))).toBe(target);
    expect(getDueArticleAiWeeklyTarget(new Date("2026-11-23T05:00:00.000Z"))).toBeNull();
    expect(isArticleAiWeeklyGenerationDue(target, new Date("2026-11-23T04:59:59.000Z"))).toBe(true);
    expect(isArticleAiWeeklyGenerationDue(target, new Date("2026-11-23T05:00:00.000Z"))).toBe(false);
  });

  it("returns the upcoming Monday without backfilling a missed prior week", () => {
    expect(getNextArticleAiWeeklySchedule(new Date("2026-11-20T19:59:59.000Z")).targetWeekKey).toBe(target);
    expect(getNextArticleAiWeeklySchedule(new Date("2026-11-23T05:00:00.000Z")).targetWeekKey).toBe("2026-11-30");
  });

  it("rejects non-Monday cohort keys", () => {
    expect(() => getArticleAiWeeklyCalendar("2026-11-24")).toThrow(/Monday/);
  });
});
