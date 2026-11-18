import type { ReactNode } from "react";

type CreditArticlesHeaderProps = {
  regionLabel: string;
  dateLabel: string;
  total: number | null;
  page: number;
  pageCount: number;
  title?: string;
  filters?: ReactNode;
  showAllRegions?: boolean;
};

export default function CreditArticlesHeader({
  regionLabel,
  dateLabel,
  total,
  page,
  pageCount,
  title = "CREDIT Articles",
  filters,
  showAllRegions = false,
}: CreditArticlesHeaderProps) {
  // Check if showing today's articles
  const todayFormatted = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date());
  const isShowingToday = dateLabel === todayFormatted;

  return (
    <header className="mb-6 space-y-6 rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-sm">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold md:text-4xl">{title}</h1>
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm text-muted-foreground md:text-base">
              {showAllRegions ? "All regions" : `${regionLabel} region`}
              {isShowingToday ? " • " : " • Showing "}
            </p>
            {isShowingToday ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 dark:bg-green-900/20 px-3 py-1 text-xs font-semibold text-green-700 dark:text-green-400">
                <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse"></span>
                Today&apos;s Articles ({dateLabel})
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-100 dark:bg-blue-900/20 px-3 py-1 text-xs font-semibold text-blue-700 dark:text-blue-400">
                {dateLabel}
              </span>
            )}
          </div>
        </div>
        {total !== null && <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
            <span className="font-semibold text-card-foreground">{total}</span> articles
          </div>
          <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
            Page {page} of {pageCount}
          </div>
        </div>}
      </div>

      {filters ? <div className="pt-2">{filters}</div> : null}
    </header>
  );
}
