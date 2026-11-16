import { describe, expect, it } from "vitest";

import {
  buildProfile,
  classifyDomainHistory,
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
    const profile = buildProfile("esg", "domain", liked, 22, 50);
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
    const profile = buildProfile("credit", "domain", [article(1, "Credit rating methodology risk disclosure")], 1, 50);
    const ranked = rankCandidates(
      profile,
      [article(1, "Credit rating methodology risk disclosure"), article(2, "Short", "Other")],
      new Set([1]),
      10,
    );
    expect(ranked).toHaveLength(0);
    expect(deterministicDecisions(ranked)).toEqual([]);
  });

  it("accepts one usable shared domain example and abstains only on zero", () => {
    expect(classifyDomainHistory(0)).toEqual({ count: 0, source: "insufficient" });
    expect(classifyDomainHistory(1)).toEqual({ count: 1, source: "domain" });
    expect(classifyDomainHistory(102)).toEqual({ count: 102, source: "domain" });
  });
});
