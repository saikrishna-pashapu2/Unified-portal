import { ExternalLink, Eye, FileDown, Package, Paperclip } from "lucide-react";
import type { ReactNode } from "react";
import { amountInUsd, deadlineState, prettyAmount, prettyJson, prettyScalar } from "@/lib/monitored-tenders/format";
import SourceDetailTabs from "./SourceDetailTabs";

export type JsonRecord = Record<string, any>;
export type DetailRow = { label: string; value: unknown };
export type SourceDetailProps = {
  tender: any;
  rawJson: JsonRecord;
  lots: JsonRecord[];
  documents: JsonRecord[];
};

export { SourceDetailTabs };

export function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function listOfRecords(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

export function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (isRecord(value)) return Object.keys(value).length === 0;
  return false;
}

export function firstPresent(mapping: JsonRecord, ...keys: string[]): unknown {
  for (const key of keys) {
    const value = mapping[key];
    if (!isEmptyValue(value)) return value;
  }
  return null;
}

export function rowsFromKeys(mapping: JsonRecord, candidates: Array<[string, string[]]>): DetailRow[] {
  return candidates.flatMap(([label, keys]) => {
    const value = firstPresent(mapping, ...keys);
    return isEmptyValue(value) ? [] : [{ label, value }];
  });
}

