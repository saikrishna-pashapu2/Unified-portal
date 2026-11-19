"use client";

import {
  AlertCircle,
  CalendarClock,
  Check,
  ClipboardList,
  Clock3,
  Loader2,
  Mail,
  Sparkles,
} from "lucide-react";
import type {
  ArticleAiDomain,
  ArticleAiPreference,
  ArticleAiWeeklyStatus,
  ArticleAiWeeklySummary,
} from "@/lib/article-ai/types";
import { useArticleAi } from "./ArticleAiProvider";

const DUBAI_TIMEZONE = "Asia/Dubai";

function formatDubaiDate(value: string | null | undefined) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: DUBAI_TIMEZONE,
    dateStyle: "medium",
  }).format(date);
}

function formatDubaiExclusiveDate(value: string | null | undefined) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  // Weekly sourceEnd is the exclusive Saturday 00:00 Dubai boundary. Show
  // the last included calendar day so the UI reads as Monday–Friday.
  date.setTime(date.getTime() - 1);
  return formatDubaiDate(date.toISOString());
}

function formatDubaiDateTime(value: string | null | undefined) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: DUBAI_TIMEZONE,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatCount(value: number | null | undefined) {
  return Number.isFinite(value) ? new Intl.NumberFormat("en-US").format(Number(value)) : "0";
}

function weeklyStatusLabel(status: ArticleAiWeeklyStatus | undefined) {
  switch (status) {
    case "manifesting":
      return "Preparing this week's inputs";
    case "assessing_history":
      return "Reviewing liked-article history";
    case "merging_history":
      return "Combining history review";
    case "evaluating_candidates":
      return "Reviewing current candidates";
    case "merging_candidates":
      return "Combining candidate review";
    case "ready":
      return "Last weekly pass ready";
    case "error":
      return "Weekly assessment needs attention";
    case "budget_exhausted":
      return "Weekly assessment paused at its AI budget";
    case "insufficient_history":
      return "Waiting for usable liked-article history";
    case "expired":
      return "The previous weekly pass has expired";
    case "cancelled":
      return "Weekly assessment cancelled";
    case "queued":
      return "Weekly email pass queued";
    default:
      return "Weekly email status is not available yet";
  }
}

function weeklyStatusTone(status: ArticleAiWeeklyStatus | undefined) {
  if (status === "ready") return "bg-emerald-100 text-emerald-800";
  if (status === "error" || status === "budget_exhausted" || status === "cancelled") {
    return "bg-rose-100 text-rose-800";
  }
  if (status === "insufficient_history" || status === "expired") {
    return "bg-amber-100 text-amber-800";
  }
  return "bg-sky-100 text-sky-800";
}

function weeklyCoverageCopy(weekly: ArticleAiWeeklySummary) {
  const history = `${formatCount(weekly.coverage.historyProcessed)} of ${formatCount(weekly.coverage.historyTotal)} history inputs`;
  const candidates = `${formatCount(weekly.coverage.candidateProcessed)} of ${formatCount(weekly.coverage.candidateTotal)} candidates`;
  const complete = weekly.coverage.status === "complete" && weekly.status === "ready";
  return complete
    ? `Reviewed ${history} and ${candidates}.`
    : `Reviewed ${history} and ${candidates} so far.`;
}

function dailyStatusLabel(status: string | undefined) {
  switch (status) {
    case "manifest":
    case "manifesting":
      return "Preparing this source day";
    case "history_profile":
    case "assessing_history":
      return "Reviewing shared liked history";
    case "history_merge":
    case "merging_history":
      return "Combining history review";
    case "candidate_evaluation":
    case "evaluating_candidates":
      return "Reviewing current candidates";
    case "candidate_merge":
    case "merging_candidates":
      return "Combining candidate review";
    case "finalize":
      return "Finalizing shared picks";
    case "queued":
      return "Queued for assessment";
    case "running":
    case "processing":
      return "Assessing this source day";
    case "ready":
      return "Ready to review";
    case "insufficient":
    case "insufficient_history":
      return "Needs one usable human-liked article";
    case "budget_exhausted":
      return "Paused at the AI budget";
    case "error":
      return "Assessment needs attention";
    case "expired":
      return "Assessment window expired";
    case "cancelled":
      return "Assessment cancelled";
    default:
      return "Daily status is not available yet";
  }
}

function dailyStatusTone(status: string | undefined) {
  if (status === "ready") return "bg-emerald-100 text-emerald-800";
  if (status === "error" || status === "budget_exhausted" || status === "cancelled") return "bg-rose-100 text-rose-800";
  if (status === "insufficient" || status === "insufficient_history" || status === "expired") return "bg-amber-100 text-amber-800";
  return "bg-sky-100 text-sky-800";
}

