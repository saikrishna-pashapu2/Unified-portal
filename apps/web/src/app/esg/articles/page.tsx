import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowUpRight,
  Building2,
  CalendarDays,
  Clock3,
  Filter,
  Leaf,
  Newspaper,
  Shield,
  TrendingUp,
  Users,
} from "lucide-react";
import ArticleAiControls from "@/components/articles/ArticleAiControls";
import ArticleAiOnlyFilter from "@/components/articles/ArticleAiOnlyFilter";
import ArticleAiProvider from "@/components/articles/ArticleAiProvider";
import ArticleAiSelection from "@/components/articles/ArticleAiSelection";
import ArticleSearchHighlight from "@/components/articles/ArticleSearchHighlight";
import ArticlesPaginator from "@/components/articles/ArticlesPaginator";
import EsgArticleSearch from "@/components/articles/EsgArticleSearch";
import LikeButton from "@/components/LikeButton";
import { fetchSources } from "@/lib/articles";
import { requireUserSession } from "@/lib/api-auth";
import { getLikeCounts, getUserLikedSet } from "@/lib/likes";
import { parseKeywords } from "@/lib/keywords";
import { getDailyArticlePickIds } from "@/lib/article-ai/daily-feed";
import { articleSearchParams, parseArticleSearchParams } from "@/lib/esg-article-search/query";
import { searchEsgArticles } from "@/lib/esg-article-search/repository";
import type {
  ArticleSearchFilters,
  ArticleSearchResponse,
  EsgArticleSearchItem,
} from "@/lib/esg-article-search/types";

export const revalidate = 0;

const PAGE_SIZE = 15;
const EMPTY_FILTERS: ArticleSearchFilters = {
  q: "",
  source: "",
  from: "",
  to: "",
  sort: "relevance",
  page: 1,
};

type ArticlePageSearchParams = Record<string, string | string[] | undefined>;

function hasAiOnlyFilter(searchParams: ArticlePageSearchParams) {
  const value = searchParams.ai;
  const normalized = Array.isArray(value) ? value[0] : value;
  return normalized === "1" || normalized === "true";
}

function emptySearchResponse(filters: ArticleSearchFilters): ArticleSearchResponse {
  return {
    items: [],
    total: 0,
    page: filters.page,
    pageSize: PAGE_SIZE,
    hasMore: false,
    query: filters.q,
    typoTolerance: false,
  };
}

function resultCountLabel(result: ArticleSearchResponse, filters: ArticleSearchFilters) {
  if (result.total === null) return "Archive results";
  const count = new Intl.NumberFormat("en-US").format(result.total);
  return filters.q
    ? `${count} matching article${result.total === 1 ? "" : "s"}`
    : `${count} articles in the archive`;
}

function formatDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function articleBackPath(filters: ArticleSearchFilters, aiOnly = false) {
  const params = articleSearchParams(filters);
  if (aiOnly) params.set("ai", "1");
  const query = params.toString();
  return `/esg/articles${query ? `?${query}` : ""}`;
}

function articleHref(item: EsgArticleSearchItem, filters: ArticleSearchFilters, aiOnly = false) {
  return `/esg/articles/${encodeURIComponent(String(item.id))}?back=${encodeURIComponent(articleBackPath(filters, aiOnly))}`;
}

function SearchError({ title, children }: { title: string; children: string }) {
  return (
    <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950" role="alert">
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-amber-900">{children}</p>
    </div>
  );
}

function dateRangeLabel(filters: ArticleSearchFilters) {
  if (!filters.from && !filters.to) return "All dates";
  if (filters.from && filters.to && filters.from === filters.to) return filters.from;
  if (filters.from && filters.to) return `${filters.from} – ${filters.to}`;
  if (filters.from) return `From ${filters.from}`;
  return `Through ${filters.to}`;
}