export function rowsFromObject(mapping: JsonRecord): DetailRow[] {
  return Object.entries(mapping)
    .filter(([, value]) => !isEmptyValue(value))
    .map(([key, value]) => ({
      label: key.replace(/^_+/, "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
      value,
    }));
}

export function compactRows(rows: DetailRow[]): DetailRow[] {
  return rows.filter((row) => !isEmptyValue(row.value));
}

function LinkValue({ value, accent = "blue" }: { value: unknown; accent?: "blue" | "sky" | "emerald" | "red" }) {
  const text = prettyScalar(value);
  if (typeof value === "string" && value.startsWith("http")) {
    const accentClass =
      accent === "sky"
        ? "text-sky-700 hover:text-sky-900"
        : accent === "emerald"
          ? "text-emerald-700 hover:text-emerald-900"
          : accent === "red"
            ? "text-red-700 hover:text-red-900"
            : "text-blue-700 hover:text-blue-900";
    return (
      <a href={value} target="_blank" rel="noopener noreferrer" className={`break-all ${accentClass}`}>
        {text}
      </a>
    );
  }
  if (isRecord(value) || Array.isArray(value)) {
    return <pre className="max-h-56 overflow-auto rounded bg-slate-50 p-2 text-xs leading-5 text-slate-700">{prettyJson(value)}</pre>;
  }
  return <span className="whitespace-pre-wrap break-words">{text}</span>;
}

export function RowsTable({
  rows,
  emptyText = "No fields were extracted for this section.",
  wideLabel = false,
  accent = "blue",
}: {
  rows: DetailRow[];
  emptyText?: string;
  wideLabel?: boolean;
  accent?: "blue" | "sky" | "emerald" | "red";
}) {
  if (!rows.length) return <p className="text-sm text-slate-500">{emptyText}</p>;
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      <table className="min-w-full text-sm">
        <tbody className="divide-y divide-slate-200">
          {rows.map((row, index) => (
            <tr key={`${row.label}-${index}`} className="align-top">
              <th className={`${wideLabel ? "w-72" : "w-1/3"} bg-slate-50 px-4 py-3 text-left font-medium text-slate-600`}>
                {row.label}
              </th>
              <td className="px-4 py-3 text-slate-950">
                <LinkValue value={row.value} accent={accent} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">{children}</h3>;
}

export function MetricCard({
  label,
  children,
  tone = "default",
}: {
  label: string;
  children: ReactNode;
  tone?: "default" | "green" | "red";
}) {
  const toneClass = tone === "green" ? "text-emerald-700" : tone === "red" ? "text-red-600" : "text-slate-950";
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</div>
      <div className={`mt-2 text-base font-semibold ${toneClass}`}>{children}</div>
    </div>
  );
}

export function MoneyValue({ amount, currency }: { amount: unknown; currency?: string | null }) {
  if (amount === null || amount === undefined || amount === "") return <span>—</span>;
  const numeric = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(numeric)) return <span>{prettyScalar(amount)}</span>;
  const usdValue = amountInUsd(numeric, currency);
  return (
    <>
      <div>{prettyAmount(numeric, currency)}</div>
      {usdValue !== null && (currency ?? "").toUpperCase() !== "USD" ? (
        <div className="mt-1 text-sm font-semibold text-slate-950">{prettyAmount(usdValue, "USD")}</div>
      ) : null}
    </>
  );
}

export function DeadlineBadge({ value }: { value: unknown }) {
  const deadlineValue = value instanceof Date || typeof value === "string" || value === null || value === undefined ? value : String(value);
  const state = deadlineState(deadlineValue);
  const cls =
    state.color === "past"
      ? "bg-slate-200 text-slate-500"
      : state.color === "red"
        ? "bg-red-100 text-red-800"
        : state.color === "orange"
          ? "bg-orange-100 text-orange-800"
          : state.color === "yellow"
            ? "bg-yellow-100 text-yellow-800"
            : "bg-gray-100 text-gray-800";
  return <div className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${cls}`}>{state.label}</div>;
}

export function SourceHero({
  eyebrow,
  title,
  subtitle,
  status,
  sourceUrl,
  actionLabel,
  variant = "light",
  children,
}: {
  eyebrow: string;
  title: ReactNode;
  subtitle?: ReactNode;
  status?: unknown;
  sourceUrl: string;
  actionLabel: string;
  variant?: "light" | "blue" | "emerald" | "amber" | "red" | "xt";
  children?: ReactNode;
}) {
  const headerClass =
    variant === "blue"
      ? "border-b border-slate-300 bg-gradient-to-r from-blue-950 via-blue-900 to-cyan-800 px-5 py-5 text-white sm:px-6"
      : variant === "emerald"
        ? "border-b border-emerald-800 bg-gradient-to-r from-emerald-950 via-emerald-900 to-teal-800 px-5 py-5 text-white sm:px-6"
        : variant === "amber"
          ? "border-b border-amber-800 bg-gradient-to-r from-amber-950 via-amber-900 to-orange-800 px-5 py-5 text-white sm:px-6"
          : variant === "red"
            ? "border-b border-red-800 bg-gradient-to-r from-red-950 via-red-900 to-rose-800 px-5 py-5 text-white sm:px-6"
            : variant === "xt"
              ? "border-b border-slate-200 bg-gradient-to-br from-white via-slate-50 to-emerald-50/70 px-5 py-5 sm:px-7 sm:py-6"
              : "border-b border-slate-300 bg-slate-100 px-5 py-4 sm:px-6";
  const mutedClass = variant === "light" || variant === "xt" ? "text-slate-500" : variant === "blue" ? "text-cyan-100" : variant === "amber" ? "text-amber-100" : variant === "red" ? "text-red-100" : "text-emerald-100";
  const titleClass = variant === "light" || variant === "xt" ? "text-slate-950" : "text-white";
  const buttonClass =
    variant === "light"
      ? "bg-slate-900 text-white hover:bg-slate-800"
      : variant === "blue"
        ? "bg-white text-blue-950 hover:bg-cyan-50"
        : variant === "amber"
          ? "bg-white text-amber-950 hover:bg-amber-50"
          : variant === "red"
            ? "bg-white text-red-950 hover:bg-red-50"
            : "bg-emerald-900 text-white hover:bg-emerald-800";

  return (
    <section className={`overflow-hidden ${variant === "xt" ? "rounded-[28px] border-slate-200" : "rounded-lg border-slate-300"} border bg-white shadow-sm shadow-slate-200/70`}>
      <div className={headerClass}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className={`text-xs font-semibold uppercase tracking-[0.22em] ${mutedClass}`}>{eyebrow}</div>
            <h2 className={`mt-2 text-xl font-semibold ${titleClass}`}>{title}</h2>
            {subtitle ? <p className={`mt-2 max-w-5xl text-sm ${variant === "light" || variant === "xt" ? "text-slate-600" : "text-white/85"}`}>{subtitle}</p> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!isEmptyValue(status) ? (
              <span className={`${variant === "light" || variant === "xt" ? "border-slate-300 bg-white text-slate-700" : "border-white/20 bg-white/10 text-white"} inline-flex items-center rounded-md border px-3 py-2 text-sm font-medium`}>
                {prettyScalar(status)}
              </span>
            ) : null}
            <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition ${buttonClass}`}>
              <ExternalLink className="h-4 w-4" />
              {actionLabel}
            </a>
          </div>
        </div>
      </div>
      {children}
    </section>
  );
}

