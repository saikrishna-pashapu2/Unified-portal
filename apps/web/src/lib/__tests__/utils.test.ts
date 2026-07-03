import { describe, expect, it, vi } from "vitest";
import { fmtDate, fmtDateRange, fmtDateTime, fmtTime, getRelativeTimeStatus } from "@/lib/date";
import { parseKeywords } from "@/lib/keywords";
import { cn } from "@/lib/utils";

describe("pure utility functions", () => {
  it("cn joins truthy class names and drops falsey values", () => {
    expect(cn("base", false, null, undefined, "active")).toBe("base active");
  });

  it("parseKeywords dedupes case-insensitively and preserves first casing", () => {
    expect(parseKeywords('["ESG", "esg", " Credit "]')).toEqual(["ESG", "Credit"]);
    expect(parseKeywords("{alpha; beta, Alpha}")).toEqual(["alpha", "beta"]);
  });

  it("parseKeywords extracts array and string values from objects", () => {
    expect(parseKeywords({ esg: ["Climate", "climate"], credit: "Ratings" })).toEqual([
      "Climate",
      "Ratings",
    ]);
  });

  it("formats dates, ranges, times, and datetimes with current behavior", () => {
    const start = new Date(2026, 6, 3);
    const end = new Date(2026, 6, 5);

    expect(fmtDate(start)).toBe("Jul 3, 2026");
    expect(fmtDateRange(start, end)).toBe("Jul 3–5, 2026");
    expect(fmtTime("14:05")).toBe("2:05 PM");
    expect(fmtDateTime(start, "14:05", "GST")).toBe("Jul 3, 2026 at 2:05 PM (GST)");
  });

  it("classifies relative event timing", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));

    expect(getRelativeTimeStatus(new Date("2026-01-02T12:00:00Z"))).toEqual({
      status: "upcoming",
      label: "Tomorrow",
    });
    expect(
      getRelativeTimeStatus(
        new Date("2026-01-01T11:00:00Z"),
        new Date("2026-01-01T13:00:00Z"),
      ),
    ).toEqual({ status: "ongoing", label: "Live" });

    vi.useRealTimers();
  });
});
