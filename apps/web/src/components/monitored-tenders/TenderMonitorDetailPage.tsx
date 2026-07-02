import Link from "next/link";
import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { ArrowLeft, ExternalLink, FileStack, History, Package2 } from "lucide-react";
import { authOptions } from "@/lib/nextauth-options";
import {
  getMonitoredTender,
  groupForDomain,
  listRelatedMonitoredTenders,
  overallMonitoredCounters,
  type TenderDomain,
} from "@/lib/monitored-tenders/queries";
import {
  amountInUsd,
  countryFlag,
  deadlineState,
  prettyAmount,
  prettyJson,
  prettyScalar,
  sourceColor,
  timeAgo,
} from "@/lib/monitored-tenders/format";
import { tenderLikeViewerFromSession } from "@/lib/monitored-tenders/likes";
import {
  extractDocuments,
  extractLots,
  extractSourceGroups,
  extractSourceSections,
  type JsonRecord,
} from "@/lib/monitored-tenders/presentation";
import { cn, deadlineClasses, groupPillClasses, sourceHeaderClasses, sourcePillClasses } from "./styles";
import TenderLikeControl from "./TenderLikeControl";
import PresentedValue from "./PresentedValue";
import SourceSpecificDetail, { hasSourceSpecificDetail } from "./SourceSpecificDetail";
import ShareTenderButton from "./ShareTenderButton";

function rawRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function OverviewGrid({ tender }: { tender: any }) {
  const rows = [
    ["Source", tender.source?.display_name ?? tender.source_name],
    ["External ID", tender.external_id],
    ["Buyer", tender.buyer_name],
    ["Country", tender.country],
    ["Sector", tender.sector],
    ["Status", tender.status],
    ["Language", tender.language],
    ["Last seen", tender.last_seen_at ? prettyScalar(tender.last_seen_at) : null],
  ];
  return (
    <dl className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {rows
        .filter(([, value]) => value !== null && value !== undefined && value !== "")
        .map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</dt>
            <dd className="mt-2 text-sm text-slate-900">{prettyScalar(value)}</dd>
          </div>
        ))}
    </dl>
  );
}

