export const revalidate = 0; // always fresh

import Link from "next/link";
import { getPrisma } from "@/lib/db";
import { parseKeywords } from "@/lib/keywords";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/nextauth-options";
import { 
  TrendingUp, 
  Clock, 
  Filter, 
  User, 
  Globe, 
  ExternalLink, 
  ThumbsUp, 
  Calendar,
  MessageSquare,
  Sparkles
} from "lucide-react";
import { cn } from "@/lib/utils";
import WeeklyDigest from "@/components/community/WeeklyDigest";

type Sort = "latest" | "top";
type Range = "7d" | "30d" | "60d";
type Scope = "all" | "mine";
type Tab = "articles" | "digest";

const RANGE_TO_DAYS: Record<Range, number> = { "7d": 7, "30d": 30, "60d": 60 };

export default async function CommunityPage({
  params,
  searchParams,
}: {
  params: { domain: "esg" | "credit" },
  searchParams?: { sort?: Sort; range?: Range; scope?: Scope; tab?: Tab }
}) {
  const domain = params.domain;
  const sort: Sort = (searchParams?.sort || "latest") as Sort; // default LATEST
  const range: Range = (searchParams?.range || "7d") as Range;  // default 7d
  const scope: Scope = (searchParams?.scope || "all") as Scope; // default ALL
  const tab: Tab = (searchParams?.tab || "articles") as Tab; // default ARTICLES

  const session = await getServerSession(authOptions);
  const userId = Number((session?.user as any)?.id || 0);

  const days = RANGE_TO_DAYS[range] ?? 7;
  const prisma = getPrisma(domain);

  const from = new Date();
  from.setDate(from.getDate() - days);

  let rows;
  if (domain === "esg") {
    if (scope === "mine" && userId) {
      if (sort === "top") {
        rows = await prisma.$queryRaw<{
          id: number; title: string | null; source: string | null; link: string | null;
          date: Date | null; matched_keywords: any; likes: number; last_like_at: Date | null;
        }[]>`
          SELECT a.id, a.title, a.source, a.link,
                 COALESCE(a.published, a.save_time) AS date,
                 a.matched_keywords,
                 COUNT(l.*)::int AS likes,
                 MAX(l.created_at) AS last_like_at
          FROM likes l
          JOIN esg_articles a ON a.id = l.content_id
          WHERE COALESCE(l.content_type,'article') = 'article'
            AND l.created_at >= ${from}
            AND l.user_id = ${userId}
          GROUP BY a.id
          ORDER BY likes DESC, COALESCE(a.published, a.save_time) DESC
          LIMIT 60;
        `;
      } else {
        rows = await prisma.$queryRaw<{
          id: number; title: string | null; source: string | null; link: string | null;
          date: Date | null; matched_keywords: any; likes: number; last_like_at: Date | null;
        }[]>`
          SELECT a.id, a.title, a.source, a.link,
                 COALESCE(a.published, a.save_time) AS date,
                 a.matched_keywords,
                 COUNT(l.*)::int AS likes,
                 MAX(l.created_at) AS last_like_at
          FROM likes l
          JOIN esg_articles a ON a.id = l.content_id
          WHERE COALESCE(l.content_type,'article') = 'article'
            AND l.created_at >= ${from}
            AND l.user_id = ${userId}
          GROUP BY a.id
          ORDER BY last_like_at DESC, likes DESC
          LIMIT 60;
        `;
      }
    } else {
      if (sort === "top") {
        rows = await prisma.$queryRaw<{
          id: number; title: string | null; source: string | null; link: string | null;
          date: Date | null; matched_keywords: any; likes: number; last_like_at: Date | null;
        }[]>`
          SELECT a.id, a.title, a.source, a.link,
                 COALESCE(a.published, a.save_time) AS date,
                 a.matched_keywords,
                 COUNT(l.*)::int AS likes,
                 MAX(l.created_at) AS last_like_at
          FROM likes l
          JOIN esg_articles a ON a.id = l.content_id
          WHERE COALESCE(l.content_type,'article') = 'article'
            AND l.created_at >= ${from}
          GROUP BY a.id
          ORDER BY likes DESC, COALESCE(a.published, a.save_time) DESC
          LIMIT 60;
        `;
      } else {
        rows = await prisma.$queryRaw<{
          id: number; title: string | null; source: string | null; link: string | null;
          date: Date | null; matched_keywords: any; likes: number; last_like_at: Date | null;
        }[]>`
          SELECT a.id, a.title, a.source, a.link,
                 COALESCE(a.published, a.save_time) AS date,
                 a.matched_keywords,
                 COUNT(l.*)::int AS likes,
                 MAX(l.created_at) AS last_like_at
          FROM likes l
          JOIN esg_articles a ON a.id = l.content_id
          WHERE COALESCE(l.content_type,'article') = 'article'
            AND l.created_at >= ${from}
          GROUP BY a.id
          ORDER BY last_like_at DESC, likes DESC
          LIMIT 60;
        `;
      }
    }
  } else {
    if (scope === "mine" && userId) {
      if (sort === "top") {
        rows = await prisma.$queryRaw<{
          id: number; title: string | null; source: string | null; link: string | null;
          date: Date | null; matched_keywords: any; likes: number; last_like_at: Date | null;
        }[]>`
          SELECT a.id, a.title, a.source, a.link,
                 a.date,
                 a.matched_keywords,
                 COUNT(l.*)::int AS likes,
                 MAX(l.created_at) AS last_like_at
          FROM likes l
          JOIN credit_articles a ON a.id = l.content_id
          WHERE COALESCE(l.content_type,'article') = 'article'
            AND l.created_at >= ${from}
            AND l.user_id = ${userId}
          GROUP BY a.id
          ORDER BY likes DESC, a.date DESC
          LIMIT 60;
        `;
      } else {
        rows = await prisma.$queryRaw<{
          id: number; title: string | null; source: string | null; link: string | null;
          date: Date | null; matched_keywords: any; likes: number; last_like_at: Date | null;
        }[]>`
          SELECT a.id, a.title, a.source, a.link,
                 a.date,
                 a.matched_keywords,
                 COUNT(l.*)::int AS likes,
                 MAX(l.created_at) AS last_like_at
          FROM likes l
          JOIN credit_articles a ON a.id = l.content_id
          WHERE COALESCE(l.content_type,'article') = 'article'
            AND l.created_at >= ${from}
            AND l.user_id = ${userId}
          GROUP BY a.id
          ORDER BY last_like_at DESC, likes DESC
          LIMIT 60;
        `;
      }
    } else {
      if (sort === "top") {
        rows = await prisma.$queryRaw<{
          id: number; title: string | null; source: string | null; link: string | null;
          date: Date | null; matched_keywords: any; likes: number; last_like_at: Date | null;
        }[]>`
          SELECT a.id, a.title, a.source, a.link,
                 a.date,
                 a.matched_keywords,
                 COUNT(l.*)::int AS likes,
                 MAX(l.created_at) AS last_like_at
          FROM likes l
          JOIN credit_articles a ON a.id = l.content_id
          WHERE COALESCE(l.content_type,'article') = 'article'
            AND l.created_at >= ${from}
          GROUP BY a.id
          ORDER BY likes DESC, a.date DESC
          LIMIT 60;
        `;
      } else {
        rows = await prisma.$queryRaw<{
          id: number; title: string | null; source: string | null; link: string | null;
          date: Date | null; matched_keywords: any; likes: number; last_like_at: Date | null;
        }[]>`
          SELECT a.id, a.title, a.source, a.link,
                 a.date,
                 a.matched_keywords,
                 COUNT(l.*)::int AS likes,
                 MAX(l.created_at) AS last_like_at
          FROM likes l
          JOIN credit_articles a ON a.id = l.content_id
          WHERE COALESCE(l.content_type,'article') = 'article'
            AND l.created_at >= ${from}
          GROUP BY a.id
          ORDER BY last_like_at DESC, likes DESC
          LIMIT 60;
        `;
      }
    }
  }

  const isEsg = domain === "esg";
  const accentColor = isEsg ? "text-emerald-600" : "text-blue-600";
  const bgAccent = isEsg ? "bg-emerald-50" : "bg-blue-50";
  const borderAccent = isEsg ? "border-emerald-100" : "border-blue-100";

  // Fetch list of weekly digests
  let digests: any[] = [];
  try {
    digests = await prisma.$queryRaw<any[]>`
      SELECT id, week_start, week_end, content, created_at
      FROM weekly_digest
      ORDER BY created_at DESC
      LIMIT 20
    `;
  } catch (error) {
    console.error("Error fetching weekly digests:", error);
  }

  return (
    <div className="min-h-screen bg-slate-50/50">
      {/* Header Section */}
      <div className="bg-white border-b border-slate-200">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-500">
                <span className="uppercase tracking-wider">{domain}</span>
                <span>/</span>
                <span>Community</span>
              </div>
              <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
                Community Insights
              </h1>
              <p className="text-lg text-slate-600 max-w-2xl">
                Discover what the {domain.toUpperCase()} community is reading and discussing. 
                Top articles liked in the last {days} days.
              </p>
            </div>
            
            <div className="flex items-center gap-3">
              <div className={cn("p-3 rounded-2xl", bgAccent)}>
                <Sparkles className={cn("w-6 h-6", accentColor)} />
              </div>
              <div className="text-sm">
                <div className="font-medium text-slate-900">{rows.length} Articles</div>
                <div className="text-slate-500">Trending now</div>
              </div>
            </div>
          </div>

          {/* Tab Navigation */}
          <div className="mt-8 border-t border-slate-100 pt-6">
            <div className="flex items-center gap-2">
              <Link
                href={`/${domain}/community?tab=articles&sort=${sort}&range=${range}&scope=${scope}`}
                className={cn(
                  "px-4 py-2 text-sm font-medium rounded-lg transition-all duration-200 flex items-center gap-2",
                  tab === "articles"
                    ? "bg-slate-900 text-white shadow-sm"
                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                )}
              >
                <ThumbsUp className="w-4 h-4" />
                Liked Articles
              </Link>
              <Link
                href={`/${domain}/community?tab=digest&sort=${sort}&range=${range}&scope=${scope}`}
                className={cn(
                  "px-4 py-2 text-sm font-medium rounded-lg transition-all duration-200 flex items-center gap-2",
                  tab === "digest"
                    ? "bg-slate-900 text-white shadow-sm"
                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                )}
              >
                <Sparkles className="w-4 h-4" />
                Weekly Digest
              </Link>
            </div>
          </div>

          {/* Filters Bar - Only show for articles tab */}
          {tab === "articles" && (
            <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <FilterGroup label="Sort by">
                  <FilterOption 
                    href={`/${domain}/community?tab=articles&sort=latest&range=${range}&scope=${scope}`} 
                    active={sort === "latest"}
                    icon={Clock}
                  >
                    Latest
                  </FilterOption>
                  <FilterOption 
                    href={`/${domain}/community?tab=articles&sort=top&range=${range}&scope=${scope}`} 
                    active={sort === "top"}
                    icon={TrendingUp}
                  >
                    Top Rated
                  </FilterOption>
                </FilterGroup>

                <div className="h-6 w-px bg-slate-200 hidden sm:block" />

                <FilterGroup label="Time range">
                  {(["7d", "30d", "60d"] as Range[]).map(r => (
                    <FilterOption 
                      key={r} 
                      href={`/${domain}/community?tab=articles&sort=${sort}&range=${r}&scope=${scope}`} 
                      active={range === r}
                    >
                      {r}
                    </FilterOption>
                  ))}
                </FilterGroup>
              </div>

              <div className="flex items-center">
                <div className="bg-slate-100 p-1 rounded-lg flex items-center">
                  <Link
                    href={`/${domain}/community?tab=articles&sort=${sort}&range=${range}&scope=all`}
                    className={cn(
                      "px-3 py-1.5 text-sm font-medium rounded-md transition-all duration-200 flex items-center gap-2",
                      scope === "all" 
                        ? "bg-white text-slate-900 shadow-sm" 
                        : "text-slate-500 hover:text-slate-700"
                    )}
                  >
                    <Globe className="w-4 h-4" />
                    All
                  </Link>
                  <Link
                    href={`/${domain}/community?tab=articles&sort=${sort}&range=${range}&scope=mine`}
                    className={cn(
                      "px-3 py-1.5 text-sm font-medium rounded-md transition-all duration-200 flex items-center gap-2",
                      scope === "mine" 
                        ? "bg-white text-slate-900 shadow-sm" 
                        : "text-slate-500 hover:text-slate-700"
                    )}
                  >
                    <User className="w-4 h-4" />
                    My Likes
                  </Link>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Content Grid */}
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Weekly Digest Tab */}
        {tab === "digest" && <WeeklyDigest digests={digests} />}
        
        {/* Liked Articles Tab */}
        {tab === "articles" && (rows.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-2xl border border-slate-200 border-dashed">
            <div className="mx-auto w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-4">
              <MessageSquare className="w-8 h-8 text-slate-400" />
            </div>
            <h3 className="text-lg font-medium text-slate-900">No articles found</h3>
            <p className="text-slate-500 mt-1">Try adjusting your filters or check back later.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((a, i) => {
              const kws = parseKeywords(a.matched_keywords).slice(0, 4);
              return (
                <article 
                  key={`${a.id}-${i}`} 
                  className="group relative flex flex-col bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md hover:border-slate-300 transition-all duration-200 overflow-hidden"
                >
                  <div className="p-5 flex-1 flex flex-col">
                    <div className="flex items-center justify-between mb-3">
                      <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-800">
                        {a.source ?? "Unknown Source"}
                      </span>
                      {a.date && (
                        <time className="text-xs text-slate-500 flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {new Date(a.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                        </time>
                      )}
                    </div>

                    <h3 className="text-lg font-semibold text-slate-900 mb-3 line-clamp-2 group-hover:text-blue-600 transition-colors">
                      <Link href={`/${domain}/articles/${a.id}`} className="focus:outline-none">
                        <span className="absolute inset-0" aria-hidden="true" />
                        {a.title ?? "Untitled Article"}
                      </Link>
                    </h3>

                    {kws.length > 0 && (
                      <div className="mt-auto flex flex-wrap gap-1.5 pt-2">
                        {kws.map((k) => (
                          <span 
                            key={k} 
                            className="inline-flex items-center px-2 py-1 rounded-md bg-slate-50 border border-slate-100 text-xs font-medium text-slate-600"
                          >
                            {k}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-sm">
                    <div className="flex items-center gap-4 text-slate-500">
                      <span className="flex items-center gap-1.5" title="Likes">
                        <ThumbsUp className="w-4 h-4" />
                        <span className="font-medium">{a.likes}</span>
                      </span>
                      {a.last_like_at && (
                        <span className="text-xs text-slate-400">
                          Liked {timeAgo(a.last_like_at)}
                        </span>
                      )}
                    </div>
                    
                    {a.link && (
                      <a 
                        href={a.link} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="relative z-10 flex items-center gap-1 text-slate-500 hover:text-blue-600 transition-colors text-xs font-medium"
                      >
                        Original
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        ))}
      </main>
    </div>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">{label}</span>
      <div className="flex items-center gap-1 bg-white rounded-lg border border-slate-200 p-1">
        {children}
      </div>
    </div>
  );
}

function FilterOption({ 
  href, 
  active, 
  children,
  icon: Icon 
}: { 
  href: string; 
  active?: boolean; 
  children: React.ReactNode;
  icon?: any;
}) {
  return (
    <Link
      href={href}
      prefetch={false}
      className={cn(
        "px-3 py-1.5 text-sm font-medium rounded-md transition-all duration-200 flex items-center gap-1.5",
        active 
          ? "bg-slate-900 text-white shadow-sm" 
          : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
      )}
    >
      {Icon && <Icon className="w-3.5 h-3.5" />}
      {children}
    </Link>
  );
}

function timeAgo(d: Date | string) {
  const t = new Date(d).getTime();
  const delta = Math.floor((Date.now() - t) / 1000);
  if (delta < 60) return "just now";
  const mins = Math.floor(delta / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}