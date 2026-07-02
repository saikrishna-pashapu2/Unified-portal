import { ExternalLink, FileDown, Package, Paperclip } from "lucide-react";
import { prettyScalar } from "@/lib/monitored-tenders/format";
import {
  DataTable,
  MoneyValue,
  RawPayload,
  firstPresent,
  isEmptyValue,
  isRecord,
  listOfRecords,
  rowsFromKeys,
  type JsonRecord,
  type SourceDetailProps,
} from "./primitives";

function buildGoods(rawJson: JsonRecord, lots: JsonRecord[]): JsonRecord[] {
  const meta = isRecord(rawJson.meta) ? rawJson.meta : {};
  const goodMaps = listOfRecords(meta.good_maps);
  const mapped = goodMaps.map((item) => ({
    lot_id: item.lot_id,
    classification_code: item.id,
    name: item.name,
    description: firstPresent(item, "description", "description_ru", "technical_description", "characteristic"),
    quantity: item.amount,
    unit: item.unit,
    unit_price: item.price,
    total_amount: item.totalcost_item,
  }));
  if (mapped.length) return mapped;
  return lots.map((lot) => ({
    lot_id: lot.lot_id,
    classification_code: lot.classification_code,
    name: lot.name_ru ?? lot.name,
    description: lot.description_ru ?? lot.description,
    quantity: lot.quantity,
    unit: lot.unit,
    unit_price: lot.unit_price,
    total_amount: lot.total_amount,
  }));
}

export default function XtXaridDetail({ tender, rawJson, lots, documents }: SourceDetailProps) {
  const meta = isRecord(rawJson.meta) ? rawJson.meta : {};
  const areaPath = listOfRecords(meta.area_path);
  const areaNames = areaPath.map((item) => item.name).filter((value) => !isEmptyValue(value)).map(String);
  const finSources = Array.isArray(meta.fin_src) ? meta.fin_src.filter((item) => !isRecord(item) && !Array.isArray(item)) : [];
  const timelineRows = rowsFromKeys(rawJson, [
    ["Published at", ["publicated_at"]],
    ["Submission deadline", ["close_at"]],
    ["Remaining time", ["remain_time"]],
    ["Objection deadline", ["close_docs_objections_at"]],
    ["Objection remaining time", ["docs_objections_remain_time"]],
  ]);
  const customerRows = [
    { label: "Customer name", value: meta.company_name },
    { label: "Customer TIN", value: meta.company_inn },
    { label: "Region path", value: areaNames.length ? areaNames.join(" / ") : null },
    { label: "Financing sources", value: finSources.length ? finSources.map(String).join(", ") : null },
  ].filter((row) => !isEmptyValue(row.value));
  const goods = buildGoods(rawJson, lots);
  const rawStatus = rawJson.status;
  const status = rawStatus === "docs_objections" ? "Documentation objections" : rawStatus;

  return (
    <section className="space-y-5">
      <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm shadow-slate-200/70">
        <div className="border-b border-slate-200 bg-gradient-to-br from-white via-slate-50 to-emerald-50/70 px-5 py-5 sm:px-7 sm:py-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-sm text-slate-500">XT-Xarid Public Procurement</div>
              <div className="mt-2 inline-flex items-center rounded-xl bg-emerald-900 px-3 py-2 font-mono text-sm font-semibold tracking-wide text-white">
                Тендер № {prettyScalar(rawJson.id ?? tender.external_id)}
              </div>
              {!isEmptyValue(status) ? <div className="mt-3 text-sm text-slate-600">{prettyScalar(status)}</div> : null}
            </div>
            <a href={tender.source_url} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center gap-2 rounded-xl bg-emerald-900 px-4 text-sm font-medium text-white transition hover:bg-emerald-800">
              <ExternalLink className="h-4 w-4" />
              Visit source
            </a>
          </div>
        </div>

        <div className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-4 sm:p-6">
          {[...timelineRows, ...customerRows].map((row, index) => (
            <div key={`${row.label}-${index}`} className="rounded-[22px] border border-slate-200 bg-white p-4 shadow-sm shadow-slate-100">
              <div className="text-sm font-medium text-slate-700">{row.label}</div>
              <div className="mt-2 text-sm text-slate-900">{prettyScalar(row.value)}</div>
            </div>
          ))}
        </div>
      </section>

      {goods.length ? (
        <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/70 sm:p-6">
          <div className="mb-5 flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
              <Package className="h-4 w-4" />
            </div>
            <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">Goods</h2>
          </div>
          <DataTable
            rows={goods}
            emptyText="No goods were extracted for this tender."
            columns={[
              { header: "Code", cell: (good) => <span className="font-mono text-xs text-slate-600">{prettyScalar(good.classification_code ?? "—")}</span> },
              { header: "Name", cell: (good) => <span className="font-medium text-slate-900">{prettyScalar(good.name ?? "—")}</span> },
              { header: "Description", cell: (good) => prettyScalar(good.description ?? "—") },
              { header: "Quantity", cell: (good) => prettyScalar(good.quantity ?? "—") },
              { header: "Unit price", cell: (good) => (!isEmptyValue(good.unit_price) ? <MoneyValue amount={good.unit_price} currency={String(rawJson.currency ?? tender.value_currency ?? "")} /> : "—") },
              { header: "Total", cell: (good) => (!isEmptyValue(good.total_amount) ? <MoneyValue amount={good.total_amount} currency={String(rawJson.currency ?? tender.value_currency ?? "")} /> : "—") },
            ]}
          />
        </section>
      ) : null}

      {documents.length ? (
        <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/70 sm:p-6">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
                <Paperclip className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">Documents ({documents.length})</h2>
                <p className="text-sm text-slate-500">Files exposed by the source connector.</p>
              </div>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
              {documents.length} file{documents.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="grid gap-3">
            {documents.map((doc, index) => (
              <article key={index} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="break-words text-sm font-semibold text-slate-900">{prettyScalar(doc.name ?? "Document")}</div>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                      {doc.category ? <span>{prettyScalar(doc.category)}</span> : null}
                      {doc.ext ? <span className="uppercase">{prettyScalar(doc.ext)}</span> : null}
                      {!isEmptyValue(doc.size_bytes) ? <span>{prettyScalar(doc.size_bytes)} bytes</span> : null}
                      {doc.size_text ? <span>{prettyScalar(doc.size_text)}</span> : null}
                    </div>
                  </div>
                  {doc.url ? (
                    <a href={doc.url} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-2 rounded-2xl border border-emerald-200 bg-white px-3 py-2 text-sm font-medium text-emerald-700 transition hover:bg-emerald-50">
                      <FileDown className="h-4 w-4" />
                      Open file
                    </a>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <RawPayload payload={rawJson} />
    </section>
  );
}
