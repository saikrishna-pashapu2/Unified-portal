import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Factory,
  FileText,
  Globe2,
  Landmark,
  Map as MapIcon,
  Puzzle,
  Scale,
  ChevronDown,
} from "lucide-react";
import { type CreditRegion, type CreditSector } from "@/lib/credit-articles";
import { searchCreditArticles } from "@/lib/credit-article-search/repository";
import {
  creditArticleSearchParams,
  parseCreditArticleSearchParams,
} from "@/lib/credit-article-search/query";
import type { CreditArticleSearchFilters } from "@/lib/credit-article-search/types";
import { fetchCreditSources } from "@/lib/articles";
import CreditArticlesHeader from "@/components/articles/CreditArticlesHeader";
import CreditArticleRowCard from "@/components/articles/CreditArticleRowCard";
import CreditArticleSearch from "@/components/articles/CreditArticleSearch";
import ArticleAiProvider from "@/components/articles/ArticleAiProvider";
import ArticleAiControls from "@/components/articles/ArticleAiControls";
import { getLikeCounts, getUserLikedSet } from "@/lib/likes";
import { requireUserSession } from "@/lib/api-auth";

type SearchParams = {
  q?: string;
  region?: string;
  sector?: string;
  source?: string;
  page?: string;
  from?: string;
  to?: string;
  sort?: string;
  date?: string;
  dateFrom?: string;
  dateTo?: string;
};

type RegionItem = {
  key: CreditRegion;
  label: string;
  icon: ReactNode;
};

type SectorItem = {
  key: CreditSector;
  label: string;
  icon: ReactNode;
};

const REGIONS: readonly RegionItem[] = [
  { key: "global", label: "Global", icon: <Globe2 className="h-4 w-4" aria-hidden="true" /> },
  { key: "MiddleEast", label: "Middle East", icon: <MapIcon className="h-4 w-4" aria-hidden="true" /> },
  { key: "CentralAsia", label: "Central Asia", icon: <Landmark className="h-4 w-4" aria-hidden="true" /> },
];

const SECTORS: readonly SectorItem[] = [
  { key: "sovereigns", label: "Sovereigns", icon: <Scale className="h-4 w-4" aria-hidden="true" /> },
  { key: "sovereignsRACS", label: "Sovereigns Rating Actions", icon: <FileText className="h-4 w-4" aria-hidden="true" /> },
  { key: "banks", label: "Financial Institutions", icon: <Building2 className="h-4 w-4" aria-hidden="true" /> },
  { key: "banksRACS", label: "Financial Institutions Rating Actions", icon: <FileText className="h-4 w-4" aria-hidden="true" /> },
  { key: "corporates", label: "Corporates", icon: <Factory className="h-4 w-4" aria-hidden="true" /> },
  { key: "corporatesRACS", label: "Corporates Rating Actions", icon: <FileText className="h-4 w-4" aria-hidden="true" /> },
];

function href(base: string, params: Record<string, string | undefined>) {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) sp.set(key, value);
  });
  const query = sp.toString();
  return query ? `${base}?${query}` : base;
}

function resolveRegion(value: string | undefined): CreditRegion | undefined {
  const match = REGIONS.find((r) => r.key === value);
  return match?.key;
}

function resolveSector(value: string | undefined): CreditSector | undefined {
  const match = SECTORS.find((s) => s.key === value);
  return match?.key;
}

function getRegionMeta(region: CreditRegion | undefined) {
  if (!region) {
    return { key: "all" as const, label: "All Regions", icon: <Globe2 className="h-4 w-4" aria-hidden="true" /> };
  }
  return REGIONS.find((r) => r.key === region) ?? REGIONS[0];
}

export const revalidate = 0;

const articleDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  year: "numeric",
  month: "short",
  day: "numeric",
});

function formatDisplayDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return null;
  return articleDateFormatter.format(date);
}