function ArticleCard({
  item,
  filters,
  aiOnly,
  liked,
  likeCount,
}: {
  item: EsgArticleSearchItem;
  filters: ArticleSearchFilters;
  aiOnly: boolean;
  liked: boolean;
  likeCount: number;
}) {
  const numericId = Number(item.id);
  const publishedLabel = formatDate(item.published);
  const keywords = parseKeywords(item.matched_keywords);

  return (
    <article className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_10px_36px_-30px_rgba(15,23,42,0.65)] transition duration-200 hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-[0_20px_40px_-28px_rgba(15,23,42,0.55)] sm:p-7">
      <div className="flex items-start gap-4 sm:gap-6">
        <div className="hidden shrink-0 rounded-xl bg-emerald-50 p-3 text-emerald-700 sm:block">
          <Leaf className="h-5 w-5" aria-hidden="true" />
        </div>

        <div className="min-w-0 flex-1">
          <h2 className="break-words text-lg font-semibold leading-7 text-slate-950 sm:text-xl">
            <Link
              href={articleHref(item, filters, aiOnly)}
              className="rounded-sm outline-none transition-colors hover:text-emerald-800 focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2"
            >
              <ArticleSearchHighlight text={item.title ?? "Untitled article"} query={filters.q} />
            </Link>
          </h2>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-600">
            {item.source ? (
              <span className="inline-flex min-w-0 items-center gap-2">
                <Building2 className="h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />
                <span className="truncate">{item.source}</span>
              </span>
            ) : null}
            {publishedLabel ? (
              <span className="inline-flex items-center gap-2">
                <Clock3 className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
                <time dateTime={item.published ?? undefined}>{publishedLabel}</time>
              </span>
            ) : null}
            {!item.source && !publishedLabel ? <span>Publication details unavailable</span> : null}
          </div>

          {item.snippet ? (
            <p className="mt-4 line-clamp-3 text-sm leading-6 text-slate-700">
              <ArticleSearchHighlight text={item.snippet} query={filters.q} />
            </p>
          ) : null}

          {keywords.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-2" aria-label="Article keywords">
              {keywords.slice(0, 5).map((keyword) => (
                <span key={keyword} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                  {keyword}
                </span>
              ))}
              {keywords.length > 5 ? (
                <span className="rounded-full bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-500">
                  +{keywords.length - 5} more
                </span>
              ) : null}
            </div>
          ) : null}

          {Number.isFinite(numericId) ? <ArticleAiSelection articleId={numericId} /> : null}

          <div className="mt-4 flex flex-wrap items-center gap-2.5" aria-label="ESG domains">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800">
              <Leaf className="h-3.5 w-3.5" aria-hidden="true" />
              Environmental
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-800">
              <Users className="h-3.5 w-3.5" aria-hidden="true" />
              Social
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-800">
              <Shield className="h-3.5 w-3.5" aria-hidden="true" />
              Governance
            </span>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-3">
          {Number.isFinite(numericId) ? (
            <LikeButton
              key={`like-${numericId}-${liked}-${likeCount}`}
              domain="esg"
              contentId={numericId}
              initialLiked={liked}
              initialCount={likeCount}
            />
          ) : null}
          {item.url ? (
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2"
              title="Read the original article"
            >
              <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Original</span>
            </a>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export default async function EsgArticlesPage({
  searchParams,
}: {
  searchParams: Promise<ArticlePageSearchParams>;
}) {
  const auth = await requireUserSession();
  if (auth.response) {
    redirect(`/signin?callbackUrl=${encodeURIComponent("/esg/articles")}`);
  }

  const resolvedSearchParams = await searchParams;
  const parsed = parseArticleSearchParams(resolvedSearchParams);
  const filters = parsed.ok ? parsed.filters : EMPTY_FILTERS;
  const aiOnly = hasAiOnlyFilter(resolvedSearchParams);
  let sources: string[] = [];
  let sourcesUnavailable = false;
  try {
    sources = await fetchSources("esg");
  } catch {
    sourcesUnavailable = true;
  }

  let searchResult = emptySearchResponse(filters);
  let searchUnavailable: string | null = null;
  if (parsed.ok) {
    try {
      if (aiOnly) {
        const dailyPickIds = await getDailyArticlePickIds("esg");
        searchResult = await searchEsgArticles(filters, { articleIds: dailyPickIds });
      } else {
        searchResult = await searchEsgArticles(filters);
      }
    } catch {
      searchUnavailable = "The article archive is temporarily unavailable. Please try again in a moment.";
    }
  }

  const serializedItems = JSON.parse(JSON.stringify(searchResult.items)) as EsgArticleSearchItem[];
  const totalPages = searchResult.total !== null
    ? Math.max(1, Math.ceil(searchResult.total / searchResult.pageSize))
    : searchResult.hasMore
      ? searchResult.page + 1
      : searchResult.page;

  const userId = auth.userId;
  const ids = serializedItems
    .map((item) => Number(item.id))
    .filter((id) => Number.isFinite(id));
  let countMap: Record<number, number> = {};
  let likedSet = new Set<number>();
  try {
    [countMap, likedSet] = await Promise.all([
      getLikeCounts("esg", "article", ids),
      getUserLikedSet("esg", userId, "article", ids),
    ]);
  } catch {
    // Like metadata is ancillary to the archive search. Keep the results
    // readable if a likes query is temporarily unavailable.
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_right,_rgba(16,185,129,0.08),_transparent_34%),linear-gradient(145deg,_#f8fafc_0%,_#f1f5f9_62%,_#ecfdf5_100%)]">
      <ArticleAiProvider domain="esg" articleIds={ids} isAuthenticated={userId > 0}>
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
          <header className="mb-8 max-w-4xl">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white/80 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.15em] text-emerald-800 shadow-sm">
              <Leaf className="h-3.5 w-3.5" aria-hidden="true" />
              ESG intelligence desk
            </div>
            <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h1 className="max-w-3xl text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
                  ESG news, searchable across the full archive.
                </h1>
                <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600 sm:text-lg">
                  Search trusted environmental, social, and governance coverage by phrase, source, or date range.
                  Results are drawn from the archive, not only today&apos;s feed.
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2 text-sm text-slate-500">
                <CalendarDays className="h-4 w-4 text-emerald-700" aria-hidden="true" />
                <span>{dateRangeLabel(filters)}</span>
              </div>
            </div>
          </header>

          <section aria-labelledby="article-search-heading" className="mb-8">
            <h2 id="article-search-heading" className="sr-only">Search ESG articles</h2>
            <EsgArticleSearch
              filters={filters}
              sources={sources}
              extraQueryParams={{ ai: aiOnly ? "1" : undefined }}
            />
            <ArticleAiOnlyFilter domain="esg" />
            <ArticleAiControls domain="esg" className="mt-4" />
          </section>

          {!parsed.ok ? (
            <SearchError title="Search needs attention">{String(parsed.error)}</SearchError>
          ) : null}
          {sourcesUnavailable ? (
            <SearchError title="Source filters are temporarily unavailable">
              The archive is still available, but source choices could not be loaded. Try again later.
            </SearchError>
          ) : null}
          {searchUnavailable ? (
            <SearchError title="The article archive is temporarily unavailable">{searchUnavailable}</SearchError>
          ) : null}

          <section aria-labelledby="article-results-heading">
            <div className="mb-5 flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-emerald-800">
                  <TrendingUp className="h-4 w-4" aria-hidden="true" />
                  Archive results
                </div>
                <h2 id="article-results-heading" className="mt-1 text-xl font-semibold text-slate-950">
                  {searchUnavailable ? "Archive temporarily unavailable" : resultCountLabel(searchResult, filters)}
                </h2>
              </div>
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Filter className="h-4 w-4" aria-hidden="true" />
                {filters.source ? <span>{filters.source}</span> : <span>All sources</span>}
                {filters.q ? <span className="max-w-[18rem] truncate">· “{filters.q}”</span> : null}
              </div>
            </div>

            {searchUnavailable ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50/80 px-6 py-16 text-center shadow-sm" role="status">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
                  <Newspaper className="h-7 w-7" aria-hidden="true" />
                </div>
                <h3 className="mt-5 text-lg font-semibold text-slate-950">We couldn&apos;t load the archive</h3>
                <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-700">
                  Please try the search again shortly. Your filters are still in the address bar.
                </p>
              </div>
            ) : serializedItems.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white/75 px-6 py-16 text-center shadow-sm" role="status">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
                  <Newspaper className="h-7 w-7" aria-hidden="true" />
                </div>
                <h3 className="mt-5 text-lg font-semibold text-slate-950">
                  {filters.q ? "No articles match those terms" : "No articles are available"}
                </h3>
                <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600">
                  {filters.q
                    ? "Try a shorter phrase, another source, or a wider date range."
                    : "The archive did not return any articles for these filters."}
                </p>
              </div>
            ) : (
              <div className="space-y-4" aria-live="polite">
                {serializedItems.map((item) => (
                  <ArticleCard
                    key={item.id}
                    item={item}
                    filters={filters}
                    aiOnly={aiOnly}
                    liked={likedSet.has(Number(item.id))}
                    likeCount={countMap[Number(item.id)] ?? 0}
                  />
                ))}
              </div>
            )}
          </section>

          {totalPages > 1 ? (
            <div className="mt-8 flex justify-center rounded-2xl border border-slate-200 bg-white/80 p-2 shadow-sm">
              <ArticlesPaginator currentPage={filters.page} totalPages={totalPages} domain="esg" />
            </div>
          ) : null}
        </div>
      </ArticleAiProvider>
    </main>
  );
}
