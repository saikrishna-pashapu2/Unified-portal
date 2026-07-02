import Link from "next/link";
import { amountInUsd, countryFlag, deadlineState, prettyAmount, prettyScalar, sourceColor, timeAgo } from "@/lib/monitored-tenders/format";
import type { TenderLikeViewer } from "@/lib/monitored-tenders/likes";
import { cn, deadlineClasses, groupPillClasses, sourcePillClasses } from "./styles";
import TenderLikeControl from "./TenderLikeControl";

export default function TenderCard({
  tender,
  basePath,
  viewer,
}: {
  tender: any;
  basePath: string;
  viewer: TenderLikeViewer | null;
}) {
  const deadline = deadlineState(tender.deadline_at);
  const color = sourceColor(tender.source_name);
  const matchedGroups = tender.matched_groups ?? [];

  return (
    <article className="group overflow-hidden rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm shadow-slate-100 transition duration-200 hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-lg hover:shadow-slate-200/70 sm:p-6">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]",
                  sourcePillClasses[color],
                )}
                title={tender.source_name}
              >
                {countryFlag(tender.country)} {tender.source_name}
              </span>
              {matchedGroups.length ? (
                <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-[11px] font-medium text-slate-500">
                  {matchedGroups.length} match{matchedGroups.length === 1 ? "" : "es"}
                </span>
              ) : null}
            </div>
            <Link
              href={`${basePath}/${tender.id}`}
              className="block text-lg font-semibold leading-snug text-slate-950 transition group-hover:text-blue-700 sm:text-[1.35rem]"
            >
              {tender.title_en || tender.title}
            </Link>
            {tender.title_en && tender.title_en !== tender.title ? (
              <p className="mt-2 text-sm leading-6 text-slate-500">{tender.title}</p>
            ) : null}
          </div>
          <div className="shrink-0">
            <TenderLikeControl tenderId={tender.id} likes={tender.likes ?? []} viewer={viewer} variant="compact" />
          </div>
        </div>

        {tender.buyer_name ? (
          <p className="text-sm text-slate-600" title={tender.buyer_name}>
            {tender.buyer_name}
          </p>
        ) : null}

        {matchedGroups.length ? (
          <div className="rounded-[22px] border border-slate-200 bg-slate-50/80 p-3.5">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Match trail</div>
            <div className="space-y-2">
              {matchedGroups.map((group: string) => {
                const details = tender.match_details?.[group] ?? {};
                const hits = [...(details.matched_phrases ?? []), ...(details.matched_tokens ?? [])];
                return (
                  <div key={group} className="flex flex-wrap items-baseline gap-2 text-xs">
                    <span className={cn("shrink-0 inline-flex items-center rounded-full px-2.5 py-1 font-medium", groupPillClasses[group] ?? "bg-gray-100 text-gray-800")}>
                      {group}
                    </span>
                    {hits.length ? (
                      <span className="text-slate-700">
                        {hits.map((hit: string) => (
                          <span key={hit} className="mb-1 mr-1 inline-block rounded-full border border-slate-200 bg-white px-2 py-1">
                            {hit}
                          </span>
                        ))}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        <div className="grid gap-3 border-t border-slate-100 pt-4 md:grid-cols-3">
          <div className="rounded-[22px] border border-slate-200 bg-white p-4">
            <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Published</div>
            {tender.published_at ? (
              <>
                <div className="mt-2 font-medium text-slate-900">{prettyScalar(tender.published_at)}</div>
                <div className="mt-1 text-xs text-slate-500">{timeAgo(tender.published_at)}</div>
              </>
            ) : (
              <div className="mt-2 font-medium text-slate-400">—</div>
            )}
          </div>

          <div className="rounded-[22px] border border-slate-200 bg-white p-4">
            <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Deadline</div>
            {tender.deadline_at ? (
              <>
                <div className={cn("mt-2 font-medium text-slate-900", deadline.color === "past" && "line-through")}>{prettyScalar(tender.deadline_at)}</div>
                <div className="mt-1">
                  <span className={cn("inline-flex items-center rounded-full px-2 py-1 text-xs font-medium", deadlineClasses[deadline.color])}>
                    {deadline.label}
                  </span>
                </div>
              </>
            ) : (
              <div className="mt-2 font-medium text-slate-400">—</div>
            )}
          </div>

          <div className="rounded-[22px] border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-4">
            <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Value</div>
            {tender.value_amount !== null && tender.value_amount !== undefined ? (
              <>
                <div className="mt-2 font-medium text-slate-900">{prettyAmount(tender.value_amount, tender.value_currency)}</div>
                <div className="mt-1 font-medium text-slate-900">
                  {amountInUsd(tender.value_amount, tender.value_currency) !== null && (tender.value_currency ?? "").toUpperCase() !== "USD"
                    ? prettyAmount(amountInUsd(tender.value_amount, tender.value_currency), "USD")
                    : tender.value_currency || "No currency"}
                </div>
              </>
            ) : (
              <div className="mt-2 font-medium text-slate-400">—</div>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
