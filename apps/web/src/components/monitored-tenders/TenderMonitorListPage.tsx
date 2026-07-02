import { AlertTriangle, Search, SlidersHorizontal } from "lucide-react";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/nextauth-options";
import {
  listMonitoredSources,
  listMonitoredTenders,
  overallMonitoredCounters,
  type TenderDomain,
} from "@/lib/monitored-tenders/queries";
import { timeAgo } from "@/lib/monitored-tenders/format";
import { tenderLikeViewerFromSession } from "@/lib/monitored-tenders/likes";
import TenderFiltersPanel from "./TenderFiltersPanel";
import TenderResults from "./TenderResults";

export default async function TenderMonitorListPage({
  domain,
  basePath,
  searchParams,
}: {
  domain: TenderDomain;
  basePath: string;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const [result, sources, counters, session] = await Promise.all([
    listMonitoredTenders({ domain, searchParams }),
    listMonitoredSources(),
    overallMonitoredCounters(),
    getServerSession(authOptions),
  ]);
  const query = result.filters.q ?? "";
  const setupRequired = result.setupRequired || counters.setupRequired;
  const viewer = tenderLikeViewerFromSession(session);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <main className="mx-auto w-full max-w-[96rem] px-4 py-6 sm:px-6">
        <section className="mb-6 overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm shadow-slate-200/70">
          <div className="bg-[radial-gradient(circle_at_top_left,_rgba(37,99,235,0.12),_transparent_38%),radial-gradient(circle_at_bottom_right,_rgba(16,185,129,0.10),_transparent_32%),linear-gradient(135deg,_#ffffff,_#f8fafc)] px-5 py-6 sm:px-7">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="mb-2 inline-flex items-center rounded-full border border-slate-200 bg-white/90 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                  Matched tender feed
                </div>
                <h1 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">Tenders</h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                  Browse, filter, and triage every ingested tender with a cleaner review flow for analysts.
                </p>
              </div>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm shadow-slate-100 xl:hidden"
              >
                <SlidersHorizontal className="h-4 w-4" /> Filters
              </button>
            </div>

            <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,1fr)_16rem]">
              <form action={basePath} className="relative">
                <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input type="hidden" name="sort" value={result.sort} />
                <input type="hidden" name="per_page" value={result.perPage} />
                {result.filters.country.map((value) => <input key={`country-${value}`} type="hidden" name="country" value={value} />)}
                {result.filters.source.map((value) => <input key={`source-${value}`} type="hidden" name="source" value={value} />)}
                {result.filters.group.map((value) => <input key={`group-${value}`} type="hidden" name="group" value={value} />)}
                <input
                  type="search"
                  name="q"
                  defaultValue={query}
                  placeholder="Search title, buyer, or keyword trail…"
                  className="w-full rounded-2xl border border-slate-200 bg-white/95 py-3 pl-11 pr-4 text-sm text-slate-900 shadow-sm shadow-slate-100 placeholder:text-slate-400 focus:border-blue-500 focus:ring-blue-500"
                />
              </form>
              <div className="hidden items-center justify-end gap-2 text-xs text-slate-500 lg:flex">
                <span className="inline-flex items-center rounded-full bg-white/90 px-3 py-2 shadow-sm shadow-slate-100">
                  {result.total.toLocaleString("en-US")} visible
                </span>
                <span className="inline-flex items-center rounded-full bg-white/90 px-3 py-2 shadow-sm shadow-slate-100">
                  {result.filters.group.length || 2} focus group{(result.filters.group.length || 2) === 1 ? "" : "s"}
                </span>
              </div>
            </div>
          </div>
        </section>

        {setupRequired ? (
          <section className="mb-6 rounded-[24px] border border-amber-200 bg-amber-50 px-5 py-4 text-amber-950 shadow-sm shadow-amber-100">
            <div className="flex gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
              <div className="min-w-0">
                <h2 className="text-sm font-semibold">Tender monitor database tables are not installed yet.</h2>
                <p className="mt-1 text-sm leading-6 text-amber-900">
                  Run the monitored tender SQL migration against the Portal ESG database, then restart the Portal app.
                </p>
                <code className="mt-3 block overflow-x-auto rounded-xl border border-amber-200 bg-white/80 px-3 py-2 text-xs text-slate-900">
                  {`psql "$ESG_DATABASE_URL" -f packages/db-esg/prisma/monitored-tenders-schema.sql`}
                </code>
              </div>
            </div>
          </section>
        ) : null}

        <div className="grid gap-6 xl:grid-cols-[17.5rem_minmax(0,1fr)]">
          <aside className="hidden xl:block">
            <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/70 xl:sticky xl:top-20">
              <TenderFiltersPanel
                filters={result.filters}
                sources={sources}
                perPage={result.perPage}
                basePath={basePath}
                query={query}
                sort={result.sort}
              />
            </div>
          </aside>

          <section className="min-w-0 flex-1">
            <TenderResults
              tenders={result.rows}
              total={result.total}
              page={result.page}
              pages={result.pages}
              perPage={result.perPage}
              filters={result.filters}
              sort={result.sort}
              basePath={basePath}
              query={query}
              viewer={viewer}
            />
          </section>
        </div>
      </main>

      <footer className="border-t border-gray-200 bg-white">
        <div className="mx-auto flex max-w-[96rem] flex-wrap justify-between gap-2 px-4 py-3 text-xs text-gray-500 sm:px-6">
          <span>Read-only browsing UI.</span>
          <span>
            {counters.totalTenders.toLocaleString("en-US")} tenders · {counters.totalSources} sources · Last ingest:{" "}
            {counters.lastSeen ? timeAgo(counters.lastSeen) : "No tenders ingested yet."}
          </span>
        </div>
      </footer>
    </div>
  );
}
