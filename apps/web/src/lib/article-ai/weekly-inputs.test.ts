import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@esgcredit/db-esg", () => ({ esgPrisma: {} }));
vi.mock("@esgcredit/db-credit", () => ({ creditPrisma: {} }));
import { buildWeeklyManifestInputs, weeklyArticleContentHash, type WeeklySourceRow } from "./weekly-inputs";
import { getArticleAiWeeklyCalendar } from "./weekly-calendar";

const calendar = getArticleAiWeeklyCalendar("2026-11-23");
const observedAt = calendar.processingAt;
function row(id: number, kind: WeeklySourceRow["kind"] = "candidate", overrides: Partial<WeeklySourceRow> = {}): WeeklySourceRow {
  return {
    id, kind, resolved: true, title: `Article ${id}`, summary: "Substantive domain evidence",
    content: null, source: "Source", url: `https://example.test/${id}`,
    published_at: new Date("2026-11-20T20:00:00+04:00"),
    eligible_at: new Date("2026-11-20T20:00:00+04:00"),
    first_seen_at: new Date("2026-11-20T22:00:00+04:00"), ...overrides,
  };
}
function build(rows: WeeklySourceRow[], floor = calendar.sourceStart, reviewed = new Set<number>()) {
  return buildWeeklyManifestInputs("esg", calendar, observedAt, floor, reviewed, rows);
}

describe("weekly complete input manifests", () => {
  it("keeps more than 200 historical examples and more than 120 candidates without truncation", () => {
    const text = "مخاطر المناخ 信用评级 ".repeat(10_000);
    const rows = [
      ...Array.from({ length: 251 }, (_, i) => row(i + 1, "history", { content: text })),
      ...Array.from({ length: 131 }, (_, i) => row(i + 501)),
      row(1, "history", { content: text }),
    ];
    const result = build(rows);
    expect(result.history).toHaveLength(251);
    expect(result.candidates).toHaveLength(131);
    expect(result.history[0].content).toBe(text);
    expect(result.coverage.historyTotal).toBe(251);
    expect(result.coverage.status).toBe("incomplete");
  });

  it("records missing and empty historical records without dropping their liked IDs", () => {
    const result = build([
      row(1, "history", { resolved: false, title: null, summary: null }),
      row(2, "history", { title: "", summary: null }),
      row(3, "history"), row(4, "candidate", { url: "javascript:alert(1)" }),
    ]);
    expect(result.history.map((input) => input.articleId)).toEqual([1, 2, 3]);
    expect(result.history.map((input) => input.exclusionReason)).toEqual(["article_missing", "article_text_empty", null]);
    expect(result.coverage.historyTotal).toBe(result.coverage.historyResolved + result.coverage.historyExcluded);
    expect(result.coverage.candidateExcluded).toBe(1);
  });

  it("includes all Friday, excludes Saturday and defers known late arrivals", () => {
    const late = row(3, "candidate", { first_seen_at: calendar.sourceEnd });
    const unknown = row(4, "candidate", { first_seen_at: null });
    const result = build([
      row(1, "candidate", { eligible_at: new Date("2026-11-20T23:59:59+04:00") }),
      row(2, "candidate", { eligible_at: calendar.sourceEnd }), late, unknown,
    ]);
    expect(result.candidates.map((input) => input.articleId)).toEqual([1, 4]);
    expect(result.candidates[1].firstSeenKnown).toBe(false);
    const next = getArticleAiWeeklyCalendar("2026-11-30");
    const carryover = buildWeeklyManifestInputs("esg", next, next.processingAt, calendar.sourceStart, new Set(), [late]);
    expect(carryover.candidates[0].carryoverFromWeek).toBe("2026-11-23");
    expect(carryover.coverage.candidateCarryover).toBe(1);
  });

  it("keeps unreviewed carryover, excludes completed reviews and pre-rollout backlog", () => {
    const old = row(1, "candidate", { eligible_at: new Date("2026-11-13T12:00:00+04:00"), first_seen_at: new Date("2026-11-13T13:00:00+04:00") });
    expect(build([old]).candidates).toEqual([]);
    const floor = getArticleAiWeeklyCalendar("2026-11-16").sourceStart;
    const result = build([old, row(2)], floor, new Set([2]));
    expect(result.candidates.map((input) => input.articleId)).toEqual([1]);
    expect(result.candidates[0].carryoverFromWeek).toBe("2026-11-16");
  });

  it("hashes complete text, domain, source and URL, independently of runtime UUIDs", () => {
    const input = build([row(1, "history", { content: "x".repeat(20_000) + "A" })]).history[0];
    const same = { ...input, manifestId: "some-new-runtime-uuid" };
    expect(weeklyArticleContentHash(same)).toBe(input.contentHash);
    expect(weeklyArticleContentHash({ ...same, content: "x".repeat(20_000) + "B" })).not.toBe(input.contentHash);
    expect(weeklyArticleContentHash({ ...same, domain: "credit" })).not.toBe(input.contentHash);
  });
});
