import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Database,
  type LucideIcon,
  Mail,
  Search,
  XCircle,
} from "lucide-react";

import { getTenderMonitorHealth } from "@/lib/monitored-tenders/health";

export const dynamic = "force-dynamic";

function formatDate(value: Date | null): string {
  if (!value) return "Never";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatDuration(ms: number | null): string {
  if (ms == null) return "-";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function ageLabel(value: Date | null): string {
  if (!value) return "never";
  const diffMs = Date.now() - new Date(value).getTime();
  const diffMinutes = Math.max(0, Math.floor(diffMs / 60000));
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 48) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}

function statusClass(status: string): string {
  if (status === "success" || status === "resolved") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (status === "failed" || status === "open") {
    return "border-red-200 bg-red-50 text-red-700";
  }
  if (status === "running") {
    return "border-blue-200 bg-blue-50 text-blue-700";
  }
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function Stat({
  label,
  value,
  subtext,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  subtext?: string;
  icon: LucideIcon;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm font-medium text-gray-600">{label}</p>
        <Icon className="h-5 w-5 text-gray-400" />
      </div>
      <p className="text-3xl font-semibold text-gray-950">{value}</p>
      {subtext ? <p className="mt-2 text-sm text-gray-500">{subtext}</p> : null}
    </div>
  );
}

export default async function TenderMonitorAdminPage() {
  const health = await getTenderMonitorHealth();
  const { summary } = health;
  const openAlerts = health.alerts.filter((alert) => alert.status === "open");
  const unhealthySources = health.sources.filter(
    (source) => source.consecutive_failures > 0 || source.last_error,
  );

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-950">Tender Monitor</h1>
          <p className="mt-2 text-sm text-gray-600">
            Hourly extractor runs, source health, candidate matching, and email delivery.
          </p>
        </div>
        <div
          className={`inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium ${
            summary.open_alerts || summary.failed_runs_24h
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-emerald-200 bg-emerald-50 text-emerald-700"
          }`}
        >
          {summary.open_alerts || summary.failed_runs_24h ? (
            <AlertTriangle className="h-4 w-4" />
          ) : (
            <CheckCircle2 className="h-4 w-4" />
          )}
          {summary.open_alerts || summary.failed_runs_24h
            ? "Needs attention"
            : "Healthy"}
        </div>
      </div>

      {health.setupRequired ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-amber-900">
          <h2 className="font-semibold">Schema setup required</h2>
          <p className="mt-2 text-sm">
            Apply the monitored tender schema SQL against the ESG database before using this page.
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Active Tenders"
          value={summary.active_tenders}
          subtext={`${summary.esg_tenders} ESG, ${summary.credit_tenders} credit`}
          icon={Database}
        />
        <Stat
          label="Latest Discovery"
          value={ageLabel(summary.latest_first_seen_at)}
          subtext={formatDate(summary.latest_first_seen_at)}
          icon={Clock}
        />
        <Stat
          label="Last Extractor Run"
          value={ageLabel(summary.latest_run_at)}
          subtext={`${summary.failed_runs_24h} failed runs in 24h`}
          icon={Activity}
        />
        <Stat
          label="Email Delivery"
          value={summary.emails_sent_7d}
          subtext={`${summary.emails_failed_7d} failed in 7d, ${summary.email_recipients} recipients`}
          icon={Mail}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 px-5 py-4">
            <h2 className="text-lg font-semibold text-gray-950">Open Alerts</h2>
          </div>
          <div className="divide-y divide-gray-100">
            {openAlerts.length ? (
              openAlerts.map((alert) => (
                <div key={alert.id} className="p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full border px-2.5 py-1 text-xs font-medium ${statusClass(
                        alert.status,
                      )}`}
                    >
                      {alert.severity}
                    </span>
                    {alert.source_name ? (
                      <span className="text-xs font-medium text-gray-500">
                        {alert.source_name}
                      </span>
                    ) : null}
                    <span className="text-xs text-gray-500">
                      {ageLabel(alert.last_seen_at)}
                    </span>
                  </div>
                  <h3 className="mt-3 font-semibold text-gray-950">{alert.title}</h3>
                  <p className="mt-1 text-sm text-gray-600">{alert.detail}</p>
                </div>
              ))
            ) : (
              <div className="p-5 text-sm text-gray-500">No open alerts.</div>
            )}
          </div>
        </section>

        <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 px-5 py-4">
            <h2 className="text-lg font-semibold text-gray-950">Candidate Matching</h2>
          </div>
          <div className="p-5">
            <div className="mb-5 grid grid-cols-2 gap-3">
              <div className="rounded-md border border-gray-200 p-4">
                <p className="text-sm text-gray-500">Fetched 24h</p>
                <p className="mt-1 text-2xl font-semibold text-gray-950">
                  {summary.candidates_24h}
                </p>
              </div>
              <div className="rounded-md border border-gray-200 p-4">
                <p className="text-sm text-gray-500">Unmatched 24h</p>
                <p className="mt-1 text-2xl font-semibold text-gray-950">
                  {summary.unmatched_candidates_24h}
                </p>
              </div>
            </div>
            <div className="space-y-2">
              {health.candidateCounts.length ? (
                health.candidateCounts.map((row) => (
                  <div
                    key={`${row.source_name}-${row.match_status}`}
                    className="flex items-center justify-between rounded-md bg-gray-50 px-3 py-2 text-sm"
                  >
                    <span className="font-medium text-gray-700">
                      {row.source_name} / {row.match_status}
                    </span>
                    <span className="font-semibold text-gray-950">{row.count}</span>
                  </div>
                ))
              ) : (
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <Search className="h-4 w-4" />
                  No candidates in the last 24 hours.
                </div>
              )}
            </div>
          </div>
        </section>
      </div>

      <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <h2 className="text-lg font-semibold text-gray-950">Sources</h2>
          <span className="text-sm text-gray-500">
            {summary.enabled_sources} of {summary.total_sources} enabled
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-5 py-3">Source</th>
                <th className="px-5 py-3">Country</th>
                <th className="px-5 py-3">Last success</th>
                <th className="px-5 py-3">Failures</th>
                <th className="px-5 py-3">Seen</th>
                <th className="px-5 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {health.sources.map((source) => (
                <tr key={source.name}>
                  <td className="px-5 py-4">
                    <div className="font-medium text-gray-950">{source.display_name}</div>
                    <div className="text-xs text-gray-500">{source.name}</div>
                    {source.last_error ? (
                      <div className="mt-1 max-w-lg truncate text-xs text-red-600">
                        {source.last_error}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-5 py-4 text-gray-600">{source.country}</td>
                  <td className="px-5 py-4 text-gray-600">
                    {ageLabel(source.last_success_at)}
                    <div className="text-xs text-gray-400">
                      {formatDate(source.last_success_at)}
                    </div>
                  </td>
                  <td className="px-5 py-4 font-medium text-gray-950">
                    {source.consecutive_failures}
                  </td>
                  <td className="px-5 py-4 text-gray-600">
                    {source.total_tenders_seen}
                  </td>
                  <td className="px-5 py-4">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${
                        source.enabled
                          ? source.consecutive_failures
                            ? "border-amber-200 bg-amber-50 text-amber-700"
                            : "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-gray-200 bg-gray-50 text-gray-600"
                      }`}
                    >
                      {source.consecutive_failures ? (
                        <XCircle className="h-3.5 w-3.5" />
                      ) : (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      )}
                      {source.enabled ? "Enabled" : "Disabled"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {unhealthySources.length ? (
          <div className="border-t border-gray-200 bg-amber-50 px-5 py-3 text-sm text-amber-900">
            {unhealthySources.length} source(s) have recent failures.
          </div>
        ) : null}
      </section>

      <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 px-5 py-4">
          <h2 className="text-lg font-semibold text-gray-950">Recent Runs</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-5 py-3">Started</th>
                <th className="px-5 py-3">Source</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Fetched</th>
                <th className="px-5 py-3">Matched</th>
                <th className="px-5 py-3">Saved</th>
                <th className="px-5 py-3">Emails</th>
                <th className="px-5 py-3">Duration</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {health.recentRuns.map((run) => (
                <tr key={run.id}>
                  <td className="px-5 py-4 text-gray-600">
                    {ageLabel(run.started_at)}
                    <div className="text-xs text-gray-400">
                      {formatDate(run.started_at)}
                    </div>
                  </td>
                  <td className="px-5 py-4 font-medium text-gray-950">
                    {run.source_name}
                  </td>
                  <td className="px-5 py-4">
                    <span
                      className={`rounded-full border px-2.5 py-1 text-xs font-medium ${statusClass(
                        run.status,
                      )}`}
                    >
                      {run.status}
                    </span>
                    {run.error ? (
                      <div className="mt-1 max-w-xs truncate text-xs text-red-600">
                        {run.error_type}: {run.error}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-5 py-4 text-gray-600">{run.fetched}</td>
                  <td className="px-5 py-4 text-gray-600">
                    {run.matched_total}
                    <div className="text-xs text-gray-400">
                      {run.matched_esg} ESG, {run.matched_credit} credit
                    </div>
                  </td>
                  <td className="px-5 py-4 text-gray-600">
                    {run.created_count} new
                    <div className="text-xs text-gray-400">
                      {run.updated_count} changed, {run.deleted_count} deleted
                    </div>
                  </td>
                  <td className="px-5 py-4 text-gray-600">{run.emails_sent}</td>
                  <td className="px-5 py-4 text-gray-600">
                    {formatDuration(run.duration_ms)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="flex justify-end">
        <Link
          href="/esg/tenders"
          className="rounded-md bg-gray-950 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          Open Tender Page
        </Link>
      </div>
    </div>
  );
}
