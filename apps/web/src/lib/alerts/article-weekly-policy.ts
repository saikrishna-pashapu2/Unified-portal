import { isArticleAiDomain, type ArticleAiDomain } from "@/lib/article-ai/types";

export interface WeeklyArticleItem {
  id: number;
  domain: ArticleAiDomain;
  kind: "article" | "event" | "publication";
  origin: "human" | "ai";
  title: string;
  url: string;
  source: string;
  publishedAt: string | null;
  reason?: string;
  contentHash?: string;
}

export function normalizeWeeklyDomains(domains: unknown, legacyDomain: unknown): ArticleAiDomain[] {
  const values = Array.isArray(domains) && domains.length ? domains : [legacyDomain];
  if (!values.length || !values.every(isArticleAiDomain)) {
    throw new RangeError("Weekly alert contains an invalid domain");
  }
  return Array.from(new Set(values));
}

/** AI content is never sent to an override mailbox or a distribution list. */
export function isPersonalDigestRecipient(destination: string, accountEmail: string | null): boolean {
  if (!accountEmail) return false;
  const recipient = destination.trim().toLowerCase();
  return /^[^\s,;<>@]+@[^\s,;<>@]+\.[^\s,;<>@]+$/.test(recipient)
    && recipient === accountEmail.trim().toLowerCase();
}

/**
 * AI picks are an opt-in addition to the existing personal Monday digest.
 * Custom schedules and override mailboxes continue to receive the human
 * digest only; toggling AI never changes the subscription itself.
 */
export function isCanonicalArticleAiSchedule(
  schedule: { digest_day?: string | null; digest_hour?: number | null; timezone?: string | null },
): boolean {
  return (schedule.digest_day ?? "monday").trim().toLowerCase() === "monday"
    && (schedule.digest_hour ?? 9) === 9
    && (schedule.timezone ?? "Asia/Dubai").trim().toLowerCase() === "asia/dubai";
}

export function safeDigestUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function canonicalDigestUrl(value: string): string | null {
  const safe = safeDigestUrl(value);
  if (!safe) return null;
  const url = new URL(safe);
  url.hash = "";
  for (const key of Array.from(url.searchParams.keys())) {
    if (/^utm_/i.test(key) || /^(fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  return url.href.replace(/\/$/, "");
}

/** Human choices win regardless of the input order; integer IDs are domain scoped. */
export function deduplicateWeeklyItems(items: WeeklyArticleItem[]): WeeklyArticleItem[] {
  const identities = new Set<string>();
  const links = new Set<string>();
  const result: WeeklyArticleItem[] = [];
  for (const item of [...items].sort((a, b) => Number(a.origin === 'ai') - Number(b.origin === 'ai'))) {
    const identity = `${item.domain}:${item.kind}:${item.id}`;
    const link = canonicalDigestUrl(item.url);
    if (!link || identities.has(identity) || links.has(link)) continue;
    identities.add(identity);
    links.add(link);
    result.push(item);
  }
  return result;
}

export function matchesWeeklyFilters(
  item: WeeklyArticleItem,
  filters: { sources?: string[] | null; keywords?: string[] | null },
): boolean {
  const sources = (filters.sources ?? []).map(value => value.trim().toLowerCase()).filter(Boolean);
  const keywords = (filters.keywords ?? []).map(value => value.trim().toLowerCase()).filter(Boolean);
  return (!sources.length || sources.includes(item.source.trim().toLowerCase()))
    && (!keywords.length || keywords.some(keyword => `${item.title} ${item.source}`.toLowerCase().includes(keyword)));
}
