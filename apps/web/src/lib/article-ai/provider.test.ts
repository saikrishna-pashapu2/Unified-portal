import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { buildArticleAiProviderRequest } from "./provider";
import { buildProfile, normalizeArticle } from "./policy";

describe("article AI provider request bounds", () => {
  it("serializes the domain, bounded human examples, and candidate text", () => {
    const liked = normalizeArticle({
      id: 1,
      title: "Climate risk disclosure",
      summary: "Climate risk and emissions accounting",
      content: "Human example content",
      source: "Wire",
      url: "https://example.test/1",
      publishedAt: new Date("2026-11-15T00:00:00Z"),
    });
    const candidate = normalizeArticle({
      id: 2,
      title: "Transition risk update",
      summary: "Scenario analysis",
      content: "Candidate content",
      source: "Daily",
      url: "https://example.test/2",
      publishedAt: new Date("2026-11-16T00:00:00Z"),
    });
    const profile = buildProfile("esg", "personal", [liked], 20, 50);
    const request = buildArticleAiProviderRequest(profile, [candidate]);
    expect(request.prompt).toContain('"domain":"esg"');
    expect(request.prompt).toContain('"id":2');
    expect(request.inputBytes).toBeGreaterThan(Buffer.byteLength(request.prompt, "utf8"));
  });

  it("keeps provider input bounded for large article content", () => {
    const huge = normalizeArticle({
      id: 3,
      title: "Long article",
      summary: "x".repeat(20_000),
      content: "y".repeat(20_000),
      source: "Wire",
      url: "https://example.test/3",
      publishedAt: null,
    });
    const profile = buildProfile("credit", "team", [huge], 4, 50);
    const request = buildArticleAiProviderRequest(profile, [huge]);
    expect(request.prompt.length).toBeLessThan(10_000);
    expect(request.inputBytes).toBeGreaterThan(4_000);
  });
});
