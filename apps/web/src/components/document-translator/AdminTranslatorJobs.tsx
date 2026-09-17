'use client';

import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  FileText,
  Loader2,
  RefreshCw,
  Search,
} from 'lucide-react';
import type {
  AdminTranslatorJob,
  AdminTranslatorJobKind,
  AdminTranslatorJobPeriod,
  AdminTranslatorJobStatus,
  AdminTranslatorJobsResponse,
} from '@/lib/document-translator/admin-jobs';

type JobKindFilter = AdminTranslatorJobKind;
type JobStatusFilter = AdminTranslatorJobStatus;

type RequestState =
  | { key: string; phase: 'loading' | 'success' }
  | { key: string; phase: 'error'; message: string };

const PAGE_SIZE = 25;

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700 ring-slate-500/20',
  queued: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  processing: 'bg-cyan-50 text-cyan-800 ring-cyan-600/20',
  cancelling: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  completed: 'bg-emerald-50 text-emerald-800 ring-emerald-600/20',
  error: 'bg-rose-50 text-rose-800 ring-rose-600/20',
  cancelled: 'bg-slate-100 text-slate-600 ring-slate-500/20',
};

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US').format(value || 0);
}

function formatDate(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function humanize(value: string) {
  return value.replace(/[_-]+/g, ' ').trim();
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    active: 'Active',
    cancelled: 'Cancelled',
    cancelling: 'Cancelling',
    completed: 'Completed',
    draft: 'Draft',
    error: 'Failed',
    processing: 'In progress',
    queued: 'Queued',
  };
  return labels[status] ?? humanize(status);
}

function isJobsResponse(value: unknown): value is AdminTranslatorJobsResponse {
  if (!value || typeof value !== 'object') return false;
  const payload = value as Record<string, unknown>;
  return payload.success === true
    && Array.isArray(payload.items)
    && Number.isInteger(payload.total)
    && Number.isInteger(payload.page)
    && Number.isInteger(payload.size);
}

function getErrorMessage(value: unknown, fallback: string) {
  if (!value || typeof value !== 'object') return fallback;
  const payload = value as Record<string, unknown>;
  if (typeof payload.error === 'string' && payload.error.trim()) return payload.error;
  if (typeof payload.message === 'string' && payload.message.trim()) return payload.message;
  return fallback;
}

function JobErrorDetails({ job }: { job: AdminTranslatorJob }) {
  if (job.status !== 'error' && job.status !== 'failed') return null;

  return (
    <details className="mt-2 max-w-lg rounded-lg border border-rose-200 bg-rose-50/70 text-xs text-rose-950">
      <summary className="cursor-pointer px-3 py-2 font-semibold text-rose-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-rose-600">
        View stored error detail
      </summary>
      <div className="space-y-2 border-t border-rose-200 px-3 py-2.5">
        {job.error ? (
          <p className="whitespace-pre-wrap leading-5" style={{ overflowWrap: 'anywhere' }}>{job.error}</p>
        ) : (
          <p className="font-medium">No stored error detail is available for this job.</p>
        )}
        {job.errorTruncated && (
          <p className="font-medium text-rose-700">The stored error was truncated.</p>
        )}
        {!job.error && job.message && (
          <p className="border-t border-rose-200 pt-2 leading-5">
            <span className="font-semibold">Latest status message (not the stored error): </span>
            <span style={{ overflowWrap: 'anywhere' }}>{job.message}</span>
          </p>
        )}
      </div>
    </details>
  );
}

