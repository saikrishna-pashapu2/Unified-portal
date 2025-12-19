import { listArticles, fetchSources } from "@/lib/articles";
import ArticlesPaginator from "@/components/articles/ArticlesPaginator";
import Link from "next/link";
import LikeButton from "@/components/LikeButton";
import { getLikeCounts, getUserLikedSet } from "@/lib/likes";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/nextauth-options";
import { parseKeywords } from "@/lib/keywords";
import { ExternalLink, Calendar, Building2, Clock, Newspaper, Filter, TrendingUp, Leaf, Users, Shield } from "lucide-react";

export const revalidate = 0;

export default async function EsgArticlesPage({
  searchParams,
}: {
  searchParams: { page?: string; date?: string; source?: string };
}) {
  const domain = "esg";
  const page = Math.max(1, Number(searchParams.page ?? 1));
  const pageSize = 15;
  
  const { rows: items, total, date } = await listArticles({
    domain,
    page,
    pageSize,
    date: searchParams.date,
    source: searchParams.source,
  });

  const serializedItems = JSON.parse(JSON.stringify(items));
  const totalPages = Math.ceil(total / pageSize);

  const sources = await fetchSources(domain);
  const selectedSource = searchParams.source && sources.includes(searchParams.source) 
    ? searchParams.source 
    : undefined;

  const session = await getServerSession(authOptions);
  const userId = Number((session?.user as any)?.id || 0);
  const ids = serializedItems
    .map((a: any) => Number(a.id))
    .filter((n: number) => Number.isFinite(n));

  const [countMap, likedSet] = await Promise.all([
    getLikeCounts(domain, "article", ids),
    getUserLikedSet(domain, userId, "article", ids),
  ]);

  const displayDate = new Date(date).toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-green-50">
      <div className="mx-auto max-w-7xl px-4 py-8">
        {/* Hero Header */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-r from-green-500 to-blue-600 rounded-2xl mb-6">
            <Leaf className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-4xl font-bold text-gray-900 mb-4">ESG News & Insights</h1>
          <div className="flex items-center justify-center gap-8 text-gray-600 mb-6">
            <div className="flex items-center gap-2">
              <Calendar className="w-5 h-5" />
              <span className="font-medium">{displayDate}</span>
            </div>
            <div className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5" />
              <span>{total} articles</span>
            </div>
            {selectedSource && (
              <div className="flex items-center gap-2">
                <Building2 className="w-5 h-5" />
                <span className="bg-gradient-to-r from-green-100 to-blue-100 text-green-800 px-3 py-1 rounded-full text-sm font-medium">
                  {selectedSource}
                </span>
              </div>
            )}
          </div>
          <p className="text-xl text-gray-600 max-w-3xl mx-auto leading-relaxed">
            Stay informed with the latest environmental, social, and governance news from trusted sources worldwide.
          </p>
        </div>

        {/* Modern Filters */}
        <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8 mb-12">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
              <Filter className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h3 className="text-xl font-semibold text-gray-900">Filter Articles</h3>
              <p className="text-gray-600">Customize your news feed</p>
            </div>
          </div>
          
          <form
            method="get"
            action="/esg/articles"
            className="grid w-full gap-6 md:grid-cols-[1fr_1fr_auto_auto] md:items-end"
          >
            <input type="hidden" name="page" value="1" />
            
            <div className="space-y-2">
              <label className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                Date
              </label>
              <input
                type="date"
                name="date"
                defaultValue={searchParams.date || date.slice(0, 10)}
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                <Building2 className="w-4 h-4" />
                Source
              </label>
              <select
                name="source"
                defaultValue={selectedSource || ""}
                className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all"
              >
                <option value="">All sources</option>
                {sources.map((source) => (
                  <option key={source} value={source}>
                    {source}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="submit"
              className="px-6 py-3 bg-gradient-to-r from-green-600 to-blue-600 text-white rounded-xl hover:from-green-700 hover:to-blue-700 font-semibold transition-all duration-200 shadow-lg hover:shadow-xl"
            >
              Apply Filters
            </button>

            <Link
              href="/esg/articles"
              className="px-6 py-3 border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 font-semibold transition-all duration-200 text-center"
            >
              Reset
            </Link>
          </form>
        </div>

        {/* Articles List */}
        {serializedItems.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-16 text-center">
            <div className="w-16 h-16 bg-gray-100 rounded-2xl mx-auto mb-4 flex items-center justify-center">
              <Newspaper className="w-8 h-8 text-gray-400" />
            </div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">No articles found</h3>
            <p className="text-gray-600">Try selecting a different date or check back later for new content.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {serializedItems.map((a: any, i: number) => {
              const backParams = new URLSearchParams();
              if (searchParams.date) backParams.set('date', searchParams.date);
              if (searchParams.source) backParams.set('source', searchParams.source);
              if (page > 1) backParams.set('page', String(page));
              const backQuery = backParams.toString();
              const articleHref = backQuery 
                ? `/esg/articles/${a.id}?back=${encodeURIComponent(`/esg/articles?${backQuery}`)}`
                : `/esg/articles/${a.id}`;

              return (
              <article 
                key={`${a.id ?? i}`} 
                className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8 hover:shadow-xl transition-all duration-300 group"
              >
                <div className="flex items-start gap-8">
                  <div className="flex-shrink-0">
                    <div className="w-12 h-12 bg-gradient-to-r from-green-500 to-blue-600 rounded-xl flex items-center justify-center">
                      <Leaf className="w-6 h-6 text-white" />
                    </div>
                  </div>

                  <div className="flex-1 min-w-0">
                    <h3 className="text-xl font-bold text-gray-900 mb-4 group-hover:text-blue-600 transition-colors leading-7">
                      <Link href={articleHref} className="block">
                        {a.title ?? "Untitled"}
                      </Link>
                    </h3>
                    
                    <div className="flex items-center gap-6 mb-4">
                      <div className="flex items-center gap-2 text-gray-600">
                        <Building2 className="w-4 h-4" />
                        <span className="font-medium">{a.source ?? "Unknown source"}</span>
                      </div>
                      {a.published && (
                        <div className="flex items-center gap-2 text-gray-600">
                          <Clock className="w-4 h-4" />
                          <time dateTime={new Date(a.published).toISOString()} className="tabular-nums">
                            {new Date(a.published).toLocaleDateString('en-US', { 
                              year: 'numeric', 
                              month: 'short', 
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </time>
                        </div>
                      )}
                    </div>
                    
                    {parseKeywords(a.matched_keywords).length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-4">
                        {parseKeywords(a.matched_keywords).slice(0, 5).map((keyword: string, idx: number) => (
                          <span 
                            key={idx}
                            className="bg-gradient-to-r from-green-100 to-blue-100 text-green-800 px-3 py-1 rounded-full text-xs font-medium"
                          >
                            {keyword}
                          </span>
                        ))}
                        {parseKeywords(a.matched_keywords).length > 5 && (
                          <span className="text-gray-500 text-xs px-3 py-1 bg-gray-100 rounded-full">
                            +{parseKeywords(a.matched_keywords).length - 5} more
                          </span>
                        )}
                      </div>
                    )}

                    <div className="flex items-center gap-4 mt-4">
                      <div className="flex items-center gap-2 text-green-600">
                        <Leaf className="w-4 h-4" />
                        <span className="text-sm font-medium">Environmental</span>
                      </div>
                      <div className="flex items-center gap-2 text-blue-600">
                        <Users className="w-4 h-4" />
                        <span className="text-sm font-medium">Social</span>
                      </div>
                      <div className="flex items-center gap-2 text-purple-600">
                        <Shield className="w-4 h-4" />
                        <span className="text-sm font-medium">Governance</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col items-center gap-4 flex-shrink-0">
                    {(() => {
                      const numericId = Number(a.id);
                      return Number.isFinite(numericId) && (
                        <div className="flex flex-col items-center">
                          <LikeButton
                            domain={domain}
                            contentId={numericId}
                            initialLiked={likedSet.has(numericId)}
                            initialCount={countMap[numericId] ?? 0}
                          />
                        </div>
                      );
                    })()}

                    {a.url && (
                      <Link 
                        href={a.url} 
                        target="_blank"
                        className="flex items-center justify-center w-12 h-12 rounded-xl bg-blue-100 text-blue-600 hover:bg-blue-200 transition-all duration-200 hover:scale-105"
                        title="Read full article"
                      >
                        <ExternalLink className="w-5 h-5" />
                      </Link>
                    )}
                  </div>
                </div>
              </article>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="mt-12 flex justify-center">
            <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-2">
              <ArticlesPaginator 
                currentPage={page}
                totalPages={totalPages}
                domain={domain}
              />
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
