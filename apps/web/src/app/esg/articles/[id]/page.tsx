import { getPrisma } from "@/lib/db";
import { summarizeText } from "@/app/actions/summarize";
import { Suspense } from "react";
import LikeButton from "@/components/LikeButton";
import { getLikeCounts, getUserLikedSet, getLikers } from "@/lib/likes";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/nextauth-options";
import { parseKeywords } from "@/lib/keywords";
import Link from "next/link";
import { ArrowLeft, ExternalLink, Calendar, Building2, Heart, Users, Sparkles, Leaf, Shield, User2, Clock } from "lucide-react";
import SafeHTMLContent from "@/components/SafeHTMLContent";
import ArticleAssistant from "@/components/articles/ArticleAssistant";
import { TrackActivity } from "@/components/analytics/UserActivityTracker";

async function fetchArticle(id: string) {
  const domain = "esg";
  const prisma = getPrisma(domain);
  const idNum = Number(id);
  if (!Number.isFinite(idNum)) return null;

  const rows = await prisma.$queryRaw<{
    id: number | string;
    title: string | null;
    source: string | null;
    link: string | null;
    date: Date | null;
    summary: string | null;
    matched_keywords?: unknown;
  }[]>`
    SELECT id, title, source, link,
           COALESCE(published, save_time) AS date,
           summary,
           matched_keywords
    FROM esg_articles
    WHERE id = ${idNum}
    LIMIT 1;
  `;
  return rows[0] ?? null;
}


export const revalidate = 0;