export default function AdminTranslatorJobs({
  period,
  refreshKey = 0,
}: {
  period: AdminTranslatorJobPeriod;
  refreshKey?: number;
}) {
  const [kind, setKind] = useState<JobKindFilter>('all');
  const [status, setStatus] = useState<JobStatusFilter>('all');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [retryKey, setRetryKey] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    payload: AdminTranslatorJobsResponse;
  } | null>(null);
  const [request, setRequest] = useState<RequestState>({ key: '', phase: 'loading' });
  const requestId = useRef(0);

  useEffect(() => {
    const nextSearch = search.trim();
    if (nextSearch === debouncedSearch) return;
    const timeout = window.setTimeout(() => {
      setDebouncedSearch(nextSearch);
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [search, debouncedSearch]);

  useEffect(() => {
    setPage(1);
  }, [period]);

  const params = new URLSearchParams({
    period,
    kind,
    status,
    q: debouncedSearch,
    page: String(page),
    pageSize: String(PAGE_SIZE),
  });
  const query = params.toString();
  const currentResult = result?.key === query ? result.payload : null;
  const currentRequest = request.key === query ? request : null;
  const isLoading = !currentRequest || currentRequest.phase === 'loading';
  const requestError = currentRequest?.phase === 'error' ? currentRequest.message : null;

  useEffect(() => {
    const controller = new AbortController();
    const currentRequestId = ++requestId.current;
    setRequest({ key: query, phase: 'loading' });

    async function loadJobs() {
      try {
        const response = await fetch(`/api/admin/document-translator/jobs?${query}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        const payload: unknown = await response.json();
        if (!response.ok || !isJobsResponse(payload)) {
          throw new Error(getErrorMessage(
            payload,
            response.ok ? 'The job list response was not valid.' : `Unable to load jobs (${response.status}).`,
          ));
        }
        if (controller.signal.aborted || currentRequestId !== requestId.current) return;
        const lastValidPage = Math.max(1, Math.ceil(payload.total / PAGE_SIZE));
        if (page > lastValidPage) {
          setPage(lastValidPage);
          return;
        }
        setResult({ key: query, payload });
        setRequest({ key: query, phase: 'success' });
      } catch (loadError) {
        if (controller.signal.aborted || currentRequestId !== requestId.current) return;
        setRequest({
          key: query,
          phase: 'error',
          message: loadError instanceof Error ? loadError.message : 'Unable to load translator jobs.',
        });
      }
    }

    void loadJobs();
    return () => controller.abort();
  }, [page, query, refreshKey, retryKey]);

  const total = currentResult?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = kind !== 'all' || status !== 'all' || search.trim().length > 0;
  const refreshJobs = () => setRetryKey((value) => value + 1);
  const clearFilters = () => {
    setKind('all');
    setStatus('all');
    setSearch('');
    setDebouncedSearch('');
    setPage(1);
  };

  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-labelledby="admin-translator-jobs-title">
      <div className="flex flex-col gap-4 border-b border-slate-200 px-5 py-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-700">Retained job ledger</p>
          <h2 id="admin-translator-jobs-title" className="mt-1 text-xl font-semibold tracking-tight text-slate-950">PDF &amp; Excel translation jobs</h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">
            Search across retained PDF and workbook jobs. Page totals and changed-cell totals stay separate by file type.
          </p>
        </div>
        <button
          type="button"
          onClick={refreshJobs}
          disabled={isLoading}
          className="inline-flex shrink-0 items-center justify-center gap-2 self-start rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-600 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60 lg:self-center"
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin motion-reduce:animate-none' : ''}`} />
          {isLoading ? 'Loading jobs' : 'Refresh jobs'}
        </button>
      </div>

      <div className="grid gap-3 border-b border-slate-200 bg-slate-50/70 px-5 py-4 sm:grid-cols-2 sm:px-6 xl:grid-cols-[minmax(15rem,1.5fr)_minmax(10rem,0.8fr)_minmax(10rem,0.8fr)]">
        <label className="relative block min-w-0">
          <span className="sr-only">Search filenames</span>
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            type="search"
            maxLength={200}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Search filenames"
            className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-900 outline-none placeholder:text-slate-500 focus:border-cyan-600 focus:ring-2 focus:ring-cyan-600/20"
          />
        </label>
        <label className="block min-w-0">
          <span className="sr-only">Document type</span>
          <select
            value={kind}
            onChange={(event) => {
              setKind(event.target.value as JobKindFilter);
              setPage(1);
            }}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-cyan-600 focus:ring-2 focus:ring-cyan-600/20"
          >
            <option value="all">All file types</option>
            <option value="pdf">PDF only</option>
            <option value="xlsx">Excel only</option>
          </select>
        </label>
        <label className="block min-w-0 sm:col-span-2 xl:col-span-1">
          <span className="sr-only">Job status</span>
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as JobStatusFilter);
              setPage(1);
            }}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-cyan-600 focus:ring-2 focus:ring-cyan-600/20"
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
            <option value="attention">Needs attention</option>
            <option value="draft">Drafts</option>
          </select>
        </label>
      </div>

      <div className="px-5 py-4 sm:px-6">
        {requestError && currentResult && (
          <div role="alert" className="mb-4 flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-2.5">
              <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
              <p className="min-w-0"><span className="font-semibold">Job list refresh failed.</span> Showing the last successfully loaded results. {requestError}</p>
            </div>
            <button type="button" onClick={refreshJobs} className="shrink-0 font-semibold underline decoration-amber-500 underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700">Try again</button>
          </div>
        )}

        {isLoading && currentResult && (
          <p role="status" aria-live="polite" className="mb-3 flex items-center gap-2 text-xs font-medium text-slate-500">
            <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> Refreshing this job list…
          </p>
        )}

        {!currentResult && isLoading && (
          <div role="status" aria-live="polite" aria-busy="true" className="grid min-h-48 place-items-center rounded-xl border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-600">
            <span className="flex items-center gap-2"><Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none text-cyan-700" /> Loading translator jobs…</span>
          </div>
        )}

        {!currentResult && requestError && (
          <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-950">
            <div className="flex items-start gap-3">
              <AlertTriangle aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-rose-700" />
              <div className="min-w-0">
                <p className="font-semibold">Translator jobs could not be loaded.</p>
                <p className="mt-1 leading-5">{requestError}</p>
                <button type="button" onClick={refreshJobs} className="mt-3 rounded-md font-semibold text-rose-800 underline decoration-rose-400 underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-700">Try again</button>
              </div>
            </div>
          </div>
        )}

        {currentResult && currentResult.items.length === 0 && (
          <div className="grid min-h-48 place-items-center rounded-xl border border-dashed border-slate-300 bg-slate-50 px-6 text-center">
            <div>
              <p className="font-semibold text-slate-800">{hasFilters ? 'No translator jobs match these filters' : 'No translator jobs in this period'}</p>
              <p className="mt-1 text-sm text-slate-500">{hasFilters ? 'Try another filename, file type, or status.' : 'Retained PDF and Excel jobs will appear here.'}</p>
              {hasFilters && (
                <button type="button" onClick={clearFilters} className="mt-3 rounded-md text-sm font-semibold text-cyan-800 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-600">Clear filters</button>
              )}
            </div>
          </div>
        )}

        {currentResult && currentResult.items.length > 0 && (
          <>
            <div className="max-w-full overflow-x-auto overscroll-x-contain rounded-xl border border-slate-200">
              <table className="w-full min-w-[1160px] text-sm" aria-label="PDF and Excel translation jobs">
                <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-[0.14em] text-slate-500">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-semibold">Document</th>
                    <th scope="col" className="px-4 py-3 font-semibold">Submitted by</th>
                    <th scope="col" className="px-4 py-3 font-semibold">Status / stage</th>
                    <th scope="col" className="px-4 py-3 font-semibold">Progress</th>
                    <th scope="col" className="px-4 py-3 text-right font-semibold">Pages / changed cells</th>
                    <th scope="col" className="px-4 py-3 text-right font-semibold">Input / output tokens</th>
                    <th scope="col" className="px-4 py-3 text-right font-semibold">Request attempts</th>
                    <th scope="col" className="whitespace-nowrap px-4 py-3 text-right font-semibold">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {currentResult.items.map((job) => {
                    const progress = Math.max(0, Math.min(100, Math.round(job.progress || 0)));
                    const JobIcon = job.kind === 'pdf' ? FileText : FileSpreadsheet;
                    const workUnits = job.kind === 'pdf'
                      ? job.totalPages === null ? '—' : `${formatNumber(job.totalPages)} pages`
                      : job.changedCells === null ? '—' : `${formatNumber(job.changedCells)} changed cells`;

                    return (
                      <tr key={`${job.kind}-${job.id}`} className="border-t border-slate-100 align-top hover:bg-slate-50/70">
                        <td className="max-w-sm px-4 py-4">
                          <div className="flex min-w-0 items-start gap-2.5">
                            <span className={`mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[9px] font-bold uppercase tracking-[0.1em] ring-1 ring-inset ${job.kind === 'pdf' ? 'bg-cyan-50 text-cyan-800 ring-cyan-600/20' : 'bg-emerald-50 text-emerald-800 ring-emerald-600/20'}`}>
                              <JobIcon aria-hidden="true" className="h-3 w-3" /> {job.kind === 'pdf' ? 'PDF' : 'Excel'}
                            </span>
                            <div className="min-w-0">
                              <p className="font-semibold leading-5 text-slate-900" title={job.filename} style={{ overflowWrap: 'anywhere' }}>{job.filename}</p>
                              <p className="mt-1 truncate font-mono text-[10px] text-slate-500" title={job.id}>{job.id}</p>
                              <p className="mt-1 text-xs text-slate-500">Target: {job.targetLanguage || '—'}</p>
                            </div>
                          </div>
                          <JobErrorDetails job={job} />
                        </td>
                        <td className="max-w-[180px] px-4 py-4">
                          <p className="font-medium text-slate-800" style={{ overflowWrap: 'anywhere' }}>{job.userName || 'Unknown user'}</p>
                          <p className="mt-1 text-xs text-slate-500" style={{ overflowWrap: 'anywhere' }}>{job.userEmail || 'No email'}</p>
                        </td>
                        <td className="px-4 py-4">
                          <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${STATUS_STYLES[job.status] ?? STATUS_STYLES.cancelled}`}>
                            {statusLabel(job.status)}
                          </span>
                          <p className="mt-1.5 max-w-36 text-xs capitalize text-slate-500" style={{ overflowWrap: 'anywhere' }}>{job.stage ? humanize(job.stage) : '—'}</p>
                        </td>
                        <td className="min-w-32 px-4 py-4">
                          <div className="flex items-center justify-between gap-2 text-xs font-semibold text-slate-700">
                            <span>{formatNumber(progress)}%</span>
                            <span className="max-w-24 truncate font-normal text-slate-500" title={job.stage ? humanize(job.stage) : ''}>{job.stage ? humanize(job.stage) : '—'}</span>
                          </div>
                          <div
                            role="progressbar"
                            aria-label={`${job.filename} progress`}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={progress}
                            aria-valuetext={`${formatNumber(progress)} percent${job.stage ? `, ${humanize(job.stage)}` : ''}`}
                            className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"
                          >
                            <div className={`h-full rounded-full ${job.status === 'error' || job.status === 'failed' ? 'bg-rose-500' : job.kind === 'pdf' ? 'bg-cyan-600' : 'bg-emerald-600'}`} style={{ width: `${progress}%` }} />
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-4 py-4 text-right font-medium text-slate-800">{workUnits}</td>
                        <td className="whitespace-nowrap px-4 py-4 text-right text-xs text-slate-700">
                          <p><span className="text-slate-500">In </span>{formatNumber(job.inputTokens)}</p>
                          <p className="mt-1"><span className="text-slate-500">Out </span>{formatNumber(job.outputTokens)}</p>
                        </td>
                        <td className="px-4 py-4 text-right font-medium text-slate-700">{job.requests === null ? '—' : formatNumber(job.requests)}</td>
                        <td className="whitespace-nowrap px-4 py-4 text-right text-xs text-slate-500">
                          <p>{formatDate(job.createdAt)}</p>
                          {job.completedAt && <p className="mt-1 text-slate-500">Done {formatDate(job.completedAt)}</p>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex flex-col gap-3 text-sm sm:flex-row sm:items-center sm:justify-between">
              <p role="status" aria-live="polite" className="text-xs text-slate-500">
                Showing {formatNumber((page - 1) * PAGE_SIZE + 1)}–{formatNumber(Math.min(page * PAGE_SIZE, total))} of {formatNumber(total)} jobs
              </p>
              <nav aria-label="Translator jobs pages" className="flex items-center justify-between gap-2 sm:justify-end">
                <button
                  type="button"
                  aria-label="Previous jobs page"
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                  disabled={page <= 1 || isLoading}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-600 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronLeft aria-hidden="true" className="h-4 w-4" /> Previous
                </button>
                <span className="whitespace-nowrap px-1 text-xs text-slate-500">Page {formatNumber(page)} of {formatNumber(pageCount)}</span>
                <button
                  type="button"
                  aria-label="Next jobs page"
                  onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
                  disabled={page >= pageCount || isLoading}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-600 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Next <ChevronRight aria-hidden="true" className="h-4 w-4" />
                </button>
              </nav>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
