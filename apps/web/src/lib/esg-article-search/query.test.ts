import { describe, expect, it } from "vitest";

import { articleSearchParams, parseArticleSearchParams } from "./query";

describe("ESG article search query contract", () => {
  it("allows an unfiltered archive browse and defaults it to newest", () => {
    const parsed = parseArticleSearchParams(new URLSearchParams());

    expect(parsed).toEqual({
      ok: true,
      filters: {
        q: "",
        source: "",
        from: "",
        to: "",
        sort: "newest",
        page: 1,
      },
    });
  });

  it("normalizes query whitespace and keeps only an explicit range", () => {
    const parsed = parseArticleSearchParams({
      q: "  climate   transition ",
      date: "2024-02-30",
      from: "2024-01-01",
      to: "2024-03-31",
      source: "  Reuters  ",
      sort: "relevance",
      page: "3",
    });

    expect(parsed).toEqual({
      ok: true,
      filters: {
        q: "climate transition",
        source: "Reuters",
        from: "2024-01-01",
        to: "2024-03-31",
        sort: "relevance",
        page: 3,
      },
    });
  });

  it("maps a valid legacy date to an inclusive one-day range", () => {
    const parsed = parseArticleSearchParams({ q: "ghg", date: "2024-02-29" });
    expect(parsed).toMatchObject({
      ok: true,
      filters: { from: "2024-02-29", to: "2024-02-29" },
    });
  });

  it.each([
    ["one character", { q: "é" }, "at least 2"],
    ["invalid date", { q: "esg", from: "2024-02-30" }, "Invalid from date"],
    ["reversed range", { q: "esg", from: "2025-01-01", to: "2024-12-31" }, "on or before"],
    ["bad page", { q: "esg", page: "100001" }, "integer"],
    ["bad sort", { q: "esg", sort: "popular" }, "relevance or newest"],
  ])("rejects %s", (_label, input, expected) => {
    const parsed = parseArticleSearchParams(input);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain(expected);
  });

  it("bounds Unicode length and term count", () => {
    expect(parseArticleSearchParams({ q: "😀" }).ok).toBe(false);
    expect(parseArticleSearchParams({ q: "éé" }).ok).toBe(true);
    expect(parseArticleSearchParams({ q: Array.from({ length: 13 }, (_, i) => `term${i}`).join(" ") }).ok).toBe(false);
  });

  it("round-trips the client-safe URL helper", () => {
    const original = {
      q: "greenhouse gases",
      source: "Reuters",
      from: "2024-01-01",
      to: "2024-03-31",
      sort: "relevance" as const,
      page: 4,
    };
    const parsed = parseArticleSearchParams(articleSearchParams(original));
    expect(parsed).toEqual({ ok: true, filters: original });
  });
});
