import type { TenderFilters } from "@/lib/monitored-tenders/queries";
import { countryFlag } from "@/lib/monitored-tenders/format";

export default function TenderFiltersPanel({
  filters,
  sources,
  perPage,
  basePath,
  query,
  sort,
}: {
  filters: TenderFilters;
  sources: any[];
  perPage: number;
  basePath: string;
  query: string;
  sort: string;
}) {
  const selectedCountries = new Set(filters.country);
  const selectedGroups = new Set(filters.group);
  const selectedSource = filters.source[0] ?? "";

  return (
    <form id="filters" action={basePath} className="space-y-6">
      <input type="hidden" name="q" value={query} />
      <input type="hidden" name="sort" value={sort} />
      <input type="hidden" name="per_page" value={perPage} />

      <div className="border-b border-slate-200 px-1 pb-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Filter stack</div>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Tighten the feed by market, theme, source, and date range.
        </p>
      </div>

      <div>
        <label className="mb-3 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
          Country
        </label>
        <div className="space-y-2">
          {[
            ["KZ", "Kazakhstan"],
            ["UZ", "Uzbekistan"],
          ].map(([code, label]) => (
            <label key={code} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700 transition hover:border-blue-200 hover:bg-white">
              <input
                type="checkbox"
                name="country"
                value={code}
                defaultChecked={selectedCountries.has(code)}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              {countryFlag(code)} {label}
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="mb-3 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
          Group
        </label>
        <div className="space-y-2 text-sm">
          {[
            ["esg", "bg-emerald-100 text-emerald-800"],
            ["credit_rating", "bg-blue-100 text-blue-800"],
          ].map(([group, classes]) => (
            <label key={group} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 transition hover:border-blue-200 hover:bg-white">
              <input
                type="checkbox"
                name="group"
                value={group}
                defaultChecked={selectedGroups.has(group)}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${classes}`}>
                {group}
              </span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="mb-3 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
          Source
        </label>
        <select
          name="source"
          defaultValue={selectedSource}
          className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 focus:border-blue-500 focus:ring-blue-500"
        >
          <option value="">All sources</option>
          {["KZ", "UZ"].map((country) => (
            <optgroup key={country} label={country === "KZ" ? "Kazakhstan" : "Uzbekistan"}>
              {sources
                .filter((source) => source.country === country)
                .map((source) => (
                  <option key={source.name} value={source.name}>
                    {countryFlag(source.country)} {source.display_name}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">From</label>
          <input
            type="date"
            name="from"
            defaultValue={filters.from ? filters.from.toISOString().slice(0, 10) : ""}
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm focus:border-blue-500 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">To</label>
          <input
            type="date"
            name="to"
            defaultValue={filters.to ? filters.to.toISOString().slice(0, 10) : ""}
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm focus:border-blue-500 focus:ring-blue-500"
          />
        </div>
      </div>

      <div className="space-y-2 pt-2">
        <button
          type="submit"
          className="block w-full rounded-2xl bg-slate-950 px-3 py-2.5 text-center text-sm font-medium text-white transition hover:bg-slate-800"
        >
          Apply filters
        </button>
        <a
          href={basePath}
          className="block w-full rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-center text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
        >
          Clear all filters
        </a>
      </div>
    </form>
  );
}