function DailySummary({
  domain,
  daily,
}: {
  domain: ArticleAiDomain;
  daily: ArticleAiPreference["daily"];
}) {
  const status = daily?.status;
  const sourceDay = daily?.sourceDay ? formatDubaiDate(daily.sourceDay) : null;

  return (
    <div
      className="mt-4 rounded-xl border border-slate-200 bg-slate-50/80 p-3.5"
      data-testid={`article-ai-daily-${domain}`}
      data-source-day={daily?.sourceDay ?? undefined}
      aria-label={`Daily ${domain.toUpperCase()} AI assessment`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 rounded-lg bg-slate-200 p-2 text-slate-700">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-700">
              Daily shared assessment
            </p>
            <p className="mt-1 text-xs leading-5 text-slate-600">
              This domain-wide result is visible in the archive whether your private email switch is on or off.
            </p>
          </div>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] ${dailyStatusTone(status)}`}
          data-testid={`article-ai-daily-status-${domain}`}
        >
          {dailyStatusLabel(status)}
        </span>
      </div>

      {daily ? (
        <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
            <p className="font-semibold text-slate-700">Source day · Dubai</p>
            <p className="mt-0.5 text-slate-600">{sourceDay ?? daily.sourceDay}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
            <p className="font-semibold text-slate-700">Shared AI picks</p>
            <p className="mt-0.5 text-slate-600" data-selection-count={daily.selectionCount}>{formatCount(daily.selectionCount)} selected</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
            <p className="font-semibold text-slate-700">Archive visibility</p>
            <p className="mt-0.5 text-slate-600">Available in the Only AI picks filter</p>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-xs leading-5 text-slate-600">
          The first daily assessment is not available yet. New source days are assessed after 12:15 am Dubai; completed shared picks appear in the article archive.
        </p>
      )}
    </div>
  );
}

function WeeklySummary({
  domain,
  weekly,
}: {
  domain: ArticleAiDomain;
  weekly: ArticleAiWeeklySummary | null | undefined;
}) {
  const status = weekly?.status;
  const coverage = weekly?.coverage;
  const complete = Boolean(weekly && coverage?.status === "complete" && status === "ready");
  const statusLabel = weeklyStatusLabel(status);

  return (
    <div
      className="mt-4 rounded-xl border border-slate-200 bg-slate-50/80 p-3.5"
      data-testid={`article-ai-weekly-${domain}`}
      aria-label={`Weekly ${domain.toUpperCase()} email schedule and last AI assessment`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 rounded-lg bg-slate-200 p-2 text-slate-700">
            <CalendarClock className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-700">
              Weekly email assessment
            </p>
            <p className="mt-1 text-xs leading-5 text-slate-600">
              Daily AI picks are assessed separately. This panel shows the last weekly email pass and schedule; it does not control the Only AI picks filter.
            </p>
          </div>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] ${weeklyStatusTone(status)}`}
          data-testid={`article-ai-weekly-status-${domain}`}
        >
          {statusLabel}
        </span>
      </div>

      <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
          <p className="font-semibold text-slate-700">Last target week · Monday delivery</p>
          <p className="mt-0.5 text-slate-600">
            {weekly ? formatDubaiDate(weekly.targetWeekKey) : "Next scheduled email"}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
          <p className="font-semibold text-slate-700">Review window</p>
          <p className="mt-0.5 text-slate-600">
            {weekly
              ? `${formatDubaiDate(weekly.sourceStart)} – ${formatDubaiExclusiveDate(weekly.sourceEnd)} Dubai`
              : "Monday–Friday · Dubai"}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
          <p className="font-semibold text-slate-700">Processing</p>
          <p className="mt-0.5 text-slate-600">
            Saturday at 12:15 am Dubai
            {weekly ? <span className="block text-[11px] text-slate-500">{formatDubaiDateTime(weekly.processingAt)}</span> : null}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
          <p className="font-semibold text-slate-700">Email window</p>
          <p className="mt-0.5 text-slate-600">
            Monday at 9:00 am Dubai
            {weekly ? <span className="block text-[11px] text-slate-500">{formatDubaiDateTime(weekly.emailAt)}</span> : null}
          </p>
        </div>
      </div>

      {weekly ? (
        <>
          <div
            className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4"
            data-testid={`article-ai-weekly-coverage-${domain}`}
          >
            <div className="flex items-start gap-2 rounded-lg bg-white px-3 py-2">
              <ClipboardList className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden="true" />
              <span>
                <span className="block font-semibold text-slate-700">Input review</span>
                <span className="mt-0.5 block text-slate-600">{weeklyCoverageCopy(weekly)}</span>
              </span>
            </div>
            <div className="flex items-start gap-2 rounded-lg bg-white px-3 py-2">
              <span className="mt-0.5 text-slate-500" aria-hidden="true">×</span>
              <span>
                <span className="block font-semibold text-slate-700">Explicit exclusions</span>
                <span className="mt-0.5 block text-slate-600">
                  {formatCount(weekly.coverage.historyExcluded)} history · {formatCount(weekly.coverage.candidateExcluded)} candidates
                </span>
              </span>
            </div>
            <div className="flex items-start gap-2 rounded-lg bg-white px-3 py-2">
              <Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden="true" />
              <span>
                <span className="block font-semibold text-slate-700">Carryover</span>
                <span className="mt-0.5 block text-slate-600">
                  {formatCount(weekly.coverage.candidateCarryover)} candidate{weekly.coverage.candidateCarryover === 1 ? "" : "s"}
                </span>
              </span>
            </div>
            <div className="flex items-start gap-2 rounded-lg bg-white px-3 py-2">
              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden="true" />
              <span>
                <span className="block font-semibold text-slate-700">Shared picks</span>
                <span className="mt-0.5 block text-slate-600">{formatCount(weekly.selectionCount)} selected</span>
              </span>
            </div>
          </div>

          {weekly.assessmentSummary ? (
            <p className="mt-3 rounded-lg bg-white px-3 py-2 text-xs leading-5 text-slate-700">
              {weekly.assessmentSummary}
            </p>
          ) : null}

          {complete ? (
            weekly.selectionCount === 0 ? (
              <p className="mt-3 text-[11px] leading-5 text-slate-600">
                This weekly pass completed without selecting a shared pick.
              </p>
            ) : null
          ) : (
            <p className="mt-3 text-[11px] leading-5 text-amber-800">
              Coverage is partial or this pass did not finish; these results do not claim that every input was reviewed.
            </p>
          )}

          <p className="mt-2 text-[11px] text-slate-500">
            Expires {formatDubaiDateTime(weekly.validUntil)} in Dubai · model {weekly.model}
            {weekly.completedAt ? ` · completed ${formatDubaiDateTime(weekly.completedAt)}` : ""}
          </p>
        </>
      ) : (
        <p className="mt-3 text-xs leading-5 text-slate-600">
          The next weekly email pass reviews Monday–Friday inputs, processes them Saturday at 12:15 am Dubai, and prepares the email for Monday at 9:00 am Dubai. Daily AI picks are available independently in the article filters.
        </p>
      )}
    </div>
  );
}

