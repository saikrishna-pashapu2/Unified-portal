"use client";

import { useState } from "react";
import { Check, Loader2, Sparkles, X } from "lucide-react";
import { useArticleAi } from "./ArticleAiProvider";

export default function ArticleAiSelection({ articleId }: { articleId: number }) {
  const {
    isAuthenticated,
    preference,
    selectionFor,
    pendingArticleIds,
    pendingPollingExhausted,
    refresh,
    submitFeedback,
  } = useArticleAi();
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const selection = selectionFor(articleId);

  if (!isAuthenticated || !preference || !selection || selection.state === "dismissed") {
    return null;
  }

  const isPending = pendingArticleIds.has(articleId) || selection.pendingConfirmation;
  const feedbackUnavailable = !selection.sharedSelectionId;
  const canCheckAgain =
    selection.pendingConfirmation &&
    pendingPollingExhausted.has(articleId) &&
    !pendingArticleIds.has(articleId);
  const isConfirmed = selection.state === "confirmed" && !selection.pendingConfirmation;

  const handleFeedback = async (action: "confirm" | "dismiss") => {
    if (isPending || feedbackUnavailable) return;
    setFeedbackError(null);
    const result = await submitFeedback(articleId, action);
    if (!result.ok) setFeedbackError(result.error);
  };

  return (
    <div
      className={`mt-3 rounded-xl border px-3 py-3 ${
        isConfirmed
          ? "border-emerald-200 bg-emerald-50/70"
          : "border-amber-200 bg-amber-50/70"
      }`}
      data-testid={`article-ai-selection-${articleId}`}
    >
      <div className="flex items-start gap-2.5">
        <span
          className={`mt-0.5 rounded-md p-1.5 ${
            isConfirmed ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
          }`}
        >
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-xs font-semibold text-slate-900">
              {canCheckAgain
                ? "AI pick is still processing"
                : isPending
                ? "Saving your AI pick…"
                : feedbackUnavailable
                  ? "Shared AI pick needs a refresh"
                : isConfirmed
                  ? preference.enabled
                    ? "AI pick confirmed for your digest"
                    : "Shared AI pick confirmed"
                  : preference.enabled
                    ? "AI pick for your digest"
                    : "Shared AI pick"}
            </p>
            {!isConfirmed ? (
              <span className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-amber-800">
                Review
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-700">{selection.reason}</p>
          {selection.targetWeekKey ? (
            <p className="mt-1 text-[10px] font-medium uppercase tracking-[0.1em] text-slate-500">
              Shared week {selection.targetWeekKey} · Dubai
            </p>
          ) : null}

          {!isConfirmed ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {feedbackUnavailable ? (
                <>
                  <button
                    type="button"
                    onClick={() => void refresh()}
                    className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-2.5 py-1.5 text-[11px] font-semibold text-white transition hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2"
                  >
                    Refresh pick
                  </button>
                  <span className="text-[10px] text-slate-500">
                    Refresh before sending feedback for this shared assessment.
                  </span>
                </>
              ) : canCheckAgain ? (
                <>
                  <button
                    type="button"
                    onClick={() => void refresh()}
                    className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-2.5 py-1.5 text-[11px] font-semibold text-white transition hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2"
                  >
                    Check again
                  </button>
                  <span className="text-[10px] text-slate-500">
                    The article worker is still processing this pick.
                  </span>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={isPending || feedbackUnavailable}
                    onClick={() => void handleFeedback("confirm")}
                    className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-2.5 py-1.5 text-[11px] font-semibold text-white transition hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
                  >
                    {isPending ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : <Check className="h-3 w-3" aria-hidden="true" />}
                    {isPending ? "Saving…" : "Keep & like"}
                  </button>
                  <button
                    type="button"
                    disabled={isPending || feedbackUnavailable}
                    onClick={() => void handleFeedback("dismiss")}
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white/80 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 transition hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
                  >
                    <X className="h-3 w-3" aria-hidden="true" />
                    Dismiss
                  </button>
                </>
              )}
              {!canCheckAgain && !feedbackUnavailable ? (
                <span className="text-[10px] text-slate-500">
                  Confirming adds your human like to the shared domain history.
                </span>
              ) : null}
            </div>
          ) : (
            <p className="mt-2 text-[11px] font-medium text-emerald-800">
              Your confirmation is included as a human signal for future shared picks.
            </p>
          )}

          {feedbackError ? (
            <p className="mt-2 text-[11px] text-rose-700" role="alert">
              {feedbackError}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
