import { describe, expect, it } from "vitest";

import {
  getArticleAiDailyCalendar,
  getDueArticleAiDailySourceDay,
  isArticleAiDailyGenerationDue,
} from "./daily-calendar";

const sourceDay = "2026-11-18";

describe("Article AI daily Dubai calendar", () => {
  it("uses the preceding Dubai calendar day as the immutable source", () => {
    const calendar = getArticleAiDailyCalendar(sourceDay);
    expect(calendar.sourceStart.toISOString()).toBe("2026-11-17T20:00:00.000Z");
    expect(calendar.sourceEnd.toISOString()).toBe("2026-11-18T20:00:00.000Z");
    expect(calendar.processingAt.toISOString()).toBe("2026-11-18T20:15:00.000Z");
    expect(calendar.generationValidUntil.toISOString()).toBe("2026-11-19T20:15:00.000Z");
    expect(calendar.validUntil.toISOString()).toBe("2026-12-18T20:00:00.000Z");
    expect(calendar.candidateStart.toISOString()).toBe("2026-11-10T20:00:00.000Z");
  });

  it("opens at 00:15 Dubai and does not backfill before the cutoff", () => {
    expect(getDueArticleAiDailySourceDay(new Date("2026-11-18T20:14:59.000Z"))).toBeNull();
    expect(getDueArticleAiDailySourceDay(new Date("2026-11-18T20:15:00.000Z"))).toBe(sourceDay);
    expect(getDueArticleAiDailySourceDay(new Date("2026-11-19T19:59:59.000Z"))).toBe(sourceDay);
    expect(getDueArticleAiDailySourceDay(new Date("2026-11-19T20:15:00.000Z"))).toBe("2026-11-19");
    expect(isArticleAiDailyGenerationDue(sourceDay, new Date("2026-11-19T20:15:00.000Z"))).toBe(false);
  });

  it("rejects invalid day keys", () => {
    expect(() => getArticleAiDailyCalendar("2026-02-30")).toThrow(/YYYY-MM-DD/);
  });
});
