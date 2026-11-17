export const ARTICLE_SEARCH_PAGE_SIZE = 15;
export const ARTICLE_SEARCH_SUGGEST_PAGE_SIZE = 6;
export const ARTICLE_SEARCH_MAX_PAGE = 100_000;

export type ArticleSearchSort = "relevance" | "newest";

export interface ArticleSearchFilters {
  q: string;
  source: string;
  from: string;
  to: string;
  sort: ArticleSearchSort;
  page: number;
}

export interface EsgArticleSearchItem {
  id: number;
  title: string;
  source: string | null;
  published: string | null;
  url: string | null;
  snippet: string;
  matched_keywords: string | null;
}

export interface ArticleSearchResponse {
  items: EsgArticleSearchItem[];
  total: number | null;
  page: number;
  pageSize: number;
  hasMore: boolean;
  query: string;
  typoTolerance: boolean;
}
