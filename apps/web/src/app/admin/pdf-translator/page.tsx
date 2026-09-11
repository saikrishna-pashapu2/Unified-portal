'use client';

import ExcelUsageCard from '@/components/xlsx-translator/ExcelUsageCard';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Cpu,
  Database,
  FileStack,
  FileText,
  Gauge,
  HardDrive,
  Languages,
  Loader2,
  RefreshCw,
  ScanText,
  Users,
} from 'lucide-react';
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

type PeriodValue = '7' | '30' | '90' | '365' | 'all';

interface PdfTranslatorStats {
  success: true;
  period: { value: PeriodValue; startDate: string | null; endDate: string };
  overview: {
    totalJobs: number;
    completedJobs: number;
    failedJobs: number;
    cancelledJobs: number;
    activeJobs: number;
    uniqueUsers: number;
    totalPages: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    uploadedBytes: number;
    outputBytes: number;
    extractionAttempts: number;
    translationAttempts: number;
    successRate: number;
    averagePagesPerJob: number;
    averageTokensPerPage: number;
    averageDurationSeconds: number;
    p95DurationSeconds: number;
  };
  lifetime: {
    totalJobs: number;
    uniqueUsers: number;
    totalPages: number;
    totalTokens: number;
  };
  statusBreakdown: Array<{ status: string; jobs: number }>;
  languageBreakdown: Array<{ language: string; jobs: number; pages: number; tokens: number }>;
  dailyTrend: Array<{
    date: string;
    jobs: number;
    completed: number;
    failed: number;
    pages: number;
    tokens: number;
  }>;
  modelBreakdown: Array<{ role: string; model: string; pages: number; attempts: number }>;
  topUsers: Array<{
    userId: number;
    name: string;
    email: string | null;
    team: string | null;
    jobs: number;
    completed: number;
    failed: number;
    pages: number;
    inputTokens: number;
    outputTokens: number;
    lastUsedAt: string;
  }>;
  recentJobs: Array<{
    id: string;
    filename: string;
    targetLanguage: string;
    status: string;
    stage: string;
    progress: number;
    totalPages: number;
    createdAt: string;
    completedAt: string | null;
    message: string | null;
    userName: string;
    userEmail: string | null;
    inputTokens: number;
    outputTokens: number;
  }>;
}

const PERIOD_OPTIONS: Array<{ value: PeriodValue; label: string }> = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: '1 year' },
  { value: 'all', label: 'All time' },
];

const STATUS_STYLES: Record<string, string> = {
  completed: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  processing: 'bg-cyan-50 text-cyan-700 ring-cyan-600/20',
  queued: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  error: 'bg-rose-50 text-rose-700 ring-rose-600/20',
  cancelled: 'bg-slate-100 text-slate-600 ring-slate-500/20',
};

function formatNumber(value: number, maximumFractionDigits = 0) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits }).format(value || 0);
}

function formatBytes(value: number) {
  if (!value) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const unit = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${formatNumber(value / 1024 ** unit, unit > 1 ? 1 : 0)} ${units[unit]}`;
}

function formatDuration(value: number) {
  if (!value) return '0s';
  if (value < 60) return `${formatNumber(value, 1)}s`;
  if (value < 3600) return `${formatNumber(value / 60, 1)}m`;
  return `${formatNumber(value / 3600, 1)}h`;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function MetricCard({
  icon,
  eyebrow,
  value,
  detail,
  tone = 'ink',
}: {
  icon: React.ReactNode;
  eyebrow: string;
  value: string;
  detail: string;
  tone?: 'ink' | 'green' | 'cyan' | 'amber' | 'rose';
}) {
  const toneClass = {
    ink: 'bg-slate-950 text-white',
    green: 'bg-emerald-600 text-white',
    cyan: 'bg-cyan-600 text-white',
    amber: 'bg-amber-400 text-slate-950',
    rose: 'bg-rose-600 text-white',
  }[tone];

  return (
    <article className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.06)] transition-transform duration-200 hover:-translate-y-0.5">
      <div className="absolute right-0 top-0 h-24 w-24 translate-x-8 -translate-y-8 rounded-full bg-slate-100 transition-transform group-hover:scale-125" />
      <div className={`relative mb-7 flex h-10 w-10 items-center justify-center rounded-xl ${toneClass}`}>
        {icon}
      </div>
      <p className="relative text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{eyebrow}</p>
      <p className="relative mt-2 text-3xl font-semibold tracking-tight text-slate-950">{value}</p>
      <p className="relative mt-2 text-xs leading-5 text-slate-500">{detail}</p>
    </article>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize ring-1 ring-inset ${STATUS_STYLES[status] ?? STATUS_STYLES.cancelled}`}>
      {status}
    </span>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="grid min-h-40 place-items-center rounded-xl border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-500">
      {label}
    </div>
  );
}

