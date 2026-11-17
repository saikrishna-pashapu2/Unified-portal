import {
  ARTICLE_SEARCH_MAX_PAGE,
  type ArticleSearchFilters,
  type ArticleSearchSort,
} from "./types";

const MAX_QUERY_LENGTH = 160;
const MAX_QUERY_TERMS = 12;
const MAX_SOURCE_LENGTH = 160;
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
// Constructed at runtime because apps/web targets ES5 while Node/modern
// browsers still provide Unicode property escapes for this client-safe parser.
const SEARCH_TERM_PATTERN = new RegExp("[\\p{L}\\p{N}]+", "gu");

type SearchParamsInput = URLSearchParams | Record<string, string | string[] | undefined>;

type ParseResult =
  | { ok: true; filters: ArticleSearchFilters }
  | { ok: false; error: string };

function valueFrom(input: SearchParamsInput, key: string): string | undefined {
  if (input instanceof URLSearchParams) return input.get(key) ?? undefined;

  const value = input[key];
  if (Array.isArray(value)) return value[0];
  return value;
}

function cleanText(value: string | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

function unicodeLength(value: string): number {
  return Array.from(value).length;
}

function searchTerms(value: string): string[] {
  return value.match(SEARCH_TERM_PATTERN) ?? [];
}

function parseDate(value: string | undefined, field: string):
  | { ok: true; value: string }
  | { ok: false; error: string } {
  if (!value) return { ok: true, value: "" };

  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) return { ok: false, error: `Invalid ${field} date` };

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));

  if (
    !Number.isFinite(candidate.getTime()) ||
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return { ok: false, error: `Invalid ${field} date` };
  }

  return { ok: true, value };
}

function parsePage(value: string | undefined):
  | { ok: true; value: number }
  | { ok: false; error: string } {
  if (!value) return { ok: true, value: 1 };
  if (!/^\d+$/.test(value)) {
    return { ok: false, error: "Page must be an integer from 1 to 100000" };
  }

  const page = Number(value);
  if (!Number.isSafeInteger(page) || page < 1 || page > ARTICLE_SEARCH_MAX_PAGE) {
    return { ok: false, error: "Page must be an integer from 1 to 100000" };
  }

  return { ok: true, value: page };
}

function parseSort(value: string | undefined, hasQuery: boolean):
  | { ok: true; value: ArticleSearchSort }
  | { ok: false; error: string } {
  if (!value) return { ok: true, value: hasQuery ? "relevance" : "newest" };
  if (value !== "relevance" && value !== "newest") {
    return { ok: false, error: "Sort must be relevance or newest" };
  }

  // A browse request is intentionally chronological even when a stale client
  // sends sort=relevance.
  return { ok: true, value: hasQuery ? value : "newest" };
}

export function parseArticleSearchParams(input: SearchParamsInput): ParseResult {
  const q = cleanText(valueFrom(input, "q"));
  if (unicodeLength(q) > MAX_QUERY_LENGTH) {
    return { ok: false, error: "Query is too long" };
  }
  if (q && unicodeLength(q) < 2) {
    return { ok: false, error: "Query must be at least 2 characters" };
  }

  const terms = searchTerms(q);
  if (q && terms.length === 0) {
    return { ok: false, error: "Query must contain at least one search term" };
  }
  if (terms.length > MAX_QUERY_TERMS) {
    return { ok: false, error: "Query contains too many terms" };
  }

  const source = cleanText(valueFrom(input, "source"));
  if (unicodeLength(source) > MAX_SOURCE_LENGTH) {
    return { ok: false, error: "Source is too long" };
  }

  const rawFrom = cleanText(valueFrom(input, "from"));
  const rawTo = cleanText(valueFrom(input, "to"));
  const rawLegacyDate = cleanText(valueFrom(input, "date"));
  const hasExplicitRange = Boolean(rawFrom || rawTo);

  let from = rawFrom;
  let to = rawTo;
  if (!hasExplicitRange && rawLegacyDate) {
    from = rawLegacyDate;
    to = rawLegacyDate;
  }

  const parsedFrom = parseDate(from, "from");
  if (!parsedFrom.ok) return parsedFrom;
  const parsedTo = parseDate(to, "to");
  if (!parsedTo.ok) return parsedTo;

  if (parsedFrom.value && parsedTo.value && parsedFrom.value > parsedTo.value) {
    return { ok: false, error: "from must be on or before to" };
  }

  const page = parsePage(cleanText(valueFrom(input, "page")));
  if (!page.ok) return page;

  const sort = parseSort(cleanText(valueFrom(input, "sort")), Boolean(q));
  if (!sort.ok) return sort;

  return {
    ok: true,
    filters: {
      q,
      source,
      from: parsedFrom.value,
      to: parsedTo.value,
      sort: sort.value,
      page: page.value,
    },
  };
}

export function articleSearchParams(filters: ArticleSearchFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.source) params.set("source", filters.source);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  params.set("sort", filters.sort);
  params.set("page", String(filters.page));
  return params;
}

export function articleSearchTermCount(value: string): number {
  return searchTerms(cleanText(value)).length;
}
