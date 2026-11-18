"use client";

import { useMemo } from "react";
import EsgArticleSearch from "./EsgArticleSearch";
import type {
  ArticleSearchFilters,
  EsgArticleSearchItem,
} from "@/lib/esg-article-search/types";
import {
  creditArticleSearchParams,
} from "@/lib/credit-article-search/query";
import type { CreditArticleSearchFilters } from "@/lib/credit-article-search/types";

type CreditArticleSearchProps = {
  filters: CreditArticleSearchFilters;
  sources: string[];
};

/**
 * The Credit archive uses the same keyboard-safe, debounced search surface as
 * ESG, but keeps its API, URL state and detail links namespaced to Credit.
 */
export default function CreditArticleSearch({
  filters,
  sources,
}: CreditArticleSearchProps) {
  const extraQueryParams = useMemo(
    () => ({
      region: filters.region || undefined,
      sector: filters.sector || undefined,
    }),
    [filters.region, filters.sector],
  );

  const searchParamsBuilder = useMemo(
    () => (baseFilters: ArticleSearchFilters) =>
      creditArticleSearchParams({
        ...baseFilters,
        region: filters.region,
        sector: filters.sector,
      }),
    [filters.region, filters.sector],
  );

  const itemPathBuilder = useMemo(
    () => (item: EsgArticleSearchItem, nextFilters: ArticleSearchFilters, typedQuery: string) => {
      const backUrl = `/credit/articles?${creditArticleSearchParams({
        ...nextFilters,
        q: typedQuery,
        page: 1,
        region: filters.region,
        sector: filters.sector,
      }).toString()}`;
      return `/credit/articles/${encodeURIComponent(String(item.id))}?back=${encodeURIComponent(backUrl)}`;
    },
    [filters.region, filters.sector],
  );

  return (
    <EsgArticleSearch
      filters={filters}
      sources={sources}
      apiPath="/api/credit/articles/search"
      basePath="/credit/articles"
      archiveLabel="Credit Rating archive"
      placeholder="Try sovereign ratings, banks, outlook, or BBB-"
      searchParamsBuilder={searchParamsBuilder}
      itemPathBuilder={itemPathBuilder}
      extraQueryParams={extraQueryParams}
      testId="credit-article-search"
    />
  );
}

export type { CreditArticleSearchProps };
