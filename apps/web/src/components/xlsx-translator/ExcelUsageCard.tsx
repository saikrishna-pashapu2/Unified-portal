"use client";
import { useEffect, useState } from "react";
export default function ExcelUsageCard({
  period,
  refreshKey = 0,
}: {
  period: string;
  refreshKey?: number;
}) {
  const [usage, setUsage] = useState<{
    period: string;
    stats: Record<string, number>;
  } | null>(null);
  const [loadError, setLoadError] = useState<{
    period: string;
    message: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [retryKey, setRetryKey] = useState(0);
  const stats = usage?.period === period ? usage.stats : null;
  const error = loadError?.period === period ? loadError.message : null;
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setLoadError(null);

    async function loadUsage() {
      try {
        const response = await fetch(
          `/api/admin/xlsx-translator/stats?period=${period}`,
          { cache: "no-store", signal: abort.signal },
        );
        const payload: unknown = await response.json();
        const body =
          payload && typeof payload === "object"
            ? (payload as Record<string, unknown>)
            : null;
        if (!response.ok || !body || typeof body.error === "string") {
          throw new Error(
            typeof body?.error === "string"
              ? body.error
              : `Excel usage could not be loaded (${response.status}).`,
          );
        }
        if (!abort.signal.aborted) {
          setUsage({ period, stats: body as Record<string, number> });
        }
      } catch (loadError) {
        if (abort.signal.aborted) return;
        setLoadError({
          period,
          message:
            loadError instanceof Error
              ? loadError.message
              : "Excel usage could not be loaded.",
        });
      } finally {
        if (!abort.signal.aborted) setLoading(false);
      }
    }

    void loadUsage();
    return () => abort.abort();
  }, [period, refreshKey, retryKey]);
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-xl font-semibold">Excel translation usage</h2>
      <p className="mt-1 text-xs text-slate-500">
        Separate from PDF page statistics · selected reporting period · retained
        jobs only
      </p>
      {error && (
        <div
          role="alert"
          className="mt-4 flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-950 sm:flex-row sm:items-center sm:justify-between"
        >
          <p>
            {stats
              ? `Excel usage refresh failed; showing the last successful snapshot. ${error}`
              : error}
          </p>
          <button
            type="button"
            onClick={() => setRetryKey((value) => value + 1)}
            className="shrink-0 font-semibold underline decoration-amber-500 underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700"
          >
            Try again
          </button>
        </div>
      )}
      {!stats && loading ? (
        <p role="status" aria-live="polite" className="mt-4 text-sm">
          Loading Excel usage…
        </p>
      ) : !stats && !error ? (
        <p role="status" aria-live="polite" className="mt-4 text-sm">
          Loading Excel usage…
        </p>
      ) : stats ? (
        <>
          {loading && (
            <p role="status" aria-live="polite" className="mt-3 text-xs text-slate-500">
              Refreshing Excel usage…
            </p>
          )}
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
      ) : null}
    </section>
  );
}
