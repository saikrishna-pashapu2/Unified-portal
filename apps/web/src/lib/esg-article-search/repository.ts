import "server-only";

import { esgPrisma } from "@esgcredit/db-esg";

import {
  ARTICLE_SEARCH_PAGE_SIZE,
  ARTICLE_SEARCH_SUGGEST_PAGE_SIZE,
  type ArticleSearchFilters,
  type ArticleSearchResponse,
  type EsgArticleSearchItem,
} from "./types";

const SEARCH_STATEMENT_TIMEOUT_MS = 1_500;
// Two bounded statements plus remote round-trip/transaction setup overhead.
// The per-statement timeout remains the primary query guard.
const SEARCH_TRANSACTION_TIMEOUT_MS = 8_000;
const CAPABILITIES_CACHE_TTL_MS = 60_000;
const SUGGESTION_CACHE_TTL_MS = 15_000;
const SUGGESTION_CACHE_MAX_ENTRIES = 128;
const MAX_SNIPPET_LENGTH = 320;
const MAX_TITLE_LENGTH = 500;
const MAX_SOURCE_LENGTH = 160;
const MAX_KEYWORDS_LENGTH = 500;
const SEARCH_TERM_PATTERN = new RegExp("[\\p{L}\\p{N}]+", "gu");

type ArticleSearchRow = {
  id: number | bigint;
  title: string | null;
  source: string | null;
  published: string | Date | null;
  url: string | null;
  summary: string | null;
  matched_keywords: string | null;
};

type CountRow = { total: bigint | number | string };

type CapabilityRow = {
  has_pg_trgm: boolean;
  has_title_trgm_index: boolean;
  has_full_text_index: boolean;
};

type SearchCapabilities = {
  typoTolerance: boolean;
  hasFullTextIndex: boolean;
};

type TransactionClient = Parameters<Parameters<typeof esgPrisma.$transaction>[0]>[0];

type CapabilityCache = {
  expiresAt: number;
  promise: Promise<SearchCapabilities>;
};

type SuggestionCacheEntry = {
  expiresAt: number;
  response: ArticleSearchResponse;
};

let capabilityCache: CapabilityCache | null = null;
const suggestionCache = new Map<string, SuggestionCacheEntry>();
const suggestionInFlight = new Map<string, Promise<ArticleSearchResponse>>();

/**
 * Search uses a transaction so PostgreSQL's statement timeout is local to the
 * two read statements. The transaction contains no data mutation; SET LOCAL
 * only changes the connection-local timeout for this transaction.
 */
async function withReadOnlyTransaction<T>(
  work: (tx: TransactionClient) => Promise<T>,
): Promise<T> {
  return esgPrisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await tx.$executeRaw`SET LOCAL statement_timeout = '1500ms'`;
      return work(tx);
    },
    {
      maxWait: 750,
      timeout: SEARCH_TRANSACTION_TIMEOUT_MS,
      isolationLevel: "RepeatableRead",
    },
  );
}

async function readSearchCapabilities(): Promise<SearchCapabilities> {
  const rows = await withReadOnlyTransaction((tx) =>
    tx.$queryRaw<CapabilityRow[]>`
      SELECT
        EXISTS (
          SELECT 1
          FROM pg_extension
          WHERE extname = 'pg_trgm'
        ) AS has_pg_trgm,
        to_regclass('public.esg_articles_search_title_trgm_idx') IS NOT NULL
          AS has_title_trgm_index,
        to_regclass('public.esg_articles_search_fts_idx') IS NOT NULL
          AS has_full_text_index
    `,
  );

  const capability = rows[0];
  if (!capability) {
    throw new Error("ESG article search capability probe returned no row");
  }

  return {
    hasFullTextIndex: Boolean(capability.has_full_text_index),
    // The fallback prefilter is intentionally literal. Requiring the FTS
    // index here prevents a partially-applied/drifted database from filtering
    // out a true typo match before the trigram predicate can run.
    typoTolerance: Boolean(
      capability.has_pg_trgm &&
      capability.has_title_trgm_index &&
      capability.has_full_text_index,
    ),
  };
}