export default function ArticleAiControls({
  domain,
  className = "",
}: {
  domain: ArticleAiDomain;
  className?: string;
}) {
  const {
    isAuthenticated,
    preference,
    loading,
    savingPreference,
    error,
    refresh,
    setEnabled,
  } = useArticleAi();

  const isCredit = domain === "credit";
  const accent = isCredit
    ? {
        border: "border-blue-200",
        icon: "bg-blue-100 text-blue-700",
        switchOn: "bg-blue-600",
        switchDot: "translate-x-5",
        badge: "bg-blue-50 text-blue-800",
      }
    : {
        border: "border-emerald-200",
        icon: "bg-emerald-100 text-emerald-700",
        switchOn: "bg-emerald-600",
        switchDot: "translate-x-5",
        badge: "bg-emerald-50 text-emerald-800",
      };

  if (!isAuthenticated) {
    return (
      <section
        className={`rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-4 ${className}`}
        aria-label="AI article selection"
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 rounded-lg bg-slate-200 p-2 text-slate-600">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-slate-900">AI article selection</h3>
            <p className="mt-1 text-xs leading-5 text-slate-600">
              Sign in to choose whether shared AI picks appear in your private weekly email digest.
            </p>
            <a
              href="/signin"
              className="mt-2 inline-flex text-xs font-semibold text-slate-800 underline decoration-slate-300 underline-offset-4 hover:decoration-slate-700"
            >
              Sign in to manage digest picks
            </a>
          </div>
        </div>
      </section>
    );
  }

  if (loading && !preference) {
    return (
      <section
        className={`rounded-xl border ${accent.border} bg-white p-4 ${className}`}
        aria-label="AI article selection"
        aria-busy="true"
      >
        <div className="flex items-center gap-3 text-sm text-slate-600">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Loading AI article settings…
        </div>
      </section>
    );
  }

  if (!preference) {
    return (
      <section
        className={`rounded-xl border border-rose-200 bg-rose-50 p-4 ${className}`}
        aria-label="AI article selection"
        role="alert"
      >
        <div className="flex items-start gap-3">
          <AlertCircle className="mt-0.5 h-4 w-4 text-rose-600" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-rose-900">AI settings unavailable</h3>
            <p className="mt-1 text-xs leading-5 text-rose-800">{error ?? "Please try again."}</p>
            <button
              type="button"
              onClick={() => void refresh()}
              className="mt-2 text-xs font-semibold text-rose-900 underline underline-offset-4"
            >
              Try again
            </button>
          </div>
        </div>
      </section>
    );
  }

  const profileMessage = `The shared ${domain.toUpperCase()} profile learns from all human-liked articles in this domain. Your switch controls only whether shared picks appear in your private weekly email.`;
  const emailReady = preference.emailInclusionEnabled && preference.weeklyDigestConfigured && !preference.scheduleMismatch;
  const daily = preference.daily;

  return (
    <section
      className={`rounded-xl border ${accent.border} bg-white p-4 shadow-sm ${className}`}
      aria-label={`${domain.toUpperCase()} AI article selection`}
      data-testid={`article-ai-controls-${domain}`}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className={`mt-0.5 rounded-lg p-2 ${accent.icon}`}>
            <Sparkles className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-slate-950">AI picks for my digest</h3>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${accent.badge}`}>
                {domain}
              </span>
            </div>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-600">
              Selects useful {domain.toUpperCase()} articles from the shared history of human-liked articles. This switch controls only your private weekly email.
            </p>
          </div>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={preference.enabled}
          aria-label={`${preference.enabled ? "Turn off" : "Turn on"} AI picks for ${domain}`}
          aria-busy={savingPreference}
          aria-disabled={savingPreference}
          data-testid={`article-ai-toggle-${domain}`}
          onClick={() => {
            if (!savingPreference) void setEnabled(!preference.enabled);
          }}
          className={`inline-flex h-7 w-12 shrink-0 items-center rounded-full p-1 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2 aria-disabled:cursor-wait aria-disabled:opacity-60 ${preference.enabled ? accent.switchOn : "bg-slate-300"}`}
        >
          <span
            className={`h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${preference.enabled ? accent.switchDot : "translate-x-0"}`}
          />
        </button>
      </div>

      <div className="mt-4 grid gap-2 text-xs sm:grid-cols-2">
        <p className="rounded-lg bg-slate-50 px-3 py-2 leading-5 text-slate-600">{profileMessage}</p>
        <p className="rounded-lg bg-slate-50 px-3 py-2 leading-5 text-slate-600">
          The weekly status below is for email delivery. Daily shared picks remain available in the article filters, and turning this switch on does not start a separate AI run.
        </p>
      </div>

      {preference.weekly && !daily ? (
        <WeeklySummary domain={domain} weekly={preference.weekly} />
      ) : (
        <DailySummary domain={domain} daily={daily} />
      )}

      {!preference.emailInclusionEnabled ? (
        <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          AI email inclusion is currently unavailable here. Shared picks remain reviewable, but they will not be added to email.
        </p>
      ) : !preference.weeklyDigestConfigured ? (
        <p className="mt-3 flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs leading-5 text-sky-900">
          <Mail className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
          To receive private AI picks, configure an existing weekly article email for this domain to your account email on Monday at 9:00 am Dubai in{" "}
            <a href="/profile" className="font-semibold underline underline-offset-4">
              Profile → Alerts
            </a>
            . This switch will not create or change that subscription.
          </span>
        </p>
      ) : preference.scheduleMismatch ? (
        <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
          <Clock3 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            Your existing weekly article email uses a different schedule. AI picks require Monday at 9:00 am Dubai. Update this in{" "}
            <a href="/profile" className="font-semibold underline underline-offset-4">
              Profile → Alerts
            </a>
            ; this switch will not silently change it.
          </span>
        </p>
      ) : null}

      {preference.enabled && preference.status === "ready" && emailReady ? (
        <p className="mt-3 flex items-center gap-2 text-[11px] font-medium text-emerald-700">
          <Check className="h-3.5 w-3.5" aria-hidden="true" />
          Your opted-in AI picks will be included in the next compatible Monday 9:00 am Dubai email.
        </p>
      ) : null}

      {!preference.enabled ? (
        <p className="mt-3 text-[11px] leading-5 text-slate-500">
          Shared AI picks remain visible here, but they will not be added to your private weekly email while this switch is off.
        </p>
      ) : null}


      {error ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-rose-700" role="alert">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void refresh()}
            className="font-semibold underline underline-offset-4"
          >
            Try again
          </button>
        </div>
      ) : null}
    </section>
  );
}
