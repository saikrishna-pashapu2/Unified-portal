"use client";
import { useEffect, useState } from "react";
export default function ExcelUsageCard({ period }: { period: string }) {
  const [stats, setStats] = useState<Record<string, number> | null>(null),
    [error, setError] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    setError(false);
    setStats(null);
    void fetch(`/api/admin/xlsx-translator/stats?period=${period}`, {
      cache: "no-store",
      signal: abort.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw new Error();
        setStats(await r.json());
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(true);
      });
    return () => abort.abort();
  }, [period]);
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-xl font-semibold">Excel translation usage</h2>
      <p className="mt-1 text-xs text-slate-500">
        Separate from PDF page statistics · selected reporting period · retained
        jobs only
      </p>
      {error ? (
        <p role="alert" className="mt-4 text-sm text-red-700">
          Excel usage could not be loaded.
        </p>
      ) : !stats ? (
        <p className="mt-4 text-sm">Loading Excel usage…</p>
      ) : (
        <>
          <dl className="mt-5 grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-6">
            {[
              ["jobs", "Workbooks"],
              ["drafts", "Drafts"],
              ["completed", "Completed"],
              ["active", "Active"],
              ["failed", "Failed"],
              ["cancelled", "Cancelled"],
              ["users", "Users"],
              ["requests", "Request attempts"],
              ["input_tokens", "Input tokens"],
              ["cached_input_tokens", "Cached input subset"],
              ["output_tokens", "Output tokens"],
              ["changed_cells", "Changed cells"],
            ].map(([key, label]) => (
              <div key={key}>
                <dt className="text-xs text-slate-500">{label}</dt>
                <dd className="mt-1 text-xl font-semibold">
                  {(stats[key] || 0).toLocaleString()}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-xs text-slate-500">
            Includes usage returned by unsuccessful calls. Timeouts may be
            billed without returning token usage. Deleted jobs are excluded;
            this is not a provider billing ledger.
          </p>
        </>
      )}
    </section>
  );
}