export default async function CreditArticlesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const auth = await requireUserSession();
  if (auth.response) {
    redirect(`/signin?callbackUrl=${encodeURIComponent("/credit/articles")}`);
  }
  const resolvedSearchParams = await searchParams;
  const userId = auth.userId;
  const parsedSearch = parseCreditArticleSearchParams(resolvedSearchParams);
  const searchFilters: CreditArticleSearchFilters = parsedSearch.ok ? parsedSearch.filters : {
    q: "", region: "", sector: "", source: "", from: "", to: "", sort: "newest", page: 1,
  };
  const selectedRegion = searchFilters.region || undefined;
  const selectedSector = searchFilters.sector || undefined;
  const selectedSource = searchFilters.source || undefined;
  const { page, from: selectedDateFrom, to: selectedDateTo } = searchFilters;
  const [sourceData, archive] = await Promise.allSettled([
    parsedSearch.ok ? fetchCreditSources({ region: selectedRegion, sector: selectedSector }) : Promise.resolve([]),
    parsedSearch.ok ? searchCreditArticles(searchFilters) : Promise.resolve(null),
  ]);
  const sourcesUnavailable = sourceData.status === "rejected";
  const sources = sourceData.status === "fulfilled" ? sourceData.value : [];
  const sourceOptions = Array.from(
    new Set([...sources, ...(selectedSource ? [selectedSource] : [])]),
  ).sort((a, b) => a.localeCompare(b));

  const searchResult = archive.status === "fulfilled" ? archive.value : null;
  const searchUnavailable = archive.status === "rejected"
    ? "The Credit Rating archive is temporarily unavailable. Please try again in a moment." : null;
  const searchError = parsedSearch.ok ? null : parsedSearch.error;
  const items = searchResult
    ? searchResult.items.map((item) => ({
        id: item.id,
        title: item.title,
        source: item.source,
        date: item.published ? new Date(item.published) : null,
        link: item.url,
        snippet: item.snippet,
        // Keep null/unknown values neutral instead of inferring a default
        // region or sector from the active sidebar filter.
        region: resolveRegion(item.region ?? undefined),
        sector: resolveSector(item.sector ?? undefined),
        matched_keywords: item.matched_keywords,
      }))
    : [];
  const total = searchResult?.total ?? 0;
  const pageSize = searchResult?.pageSize ?? 15;

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const articleIds = items
    .map((article) => Number(article.id))
    .filter((id) => Number.isFinite(id));

  let likeCounts: Record<number, number> = {};
  let userLikedSet = new Set<number>();
  try {
    [likeCounts, userLikedSet] = await Promise.all([
      getLikeCounts("credit", "article", articleIds),
      getUserLikedSet("credit", userId, "article", articleIds),
    ]);
  } catch {
    // Like metadata is ancillary; keep the archive readable if it is down.
  }
  const canonicalSearchParams = creditArticleSearchParams({
    ...searchFilters,
    page: 1,
  });
  const searchStateParams = {
    q: canonicalSearchParams.get("q") ?? undefined,
    from: canonicalSearchParams.get("from") ?? undefined,
    to: canonicalSearchParams.get("to") ?? undefined,
    sort: canonicalSearchParams.get("sort") ?? undefined,
  };
  
  // Create display label for the date(s)
  let selectedDateLabel: string;
  if (selectedDateFrom && selectedDateFrom === selectedDateTo) {
    selectedDateLabel = formatDisplayDate(selectedDateFrom) ?? selectedDateFrom;
  } else if (selectedDateFrom && selectedDateTo) {
    selectedDateLabel = `${formatDisplayDate(selectedDateFrom) ?? selectedDateFrom} - ${formatDisplayDate(selectedDateTo) ?? selectedDateTo}`;
  } else if (selectedDateFrom) {
    selectedDateLabel = `From ${formatDisplayDate(selectedDateFrom) ?? selectedDateFrom}`;
  } else if (selectedDateTo) {
    selectedDateLabel = `Up to ${formatDisplayDate(selectedDateTo) ?? selectedDateTo}`;
  } else {
    selectedDateLabel = "All dates";
  }
  
  const regionMeta = getRegionMeta(selectedRegion);

  const prevPage = page > 1 ? String(page - 1) : undefined;
  const nextPage = page < pageCount ? String(page + 1) : undefined;
  const prevDisabled = page <= 1;
  const nextDisabled = page >= pageCount;

  const filtersNode = <ArticleAiControls domain="credit" className="mt-4" />;

  return (
    <ArticleAiProvider
      domain="credit"
      articleIds={articleIds}
      isAuthenticated={userId > 0}
    >
    <div className="container mx-auto px-4 py-8 md:px-6">
      <div className="mt-6 grid grid-cols-12 gap-6">
        <aside className="col-span-12 md:col-span-3">
          <div className="rounded-2xl border border-border bg-card p-4 text-card-foreground shadow-sm">
            <div className="flex items-center gap-2 text-lg font-semibold">
              <Puzzle className="h-5 w-5" aria-hidden="true" />
              <span>Sections</span>
            </div>

            <div className="mt-4 space-y-3">
              {/* All Regions option (no filter) */}
              <Link
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${
                  !selectedRegion
                    ? "border-primary/30 bg-primary/10 text-primary"
                    : "border-border bg-card text-card-foreground hover:bg-muted"
                }`}
                href={href("/credit/articles", {
                  source: selectedSource,
                  ...searchStateParams,
                })}
              >
                <Globe2 className="h-4 w-4" aria-hidden="true" />
                <span>All Regions</span>
              </Link>

              {REGIONS.map((region) => (
                <div key={region.key}>
                  {region.key === "global" ? (
                    <Link
                      className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${
                        selectedRegion === region.key
                          ? "border-primary/30 bg-primary/10 text-primary"
                          : "border-border bg-card text-card-foreground hover:bg-muted"
                      }`}
                      href={href("/credit/articles", {
                        region: region.key,
                        source: selectedSource,
                        ...searchStateParams,
                      })}
                    >
                      {region.icon}
                      <span>{region.label}</span>
                    </Link>
                  ) : (
                    <details
                      className="group rounded-xl border border-border bg-card"
                      open={selectedRegion === region.key}
                    >
                      <summary
                        className={`flex cursor-pointer list-none items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm font-medium ${
                          selectedRegion === region.key
                            ? "bg-primary/10 text-primary"
                            : "text-card-foreground hover:bg-muted"
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          {region.icon}
                          <span>{region.label}</span>
                        </span>
                        <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:-rotate-180" />
                      </summary>

                      <div className="space-y-2 px-3 pb-3 pt-2">
                        <Link
                          className={`block rounded-lg border px-3 py-2 text-sm ${
                            selectedRegion === region.key && !selectedSector
                              ? "border-primary/30 bg-primary/10 text-primary"
                              : "border-border bg-card text-card-foreground hover:bg-muted"
                          }`}
                          href={href("/credit/articles", {
                            region: region.key,
                            source: selectedSource,
                            ...searchStateParams,
                          })}
                        >
                          View all {region.label}
                        </Link>
                        {SECTORS.map((sector) => (
                          <Link
                            key={`${region.key}-${sector.key}`}
                            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                              selectedRegion === region.key && selectedSector === sector.key
                                ? "border-primary/30 bg-primary/10 text-primary"
                                : "border-border bg-card text-card-foreground hover:bg-muted"
                            }`}
                            href={href("/credit/articles", {
                              region: region.key,
                              sector: sector.key,
                              source: selectedSource,
                              ...searchStateParams,
                            })}
                          >
                            {sector.icon}
                            <span>{sector.label}</span>
                          </Link>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              ))}
            </div>
          </div>
        </aside>

        <main className="col-span-12 md:col-span-9">
          <CreditArticleSearch filters={searchFilters} sources={sourceOptions} />
          <div className="h-5" aria-hidden="true" />
          <CreditArticlesHeader
            regionLabel={regionMeta.label}
            dateLabel={selectedDateLabel}
            total={searchResult ? total : null}
            page={page}
            pageCount={pageCount}
            filters={filtersNode}
            showAllRegions={!selectedRegion}
          />

          {sourcesUnavailable && searchResult ? (
            <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="status">
              Source filters are temporarily unavailable. The archive results are still available; please try again later for the full source list.
            </div>
          ) : null}

          {searchUnavailable ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-900" role="alert">
              {searchUnavailable}
            </div>
          ) : searchError ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900" role="alert">
              {searchError}
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-2xl border border-border bg-card p-10 text-center text-base text-card-foreground">
              No articles found for the selected filters.
            </div>
          ) : (
            <div className="space-y-4">
              {items.map((article) => {
                const dateLabel = formatDisplayDate(article.date) ?? "No date";
                const regionLabel = article.region
                  ? getRegionMeta(article.region).label
                  : "Region unavailable";
                const sectorLabel =
                  SECTORS.find((sector) => sector.key === article.sector)?.label ??
                  (article.sector ? article.sector : "Sector unavailable");
                
                const articleId = Number(article.id);
                const isValidId = Number.isFinite(articleId);

                const backParams = new URLSearchParams();
                if (selectedRegion) backParams.set('region', selectedRegion);
                if (selectedSector) backParams.set('sector', selectedSector);
                if (selectedSource) backParams.set('source', selectedSource);
                Object.entries(searchStateParams).forEach(([key, value]) => {
                  if (value) backParams.set(key, value);
                });
                if (page > 1) backParams.set('page', String(page));
                const backQuery = backParams.toString();
                const articleDetailHref = backQuery 
                  ? `/credit/articles/${article.id}?back=${encodeURIComponent(`/credit/articles?${backQuery}`)}`
                  : `/credit/articles/${article.id}`;

                return (
                  <CreditArticleRowCard
                    key={article.id}
                    title={article.title}
                    detailHref={articleDetailHref}
                    externalHref={article.link}
                    source={article.source}
                    dateLabel={dateLabel}
                    regionLabel={regionLabel}
                    sectorLabel={sectorLabel}
                    matchedKeywords={article.matched_keywords}
                    highlightQuery={searchFilters.q}
                    snippet={article.snippet}
                    articleId={isValidId ? articleId : undefined}
                    initialLiked={isValidId ? userLikedSet.has(articleId) : false}
                    initialLikeCount={isValidId ? likeCounts[articleId] ?? 0 : 0}
                  />
                );
              })}
            </div>
          )}

          {pageCount > 1 && (
            <div className="mt-8 flex items-center justify-center gap-2">
              <Link
                href={href("/credit/articles", {
                  region: selectedRegion,
                  sector: selectedSector,
                  source: selectedSource,
                  page: prevPage,
                  ...searchStateParams,
                })}
                className={`flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm ${
                  prevDisabled
                    ? "pointer-events-none bg-muted text-muted-foreground opacity-60"
                    : "bg-card text-card-foreground hover:bg-muted"
                }`}
                aria-disabled={prevDisabled}
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                <span>Prev</span>
              </Link>
              <span className="text-sm text-muted-foreground">
                Page {page} / {pageCount}
              </span>
              <Link
                href={href("/credit/articles", {
                  region: selectedRegion,
                  sector: selectedSector,
                  source: selectedSource,
                  page: nextPage,
                  ...searchStateParams,
                })}
                className={`flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm ${
                  nextDisabled
                    ? "pointer-events-none bg-muted text-muted-foreground opacity-60"
                    : "bg-card text-card-foreground hover:bg-muted"
                }`}
                aria-disabled={nextDisabled}
              >
                <span>Next</span>
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
          )}
        </main>
      </div>
    </div>
    </ArticleAiProvider>
  );
}
