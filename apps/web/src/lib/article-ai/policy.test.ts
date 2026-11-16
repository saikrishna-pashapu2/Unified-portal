import { describe, expect, it } from "vitest";

import {
  buildProfile,
  classifyHistory,
  deterministicDecisions,
  hashContent,
  normalizeArticle,
  rankCandidates,
} from "./policy";

function article(id: number, text: string, source = "Wire"): ReturnType<typeof normalizeArticle> {
  return normalizeArticle({
    id,
    title: text,
    summary: text,
    content: text,
    source,
    url: `https://example.test/${id}`,
    publishedAt: new Date("2026-11-16T00:00:00Z"),
  });
}

describe("article AI deterministic policy", () => {
  it("normalizes untrusted markup and hashes the normalized content deterministically", () => {
    const first = article(1, "  Climate <script>ignore()</script> risk   disclosure  ");
    const second = article(1, "Climate risk disclosure");
    expect(first.normalizedText).toBe(second.normalizedText);
    expect(first.contentHash).toBe(hashContent(first.normalizedText));
    expect(first.normalizedText).not.toContain("script");
  });

  it("uses human history for a conservative, source-diverse shortlist", () => {
    const liked = [
      article(10, "Climate transition risk disclosure carbon accounting", "Wire"),
      article(11, "Climate scenario analysis and financed emissions", "Wire"),
    ];
    const profile = buildProfile("esg", "personal", liked, 22, 50);
    const candidates = [
      article(20, "Climate transition risk and carbon accounting update", "Wire"),
      article(21, "Climate scenario analysis for banks", "Daily"),
      article(22, "Unrelated sports result", "Sport"),
    ];
    const ranked = rankCandidates(profile, candidates, new Set([10, 11]), 10);
    expect(ranked.map((item) => item.id)).toEqual([20, 21]);
    expect(deterministicDecisions(ranked, 5).map((item) => item.articleId)).toEqual([20, 21]);
  });

  it("never returns a previously liked or low-confidence article", () => {
    const profile = buildProfile("credit", "team", [article(1, "Credit rating methodology risk disclosure")], 4, 50);
    const ranked = rankCandidates(
      profile,
      [article(1, "Credit rating methodology risk disclosure"), article(2, "Short", "Other")],
      new Set([1]),
      10,
    );
    expect(ranked).toHaveLength(0);
    expect(deterministicDecisions(ranked)).toEqual([]);
  });

  it("requires enough team history before switching away from insufficient", () => {
    expect(classifyHistory(4, 1)).toEqual({ count: 4, source: "insufficient" });
    expect(classifyHistory(4, 5)).toEqual({ count: 5, source: "team" });
    expect(classifyHistory(20, 1)).toEqual({ count: 20, source: "personal" });
  });
});
