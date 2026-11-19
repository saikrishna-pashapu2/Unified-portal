import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@esgcredit/db-esg", () => ({ esgPrisma: {} }));
vi.mock("@esgcredit/db-credit", () => ({ creditPrisma: {} }));

import { getArticleAiDailyCalendar } from "./daily-calendar";
import { buildDailyManifestInputs } from "./daily-inputs";

describe("daily article manifest late ingestion", () => {
  it("keeps unchanged human-liked evidence reusable across daily runs", () => {
    const history = {
      kind: "history" as const, id: 77, resolved: true, title: "Liquidity coverage",
      summary: "Historical evidence", content: null, source: "Wire", url: "https://example.test/history",
      published_at: null, eligible_at: null, first_seen_at: null,
    };
    const snapshots = ["2026-11-18", "2026-11-19"].map(day => {
      const calendar = getArticleAiDailyCalendar(day);
      return buildDailyManifestInputs("credit", calendar, calendar.processingAt, [history]).history[0];
    });
    expect(snapshots[0].contentHash).toBe(snapshots[1].contentHash);
    for (const snapshot of snapshots) {
      expect(snapshot.sourcePeriodStart).toBeNull();
      expect(snapshot.sourcePeriodEnd).toBeNull();
    }
  });

  it("keeps an old publication that arrived during the source day", () => {
    const calendar = getArticleAiDailyCalendar("2026-11-18");
    const result = buildDailyManifestInputs("esg", calendar, new Date("2026-11-18T20:15:00.000Z"), [
      {
        kind: "candidate", id: 101, resolved: true,
        title: "Late ESG article", summary: "Substantive climate disclosure update", content: null,
        source: "Wire", url: "https://example.test/late", published_at: new Date("2026-10-01T00:00:00.000Z"),
        eligible_at: new Date("2026-10-01T00:00:00.000Z"),
        first_seen_at: new Date("2026-11-18T19:00:00.000Z"),
      },
      {
        kind: "candidate", id: 102, resolved: true,
        title: "Too old", summary: "Outside bounded late-arrival window", content: null,
        source: "Wire", url: "https://example.test/old", published_at: new Date("2026-09-01T00:00:00.000Z"),
        eligible_at: new Date("2026-09-01T00:00:00.000Z"),
        first_seen_at: new Date("2026-11-09T19:00:00.000Z"),
      },
    ]);
    expect(result.candidates[0].exclusionReason).toBeNull();
    expect(result.candidates[0].eligibleAt).toBe("2026-10-01T00:00:00.000Z");
    expect(result.candidates[0].firstSeenAt).toBe("2026-11-18T19:00:00.000Z");
    expect(result.candidates[0].sourcePeriodStart).toBe("2026-11-17T20:00:00.000Z");
    expect(result.candidates[1].exclusionReason).toBe("outside_source_window");
    expect(result.coverage.candidateCarryover).toBe(1);
  });
});