export default async function ArticleDetail({
  params,
  searchParams,
}: { 
  params: { id: string };
  searchParams: { back?: string };
}) {
  const domain = "esg";
  const item = await fetchArticle(params.id);
  if (!item) {
    return <div className="mx-auto max-w-3xl p-6">Not found</div>;
  }

  // Determine the back URL - use the one from query params if available, otherwise default
  const backUrl = searchParams.back || `/esg/articles`;

  const body = (item as any).summary ?? "";

  // after you compute `item`, also compute like meta:
  const session = await getServerSession(authOptions);
  const userId = Number((session?.user as any)?.id || 0);
  const contentId = Number(params.id);
  let likeCount = 0, liked = false;
  const likers = Number.isFinite(contentId)
    ? await getLikers(domain, "article", contentId)
    : [];
  if (Number.isFinite(contentId)) {
    const [countMap, likedSet] = await Promise.all([
      getLikeCounts(domain, "article", [contentId]),
      getUserLikedSet(domain, userId, "article", [contentId]),
    ]);
    likeCount = countMap[contentId] ?? 0;
    liked = likedSet.has(contentId);
  }

  // Compute clean names for safe UI rendering
  const likerNames = (likers || [])
    .map(u => (u.name ?? "").trim())
    .filter(Boolean); // drop empties just in case

  const keywords = parseKeywords((item as any).matched_keywords);

  // provider enabled?
  const providerReady =
    !!process.env.CUSTOM_AI_KEY &&
    !!process.env.CUSTOM_AI_URL &&
    !process.env.CUSTOM_AI_URL.includes("<") &&
    !process.env.CUSTOM_AI_URL.includes(">");

  const getESGIcon = () => {
    return <Leaf className="w-8 h-8 text-white" />;
  };

  const getESGColor = () => {
    return "from-green-500 to-blue-600";
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-green-50">
      <TrackActivity
        action="view_article"
        resourceType="article"
        resourceId={contentId}
        details={`/${domain}/articles/${contentId}`}
      />

      {/* Header with Back Navigation - Full Width */}
      <div className="px-6 py-4 bg-white border-b border-gray-200 shadow-sm">
        <Link 
          href={backUrl}
          className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="font-medium">
            {backUrl.includes('community') ? 'Back to Community' : 'Back to Articles'}
          </span>
        </Link>
      </div>

      {/* Main Content: 40% Agent + 60% Article */}
      <div className="flex h-[calc(100vh-64px)]">
        {/* Agent - 40% */}
        <div className="w-[40%] h-full">
          <ArticleAssistant
            articleId={Number(params.id)}
            domain={domain}
            articleTitle={item.title ?? "Untitled"}
          />
        </div>

        {/* Article - 60% */}
        <div className="w-[60%] h-full overflow-y-auto bg-gray-50 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100 p-4">
          <div className="bg-white rounded-2xl shadow-lg overflow-hidden mb-4">
            {/* Article Header Card */}
            <div className="border-b border-gray-100">
              {/* Hero Section */}
              <div className={`bg-gradient-to-r ${getESGColor()} p-8 text-white rounded-t-2xl`}>
            <div className="flex items-start gap-6">
              <div className="flex-shrink-0">
                <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center backdrop-blur-sm">
                  {getESGIcon()}
                </div>
              </div>
              <div className="flex-1">
                <h1 className="text-3xl font-bold leading-tight mb-4">
                  {item.title ?? "Untitled Article"}
                </h1>
                
                {/* Article Meta */}
                <div className="flex items-center gap-6 text-white/90">
                  <div className="flex items-center gap-2">
                    <Building2 className="w-4 h-4" />
                    <span className="font-medium">{item.source ?? "Unknown Source"}</span>
                  </div>
                  {item.date && (
                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4" />
                      <time dateTime={new Date(item.date).toISOString()}>
                        {new Date(item.date).toLocaleDateString('en-US', { 
                          year: 'numeric', 
                          month: 'long', 
                          day: 'numeric' 
                        })}
                      </time>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4" />
                    <span>{Math.ceil((body?.length || 0) / 1000)} min read</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Keywords */}
            {keywords.length > 0 && (
              <div className="mt-6 flex flex-wrap gap-2">
                {keywords.slice(0, 8).map((k) => (
                  <span 
                    key={k} 
                    className="bg-white/20 text-white px-3 py-1 rounded-full text-sm font-medium backdrop-blur-sm"
                  >
                    {k}
                  </span>
                ))}
                {keywords.length > 8 && (
                  <span className="bg-white/10 text-white/80 px-3 py-1 rounded-full text-sm backdrop-blur-sm">
                    +{keywords.length - 8} more
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Action Bar */}
          <div className="p-6 border-b border-gray-100 bg-gray-50">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                {item.link ? (
                  <a 
                    href={item.link} 
                    target="_blank"
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-medium"
                  >
                    <ExternalLink className="w-4 h-4" />
                    Read Original
                  </a>
                ) : (
                  <span className="text-gray-400 text-sm">Original link not available</span>
                )}

                {/* ESG Categories */}
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1 text-green-600 bg-green-50 px-3 py-1 rounded-lg">
                    <Leaf className="w-4 h-4" />
                    <span className="text-sm font-medium">Environmental</span>
                  </div>
                  <div className="flex items-center gap-1 text-blue-600 bg-blue-50 px-3 py-1 rounded-lg">
                    <Users className="w-4 h-4" />
                    <span className="text-sm font-medium">Social</span>
                  </div>
                  <div className="flex items-center gap-1 text-purple-600 bg-purple-50 px-3 py-1 rounded-lg">
                    <Shield className="w-4 h-4" />
                    <span className="text-sm font-medium">Governance</span>
                  </div>
                </div>
              </div>

              {/* Like Button */}
              {Number.isFinite(contentId) && (
                <div className="flex items-center gap-4">
                  <LikeButton
                    domain={domain}
                    contentId={contentId}
                    initialLiked={liked}
                    initialCount={likeCount}
                  />
                </div>
              )}
            </div>

            {/* Likers */}
            {likerNames.length > 0 && (
              <div className="mt-4 flex items-center gap-2 text-sm text-gray-600">
                <Heart className="w-4 h-4 text-red-500" />
                <span>
                  Liked by <span className="font-medium">{likerNames.slice(0, 3).join(", ")}</span>
                  {likerNames.length > 3 && <span> and {likerNames.length - 3} others</span>}
                </span>
              </div>
            )}
          </div>
          </div>

          {/* Article Content */}
          <div className="p-8">
            <article className="prose prose-lg prose-gray max-w-none">
              {body ? (
                <SafeHTMLContent 
                  htmlContent={body}
                  className="article-content text-gray-800 leading-relaxed"
                />
              ) : (
                <div className="text-center py-12 bg-gray-50 rounded-xl">
                  <Building2 className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                  <h4 className="text-lg font-medium text-gray-900 mb-2">Content Not Available</h4>
                  <p className="text-gray-600">Please use the &quot;Read Original&quot; link to view the full article content.</p>
                </div>
              )}
            </article>
          </div>
          </div>
        </div>
      </div>
    </main>
  );
}

async function Summarizer({ body }: { body: string }) {
  if (!body) {
    return null;
  }
  const res = await summarizeText(body.slice(0, 8000)); // keep payload sane
  return (
    <div className="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden">
      <div className="bg-gradient-to-r from-purple-500 to-pink-500 p-6 text-white">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center backdrop-blur-sm">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="text-lg font-semibold">AI Summary</h3>
            <p className="text-white/90 text-sm">Intelligent analysis powered by AI</p>
          </div>
        </div>
      </div>
      <div className="p-6">
        <div className="text-gray-800 leading-relaxed whitespace-pre-wrap">
          {res.ok ? res.summary : res.summary}
        </div>
        <div className="mt-4 p-3 bg-purple-50 rounded-lg">
          <p className="text-xs text-purple-700">
            <Sparkles className="w-3 h-3 inline mr-1" />
            This summary was generated using AI and may not capture all nuances of the original article.
          </p>
        </div>
      </div>
    </div>
  );
}
