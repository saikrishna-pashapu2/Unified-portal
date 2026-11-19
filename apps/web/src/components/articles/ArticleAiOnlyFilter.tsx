"use client";

import { Sparkles } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ArticleAiDomain } from "@/lib/article-ai/types";

function isAiFilterValue(value: string | null) {
  return value === "1" || value === "true";
}

/**
 * URL-backed shared daily-pick filter for the article archives.
 *
 * This deliberately does not read or mutate the private digest preference.
 * It is a view filter over the domain's shared AI selections and therefore
 * remains useful when a user has opted out of email inclusion.
 */
export default function ArticleAiOnlyFilter({ domain }: { domain: ArticleAiDomain }) {
  const router = useRouter();
  const pathname = usePathname() || `/${domain}/articles`;
  const searchParams = useSearchParams();
  const active = isAiFilterValue(searchParams.get("ai"));
  const isCredit = domain === "credit";
  const accent = isCredit
    ? {
        border: active ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-white",
        icon: active ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-600",
        switchOn: "bg-blue-600",
        ring: "focus-visible:ring-blue-500",
      }
    : {
        border: active ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-white",
        icon: active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600",
        switchOn: "bg-emerald-600",
        ring: "focus-visible:ring-emerald-500",
      };

  const setActive = (nextActive: boolean) => {
    const params = new URLSearchParams(searchParams.toString());
    if (nextActive) params.set("ai", "1");
    else params.delete("ai");
    // A filtered result set has a different count. Never leave the user on a
    // page number that was valid for the unfiltered archive.
    params.delete("page");
    const query = params.toString();
    router.push(`${pathname}${query ? `?${query}` : ""}`);
  };

  return (
    <section
      className={`rounded-2xl border px-4 py-3 shadow-[0_10px_28px_-24px_rgba(15,23,42,0.45)] transition-colors sm:px-5 ${accent.border}`}
      aria-label={`${domain.toUpperCase()} article filters`}
      data-testid={`article-ai-only-filter-${domain}`}
    >
      <div className="flex items-center gap-3">
        <span className={`shrink-0 rounded-lg p-2 ${accent.icon}`}>
          <Sparkles className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-950">Only AI picks</p>
          <p className="mt-0.5 text-xs leading-5 text-slate-600">
            Show articles selected by the shared daily {domain.toUpperCase()} assessment. This is independent of your private email setting.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={active}
          aria-label={`${active ? "Turn off" : "Turn on"} the AI picks only filter`}
          onClick={() => setActive(!active)}
          className={`inline-flex h-7 w-12 shrink-0 items-center rounded-full p-1 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${accent.ring} ${active ? accent.switchOn : "bg-slate-300"}`}
        >
          <span
            className={`h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${active ? "translate-x-5" : "translate-x-0"}`}
          />
        </button>
      </div>
      {active ? (
        <p className="mt-2 pl-11 text-[11px] font-medium text-slate-600" role="status">
          Showing shared AI picks from recent daily assessments.
        </p>
      ) : null}
    </section>
  );
}
