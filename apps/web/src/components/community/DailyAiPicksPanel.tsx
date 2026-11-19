import Link from "next/link";
import {
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type DailyArticlePickDomain = "esg" | "credit";

export type DailyArticlePickFeed = {
  runs: Array<{
    sourceDay: string;
    status: string;
    pickCount: number;
  }>;
  picks: Array<{
    articleId: number;
    domain: DailyArticlePickDomain;
    sourceDay: string;
    title: string;
    reason: string;
    source: string | null;
  }>;
};

type DailyAiPicksPanelProps = {
  domain: DailyArticlePickDomain;
  feed: DailyArticlePickFeed;
  /** Set for the admin view, where the panel is shown alongside the other domain. */
  admin?: boolean;
  /** Optional link factory used by admin views to inspect an individual source day. */
  runHref?: (sourceDay: string) => string;
  selectedSourceDay?: string;
};

const DOMAIN_COPY: Record<
  DailyArticlePickDomain,
  {
    label: string;
    accent: string;
    accentSoft: string;
    border: string;
    ring: string;
    icon: string;
  }
> = {
  esg: {
    label: "ESG",
    accent: "text-emerald-800",
    accentSoft: "bg-emerald-50 text-emerald-800",
    border: "border-emerald-100",
    ring: "ring-emerald-100",
    icon: "bg-emerald-100 text-emerald-800",
  },
  credit: {
    label: "Credit rating",
    accent: "text-blue-800",
    accentSoft: "bg-blue-50 text-blue-800",
    border: "border-blue-100",
    ring: "ring-blue-100",
    icon: "bg-blue-100 text-blue-800",
  },
};

function formatSourceDay(sourceDay: string) {
  // Source days are stored as YYYY-MM-DD in Dubai time. Constructing an
  // explicit Dubai-midnight timestamp avoids the browser's local timezone
  // shifting the displayed day for users outside the UAE.
  const date = new Date(`${sourceDay}T00:00:00+04:00`);
  if (Number.isNaN(date.getTime())) return sourceDay;

  return new Intl.DateTimeFormat("en-AE", {
    timeZone: "Asia/Dubai",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function normalizeStatus(status: string) {
  return status.trim().toLowerCase();
}

function StatusIcon({ status }: { status: string }) {
  const normalizedStatus = normalizeStatus(status);
  if (["ready", "completed", "complete", "succeeded", "success"].includes(normalizedStatus)) {
    return <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" />;
  }
  if (["error", "failed", "failure"].includes(normalizedStatus)) {
    return <TriangleAlert aria-hidden="true" className="h-3.5 w-3.5" />;
  }
  return <Clock3 aria-hidden="true" className="h-3.5 w-3.5" />;
}

function statusClasses(status: string) {
  const normalizedStatus = normalizeStatus(status);
  if (["ready", "completed", "complete", "succeeded", "success"].includes(normalizedStatus)) {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }
  if (["error", "failed", "failure"].includes(normalizedStatus)) {
    return "border-rose-200 bg-rose-50 text-rose-800";
  }
  return "border-amber-200 bg-amber-50 text-amber-800";
}

function articleHref(domain: DailyArticlePickDomain, articleId: number) {
  return `/${domain}/articles/${encodeURIComponent(String(articleId))}`;
}

export default function DailyAiPicksPanel({
  domain,
  feed,
  admin = false,
  runHref,
  selectedSourceDay,
}: DailyAiPicksPanelProps) {
  const copy = DOMAIN_COPY[domain];
  const picks = feed.picks.filter((pick) => pick.domain === domain);
  const visibleRuns = admin ? feed.runs : feed.runs.slice(0, 7);

  return (
    <section
      aria-labelledby={`${domain}-daily-ai-heading`}
      className={cn(
        "overflow-hidden rounded-2xl border bg-white shadow-sm",
        copy.border,
        admin && `ring-1 ${copy.ring}`,
      )}
    >
      <header className="border-b border-slate-100 px-5 py-5 sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <span className={cn("mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", copy.icon)}>
              <Sparkles aria-hidden="true" className="h-5 w-5" />
            </span>
            <div>
              <p className={cn("text-[11px] font-semibold uppercase tracking-[0.18em]", copy.accent)}>
                Shared article intelligence
              </p>
              <h2 id={`${domain}-daily-ai-heading`} className="mt-1 text-xl font-semibold tracking-tight text-slate-900">
                {copy.label} daily AI picks
              </h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
                Selected from the articles the whole team liked. These shared picks do not add or change anyone&apos;s like count.
              </p>
            </div>
          </div>
          <span className={cn("inline-flex w-fit items-center rounded-full px-3 py-1.5 text-xs font-semibold", copy.accentSoft)}>
            {picks.length} {picks.length === 1 ? "pick" : "picks"}
          </span>
        </div>

        {visibleRuns.length > 0 && (
          <div className="mt-5 border-t border-slate-100 pt-4">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
              <CalendarDays aria-hidden="true" className="h-3.5 w-3.5" />
              Recent processing days
            </div>
            <div className="flex flex-wrap gap-2" role="list" aria-label={`${copy.label} recent AI processing days`}>
              {visibleRuns.map((run) => {
                const runContent = (
                  <>
                    <StatusIcon status={run.status} />
                    {formatSourceDay(run.sourceDay)} · {run.pickCount}
                  </>
                );
                const runClassName = cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
                  statusClasses(run.status),
                  selectedSourceDay === run.sourceDay && "ring-2 ring-slate-400 ring-offset-1",
                  runHref && "transition hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2",
                );
                const runTitle = `${formatSourceDay(run.sourceDay)}: ${run.pickCount} ${run.pickCount === 1 ? "pick" : "picks"}`;

                return runHref ? (
                  <Link
                    key={`${run.sourceDay}-${run.status}`}
                    href={runHref(run.sourceDay)}
                    role="listitem"
                    className={runClassName}
                    title={runTitle}
                    aria-current={selectedSourceDay === run.sourceDay ? "date" : undefined}
                  >
                    {runContent}
                  </Link>
                ) : (
                  <span
                    key={`${run.sourceDay}-${run.status}`}
                    role="listitem"
                    className={runClassName}
                    title={runTitle}
                  >
                    {runContent}
                  </span>
                );
              })}
            </div>
          </div>
        )}
      </header>

      {picks.length === 0 ? (
        <div className="px-5 py-12 text-center sm:px-6">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-500">
            <Sparkles aria-hidden="true" className="h-5 w-5" />
          </div>
          <h3 className="mt-4 text-base font-semibold text-slate-900">No daily picks yet</h3>
          <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-slate-600">
            The next daily run will appear here after the team has enough liked articles for {copy.label}.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 p-5 sm:grid-cols-2 sm:p-6 xl:grid-cols-3">
          {picks.map((pick) => (
            <article
              key={`${pick.sourceDay}-${pick.articleId}`}
              className="group flex min-w-0 flex-col rounded-xl border border-slate-200 bg-slate-50/60 p-4 transition hover:border-slate-300 hover:bg-white hover:shadow-sm"
            >
              <div className="flex items-center justify-between gap-3 text-xs text-slate-500">
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <CalendarDays aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                  <time dateTime={pick.sourceDay}>{formatSourceDay(pick.sourceDay)}</time>
                </span>
                {pick.source && <span className="max-w-[48%] truncate" title={pick.source}>{pick.source}</span>}
              </div>
              <h3 className="mt-3 line-clamp-3 text-base font-semibold leading-6 text-slate-900 group-hover:text-slate-700">
                <Link
                  href={articleHref(domain, pick.articleId)}
                  className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2"
                >
                  {pick.title}
                  <ArrowUpRight aria-hidden="true" className="ml-1 inline-block h-4 w-4 align-[-2px] opacity-60" />
                </Link>
              </h3>
              <p className="mt-3 line-clamp-4 text-sm leading-5 text-slate-600">{pick.reason}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
