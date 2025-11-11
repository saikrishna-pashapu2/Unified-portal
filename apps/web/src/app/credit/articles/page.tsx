import type { ReactNode } from "react";
import Link from "next/link";
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
import {
  listCreditArticles,
  type CreditRegion,
  type CreditSector,
} from "@/lib/credit-articles";
import { fetchCreditSources } from "@/lib/articles";
import CreditArticlesHeader from "@/components/articles/CreditArticlesHeader";
import CreditArticleRowCard from "@/components/articles/CreditArticleRowCard";
import { getLikeCounts, getUserLikedSet } from "@/lib/likes";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/nextauth-options";

type SearchParams = {
  region?: string;
  sector?: string;
  source?: string;
  page?: string;
  date?: string;
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
  searchParams: SearchParams;
}) {
  const selectedRegion = resolveRegion(searchParams.region);
  const rawSector = resolveSector(searchParams.sector);
  const selectedSector =
    selectedRegion === "MiddleEast" || selectedRegion === "CentralAsia"
      ? rawSector
      : undefined;
  const page = Math.max(1, Number(searchParams.page ?? "1") || 1);
  const date = searchParams.date;

  // Fetch sources filtered by region and sector
  const sources = await fetchCreditSources({
    region: selectedRegion,
    sector: selectedSector,
  });
  const rawSource = searchParams.source?.trim() ?? "";
  const sourceOptions = [...sources].sort((a, b) => a.localeCompare(b));
  const selectedSource = sourceOptions.includes(rawSource) ? rawSource : undefined;

  const { items, total, pageSize } = await listCreditArticles({
    region: selectedRegion,
    sector: selectedSector,
    source: selectedSource,
    page,
    date,
  });

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  // Like system setup
  const session = await getServerSession(authOptions);
  const userId = Number((session?.user as any)?.id || 0);
  const articleIds = items
    .map((article) => Number(article.id))
    .filter((id) => Number.isFinite(id));

  const [likeCounts, userLikedSet] = await Promise.all([
    getLikeCounts("credit", "article", articleIds),
    getUserLikedSet("credit", userId, "article", articleIds),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const selectedDateValue = date ?? today;
  const selectedDateLabel =
    formatDisplayDate(date ?? today) ?? formatDisplayDate(today) ?? today;
  const regionMeta = getRegionMeta(selectedRegion);

  const prevPage = page > 1 ? String(page - 1) : undefined;
  const nextPage = page < pageCount ? String(page + 1) : undefined;
  const prevDisabled = page <= 1;
  const nextDisabled = page >= pageCount;

  const filtersNode = (
    <form
      method="get"
      action="/credit/articles"
      className="grid w-full gap-3 md:grid-cols-[repeat(2,minmax(0,1fr))_auto_auto] md:items-end"
    >
      {selectedRegion ? <input type="hidden" name="region" value={selectedRegion} /> : null}
      {selectedSector ? <input type="hidden" name="sector" value={selectedSector} /> : null}
      <input type="hidden" name="page" value="1" />

      <label className="flex flex-col text-sm font-medium text-card-foreground">
        <span className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Date</span>
        <div className="relative">
          <input
            type="date"
            name="date"
            defaultValue={selectedDateValue}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm transition-all duration-200 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 hover:border-primary/50 [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:rounded [&::-webkit-calendar-picker-indicator]:p-1 [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:transition-opacity [&::-webkit-calendar-picker-indicator]:hover:bg-primary/10 [&::-webkit-calendar-picker-indicator]:hover:opacity-100"
            style={{
              colorScheme: 'light dark'
            }}
          />
        </div>
      </label>

      <label className="flex flex-col text-sm font-medium text-card-foreground">
        <span className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Source</span>
        <select
          name="source"
          defaultValue={selectedSource ?? ""}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm transition-all duration-200 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 hover:border-primary/50"
        >
          <option value="">All sources</option>
          {sourceOptions.map((source) => (
            <option key={source} value={source}>
              {source}
            </option>
          ))}
        </select>
      </label>

      <button
        type="submit"
        className="h-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-all duration-200 hover:bg-primary/90 hover:shadow-md active:scale-95"
      >
        Apply
      </button>

      <Link
        href={href("/credit/articles", {
          region: selectedRegion,
          sector: selectedSector,
        })}
        className="flex h-full items-center justify-center rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground transition-all duration-200 hover:bg-muted hover:border-primary/50 active:scale-95"
      >
        Reset
      </Link>
    </form>
  );

  return (
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
                  date,
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
                        date,
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
                            date,
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
                              date,
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
          <CreditArticlesHeader
            regionLabel={regionMeta.label}
            dateLabel={selectedDateLabel}
            total={total}
            page={page}
            pageCount={pageCount}
            filters={filtersNode}
            showAllRegions={!selectedRegion}
          />

          {items.length === 0 ? (
            <div className="rounded-2xl border border-border bg-card p-10 text-center text-base text-card-foreground">
              No articles found for the selected filters.
            </div>
          ) : (
            <div className="space-y-4">
              {items.map((article) => {
                const dateLabel = formatDisplayDate(article.date) ?? "No date";
                const regionLabel = getRegionMeta(article.region).label;
                const sectorLabel =
                  SECTORS.find((sector) => sector.key === article.sector)?.label ?? article.sector;
                
                const articleId = Number(article.id);
                const isValidId = Number.isFinite(articleId);

                const backParams = new URLSearchParams();
                if (selectedRegion) backParams.set('region', selectedRegion);
                if (selectedSector) backParams.set('sector', selectedSector);
                if (selectedSource) backParams.set('source', selectedSource);
                if (date) backParams.set('date', date);
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
                  date,
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
                  date,
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
  );
}