async function getSearchCapabilities(): Promise<SearchCapabilities> {
  const now = Date.now();
  if (capabilityCache && capabilityCache.expiresAt > now) {
    return capabilityCache.promise;
  }

  const promise = readSearchCapabilities();
  const cached: CapabilityCache = {
    expiresAt: now + CAPABILITIES_CACHE_TTL_MS,
    promise,
  };
  capabilityCache = cached;

  return promise.catch((error: unknown) => {
    if (capabilityCache === cached) capabilityCache = null;
    throw error;
  });
}

function normalizedTerms(query: string): string[] {
  return query.toLowerCase().match(SEARCH_TERM_PATTERN) ?? [];
}

function tsToken(term: string, prefix: boolean): string {
  // normalizedTerms only returns Unicode letters and digits, so these values
  // cannot introduce tsquery operators or delimiters.
  return `${term}${prefix ? ":*" : ""}`;
}

function tsTerm(term: string, prefix: boolean): string {
  if (term === "ghg") {
    const ghg = tsToken("ghg", prefix);
    const greenhouse = tsToken("greenhouse", prefix);
    const gases = tsToken("gases", prefix);
    return `(${ghg} | (${greenhouse} & ${gases}))`;
  }
  return tsToken(term, prefix);
}

function buildTsQuery(query: string): {
  tsQuery: string;
  precedingTsQuery: string;
  lastTerm: string;
} {
  const terms = normalizedTerms(query);
  const lastIndex = terms.length - 1;
  return {
    tsQuery: terms.map((term, index) => tsTerm(term, index === lastIndex)).join(" & "),
    precedingTsQuery: terms
      .slice(0, lastIndex)
      .map((term) => tsTerm(term, false))
      .join(" & "),
    lastTerm: terms[lastIndex] ?? "",
  };
}

function escapeRegexTerm(term: string): string {
  return term.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

function buildLiteralRequiredPatterns(query: string): string[] {
  return normalizedTerms(query).map((term) =>
    term === "ghg" ? "ghg|greenhouse[[:space:]]+gases" : escapeRegexTerm(term),
  );
}

function buildLiteralPhrasePattern(query: string): string {
  return query
    .toLowerCase()
    .split(" ")
    .map(escapeRegexTerm)
    .join("[[:space:]]+");
}

function plainText(value: string | null | undefined, maxLength: number): string {
  const stripped = (value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(
      /&(?:amp|lt|gt|quot|apos|#39|#x27|#x[0-9a-f]+|#[0-9]+);/gi,
      (entity) => {
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
        try {
          return String.fromCodePoint(numeric);
        } catch {
          return " ";
        }
      },
    )
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();

  return Array.from(stripped).slice(0, maxLength).join("");
}

function safeUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizePublished(value: string | Date | null): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : null;
  }
  const normalized = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized)
    ? normalized
    : normalized.slice(0, 10) || null;
}

function mapArticleRow(row: ArticleSearchRow): EsgArticleSearchItem {
  const title = plainText(row.title, MAX_TITLE_LENGTH);
  const source = plainText(row.source, MAX_SOURCE_LENGTH);
  const matchedKeywords = plainText(row.matched_keywords, MAX_KEYWORDS_LENGTH);

  return {
    id: Number(row.id),
    title: title || "Untitled",
    source: source || null,
    published: normalizePublished(row.published),
    url: safeUrl(row.url),
    snippet: plainText(row.summary, MAX_SNIPPET_LENGTH),
    matched_keywords: matchedKeywords || null,
  };
}

function countValue(row: CountRow | undefined): number {
  if (!row) throw new Error("ESG article search count returned no row");
  const value = typeof row.total === "bigint" ? Number(row.total) : Number(row.total);
  if (!Number.isFinite(value) || value < 0) throw new Error("ESG article search count was invalid");
  return Math.min(Math.trunc(value), Number.MAX_SAFE_INTEGER);
}

