"use client";

import { AlertCircle, Check, Loader2, Mail, Sparkles } from "lucide-react";
import {
  ARTICLE_AI_PERSONAL_HISTORY_MINIMUM,
  type ArticleAiDomain,
} from "@/lib/article-ai/types";
import { useArticleAi } from "./ArticleAiProvider";

function statusCopy(status: string | undefined) {
  switch (status) {
    case "queued":
      return "Your profile is queued for its next article pass.";
    case "ready":
      return "Your profile is ready and will be refreshed as new articles arrive.";
    case "insufficient_history":
      return "We are still collecting enough history to make personal picks.";
    case "preview":
      return "Preview mode is on for this deployment.";
    case "error":
      return "The last article pass needs attention. Your human likes are unchanged.";
    default:
      return null;
  }
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
              Sign in to create a private ESG/Credit profile for your weekly email digest.
            </p>
            <a
              href="/signin"
              className="mt-2 inline-flex text-xs font-semibold text-slate-800 underline decoration-slate-300 underline-offset-4 hover:decoration-slate-700"
            >
              Sign in to personalize
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

  const statusMessage = statusCopy(preference.status);
  const profileMessage =
    preference.profileSource === "personal"
      ? `Learning from ${preference.historyCount} human likes in ${domain.toUpperCase()}.`
      : preference.profileSource === "team"
        ? "Using the curated team history until your personal profile has enough examples."
        : `Not enough personal or team history yet (${preference.historyCount}/${ARTICLE_AI_PERSONAL_HISTORY_MINIMUM} personal likes). AI picks will wait for more human examples.`;
  const emailReady = preference.emailInclusionEnabled && preference.weeklyDigestConfigured;

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
              Selects useful articles for your private weekly email using your human likes and the {domain.toUpperCase()} team history.
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
        {statusMessage ? (
          <p className="rounded-lg bg-slate-50 px-3 py-2 leading-5 text-slate-600">{statusMessage}</p>
        ) : null}
      </div>

      {!preference.emailInclusionEnabled ? (
        <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          AI selection is in preview mode here. It will not be added to an email until email inclusion is enabled.
        </p>
      ) : !preference.weeklyDigestConfigured ? (
        <p className="mt-3 flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs leading-5 text-sky-900">
          <Mail className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
          To receive private AI picks, configure a weekly article email for this domain to your account email in{" "}
            <a href="/profile" className="font-semibold underline underline-offset-4">
              Profile → Alerts
            </a>
            .
          </span>
        </p>
      ) : null}

      {preference.enabled && preference.status === "ready" && emailReady ? (
        <p className="mt-3 flex items-center gap-2 text-[11px] font-medium text-emerald-700">
          <Check className="h-3.5 w-3.5" aria-hidden="true" />
          Future picks will be added to emails assembled after they are generated.
        </p>
      ) : null}

      {preference.enabled && preference.status === "off" ? (
        <p className="mt-3 text-[11px] text-slate-500">Turn the switch on to begin a private article pass.</p>
      ) : null}

      {!preference.enabled ? (
        <p className="mt-3 text-[11px] leading-5 text-slate-500">
          Turning off stops new picks. Emails already prepared may still contain them.
        </p>
      ) : null}

      {preference.enabled && preference.status === "queued" ? (
        <p className="mt-3 text-[11px] leading-5 text-slate-500">
          New picks will affect only emails assembled after this article pass completes.
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