function MatchTrail({ tender }: { tender: any }) {
  const groups = tender.matched_groups ?? [];
  if (!groups.length) return null;
  return (
    <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/70 sm:p-6">
      <div className="mb-4 flex items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
          <FileStack className="h-4 w-4" />
        </div>
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">Match trail</h2>
          <p className="text-sm text-slate-500">Groups and phrases that triggered this tender.</p>
        </div>
      </div>
      <div className="space-y-2">
        {groups.map((group: string) => {
          const details = tender.match_details?.[group] ?? {};
          const hits = [...(details.matched_phrases ?? []), ...(details.matched_tokens ?? [])];
          return (
            <div key={group} className="flex flex-wrap items-baseline gap-2 text-sm">
              <span className={cn("inline-flex items-center rounded-full px-3 py-1 text-xs font-medium", groupPillClasses[group] ?? "bg-gray-100 text-gray-800")}>
                {group}
              </span>
              {hits.map((hit: string) => (
                <span key={hit} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-700">
                  {hit}
                </span>
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default async function TenderMonitorDetailPage({
  id,
  domain,
  basePath,
}: {
  id: string;
  domain: TenderDomain;
  basePath: string;
}) {
  const [tender, session] = await Promise.all([
    getMonitoredTender(id),
    getServerSession(authOptions),
  ]);
  if (!tender || !tender.is_active) notFound();
  const requiredGroup = groupForDomain(domain);
  if (!((tender.matched_groups ?? []) as string[]).includes(requiredGroup)) notFound();
  const viewer = tenderLikeViewerFromSession(session);

  const [related, counters] = await Promise.all([
    listRelatedMonitoredTenders(tender),
    overallMonitoredCounters(),
  ]);

  const rawJson = rawRecord(tender.raw_json);
  const documents = extractDocuments(rawJson);
  const lots = extractLots(rawJson);
  const sourceGroups = extractSourceGroups(rawJson);
  const sourceSections = extractSourceSections(rawJson);
  const hasRichSourceDetail = hasSourceSpecificDetail(tender.source_name);
  const color = sourceColor(tender.source_name);
  const deadline = deadlineState(tender.deadline_at);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <main className="mx-auto w-full max-w-[92rem] px-4 py-6 sm:px-6">
        <Link
          href={basePath}
          className="mb-4 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-500 transition hover:border-blue-200 hover:text-blue-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to all tenders
        </Link>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_16rem] 2xl:grid-cols-[minmax(0,1fr)_17rem]">
          <div className="min-w-0 space-y-5">
            <header className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm shadow-slate-200/70">
              <div className={cn("border-b border-slate-200 bg-gradient-to-br px-5 py-5 sm:px-7 sm:py-6", sourceHeaderClasses[color])}>
                <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <span className={cn("inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em]", sourcePillClasses[color])}>
                        {countryFlag(tender.country)} {tender.source_name}
                      </span>
                      <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                        {tender.status}
                      </span>
                      {(tender.matched_groups ?? []).map((group: string) => (
                        <span key={group} className={cn("inline-flex items-center rounded-full px-3 py-1 text-xs font-medium", groupPillClasses[group] ?? "bg-gray-100 text-gray-800")}>
                          {group}
                        </span>
                      ))}
                    </div>
                    <h1 className="max-w-4xl text-2xl font-semibold leading-tight text-slate-950 sm:text-3xl">
                      {tender.title_en || tender.title}
                    </h1>
                    {tender.title_en && tender.title_en !== tender.title ? (
                      <p className="mt-3 max-w-4xl text-sm leading-6 text-slate-600">Original: {tender.title}</p>
                    ) : null}
                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-500">
                      <span>
                        Source record <span className="font-mono text-slate-700">{tender.external_id}</span>
                      </span>
                      {tender.title_en ? <span>Translated from {tender.title_language || tender.language}</span> : null}
                      <span>First seen {timeAgo(tender.first_seen_at)}</span>
                    </div>
                  </div>
                  <div className="w-full shrink-0 space-y-2 sm:w-auto sm:min-w-[22rem]">
                    <div className="flex flex-wrap gap-2 sm:justify-end">
                      <a
                        href={tender.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex shrink-0 items-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800"
                      >
                        <ExternalLink className="h-4 w-4" />
                        Open at source
                      </a>
                      <ShareTenderButton title={tender.title_en || tender.title} />
                      <TenderLikeControl tenderId={tender.id} likes={tender.likes ?? []} viewer={viewer} variant="detail" />
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-2xl border border-white/70 bg-white/90 p-4 shadow-sm shadow-slate-100">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Published</div>
                    <div className="mt-2 text-sm font-medium text-slate-900">{tender.published_at ? prettyScalar(tender.published_at) : "—"}</div>
                    <div className="mt-1 text-xs text-slate-500">{tender.published_at ? timeAgo(tender.published_at) : "No publish timestamp"}</div>
                  </div>
                  <div className="rounded-2xl border border-white/70 bg-white/90 p-4 shadow-sm shadow-slate-100">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Deadline</div>
                    <div className="mt-2 text-sm font-medium text-slate-900">{tender.deadline_at ? prettyScalar(tender.deadline_at) : "—"}</div>
                    <div className="mt-1">
                      <span className={cn("inline-flex items-center rounded-full px-2 py-1 text-[11px] font-medium", deadlineClasses[deadline.color])}>
                        {deadline.label}
                      </span>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-white/70 bg-white/90 p-4 shadow-sm shadow-slate-100">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Value</div>
                    <div className="mt-2 text-sm font-medium text-slate-900">
                      {tender.value_amount !== null && tender.value_amount !== undefined ? prettyAmount(tender.value_amount, tender.value_currency) : "—"}
                    </div>
                    {tender.value_amount !== null && tender.value_amount !== undefined ? (
                      <div className="mt-1 text-sm font-medium text-slate-900">
                        {amountInUsd(tender.value_amount, tender.value_currency) !== null && (tender.value_currency ?? "").toUpperCase() !== "USD"
                          ? prettyAmount(amountInUsd(tender.value_amount, tender.value_currency), "USD")
                          : tender.value_currency || "No currency"}
                      </div>
                    ) : null}
                  </div>
                  <div className="rounded-2xl border border-white/70 bg-white/90 p-4 shadow-sm shadow-slate-100">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Coverage</div>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-700">{documents.length} docs</span>
                      <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-700">{lots.length} lots</span>
                      <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-700">{sourceSections.length} source sections</span>
                    </div>
                    <div className="mt-2 text-xs text-slate-500">Normalized + raw source payload</div>
                  </div>
                </div>
              </div>
            </header>

            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.9fr)]">
              <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/70 sm:p-6">
                <div className="mb-4 flex items-center gap-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-slate-100 text-slate-600">
                    <FileStack className="h-4 w-4" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">Overview</h2>
                    <p className="text-sm text-slate-500">Canonical fields shared by every source.</p>
                  </div>
                </div>
                <OverviewGrid tender={tender} />
              </section>

              <MatchTrail tender={tender} />
            </div>

            {hasRichSourceDetail ? <SourceSpecificDetail tender={tender} rawJson={rawJson} lots={lots} documents={documents} /> : null}

            {!hasRichSourceDetail && (sourceGroups.length || sourceSections.length) ? (
              <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/70 sm:p-6">
                <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">Source payload</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      Source-specific facts grouped for analyst review instead of collapsing into one raw dump.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <span className="rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-600">{sourceGroups.length} fact groups</span>
                    <span className="rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-600">{sourceSections.length} deep sections</span>
                  </div>
                </div>

                {sourceGroups.length ? (
                  <div className="mb-6 grid gap-4 xl:grid-cols-2">
                    {sourceGroups.map((group) => (
                      <section key={group.title} className="rounded-[24px] border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-4">
                        <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{group.title}</h3>
                        <dl className="grid gap-3">
                          {group.rows.map((row, index) => (
                            <div key={`${row.label}-${index}`} className="rounded-2xl border border-slate-200 bg-white p-3">
                              <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{row.label}</dt>
                              <dd className="mt-2 text-sm text-slate-900">
                                <PresentedValue node={row.value} />
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </section>
                    ))}
                  </div>
                ) : null}

                {sourceSections.length ? (
                  <div className="space-y-4">
                    {sourceSections.map((section) => (
                      <section key={section.title} className="overflow-hidden rounded-[24px] border border-slate-200 bg-slate-50/80">
                        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white/80 px-4 py-3">
                          <h3 className="text-sm font-semibold text-slate-900">{section.title}</h3>
                          {section.summary ? <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-500">{section.summary}</span> : null}
                        </div>
                        <div className="p-4">
                          <PresentedValue node={section.content} />
                        </div>
                      </section>
                    ))}
                  </div>
                ) : null}
              </section>
            ) : null}

            {lots.length && !hasRichSourceDetail ? (
              <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/70 sm:p-6">
                <div className="mb-5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
                      <Package2 className="h-4 w-4" />
                    </div>
                    <div>
                      <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">Lots</h2>
                      <p className="text-sm text-slate-500">Line items and sub-lots extracted from the source.</p>
                    </div>
                  </div>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">{lots.length} lots</span>
                </div>
                <PresentedValue node={{ kind: "sequence", items: lots.map((lot, index) => ({ kind: "mapping", title: String(lot.name ?? lot.name_ru ?? lot.title ?? `Lot ${index + 1}`), rows: Object.entries(lot).map(([key, value]) => ({ label: key, value: { kind: "scalar", value } })) })) }} />
              </section>
            ) : null}

            {Array.isArray(tender.change_log) && tender.change_log.length ? (
              <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/70 sm:p-6">
                <div className="mb-4 flex items-center gap-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-rose-50 text-rose-600">
                    <History className="h-4 w-4" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">Change log</h2>
                    <p className="text-sm text-slate-500">Tracked field deltas captured during ingest.</p>
                  </div>
                </div>
                <pre className="overflow-x-auto rounded-2xl bg-slate-50 p-4 text-xs leading-6 text-slate-700">{prettyJson(tender.change_log)}</pre>
              </section>
            ) : null}

            {!hasRichSourceDetail ? (
              <details className="overflow-hidden rounded-[24px] border border-slate-200 bg-slate-950 text-slate-100">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium">
                  <span>Raw source payload</span>
                  <span className="text-xs text-slate-400">Debug JSON</span>
                </summary>
                <div className="border-t border-slate-800 px-4 py-4">
                  <pre className="overflow-x-auto rounded-2xl bg-black/30 p-4 text-xs leading-6 text-slate-200">{prettyJson(tender.raw_json)}</pre>
                </div>
              </details>
            ) : null}
          </div>

          <aside className="space-y-5 xl:pt-1">
            {related.length ? (
              <section className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/70 xl:sticky xl:top-20">
                <div className="mb-3 flex items-baseline justify-between gap-3">
                  <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">More from {tender.source_name}</h2>
                  <span className="text-xs text-slate-400">{related.length}</span>
                </div>
                <div className="max-h-[36rem] overflow-y-auto pr-1">
                  <ul className="space-y-3">
                    {related.map((row) => {
                      const relatedDeadline = deadlineState(row.deadline_at);
                      return (
                        <li key={row.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-3 transition hover:border-blue-200 hover:bg-white">
                          <Link href={`${basePath}/${row.id}`} className="block text-sm font-medium leading-snug text-slate-900 hover:text-blue-700">
                            {row.title_en || row.title}
                          </Link>
                          {row.buyer_name ? <p className="mt-1 truncate text-xs text-slate-500" title={row.buyer_name}>{row.buyer_name}</p> : null}
                          {row.matched_groups?.length ? (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {row.matched_groups.map((group: string) => (
                                <span key={group} className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium", groupPillClasses[group] ?? "bg-gray-100 text-gray-800")}>{group}</span>
                              ))}
                            </div>
                          ) : null}
                          <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                            <span>{row.published_at ? timeAgo(row.published_at) : "—"}</span>
                            {row.deadline_at ? (
                              <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 font-medium", deadlineClasses[relatedDeadline.color])}>{relatedDeadline.label}</span>
                            ) : null}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </section>
            ) : null}
          </aside>
        </div>
      </main>
      <footer className="border-t border-gray-200 bg-white">
        <div className="mx-auto flex max-w-[92rem] flex-wrap justify-between gap-2 px-4 py-3 text-xs text-gray-500 sm:px-6">
          <span>Read-only browsing UI.</span>
          <span>
            {counters.totalTenders.toLocaleString("en-US")} tenders · {counters.totalSources} sources · Last ingest:{" "}
            {counters.lastSeen ? timeAgo(counters.lastSeen) : "No tenders ingested yet."}
          </span>
        </div>
      </footer>
    </div>
  );
}