function articleSearchKey(
  filters: ArticleSearchFilters,
  capabilities: SearchCapabilities,
  articleIds?: readonly number[],
): string {
  return JSON.stringify([filters, capabilities.typoTolerance, capabilities.hasFullTextIndex, articleIds ?? null]);
}

function cloneResponse(response: ArticleSearchResponse): ArticleSearchResponse {
  return { ...response, items: response.items.map((item) => ({ ...item })) };
}

function trimSuggestionCache(now: number): void {
  Array.from(suggestionCache.entries()).forEach(([key, entry]) => {
    if (entry.expiresAt <= now) suggestionCache.delete(key);
  });

  while (suggestionCache.size >= SUGGESTION_CACHE_MAX_ENTRIES) {
    const oldest = suggestionCache.keys().next().value;
    if (oldest === undefined) break;
    suggestionCache.delete(oldest);
  }
}

/**
 * Compatibility path for a database that has not applied the search
 * migration. It deliberately avoids constructing a tsvector over every
 * scraper summary. Every normalized term must occur in at least one indexed
 * field (or the unambiguous GHG alias group), so this path searches the full
 * corpus without sampling and keeps prefix-as-substring behavior available.
 */
async function executeLiteralSearch(
  filters: ArticleSearchFilters,
  capabilities: SearchCapabilities,
  suggest: boolean,
  articleIds?: readonly number[],
): Promise<ArticleSearchResponse> {
  const pageSize = suggest ? ARTICLE_SEARCH_SUGGEST_PAGE_SIZE : ARTICLE_SEARCH_PAGE_SIZE;
  const limit = pageSize + (suggest ? 1 : 0);
  const offset = suggest ? 0 : (filters.page - 1) * ARTICLE_SEARCH_PAGE_SIZE;
  const articleIdFilterEnabled = articleIds !== undefined;
  const articleIdList = articleIds ?? [];
  const requiredPatterns = buildLiteralRequiredPatterns(filters.q);
  const scorePattern = `(${requiredPatterns.join("|")})`;
  const phrasePattern = buildLiteralPhrasePattern(filters.q);

  return withReadOnlyTransaction(async (tx) => {
    const rows = await tx.$queryRaw<ArticleSearchRow[]>`
      WITH literal_matches AS (
        SELECT
          a.id,
          a.title,
          a.source,
          a.published::text AS published,
          a.link AS url,
          a.summary,
          a.matched_keywords,
          COALESCE(a.published, a.save_time::date) AS article_date,
          (
            CASE WHEN lower(COALESCE(a.title, '')) ~ ${scorePattern} THEN 8 ELSE 0 END
            + CASE WHEN lower(COALESCE(a.summary, '')) ~ ${scorePattern} THEN 4 ELSE 0 END
            + CASE WHEN lower(COALESCE(a.matched_keywords, '')) ~ ${scorePattern} THEN 3 ELSE 0 END
            + CASE WHEN lower(COALESCE(a.source, '')) ~ ${scorePattern} THEN 2 ELSE 0 END
            + CASE WHEN searchable.search_text ~ ${phrasePattern} THEN 1 ELSE 0 END
          ) AS relevance
        FROM esg_articles AS a
        CROSS JOIN LATERAL (
          SELECT lower(concat_ws(
            ' ',
            COALESCE(a.title, ''),
            COALESCE(a.summary, ''),
            COALESCE(a.matched_keywords, ''),
            COALESCE(a.source, '')
          )) AS search_text
        ) AS searchable
        WHERE (${filters.source} = '' OR a.source = ${filters.source})
          AND (${articleIdFilterEnabled} = FALSE OR a.id = ANY(${articleIdList}::int[]))
          AND (
            ${filters.from} = ''
            OR COALESCE(a.published, a.save_time::date) >= CAST(NULLIF(${filters.from}, '') AS date)
          )
          AND (
            ${filters.to} = ''
            OR COALESCE(a.published, a.save_time::date) <= CAST(NULLIF(${filters.to}, '') AS date)
          )
          AND NOT EXISTS (
            SELECT 1
            FROM unnest(CAST(${requiredPatterns} AS text[])) AS required(pattern)
            WHERE searchable.search_text !~ required.pattern
          )
      )
      SELECT id, title, source, published, url, summary, matched_keywords
      FROM literal_matches
      ORDER BY
        CASE WHEN ${filters.sort === "relevance"} THEN relevance END DESC NULLS LAST,
        article_date DESC NULLS LAST,
        id DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    if (suggest) {
      return {
        items: rows.slice(0, pageSize).map(mapArticleRow),
        total: null,
        page: filters.page,
        pageSize,
        hasMore: rows.length > pageSize,
        query: filters.q,
        typoTolerance: capabilities.typoTolerance,
      };
    }

    const countRows = await tx.$queryRaw<CountRow[]>`
      SELECT COUNT(*)::bigint AS total
      FROM esg_articles AS a
      CROSS JOIN LATERAL (
        SELECT lower(concat_ws(
          ' ',
          COALESCE(a.title, ''),
          COALESCE(a.summary, ''),
          COALESCE(a.matched_keywords, ''),
          COALESCE(a.source, '')
        )) AS search_text
      ) AS searchable
      WHERE (${filters.source} = '' OR a.source = ${filters.source})
        AND (${articleIdFilterEnabled} = FALSE OR a.id = ANY(${articleIdList}::int[]))
        AND (
          ${filters.from} = ''
          OR COALESCE(a.published, a.save_time::date) >= CAST(NULLIF(${filters.from}, '') AS date)
        )
        AND (
          ${filters.to} = ''
          OR COALESCE(a.published, a.save_time::date) <= CAST(NULLIF(${filters.to}, '') AS date)
        )
        AND NOT EXISTS (
          SELECT 1
          FROM unnest(CAST(${requiredPatterns} AS text[])) AS required(pattern)
          WHERE searchable.search_text !~ required.pattern
        )
    `;
    const total = countValue(countRows[0]);

    return {
      items: rows.map(mapArticleRow),
      total,
      page: filters.page,
      pageSize,
      hasMore: filters.page * pageSize < total,
      query: filters.q,
      typoTolerance: capabilities.typoTolerance,
    };
  });
}

async function executeSearch(
  filters: ArticleSearchFilters,
  capabilities: SearchCapabilities,
  suggest: boolean,
  articleIds?: readonly number[],
): Promise<ArticleSearchResponse> {
  const pageSize = suggest ? ARTICLE_SEARCH_SUGGEST_PAGE_SIZE : ARTICLE_SEARCH_PAGE_SIZE;
  const limit = pageSize + (suggest ? 1 : 0);
  const offset = suggest ? 0 : (filters.page - 1) * ARTICLE_SEARCH_PAGE_SIZE;
  const articleIdFilterEnabled = articleIds !== undefined;
  const articleIdList = articleIds ?? [];
  const hasQuery = Boolean(filters.q);
  const { tsQuery, precedingTsQuery, lastTerm } = hasQuery
    ? buildTsQuery(filters.q)
    : { tsQuery: "", precedingTsQuery: "", lastTerm: "" };
  const fuzzyEnabled = capabilities.typoTolerance && Boolean(lastTerm);

  if (hasQuery && !capabilities.hasFullTextIndex) {
    return executeLiteralSearch(filters, capabilities, suggest, articleIds);
  }

  return withReadOnlyTransaction(async (tx) => {
    if (!hasQuery) {
      const rows = await tx.$queryRaw<ArticleSearchRow[]>`
        SELECT
          a.id,
          a.title,
          a.source,
          a.published::text AS published,
          a.link AS url,
          a.summary,
          a.matched_keywords
        FROM esg_articles AS a
        WHERE (${filters.source} = '' OR a.source = ${filters.source})
          AND (${articleIdFilterEnabled} = FALSE OR a.id = ANY(${articleIdList}::int[]))
          AND (
            ${filters.from} = ''
            OR COALESCE(a.published, a.save_time::date) >= CAST(NULLIF(${filters.from}, '') AS date)
          )
          AND (
            ${filters.to} = ''
            OR COALESCE(a.published, a.save_time::date) <= CAST(NULLIF(${filters.to}, '') AS date)
          )
        ORDER BY COALESCE(a.published, a.save_time::date) DESC NULLS LAST, a.id DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `;

      if (suggest) {
        return {
          items: rows.slice(0, pageSize).map(mapArticleRow),
          total: null,
          page: filters.page,
          pageSize,
          hasMore: rows.length > pageSize,
          query: filters.q,
          typoTolerance: capabilities.typoTolerance,
        };
      }

      const countRows = await tx.$queryRaw<CountRow[]>`
        SELECT COUNT(*)::bigint AS total
        FROM esg_articles AS a
        WHERE (${filters.source} = '' OR a.source = ${filters.source})
          AND (${articleIdFilterEnabled} = FALSE OR a.id = ANY(${articleIdList}::int[]))
          AND (
            ${filters.from} = ''
            OR COALESCE(a.published, a.save_time::date) >= CAST(NULLIF(${filters.from}, '') AS date)
          )
          AND (
            ${filters.to} = ''
            OR COALESCE(a.published, a.save_time::date) <= CAST(NULLIF(${filters.to}, '') AS date)
          )
      `;
      const total = countValue(countRows[0]);

      return {
        items: rows.map(mapArticleRow),
        total,
        page: filters.page,
        pageSize,
        hasMore: filters.page * pageSize < total,
        query: filters.q,
        typoTolerance: capabilities.typoTolerance,
      };
    }

    const matches = fuzzyEnabled
      ? await tx.$queryRaw<ArticleSearchRow[]>`
          WITH article_search AS (
            SELECT
              a.id,
              a.title,
              a.source,
              a.published::text AS published,
              a.link AS url,
              a.summary,
              a.matched_keywords,
              COALESCE(a.published, a.save_time::date) AS article_date,
              setweight(to_tsvector('simple'::regconfig, COALESCE(a.title, '')), 'A')
                || setweight(to_tsvector('simple'::regconfig, COALESCE(a.summary, '')), 'B')
                || setweight(to_tsvector('simple'::regconfig, COALESCE(a.matched_keywords, '')), 'C')
                || setweight(to_tsvector('simple'::regconfig, COALESCE(a.source, '')), 'D')
                AS search_document
            FROM esg_articles AS a
          ), ranked AS (
            SELECT
              article_search.*,
              ts_rank_cd(
                article_search.search_document,
                to_tsquery('simple'::regconfig, ${tsQuery}),
                32
              )
              + CASE
                  WHEN article_search.search_document @@ phraseto_tsquery('simple'::regconfig, ${filters.q})
                    THEN 0.35
                  ELSE 0
                END
              + CASE
                  WHEN lower(${lastTerm}) <% lower(COALESCE(article_search.title, ''))
                    THEN word_similarity(lower(${lastTerm}), lower(COALESCE(article_search.title, ''))) * 0.35
                  ELSE 0
                END AS relevance
            FROM article_search
            WHERE (${filters.source} = '' OR article_search.source = ${filters.source})
              AND (${articleIdFilterEnabled} = FALSE OR article_search.id = ANY(${articleIdList}::int[]))
              AND (
                ${filters.from} = ''
                OR article_search.article_date >= CAST(NULLIF(${filters.from}, '') AS date)
              )
              AND (
                ${filters.to} = ''
                OR article_search.article_date <= CAST(NULLIF(${filters.to}, '') AS date)
              )
              AND (
                article_search.search_document @@ to_tsquery('simple'::regconfig, ${tsQuery})
                OR (
                  (
                    ${precedingTsQuery} = ''
                    OR article_search.search_document @@ to_tsquery('simple'::regconfig, ${precedingTsQuery})
                  )
                  AND lower(${lastTerm}) <% lower(COALESCE(article_search.title, ''))
                )
              )
          )
          SELECT id, title, source, published, url, summary, matched_keywords
          FROM ranked
          ORDER BY
            CASE WHEN ${filters.sort === "relevance"} THEN relevance END DESC NULLS LAST,
            article_date DESC NULLS LAST,
            id DESC
          LIMIT ${limit}
          OFFSET ${offset}
        `
      : await tx.$queryRaw<ArticleSearchRow[]>`
          WITH article_search AS (
            SELECT
              a.id,
              a.title,
              a.source,
              a.published::text AS published,
              a.link AS url,
              a.summary,
              a.matched_keywords,
              COALESCE(a.published, a.save_time::date) AS article_date,
              setweight(to_tsvector('simple'::regconfig, COALESCE(a.title, '')), 'A')
                || setweight(to_tsvector('simple'::regconfig, COALESCE(a.summary, '')), 'B')
                || setweight(to_tsvector('simple'::regconfig, COALESCE(a.matched_keywords, '')), 'C')
                || setweight(to_tsvector('simple'::regconfig, COALESCE(a.source, '')), 'D')
                AS search_document
            FROM esg_articles AS a
          ), ranked AS (
            SELECT
              article_search.*,
              ts_rank_cd(
                article_search.search_document,
                to_tsquery('simple'::regconfig, ${tsQuery}),
                32
              )
              + CASE
                  WHEN article_search.search_document @@ phraseto_tsquery('simple'::regconfig, ${filters.q})
                    THEN 0.35
                  ELSE 0
                END AS relevance
            FROM article_search
            WHERE (${filters.source} = '' OR article_search.source = ${filters.source})
              AND (${articleIdFilterEnabled} = FALSE OR article_search.id = ANY(${articleIdList}::int[]))
              AND (
                ${filters.from} = ''
                OR article_search.article_date >= CAST(NULLIF(${filters.from}, '') AS date)
              )
              AND (
                ${filters.to} = ''
                OR article_search.article_date <= CAST(NULLIF(${filters.to}, '') AS date)
              )
              AND article_search.search_document @@ to_tsquery('simple'::regconfig, ${tsQuery})
          )
          SELECT id, title, source, published, url, summary, matched_keywords
          FROM ranked
          ORDER BY
            CASE WHEN ${filters.sort === "relevance"} THEN relevance END DESC NULLS LAST,
            article_date DESC NULLS LAST,
            id DESC
          LIMIT ${limit}
          OFFSET ${offset}
        `;

    if (suggest) {
      return {
        items: matches.slice(0, pageSize).map(mapArticleRow),
        total: null,
        page: filters.page,
        pageSize,
        hasMore: matches.length > pageSize,
        query: filters.q,
        typoTolerance: capabilities.typoTolerance,
      };
    }

    const countRows = fuzzyEnabled
      ? await tx.$queryRaw<CountRow[]>`
          WITH article_search AS (
            SELECT
              a.id,
              a.title,
              a.source,
              COALESCE(a.published, a.save_time::date) AS article_date,
              setweight(to_tsvector('simple'::regconfig, COALESCE(a.title, '')), 'A')
                || setweight(to_tsvector('simple'::regconfig, COALESCE(a.summary, '')), 'B')
                || setweight(to_tsvector('simple'::regconfig, COALESCE(a.matched_keywords, '')), 'C')
                || setweight(to_tsvector('simple'::regconfig, COALESCE(a.source, '')), 'D')
                AS search_document
            FROM esg_articles AS a
          )
          SELECT COUNT(*)::bigint AS total
          FROM article_search
          WHERE (${filters.source} = '' OR article_search.source = ${filters.source})
            AND (${articleIdFilterEnabled} = FALSE OR article_search.id = ANY(${articleIdList}::int[]))
            AND (
              ${filters.from} = ''
              OR article_search.article_date >= CAST(NULLIF(${filters.from}, '') AS date)
            )
            AND (
              ${filters.to} = ''
              OR article_search.article_date <= CAST(NULLIF(${filters.to}, '') AS date)
            )
            AND (
              article_search.search_document @@ to_tsquery('simple'::regconfig, ${tsQuery})
                OR (
                  (
                    ${precedingTsQuery} = ''
                    OR article_search.search_document @@ to_tsquery('simple'::regconfig, ${precedingTsQuery})
                  )
                  AND lower(${lastTerm}) <% lower(COALESCE(article_search.title, ''))
                )
            )
        `
      : await tx.$queryRaw<CountRow[]>`
          WITH article_search AS (
            SELECT
              a.id,
              a.title,
              a.source,
              COALESCE(a.published, a.save_time::date) AS article_date,
              setweight(to_tsvector('simple'::regconfig, COALESCE(a.title, '')), 'A')
                || setweight(to_tsvector('simple'::regconfig, COALESCE(a.summary, '')), 'B')
                || setweight(to_tsvector('simple'::regconfig, COALESCE(a.matched_keywords, '')), 'C')
                || setweight(to_tsvector('simple'::regconfig, COALESCE(a.source, '')), 'D')
                AS search_document
            FROM esg_articles AS a
          )
          SELECT COUNT(*)::bigint AS total
          FROM article_search
          WHERE (${filters.source} = '' OR article_search.source = ${filters.source})
            AND (${articleIdFilterEnabled} = FALSE OR article_search.id = ANY(${articleIdList}::int[]))
            AND (
              ${filters.from} = ''
              OR article_search.article_date >= CAST(NULLIF(${filters.from}, '') AS date)
            )
            AND (
              ${filters.to} = ''
              OR article_search.article_date <= CAST(NULLIF(${filters.to}, '') AS date)
            )
            AND article_search.search_document @@ to_tsquery('simple'::regconfig, ${tsQuery})
        `;
    const total = countValue(countRows[0]);

    return {
      items: matches.map(mapArticleRow),
      total,
      page: filters.page,
      pageSize,
      hasMore: filters.page * pageSize < total,
      query: filters.q,
      typoTolerance: capabilities.typoTolerance,
    };
  });
}

export async function searchEsgArticles(
  filters: ArticleSearchFilters,
  options?: { suggest?: boolean; articleIds?: readonly number[] },
): Promise<ArticleSearchResponse> {
  const suggest = options?.suggest === true;
  const articleIds = options?.articleIds;
  if (articleIds?.length === 0) {
    return {
      items: [],
      total: 0,
      page: filters.page,
      pageSize: suggest ? ARTICLE_SEARCH_SUGGEST_PAGE_SIZE : ARTICLE_SEARCH_PAGE_SIZE,
      hasMore: false,
      query: filters.q,
      typoTolerance: false,
    };
  }
  const capabilities = await getSearchCapabilities();

  if (!suggest) return executeSearch(filters, capabilities, false, articleIds);

  const key = articleSearchKey(filters, capabilities, articleIds);
  const now = Date.now();
  trimSuggestionCache(now);

  const cached = suggestionCache.get(key);
  if (cached && cached.expiresAt > now) return cloneResponse(cached.response);

  const existing = suggestionInFlight.get(key);
  if (existing) return cloneResponse(await existing);

  const promise = executeSearch(filters, capabilities, true, articleIds).then((response) => {
    trimSuggestionCache(Date.now());
    suggestionCache.set(key, {
      expiresAt: Date.now() + SUGGESTION_CACHE_TTL_MS,
      response,
    });
    return response;
  });

  if (suggestionInFlight.size >= SUGGESTION_CACHE_MAX_ENTRIES) {
    const oldestInFlight = Array.from(suggestionInFlight.keys())[0];
    if (oldestInFlight !== undefined) suggestionInFlight.delete(oldestInFlight);
  }
  suggestionInFlight.set(key, promise);

  try {
    return cloneResponse(await promise);
  } finally {
    if (suggestionInFlight.get(key) === promise) suggestionInFlight.delete(key);
  }
}

/** Test-only cache reset; production code has no caller for this export. */
export function resetEsgArticleSearchCachesForTests(): void {
  capabilityCache = null;
  suggestionCache.clear();
  suggestionInFlight.clear();
}