export default function PdfTranslatorAdminPage() {
  const [period, setPeriod] = useState<PeriodValue>('30');
  const [stats, setStats] = useState<PdfTranslatorStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStats = useCallback(async (manual = false) => {
    manual ? setRefreshing(true) : setLoading(true);
    try {
      const response = await fetch(`/api/admin/pdf-translator/stats?period=${period}`, {
        cache: 'no-store',
      });
      const payload = await response.json() as PdfTranslatorStats | { error?: string };
      if (!response.ok || !('success' in payload) || payload.success !== true) {
        throw new Error('error' in payload && payload.error ? payload.error : 'Unable to load analytics');
      }
      setStats(payload);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load analytics');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [period]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  const chartData = useMemo(() => stats?.dailyTrend.map((item) => ({
    ...item,
    label: new Date(`${item.date}T00:00:00`).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    }),
  })) ?? [], [stats]);

  if (loading && !stats) {
    return (
      <div className="-m-6 grid min-h-[calc(100vh-4rem)] place-items-center bg-[#f3f5f1]">
        <div className="text-center">
          <Loader2 className="mx-auto h-10 w-10 animate-spin text-cyan-700" />
          <p className="mt-4 text-sm font-medium text-slate-600">Reading translator telemetry…</p>
        </div>
      </div>
    );
  }

  if (error && !stats) {
    return (
      <div className="-m-6 grid min-h-[calc(100vh-4rem)] place-items-center bg-[#f3f5f1] p-6">
        <div className="max-w-md rounded-2xl border border-rose-200 bg-white p-8 text-center shadow-xl">
          <AlertTriangle className="mx-auto h-10 w-10 text-rose-600" />
          <h1 className="mt-4 text-xl font-semibold text-slate-950">Analytics unavailable</h1>
          <p className="mt-2 text-sm text-slate-600">{error}</p>
          <button onClick={() => void loadStats(true)} className="mt-6 rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800">
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!stats) return null;
  const { overview } = stats;
  const inputTokenShare = overview.totalTokens > 0
    ? (overview.inputTokens / overview.totalTokens) * 100
    : 0;
  const statusTotal = stats.statusBreakdown.reduce((sum, item) => sum + item.jobs, 0);

  return (
    <div className="-m-6 min-h-screen bg-[#f3f5f1] pb-14 text-slate-950">
      <section className="relative overflow-hidden bg-[#0b1e25] px-6 py-8 text-white sm:px-8 lg:px-10">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_82%_10%,rgba(34,211,238,0.18),transparent_26%),radial-gradient(circle_at_5%_100%,rgba(16,185,129,0.15),transparent_30%)]" />
        <div className="relative mx-auto max-w-[1500px]">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-200">
                <ScanText className="h-3.5 w-3.5" /> Operations console
              </div>
              <h1 className="max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl">PDF Translator telemetry</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
                Translation volume, reliability, token consumption, document throughput, and user adoption in one operational view.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="sr-only" htmlFor="pdf-stats-period">Analytics period</label>
              <select
                id="pdf-stats-period"
                value={period}
                onChange={(event) => setPeriod(event.target.value as PeriodValue)}
                className="rounded-xl border border-white/15 bg-white/10 px-4 py-2.5 text-sm font-semibold text-white outline-none backdrop-blur focus:border-cyan-300 [&>option]:text-slate-950"
              >
                {PERIOD_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <button
                onClick={() => void loadStats(true)}
                disabled={refreshing}
                className="inline-flex items-center gap-2 rounded-xl bg-cyan-300 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:opacity-60"
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
          </div>

          <div className="mt-8 grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ['Lifetime jobs', formatNumber(stats.lifetime.totalJobs)],
              ['Lifetime pages', formatNumber(stats.lifetime.totalPages)],
              ['Lifetime users', formatNumber(stats.lifetime.uniqueUsers)],
              ['Lifetime tokens', formatNumber(stats.lifetime.totalTokens)],
            ].map(([label, value]) => (
              <div key={label} className="bg-[#102931]/95 px-5 py-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</p>
                <p className="mt-1 text-xl font-semibold text-white">{value}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-[1500px] space-y-6 px-6 pt-7 sm:px-8 lg:px-10">
        <ExcelUsageCard period={period} />
        {error && (
          <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <AlertTriangle className="h-4 w-4 shrink-0" /> Refresh failed; showing the last successful snapshot.
          </div>
        )}

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
          <MetricCard icon={<FileStack className="h-5 w-5" />} eyebrow="Translations" value={formatNumber(overview.totalJobs)} detail={`${formatNumber(overview.completedJobs)} completed`} />
          <MetricCard icon={<CheckCircle2 className="h-5 w-5" />} eyebrow="Success rate" value={`${formatNumber(overview.successRate * 100, 1)}%`} detail="Completed vs. failed terminal jobs" tone="green" />
          <MetricCard icon={<FileText className="h-5 w-5" />} eyebrow="Pages handled" value={formatNumber(overview.totalPages)} detail={`${formatNumber(overview.averagePagesPerJob, 1)} pages per job`} tone="cyan" />
          <MetricCard icon={<Users className="h-5 w-5" />} eyebrow="Unique users" value={formatNumber(overview.uniqueUsers)} detail="Users submitting documents" />
          <MetricCard icon={<Activity className="h-5 w-5" />} eyebrow="Active now" value={formatNumber(overview.activeJobs)} detail="Queued or processing" tone="amber" />
          <MetricCard icon={<AlertTriangle className="h-5 w-5" />} eyebrow="Failed jobs" value={formatNumber(overview.failedJobs)} detail={`${formatNumber(overview.cancelledJobs)} cancelled`} tone="rose" />
        </section>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(320px,0.75fr)]">
          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-700">Throughput</p>
                <h2 className="mt-1 text-xl font-semibold tracking-tight">Daily translation load</h2>
              </div>
              <div className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600">Jobs + pages</div>
            </div>
            {chartData.length ? (
              <div className="h-80 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                    <defs>
                      <linearGradient id="pageArea" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#0891b2" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#0891b2" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={28} />
                    <YAxis yAxisId="left" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip contentStyle={{ borderRadius: 12, borderColor: '#cbd5e1', boxShadow: '0 12px 30px rgba(15,23,42,.12)' }} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: 12, paddingTop: 16 }} />
                    <Area yAxisId="right" type="monotone" dataKey="pages" name="Pages" stroke="#0891b2" strokeWidth={2} fill="url(#pageArea)" />
                    <Bar yAxisId="left" dataKey="completed" name="Completed jobs" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={18} />
                    <Bar yAxisId="left" dataKey="failed" name="Failed jobs" fill="#e11d48" radius={[4, 4, 0, 0]} maxBarSize={18} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            ) : <EmptyState label="No translator activity in this period" />}
          </article>

          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-slate-950 text-white"><Gauge className="h-5 w-5" /></div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Reliability</p>
                <h2 className="text-lg font-semibold">Job status</h2>
              </div>
            </div>
            <div className="mt-7 space-y-4">
              {stats.statusBreakdown.map((item) => {
                const percent = statusTotal > 0 ? (item.jobs / statusTotal) * 100 : 0;
                return (
                  <div key={item.status}>
                    <div className="mb-1.5 flex items-center justify-between text-sm">
                      <span className="capitalize text-slate-600">{item.status}</span>
                      <span className="font-semibold text-slate-950">{formatNumber(item.jobs)} <span className="font-normal text-slate-400">· {formatNumber(percent, 1)}%</span></span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-cyan-600" style={{ width: `${percent}%` }} />
                    </div>
                  </div>
                );
              })}
              {!stats.statusBreakdown.length && <EmptyState label="No job status data" />}
            </div>
          </article>
        </section>

        <section className="grid gap-6 lg:grid-cols-3">
          <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3"><Database className="h-5 w-5 text-cyan-700" /><h2 className="text-lg font-semibold">Token consumption</h2></div>
            <p className="mt-5 text-4xl font-semibold tracking-tight">{formatNumber(overview.totalTokens)}</p>
            <p className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-400">Total model tokens</p>
            <div className="mt-6 flex h-3 overflow-hidden rounded-full bg-slate-100">
              <div className="bg-cyan-600" style={{ width: `${inputTokenShare}%` }} />
              <div className="bg-emerald-500" style={{ width: `${100 - inputTokenShare}%` }} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div><span className="inline-block h-2 w-2 rounded-full bg-cyan-600" /> <span className="ml-1 text-slate-500">Input</span><p className="mt-1 font-semibold">{formatNumber(overview.inputTokens)}</p></div>
              <div><span className="inline-block h-2 w-2 rounded-full bg-emerald-500" /> <span className="ml-1 text-slate-500">Output</span><p className="mt-1 font-semibold">{formatNumber(overview.outputTokens)}</p></div>
            </div>
            <p className="mt-5 border-t border-slate-100 pt-4 text-xs text-slate-500">{formatNumber(overview.averageTokensPerPage)} average tokens per source page</p>
          </article>

          <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3"><Clock3 className="h-5 w-5 text-cyan-700" /><h2 className="text-lg font-semibold">Processing time</h2></div>
            <div className="mt-6 grid grid-cols-2 gap-4">
              <div className="rounded-xl bg-slate-950 p-4 text-white"><p className="text-[10px] uppercase tracking-[0.16em] text-slate-400">Average</p><p className="mt-2 text-2xl font-semibold">{formatDuration(overview.averageDurationSeconds)}</p></div>
              <div className="rounded-xl bg-cyan-50 p-4 text-cyan-950"><p className="text-[10px] uppercase tracking-[0.16em] text-cyan-700">P95</p><p className="mt-2 text-2xl font-semibold">{formatDuration(overview.p95DurationSeconds)}</p></div>
            </div>
            <dl className="mt-6 space-y-3 text-sm">
              <div className="flex justify-between"><dt className="text-slate-500">Extraction attempts</dt><dd className="font-semibold">{formatNumber(overview.extractionAttempts)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Translation attempts</dt><dd className="font-semibold">{formatNumber(overview.translationAttempts)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Pages per job</dt><dd className="font-semibold">{formatNumber(overview.averagePagesPerJob, 1)}</dd></div>
            </dl>
          </article>

          <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-3"><HardDrive className="h-5 w-5 text-cyan-700" /><h2 className="text-lg font-semibold">Document storage</h2></div>
            <div className="mt-6 space-y-5">
              <div><div className="flex items-end justify-between"><span className="text-sm text-slate-500">Uploaded PDFs</span><span className="text-xl font-semibold">{formatBytes(overview.uploadedBytes)}</span></div><div className="mt-2 h-2 rounded-full bg-slate-100"><div className="h-full w-full rounded-full bg-slate-800" /></div></div>
              <div><div className="flex items-end justify-between"><span className="text-sm text-slate-500">Generated PDFs</span><span className="text-xl font-semibold">{formatBytes(overview.outputBytes)}</span></div><div className="mt-2 h-2 rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${overview.uploadedBytes > 0 ? Math.min(100, (overview.outputBytes / overview.uploadedBytes) * 100) : 0}%` }} /></div></div>
            </div>
            <p className="mt-6 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-500">Stored volume includes the source PDF and the latest generated translation retained for each job.</p>
          </article>
        </section>

        <section className="grid gap-6 xl:grid-cols-2">
          <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-5 flex items-center gap-3"><Languages className="h-5 w-5 text-cyan-700" /><div><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Demand mix</p><h2 className="text-lg font-semibold">Target languages</h2></div></div>
            {stats.languageBreakdown.length ? (
              <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-sm"><thead><tr className="border-b border-slate-200 text-left text-[10px] uppercase tracking-[0.16em] text-slate-400"><th className="pb-3 font-semibold">Language</th><th className="pb-3 text-right font-semibold">Jobs</th><th className="pb-3 text-right font-semibold">Pages</th><th className="pb-3 text-right font-semibold">Tokens</th></tr></thead><tbody>{stats.languageBreakdown.map((item) => <tr key={item.language} className="border-b border-slate-100 last:border-0"><td className="py-3 font-semibold">{item.language}</td><td className="py-3 text-right">{formatNumber(item.jobs)}</td><td className="py-3 text-right">{formatNumber(item.pages)}</td><td className="py-3 text-right text-slate-500">{formatNumber(item.tokens)}</td></tr>)}</tbody></table></div>
            ) : <EmptyState label="No language usage in this period" />}
          </article>

          <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-5 flex items-center gap-3"><Cpu className="h-5 w-5 text-cyan-700" /><div><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">OpenAI passes</p><h2 className="text-lg font-semibold">Model execution</h2></div></div>
            {stats.modelBreakdown.length ? <div className="space-y-3">{stats.modelBreakdown.map((item) => <div key={`${item.role}-${item.model}`} className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-cyan-700">{item.role}</p><p className="mt-1 font-mono text-sm text-slate-700">{item.model}</p></div><div className="text-right"><p className="font-semibold">{formatNumber(item.pages)} pages</p><p className="text-xs text-slate-500">{formatNumber(item.attempts)} attempts</p></div></div>)}</div> : <EmptyState label="No model usage in this period" />}
          </article>
        </section>

        <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5"><div><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-700">Adoption</p><h2 className="mt-1 text-xl font-semibold">Top translator users</h2></div><Users className="h-5 w-5 text-slate-400" /></div>
          {stats.topUsers.length ? <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-sm"><thead className="bg-slate-50"><tr className="text-left text-[10px] uppercase tracking-[0.15em] text-slate-400"><th className="px-6 py-3 font-semibold">User</th><th className="px-4 py-3 font-semibold">Team</th><th className="px-4 py-3 text-right font-semibold">Jobs</th><th className="px-4 py-3 text-right font-semibold">Completed</th><th className="px-4 py-3 text-right font-semibold">Failed</th><th className="px-4 py-3 text-right font-semibold">Pages</th><th className="px-6 py-3 text-right font-semibold">Tokens</th></tr></thead><tbody>{stats.topUsers.map((user) => <tr key={user.userId} className="border-t border-slate-100 hover:bg-slate-50/70"><td className="px-6 py-3.5"><p className="font-semibold text-slate-900">{user.name}</p><p className="text-xs text-slate-500">{user.email ?? 'No email'} · last used {formatDate(user.lastUsedAt)}</p></td><td className="px-4 py-3.5 text-slate-500">{user.team ?? '—'}</td><td className="px-4 py-3.5 text-right font-semibold">{formatNumber(user.jobs)}</td><td className="px-4 py-3.5 text-right text-emerald-700">{formatNumber(user.completed)}</td><td className="px-4 py-3.5 text-right text-rose-700">{formatNumber(user.failed)}</td><td className="px-4 py-3.5 text-right">{formatNumber(user.pages)}</td><td className="px-6 py-3.5 text-right text-slate-500">{formatNumber(user.inputTokens + user.outputTokens)}</td></tr>)}</tbody></table></div> : <div className="p-6"><EmptyState label="No user activity in this period" /></div>}
        </article>

        <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5"><div><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-700">Live ledger</p><h2 className="mt-1 text-xl font-semibold">Recent translations</h2></div><FileText className="h-5 w-5 text-slate-400" /></div>
          {stats.recentJobs.length ? <div className="overflow-x-auto"><table className="w-full min-w-[1120px] text-sm"><thead className="bg-slate-50"><tr className="text-left text-[10px] uppercase tracking-[0.15em] text-slate-400"><th className="px-6 py-3 font-semibold">Document</th><th className="px-4 py-3 font-semibold">User</th><th className="px-4 py-3 font-semibold">Target</th><th className="px-4 py-3 font-semibold">Status</th><th className="px-4 py-3 text-right font-semibold">Progress</th><th className="px-4 py-3 text-right font-semibold">Pages</th><th className="px-4 py-3 text-right font-semibold">Tokens</th><th className="px-6 py-3 text-right font-semibold">Created</th></tr></thead><tbody>{stats.recentJobs.map((job) => <tr key={job.id} className="border-t border-slate-100 align-top hover:bg-slate-50/70"><td className="max-w-sm px-6 py-4"><p className="truncate font-semibold text-slate-900" title={job.filename}>{job.filename}</p><p className="mt-1 font-mono text-[10px] text-slate-400">{job.id}</p>{job.status === 'error' && job.message && <p className="mt-2 line-clamp-2 text-xs leading-5 text-rose-600" title={job.message}>{job.message}</p>}</td><td className="px-4 py-4"><p className="font-medium">{job.userName}</p><p className="text-xs text-slate-500">{job.userEmail ?? 'No email'}</p></td><td className="px-4 py-4">{job.targetLanguage}</td><td className="px-4 py-4"><StatusBadge status={job.status} /><p className="mt-1.5 text-[11px] capitalize text-slate-400">{job.stage}</p></td><td className="px-4 py-4 text-right font-semibold">{formatNumber(job.progress)}%</td><td className="px-4 py-4 text-right">{formatNumber(job.totalPages)}</td><td className="px-4 py-4 text-right text-slate-500">{formatNumber(job.inputTokens + job.outputTokens)}</td><td className="whitespace-nowrap px-6 py-4 text-right text-xs text-slate-500">{formatDate(job.createdAt)}</td></tr>)}</tbody></table></div> : <div className="p-6"><EmptyState label="No translations in this period" /></div>}
        </article>
      </main>
    </div>
  );
}