export function DataTable({
  columns,
  rows,
  emptyText,
  highlight,
}: {
  columns: Array<{ header: string; cell: (row: JsonRecord, index: number) => ReactNode; className?: string }>;
  rows: JsonRecord[];
  emptyText: string;
  highlight?: (row: JsonRecord) => boolean;
}) {
  if (!rows.length) return <p className="text-sm text-slate-500">{emptyText}</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-900 text-white">
          <tr>
            {columns.map((column) => (
              <th key={column.header} className={`px-4 py-3 text-left font-medium ${column.className ?? ""}`}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 bg-white">
          {rows.map((row, index) => (
            <tr key={index} className={`align-top ${highlight?.(row) ? "bg-blue-50/60" : ""}`}>
              {columns.map((column) => (
                <td key={column.header} className="px-4 py-3 text-slate-700">
                  {column.cell(row, index)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DocumentCards({ documents, accent = "blue" }: { documents: JsonRecord[]; accent?: "blue" | "sky" | "emerald" | "red" }) {
  if (!documents.length) return <p className="text-sm text-slate-500">No documentation files were extracted for this tender.</p>;
  const buttonClass =
    accent === "sky"
      ? "bg-sky-800 hover:bg-sky-700"
      : accent === "emerald"
        ? "bg-emerald-800 hover:bg-emerald-700"
        : accent === "red"
          ? "bg-red-800 hover:bg-red-700"
          : "bg-blue-900 hover:bg-blue-800";
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {documents.map((doc, index) => (
        <article key={index} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{prettyScalar(doc.category ?? doc.documentCategory ?? "Document")}</div>
          <h3 className="mt-2 break-words text-sm font-semibold text-slate-950">{prettyScalar(doc.name ?? doc.fileName ?? "Document")}</h3>
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
            {doc.ext ? <span className="rounded-full bg-white px-2 py-0.5 font-medium uppercase">{prettyScalar(doc.ext)}</span> : null}
            {doc.size_text ? <span className="rounded-full bg-white px-2 py-0.5">{prettyScalar(doc.size_text)}</span> : null}
            {doc.uploaded_at_text ? <span className="rounded-full bg-white px-2 py-0.5">{prettyScalar(doc.uploaded_at_text)}</span> : null}
          </div>
          {doc.hash ? <div className="mt-3 break-all rounded-md bg-white px-2 py-1 font-mono text-[11px] text-slate-500">{prettyScalar(doc.hash)}</div> : null}
          <div className="mt-4 flex flex-wrap gap-2">
            {doc.preview_url ? (
              <a href={doc.preview_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100">
                <Eye className="h-4 w-4" />
                Preview
              </a>
            ) : null}
            {doc.url ? (
              <a href={doc.url} target="_blank" rel="noopener noreferrer" className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium text-white transition ${buttonClass}`}>
                <FileDown className="h-4 w-4" />
                Download
              </a>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  );
}

export function DocumentsSection({ documents, title = "Documents", accent = "blue" }: { documents: JsonRecord[]; title?: string; accent?: "blue" | "sky" | "emerald" | "red" }) {
  return (
    <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/70 sm:p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-slate-50 text-slate-600">
            <Paperclip className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">{title} ({documents.length})</h2>
            <p className="text-sm text-slate-500">Files exposed by the source connector.</p>
          </div>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">{documents.length} file{documents.length === 1 ? "" : "s"}</span>
      </div>
      <DocumentCards documents={documents} accent={accent} />
    </section>
  );
}

export function GoodsSection({ rows, currency }: { rows: JsonRecord[]; currency?: string | null }) {
  return (
    <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/70 sm:p-6">
      <div className="mb-5 flex items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
          <Package className="h-4 w-4" />
        </div>
        <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">Goods</h2>
      </div>
      <DataTable
        rows={rows}
        emptyText="No goods were extracted for this tender."
        columns={[
          { header: "Code", cell: (row) => <span className="font-mono text-xs text-slate-600">{prettyScalar(row.classification_code ?? "—")}</span> },
          { header: "Name", cell: (row) => <span className="font-medium text-slate-900">{prettyScalar(row.name ?? "—")}</span> },
          { header: "Description", cell: (row) => prettyScalar(row.description ?? "—") },
          { header: "Quantity", cell: (row) => prettyScalar(row.quantity ?? "—") },
          { header: "Unit price", cell: (row) => <MoneyValue amount={row.unit_price} currency={currency} /> },
          { header: "Total", cell: (row) => <MoneyValue amount={row.total_amount} currency={currency} /> },
        ]}
      />
    </section>
  );
}

export function RawPayload({ payload }: { payload: unknown }) {
  return (
    <details className="overflow-hidden rounded-lg border border-slate-300 bg-slate-950 text-slate-100">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium">
        <span>Raw source payload</span>
        <span className="text-xs text-slate-400">Debug JSON</span>
      </summary>
      <div className="border-t border-slate-800 px-4 py-4">
        <pre className="overflow-x-auto rounded-lg bg-black/30 p-4 text-xs leading-6 text-slate-200">{prettyJson(payload)}</pre>
      </div>
    </details>
  );
}
