import "server-only";

import { creditPrisma } from "@esgcredit/db-credit";
import { creditArticleSearchTerms } from "./query";
import {
  CREDIT_ARTICLE_SEARCH_PAGE_SIZE,
  CREDIT_ARTICLE_SEARCH_SUGGEST_PAGE_SIZE,
  type CreditArticleSearchFilters,
  type CreditArticleSearchItem,
  type CreditArticleSearchResponse,
} from "./types";

const TRANSACTION_TIMEOUT_MS = 8_000;
const SUGGESTION_CACHE_TTL_MS = 15_000;
const SUGGESTION_CACHE_MAX_ENTRIES = 128;
const MAX_TITLE_LENGTH = 500;
const MAX_SOURCE_LENGTH = 160;
const MAX_KEYWORDS_LENGTH = 500;
const MAX_SNIPPET_LENGTH = 320;

type CreditArticleRow = {
  id: number | bigint;
  title: string | null;
  source: string | null;
  published: string | Date | null;
  url: string | null;
  summary: string | null;
  matched_keywords: string | null;
  region: string | null;
  sector: string | null;
};
type CountRow = { total: bigint | number | string };
type TransactionClient = Parameters<Parameters<typeof creditPrisma.$transaction>[0]>[0];
type SuggestionCacheEntry = { expiresAt: number; response: CreditArticleSearchResponse };

const suggestionCache = new Map<string, SuggestionCacheEntry>();
const suggestionInFlight = new Map<string, Promise<CreditArticleSearchResponse>>();

async function withReadOnlyTransaction<T>(work: (tx: TransactionClient) => Promise<T>): Promise<T> {
  return creditPrisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await tx.$executeRaw`SET LOCAL statement_timeout = '1500ms'`;
      return work(tx);
    },
    { maxWait: 750, timeout: TRANSACTION_TIMEOUT_MS, isolationLevel: "RepeatableRead" },
  );
}

function plainText(value: string | null | undefined, maxLength: number): string {
  const stripped = (value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(?:amp|lt|gt|quot|apos|#39|#x27|#x[0-9a-f]+|#[0-9]+);/gi, (entity) => {
      const normalized = entity.toLowerCase();
      if (normalized === "&amp;") return "&";
      if (normalized === "&lt;") return "<";
      if (normalized === "&gt;") return ">";
      if (normalized === "&quot;") return '"';
      if (normalized === "&apos;" || normalized === "&#39;" || normalized === "&#x27;") return "'";
      const numeric = normalized.startsWith("&#x")
        ? Number.parseInt(normalized.slice(3, -1), 16)
        : Number.parseInt(normalized.slice(2, -1), 10);
      if (!Number.isFinite(numeric) || numeric < 0 || numeric > 0x10ffff) return " ";
      try { return String.fromCodePoint(numeric); } catch { return " "; }
    })
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
  return Array.from(stripped).slice(0, maxLength).join("");
}

function safeUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch { return null; }
}

function normalizeDate(value: string | Date | null): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
}

function mapRow(row: CreditArticleRow): CreditArticleSearchItem {
  return {
    id: Number(row.id),
    title: plainText(row.title, MAX_TITLE_LENGTH) || "Untitled",
    source: plainText(row.source, MAX_SOURCE_LENGTH) || null,
    published: normalizeDate(row.published),
    url: safeUrl(row.url),
    snippet: plainText(row.summary, MAX_SNIPPET_LENGTH),
    matched_keywords: plainText(row.matched_keywords, MAX_KEYWORDS_LENGTH) || null,
    region: plainText(row.region, 100) || null,
    sector: plainText(row.sector, 100) || null,
  };
}

function countValue(row: CountRow | undefined): number {
  if (!row) throw new Error("Credit article search count returned no row");
  const value = Number(row.total);
  if (!Number.isFinite(value) || value < 0) throw new Error("Credit article search count was invalid");
  return Math.min(Math.trunc(value), Number.MAX_SAFE_INTEGER);
}

