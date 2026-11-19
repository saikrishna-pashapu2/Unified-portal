import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ExternalLink, Sparkles } from "lucide-react";
import DailyAiPicksPanel, {
  type DailyArticlePickFeed,
} from "@/components/community/DailyAiPicksPanel";
import { requireAdminSession } from "@/lib/api-auth";
import { getDailyArticlePickFeed } from "@/lib/article-ai/daily-feed";

export const dynamic = "force-dynamic";

const EMPTY_FEED: DailyArticlePickFeed = { runs: [], picks: [] };

function parseSourceDay(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : undefined;
}

async function loadFeed(domain: "esg" | "credit", sourceDay?: string) {
  try {
    const allDays = await getDailyArticlePickFeed(domain, { limit: 30 });
    if (!sourceDay) return allDays;

    const selectedDay = await getDailyArticlePickFeed(domain, {
      sourceDay,
      limit: 30,
    });
    return { runs: allDays.runs, picks: selectedDay.picks };
  } catch (error) {
    console.error(`Error fetching ${domain} daily AI picks for admin:`, error);
    return EMPTY_FEED;
  }
}

export default async function DailyAiAdminPage({
  searchParams,
}: {
  searchParams?: Promise<{ sourceDay?: string | string[] }>;
}) {
  const auth = await requireAdminSession();
  if (auth.response) redirect("/");

  const sourceDay = parseSourceDay((await searchParams)?.sourceDay);
  const [esgFeed, creditFeed] = await Promise.all([
    loadFeed("esg", sourceDay),
    loadFeed("credit", sourceDay),
  ]);

  return (
    <div className="mx-auto max-w-[1480px] space-y-8 pb-12">
      <header className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white px-6 py-8 shadow-sm sm:px-8">
        <div className="pointer-events-none absolute -right-24 -top-32 h-80 w-80 rounded-full bg-emerald-100/50 blur-3xl" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              <Sparkles aria-hidden="true" className="h-4 w-4 text-emerald-700" />
              Daily AI picks
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
              Team-wide article picks
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">
              Review recent picks for ESG and credit.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/esg/community?tab=daily-ai"
              className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
            >
              ESG community
              <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
            </Link>
            <Link
              href="/credit/community?tab=daily-ai"
              className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3.5 text-sm font-semibold text-blue-800 transition hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
            >
              Credit community
              <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
        <div className="relative mt-6 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4 text-sm">
          <span className="font-medium text-slate-500">
            {sourceDay ? `Showing ${sourceDay}` : "Showing all days"}
          </span>
          {sourceDay && (
            <Link
              href="/admin/daily-ai"
              className="font-semibold text-slate-700 underline decoration-slate-300 underline-offset-4 transition hover:text-slate-900"
            >
              Show all days
            </Link>
          )}
          <span className="text-slate-400">Pick a day below.</span>
        </div>
      </header>

      <div className="grid min-w-0 gap-6 xl:grid-cols-2">
        <DailyAiPicksPanel
          domain="esg"
          feed={esgFeed}
          admin
          selectedSourceDay={sourceDay}
          runHref={(day) => `/admin/daily-ai?sourceDay=${encodeURIComponent(day)}`}
        />
        <DailyAiPicksPanel
          domain="credit"
          feed={creditFeed}
          admin
          selectedSourceDay={sourceDay}
          runHref={(day) => `/admin/daily-ai?sourceDay=${encodeURIComponent(day)}`}
        />
      </div>

      <Link
        href="/admin"
        className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 transition hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2"
      >
        <ArrowLeft aria-hidden="true" className="h-4 w-4" />
        Back to admin dashboard
      </Link>
    </div>
  );
}
