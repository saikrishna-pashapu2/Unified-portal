import Link from "next/link";
import { redirect } from "next/navigation";
import DailyAiPicksPanel, {
  type DailyArticlePickFeed,
} from "@/components/community/DailyAiPicksPanel";
import { requireAdminSession } from "@/lib/api-auth";
import { getDailyArticlePickFeed } from "@/lib/article-ai/daily-feed";
import AdminDashboardClient from "./AdminDashboardClient";

export const dynamic = "force-dynamic";

const EMPTY_FEED: DailyArticlePickFeed = { runs: [], picks: [] };

async function loadFeed(viewerId: number, domain: "esg" | "credit") {
  try {
    const feed = await getDailyArticlePickFeed(domain, { viewerId, limit: 6 });
    return { ...feed, runs: feed.runs.slice(0, 7) };
  } catch (error) {
    console.error(`Error fetching ${domain} daily AI picks for admin dashboard:`, error);
    return EMPTY_FEED;
  }
}

export default async function AdminDashboardPage() {
  const auth = await requireAdminSession();
  if (auth.response) redirect("/");

  const viewerId = Number(auth.session.user.id);
  const [esgFeed, creditFeed] = await Promise.all([
    loadFeed(viewerId, "esg"),
    loadFeed(viewerId, "credit"),
  ]);

  return (
    <div className="space-y-8">
      <section aria-labelledby="admin-daily-ai-heading" className="mx-auto max-w-[1480px]">
        <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 id="admin-daily-ai-heading" className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
              Recent daily AI picks
            </h1>
          </div>
          <Link
            href="/admin/daily-ai"
            className="inline-flex w-fit items-center rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2"
          >
            Open full AI picks view
          </Link>
        </div>
        <div className="grid min-w-0 gap-6 xl:grid-cols-2">
          <DailyAiPicksPanel
            domain="esg"
            feed={esgFeed}
            admin
            runHref={(day) => `/admin/daily-ai?sourceDay=${encodeURIComponent(day)}`}
          />
          <DailyAiPicksPanel
            domain="credit"
            feed={creditFeed}
            admin
            runHref={(day) => `/admin/daily-ai?sourceDay=${encodeURIComponent(day)}`}
          />
        </div>
      </section>
      <AdminDashboardClient />
    </div>
  );
}
