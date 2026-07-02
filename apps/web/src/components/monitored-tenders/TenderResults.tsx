import TenderCard from "./TenderCard";
import type { TenderLikeViewer } from "@/lib/monitored-tenders/likes";
import type { TenderFilters, TenderSort } from "@/lib/monitored-tenders/queries";
import { filtersAreEmpty } from "@/lib/monitored-tenders/queries";

function makeUrl(basePath: string, params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `${basePath}?${text}` : basePath;
}

export default function TenderResults({
  tenders,
  total,
  page,
  pages,
  perPage,
  filters,
  sort,
  basePath,
  query,
  viewer,
}: {
  tenders: any[];
  total: number;
  page: number;
  pages: number;
  perPage: number;
  filters: TenderFilters;
  sort: TenderSort;
  basePath: string;
  query: string;
  viewer: TenderLikeViewer | null;
}) {
  const sharedParams: Record<string, string | number | undefined> = {
    q: query || undefined,
    sort,
    per_page: perPage,
    country: filters.country.join(",") || undefined,
    source: filters.source.join(",") || undefined,
    group: filters.group.join(",") || undefined,
    from: filters.from ? filters.from.toISOString().slice(0, 10) : undefined,
    to: filters.to ? filters.to.toISOString().slice(0, 10) : undefined,
  };

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 rounded-[24px] border border-slate-200 bg-white px-4 py-3 shadow-sm shadow-slate-100 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-slate-500">
          {total === 0 ? (
            "No tenders match these filters."
          ) : (
            <>
              Showing <span className="font-semibold text-slate-900">{tenders.length}</span> of{" "}
              <span className="font-semibold text-slate-900">{total.toLocaleString("en-US")}</span> tenders
              {!filtersAreEmpty(filters) ? <span className="text-slate-400"> · filtered</span> : null}
            </>
          )}
        </div>
        <form action={basePath} className="flex items-center gap-3">
          <input type="hidden" name="q" value={query} />
          <input type="hidden" name="per_page" value={perPage} />
          {filters.country.map((value) => <input key={`country-${value}`} type="hidden" name="country" value={value} />)}
          {filters.source.map((value) => <input key={`source-${value}`} type="hidden" name="source" value={value} />)}
          {filters.group.map((value) => <input key={`group-${value}`} type="hidden" name="group" value={value} />)}
          {filters.from ? <input type="hidden" name="from" value={filters.from.toISOString().slice(0, 10)} /> : null}
          {filters.to ? <input type="hidden" name="to" value={filters.to.toISOString().slice(0, 10)} /> : null}
          <span className="hidden text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400 sm:inline">Sort</span>
          <select
            name="sort"
            defaultValue={sort}
            className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:ring-blue-500"
          >
            <option value="newest">Newest first</option>
            <option value="deadline">Deadline soonest</option>
            <option value="value_desc">Highest value</option>
            <option value="value_asc">Lowest value</option>
          </select>
          <button className="rounded-2xl border border-slate-200 px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50">
            Apply
          </button>
        </form>
      </div>

      {tenders.length ? (
        <>
          <div className="grid gap-4 lg:gap-5">
            {tenders.map((tender) => (
              <TenderCard key={tender.id} tender={tender} basePath={basePath} viewer={viewer} />
            ))}
          </div>

          {pages > 1 ? (
            <nav className="mt-6 flex flex-col gap-3 rounded-[24px] border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm shadow-slate-100 sm:flex-row sm:items-center sm:justify-between">
              <div>
                {page > 1 ? (
                  <a
                    href={makeUrl(basePath, { ...sharedParams, page: page - 1 })}
                    className="rounded-2xl border border-slate-200 px-3 py-2 text-slate-700 transition hover:bg-slate-50"
                  >
                    « Prev
                  </a>
                ) : (
                  <span className="rounded-2xl border border-slate-100 px-3 py-2 text-slate-300">« Prev</span>
                )}
              </div>
              <div className="text-slate-600">Page {page} of {pages}</div>
              <div className="flex items-center gap-2">
                {page < pages ? (
                  <a
                    href={makeUrl(basePath, { ...sharedParams, page: page + 1 })}
                    className="rounded-2xl border border-slate-200 px-3 py-2 text-slate-700 transition hover:bg-slate-50"
                  >
                    Next »
                  </a>
                ) : (
                  <span className="rounded-2xl border border-slate-100 px-3 py-2 text-slate-300">Next »</span>
                )}
                {[10, 25, 50, 100].map((size) => (
                  <a
                    key={size}
                    href={makeUrl(basePath, { ...sharedParams, page: 1, per_page: size })}
                    className={`rounded-2xl border px-3 py-2 text-sm transition ${
                      perPage === size
                        ? "border-blue-200 bg-blue-50 text-blue-700"
                        : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-white"
                    }`}
                  >
                    {size}
                  </a>
                ))}
              </div>
            </nav>
          ) : null}
        </>
      ) : (
        <div className="rounded-[28px] border border-dashed border-slate-300 bg-white p-12 text-center shadow-sm shadow-slate-100">
          <p className="mb-3 text-slate-600">No tenders match these filters.</p>
          <a href={basePath} className="inline-block rounded-2xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50">
            Clear all
          </a>
        </div>
      )}
    </>
  );
}
