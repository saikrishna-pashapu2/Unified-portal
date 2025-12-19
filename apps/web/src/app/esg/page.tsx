import { getHomeArticles, getFreshCount, getRecentSources } from "@/lib/home";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/nextauth-options";
import GlobeHero from "@/components/heroes/GlobeHero";
import SnowfallEffect from "@/components/home/SnowfallEffect";

export const revalidate = 0;

export default async function EsgHome() {
  const domain = "esg";
  const session = await getServerSession(authOptions);

  // fetch data for the dashboard
  const [freshCount, activeSources, articles] = await Promise.all([
    getFreshCount(domain),
    getRecentSources(domain),
    getHomeArticles(domain, 6),
  ]);

  return (
    <>
      <SnowfallEffect />
      {/* Domain-specific hero */}
      <GlobeHero />

      <main className="mx-auto max-w-[1200px] px-6 py-12">
        <div className="mb-12 text-center">
          <h1 className="text-4xl font-bold text-foreground mb-4">
            {session?.user?.name ? `Welcome back, ${session.user.name}!` : "ESG Home"}
          </h1>
          <p className="text-xl text-muted-foreground">Fresh ESG articles, events & tools.</p>
        </div>

        {/* Dashboard Cards */}
        <div className="mb-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <div className="bg-card text-card-foreground border border-border rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow group cursor-pointer">
            <div className="flex items-start justify-between mb-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
                <svg className="h-6 w-6 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div className="text-xs text-primary font-medium bg-primary/10 px-2 py-1 rounded-full">+12 today</div>
            </div>
            <div className="text-sm font-semibold text-muted-foreground mb-1">Fresh Articles</div>
            <div className="text-3xl font-bold text-card-foreground mb-2">{freshCount}</div>
            <div className="text-xs text-muted-foreground">Recent articles available</div>
            <Link href="/esg/articles" className="mt-4 inline-flex items-center text-sm font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
              Browse all →
            </Link>
          </div>

          <div className="bg-card text-card-foreground border border-border rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow group cursor-pointer">
            <div className="flex items-start justify-between mb-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
                <svg className="h-6 w-6 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
                </svg>
              </div>
              <div className="text-xs text-primary font-medium bg-primary/10 px-2 py-1 rounded-full">Active</div>
            </div>
            <div className="text-sm font-semibold text-muted-foreground mb-1">Active Sources</div>
            <div className="text-3xl font-bold text-card-foreground mb-2">{activeSources}</div>
            <div className="text-xs text-muted-foreground">Sources publishing recently</div>
            <Link href="/esg/articles?source=" className="mt-4 inline-flex items-center text-sm font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
              Filter by source →
            </Link>
          </div>

          <div className="bg-card text-card-foreground border border-border rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow group cursor-pointer">
            <div className="flex items-start justify-between mb-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
                <svg className="h-6 w-6 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <div className="text-xs text-primary font-medium bg-primary/10 px-2 py-1 rounded-full">New</div>
            </div>
            <div className="text-sm font-semibold text-muted-foreground mb-1">Quick Actions</div>
            <div className="text-3xl font-bold text-card-foreground mb-2">Tools</div>
            <div className="text-xs text-muted-foreground">Productivity shortcuts</div>
            <div className="mt-4 space-y-2 opacity-0 transition-opacity group-hover:opacity-100">
              <Link className="block text-sm font-medium text-primary hover:underline" href="/esg/articles">Browse articles</Link>
              <Link className="block text-sm font-medium text-primary hover:underline" href="/esg/events">View events</Link>
            </div>
          </div>

          <Link href="/esg/tenders" className="block bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/30 rounded-2xl p-6 shadow-sm hover:shadow-md transition-all group cursor-pointer">
            <div className="flex items-start justify-between mb-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/20">
                <svg className="h-6 w-6 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div className="text-xs text-primary font-medium bg-primary/20 px-2 py-1 rounded-full">Live</div>
            </div>
            <div className="text-sm font-semibold text-muted-foreground mb-1">Government Tenders</div>
            <div className="text-3xl font-bold text-foreground mb-2">Browse</div>
            <div className="text-xs text-muted-foreground">Kazakhstan procurement opportunities</div>
            <div className="mt-4 inline-flex items-center text-sm font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
              View all tenders →
            </div>
          </Link>
        </div>

        {/* Latest Articles - Compact Rows */}
        <section className="mb-16">
          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-2xl font-bold text-foreground">Latest Articles</h2>
            <Link className="btn btn-secondary" href="/esg/articles">
              View all →
            </Link>
          </div>

          <div className="surface-2 rounded-2xl p-6">
            <div className="space-y-4">
              {articles.slice(0, 6).map((article: any, i: number) => (
                <div key={article.id} className="flex items-start justify-between border-b border-[var(--border-muted)] pb-4 last:border-0 last:pb-0">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-[15px] font-semibold text-[var(--text)] line-clamp-1 hover:text-[var(--brand)]">
                      <Link href={`/esg/articles/${article.id}`}>
                        {article.title || "Untitled"}
                      </Link>
                    </h3>
                    <p className="mt-1 text-sm text-[var(--text-muted)]">
                      {article.source} · {article.date ? new Date(article.date).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric'
                      }) : 'No date'}
                    </p>
                  </div>
                  <div className="ml-4 text-right">
                    <div className="text-xs text-[var(--text-subtle)]">
                      {article.date ? (() => {
                        const days = Math.floor((Date.now() - new Date(article.date).getTime()) / (1000 * 60 * 60 * 24));
                        return days === 0 ? 'Today' : days === 1 ? '1 day ago' : `${days} days ago`;
                      })() : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Domain Tools */}
        <section className="grid gap-6 sm:grid-cols-2">
          <Link href="/esg/events" className="card hover-lift group p-6">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-green-100 text-green-600">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <div className="flex-1">
                <div className="text-base font-semibold text-[var(--text)] group-hover:text-[var(--brand)]">Upcoming Events</div>
                <div className="text-sm text-[var(--text-muted)]">Explore the ESG calendar →</div>
              </div>
            </div>
          </Link>

          <Link href="/esg/publications" className="card hover-lift group p-6">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-green-100 text-green-600">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
              </div>
              <div className="flex-1">
                <div className="text-base font-semibold text-[var(--text)] group-hover:text-[var(--brand)]">Recent Publications</div>
                <div className="text-sm text-[var(--text-muted)]">Dive into the latest reports →</div>
              </div>
            </div>
          </Link>

          <Link href="/esg/tools" className="card hover-lift group p-6">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-green-100 text-green-600">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <div className="flex-1">
                <div className="text-base font-semibold text-[var(--text)] group-hover:text-[var(--brand)]">ESG Scores Tool</div>
                <div className="text-sm text-[var(--text-muted)]">Single company & bulk Excel →</div>
              </div>
            </div>
          </Link>

          <Link href="/esg/pdfx" className="card hover-lift group p-6">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-green-100 text-green-600">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2H5a2 2 0 00-2-2z" />
                </svg>
              </div>
              <div className="flex-1">
                <div className="text-base font-semibold text-[var(--text)] group-hover:text-[var(--brand)]">PDF Translation</div>
                <div className="text-sm text-[var(--text-muted)]">OCR + translate →</div>
              </div>
            </div>
          </Link>
        </section>
      </main>
    </>
  );
}
