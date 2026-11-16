import { createHash } from "node:crypto";

import {
  ARTICLE_AI_DOMAIN_HISTORY_MINIMUM,
  ARTICLE_AI_MAX_WEEKLY_PICKS,
  type ArticleAiDomain,
} from "./types";

export interface ArticleAiArticle {
  id: number;
  title: string | null;
  summary: string | null;
  content: string | null;
  source: string | null;
  url: string | null;
  publishedAt: Date | null;
}

export interface NormalizedArticle extends ArticleAiArticle {
  normalizedText: string;
  contentHash: string;
  tokens: string[];
}

export interface ArticleAiProfile {
  domain: ArticleAiDomain;
  profileSource: "domain" | "insufficient";
  humanLikeCount: number;
  tokens: string[];
  sources: string[];
  exampleArticleIds: number[];
  examples: Array<{ id: number; title: string | null; source: string | null; text: string }>;
  contentHash: string;
}

export function classifyDomainHistory(usableCount: number): { count: number; source: "domain" | "insufficient" } {
  const count = Math.max(0, Math.floor(usableCount));
  return count >= ARTICLE_AI_DOMAIN_HISTORY_MINIMUM
    ? { count, source: "domain" }
    : { count, source: "insufficient" };
}

export interface RankedArticle extends NormalizedArticle {
  score: number;
  overlap: number;
}

export interface DeterministicDecision {
  articleId: number;
  action: "select" | "abstain";
  confidence: number;
  reason: string;
}

const MAX_TEXT_LENGTH = 8_000;
const STOP_WORDS = new Set([
  "about", "after", "again", "among", "because", "being", "could", "from",
  "have", "into", "more", "other", "their", "there", "these", "they", "this",
  "through", "under", "were", "which", "with", "would", "your", "also", "than",
]);

export function normalizeArticleText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKC")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TEXT_LENGTH);
}

export function tokenize(value: string): string[] {
  const tokens = value
    .toLocaleLowerCase("en-US")
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
  return Array.from(new Set(tokens)).slice(0, 600);
}

export function hashContent(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function normalizeArticle(article: ArticleAiArticle): NormalizedArticle {
  const text = normalizeArticleText(
    [article.title, article.summary, article.content, article.source].filter(Boolean).join(" "),
  );
  return {
    ...article,
    title: normalizeArticleText(article.title).slice(0, 500) || null,
    summary: normalizeArticleText(article.summary).slice(0, 2_000) || null,
    content: normalizeArticleText(article.content),
    source: normalizeArticleText(article.source).slice(0, 255) || null,
    url: normalizeArticleText(article.url).slice(0, 2_000) || null,
    normalizedText: text,
    contentHash: hashContent(text),
    tokens: tokenize(text),
  };
}

function overlapScore(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const item of Array.from(left)) if (right.has(item)) intersection += 1;
  return intersection / Math.max(1, Math.min(left.size, right.size));
}

export function buildProfile(
  domain: ArticleAiDomain,
  source: "domain" | "insufficient",
  likedArticles: NormalizedArticle[],
  humanLikeCount: number,
  maxExamples: number,
): ArticleAiProfile {
  const tokenCounts = new Map<string, number>();
  const sources = new Set<string>();
  const exampleArticleIds: number[] = [];
  for (const article of likedArticles.slice(0, maxExamples)) {
    if (article.id > 0) exampleArticleIds.push(article.id);
    if (article.source) sources.add(article.source);
    for (const token of article.tokens) tokenCounts.set(token, (tokenCounts.get(token) ?? 0) + 1);
  }
  const tokens = Array.from(tokenCounts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 120)
    .map(([token]) => token);
  return {
    domain,
    profileSource: source,
    humanLikeCount,
    tokens,
    sources: Array.from(sources).slice(0, 40),
    exampleArticleIds,
    examples: likedArticles.slice(0, maxExamples).map((article) => ({
      id: article.id,
      title: article.title,
      source: article.source,
      text: article.normalizedText.slice(0, 1_000),
    })),
    contentHash: hashContent(`${domain}|${source}|${humanLikeCount}|${tokens.join(",")}`),
  };
}

export function rankCandidates(
  profile: ArticleAiProfile,
  candidates: NormalizedArticle[],
  excludedArticleIds: ReadonlySet<number>,
  limit: number,
): RankedArticle[] {
  const profileTokens = new Set(profile.tokens);
  const profileSources = new Set(profile.sources.map((source) => source.toLocaleLowerCase("en-US")));
  return candidates
    .filter((candidate) => !excludedArticleIds.has(candidate.id))
    .map((candidate) => {
      const overlap = overlapScore(profileTokens, new Set(candidate.tokens));
      const sourceBoost = candidate.source && profileSources.has(candidate.source.toLocaleLowerCase("en-US")) ? 0.12 : 0;
      return { ...candidate, overlap, score: Math.min(1, overlap * 0.88 + sourceBoost) };
    })
    .filter((candidate) => candidate.score >= 0.18)
    .sort((a, b) => b.score - a.score || (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0) || a.id - b.id)
    .slice(0, Math.max(0, Math.min(limit, 100)));
}

export function deterministicDecisions(
  ranked: RankedArticle[],
  limit = ARTICLE_AI_MAX_WEEKLY_PICKS,
): DeterministicDecision[] {
  const selected: DeterministicDecision[] = [];
  const sources = new Set<string>();
  for (const candidate of ranked) {
    if (selected.length >= limit) break;
    const source = candidate.source?.toLocaleLowerCase("en-US") ?? `id:${candidate.id}`;
    // Prefer diversity while allowing a source to contribute once if the
    // shortlist is small. The abstain threshold is intentionally conservative.
    if (sources.has(source) && ranked.length > limit) continue;
    if (candidate.score < 0.42) continue;
    sources.add(source);
    selected.push({
      articleId: candidate.id,
      action: "select",
      confidence: Number(Math.min(0.96, 0.5 + candidate.score / 2).toFixed(3)),
      reason: `Matches the domain's ${candidate.overlap >= 0.55 ? "strong" : "recurring"} human-liked topics${candidate.source ? ` and source ${candidate.source}` : ""}.`,
    });
  }
  return selected;
}