function escapeRegex(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

function isRatingToken(value: string): boolean {
  return /^[a-z]{1,5}[+-]$/i.test(value);
}

function buildWhere(filters: CreditArticleSearchFilters) {
  const params: unknown[] = [];
  const add = (value: unknown) => { params.push(value); return `$${params.length}`; };
  const terms = creditArticleSearchTerms(filters.q.toLowerCase());
  const conditions = ["TRUE"];
  const titleHits: string[] = [];
  for (const term of terms) {
    const normalized = term.toLowerCase();
    const token = add(isRatingToken(normalized)
      ? `(^|[^[:alnum:]])${escapeRegex(normalized)}([^[:alnum:]]|$)`
      : normalized);
    conditions.push(isRatingToken(normalized)
      ? `searchable.search_text ~ ${token}`
      : `position(lower(${token}) in searchable.search_text) > 0`);
    if (terms.length > 1) {
      const test = isRatingToken(normalized)
        ? `lower(a.title) ~ ${token}` : `position(${token} in lower(a.title)) > 0`;
      titleHits.push(`CASE WHEN ${test} THEN 1 ELSE 0 END`);
    }
  }
  if (filters.source) conditions.push(`a.source = ${add(filters.source)}`);
  if (filters.region) conditions.push(`a.region = ${add(filters.region)}`);
  if (filters.sector) conditions.push(`a.sector = ${add(filters.sector)}`);
  if (filters.from) conditions.push(`COALESCE(a.date, a.save_time::date) >= ${add(filters.from)}::date`);
  if (filters.to) conditions.push(`COALESCE(a.date, a.save_time::date) <= ${add(filters.to)}::date`);
  return { where: conditions.join(" AND "), params, titleHits };
}

const fromSql = `FROM credit_articles AS a
  CROSS JOIN LATERAL (
    SELECT lower(concat_ws(' ', COALESCE(a.title, ''), COALESCE(a.summary, ''),
      COALESCE(a.matched_keywords, ''), COALESCE(a.source, ''))) AS search_text
  ) AS searchable`;

async function executeSearch(
  filters: CreditArticleSearchFilters,
  suggest: boolean,
): Promise<CreditArticleSearchResponse> {
  const pageSize = suggest ? CREDIT_ARTICLE_SEARCH_SUGGEST_PAGE_SIZE : CREDIT_ARTICLE_SEARCH_PAGE_SIZE;
  const limit = pageSize + (suggest ? 1 : 0);
  const offset = suggest ? 0 : (filters.page - 1) * CREDIT_ARTICLE_SEARCH_PAGE_SIZE;

  return withReadOnlyTransaction(async (tx) => {
    const built = buildWhere(filters);
    const phraseParam = filters.q ? built.params.push(filters.q.toLowerCase()) : 0;
    const relevance = phraseParam
      ? `(CASE WHEN position($${phraseParam} in lower(COALESCE(a.title, ''))) > 0 THEN 12 ELSE 0 END
          + CASE WHEN position($${phraseParam} in lower(COALESCE(a.summary, ''))) > 0 THEN 6 ELSE 0 END
          + CASE WHEN position($${phraseParam} in lower(COALESCE(a.matched_keywords, ''))) > 0 THEN 4 ELSE 0 END
          + CASE WHEN position($${phraseParam} in lower(COALESCE(a.source, ''))) > 0 THEN 2 ELSE 0 END
          + ${built.titleHits.join(" + ") || "0"})`
      : "0";
    const rowsSql = `SELECT a.id, a.title, a.source, COALESCE(a.date, a.save_time::date)::text AS published,
      COALESCE(NULLIF(a.link, ''), a.url) AS url, LEFT(COALESCE(NULLIF(a.summary, ''), a.content), 2048) AS summary,
      a.matched_keywords, a.region, a.sector, COALESCE(a.date, a.save_time::date) AS article_date
      ${fromSql} WHERE ${built.where}
      ORDER BY CASE WHEN ${filters.sort === "relevance" ? "TRUE" : "FALSE"} THEN ${relevance} END DESC NULLS LAST,
        COALESCE(a.date, a.save_time::date) DESC NULLS LAST, a.id DESC LIMIT ${limit} OFFSET ${offset}`;
    const rows = await tx.$queryRawUnsafe<CreditArticleRow[]>(rowsSql, ...built.params);
    if (suggest) {
      return { items: rows.slice(0, pageSize).map(mapRow), total: null, page: filters.page, pageSize,
        hasMore: rows.length > pageSize, query: filters.q, typoTolerance: false };
    }
    const countBuilt = buildWhere(filters);
    const countRows = await tx.$queryRawUnsafe<CountRow[]>(`SELECT COUNT(*)::bigint AS total ${fromSql} WHERE ${countBuilt.where}`, ...countBuilt.params);
    const total = countValue(countRows[0]);
    return { items: rows.map(mapRow), total, page: filters.page, pageSize,
      hasMore: filters.page * pageSize < total, query: filters.q, typoTolerance: false };
  });
}

function cacheKey(filters: CreditArticleSearchFilters): string { return JSON.stringify(filters); }
function cloneResponse(response: CreditArticleSearchResponse): CreditArticleSearchResponse {
  return { ...response, items: response.items.map((item) => ({ ...item })) };
}
function trimCache(now: number): void {
  Array.from(suggestionCache.entries()).forEach(([key, entry]) => {
    if (entry.expiresAt <= now) suggestionCache.delete(key);
  });
  while (suggestionCache.size >= SUGGESTION_CACHE_MAX_ENTRIES) {
    const oldest = suggestionCache.keys().next().value;
    if (oldest === undefined) break;
    suggestionCache.delete(oldest);
  }
}

export async function searchCreditArticles(
  filters: CreditArticleSearchFilters,
  options?: { suggest?: boolean },
): Promise<CreditArticleSearchResponse> {
  const suggest = options?.suggest === true;
  if (!suggest) return executeSearch(filters, false);
  const key = cacheKey(filters);
  const now = Date.now();
  trimCache(now);
  const cached = suggestionCache.get(key);
  if (cached && cached.expiresAt > now) return cloneResponse(cached.response);
  const existing = suggestionInFlight.get(key);
  if (existing) return cloneResponse(await existing);
  if (suggestionInFlight.size >= SUGGESTION_CACHE_MAX_ENTRIES) throw new Error("Credit suggestions are busy");
  const promise = executeSearch(filters, true).then((response) => {
    trimCache(Date.now());
    suggestionCache.set(key, { expiresAt: Date.now() + SUGGESTION_CACHE_TTL_MS, response });
    return response;
  });
  suggestionInFlight.set(key, promise);
  try { return cloneResponse(await promise); } finally {
    if (suggestionInFlight.get(key) === promise) suggestionInFlight.delete(key);
  }
}

export function resetCreditArticleSearchCachesForTests(): void {
  suggestionCache.clear();
  suggestionInFlight.clear();
}
