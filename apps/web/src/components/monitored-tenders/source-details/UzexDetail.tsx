import { Bell, ExternalLink, FileDown } from "lucide-react";
import { deadlineState, prettyAmount, prettyScalar } from "@/lib/monitored-tenders/format";
import {
  DataTable,
  MoneyValue,
  RawPayload,
  SourceDetailTabs,
  firstPresent,
  isEmptyValue,
  isRecord,
  listOfRecords,
  rowsFromKeys,
  rowsFromObject,
  type DetailRow,
  type JsonRecord,
  type SourceDetailProps,
} from "./primitives";

const DOCUMENT_TAB_ORDER = [
  "Technical specifications and expert opinion",
  "Technical documentation",
  "Protocols",
  "Contracts",
  "Other files",
];

function humanizeKey(key: string): string {
  return key.replace(/^_+/, "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isScalarOrListOfScalars(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (["string", "number", "boolean"].includes(typeof value)) return true;
  return Array.isArray(value) && value.every((item) => item === null || ["string", "number", "boolean"].includes(typeof item));
}

function documentTabLabel(document: JsonRecord): string {
  const category = String(document.category ?? "").toLowerCase();
  if (category.includes("protocol") || category.includes("conclusion")) return "Protocols";
  if (category.includes("contract") || category.includes("agreement") || category.includes("deal")) return "Contracts";
  if (category.includes("technical document") || category.includes("criteria form") || category.includes("qualification")) return "Technical documentation";
  if (category.includes("technical attachment") || category.includes("expertise")) return "Technical specifications and expert opinion";
  return "Other files";
}

function buildInfoRows(rawJson: JsonRecord, parsedDetail: JsonRecord): DetailRow[] {
  const consumed = new Set<string>();
  const candidateRows = rowsFromKeys(rawJson, [
    ["Customer's Taxpayer Identification Number", ["customer_tin", "customer_inn"]],
    ["Customer name", ["customer_name"]],
    ["Registration form", ["registration_form", "registration_form_name", "purchase_type"]],
    ["Proposal evaluation method", ["evaluation_method", "proposal_evaluation_method", "winner_method_detail"]],
    ["Procedure for considering proposals", ["procedure_for_considering_proposals", "procedure_considering", "submit_type"]],
    ["Deposit", ["deposit", "deposit_required"]],
    ["Letter of guarantee", ["letter_of_guarantee", "guarantee_letter"]],
    ["Deposit size", ["deposit_size"]],
    ["Advance payment amount", ["advance_payment_amount", "prepayment_amount"]],
    ["Unlock method", ["unlock_method"]],
    ["Payment order", ["payment_order"]],
    ["Placement term", ["placement_term"]],
    ["Opening date", ["opening_date"]],
    ["Payment term", ["payment_term", "payment_term_full"]],
    ["Customer address", ["customer_address", "address"]],
    ["Delivery address", ["delivery_address"]],
    ["Status", ["status_name"]],
    ["Financing source", ["financing_source"]],
    ["Additional information", ["additional_information", "addon_description"]],
    ["Technical description", ["technical_description"]],
    ["Min. point", ["min_point", "minimum_point"]],
    ["Number of views", ["views", "number_of_views"]],
    ["Contact number", ["contact_number", "phone"]],
    ["Special conditions", ["special_conditions"]],
  ]);

  for (const [, keys] of [
    ["Customer's Taxpayer Identification Number", ["customer_tin", "customer_inn"]],
    ["Customer name", ["customer_name"]],
    ["Registration form", ["registration_form", "registration_form_name", "purchase_type"]],
    ["Proposal evaluation method", ["evaluation_method", "proposal_evaluation_method", "winner_method_detail"]],
    ["Procedure for considering proposals", ["procedure_for_considering_proposals", "procedure_considering", "submit_type"]],
    ["Deposit", ["deposit", "deposit_required"]],
    ["Letter of guarantee", ["letter_of_guarantee", "guarantee_letter"]],
    ["Deposit size", ["deposit_size"]],
    ["Advance payment amount", ["advance_payment_amount", "prepayment_amount"]],
    ["Unlock method", ["unlock_method"]],
    ["Payment order", ["payment_order"]],
    ["Placement term", ["placement_term"]],
    ["Opening date", ["opening_date"]],
    ["Payment term", ["payment_term", "payment_term_full"]],
    ["Customer address", ["customer_address", "address"]],
    ["Delivery address", ["delivery_address"]],
    ["Status", ["status_name"]],
    ["Financing source", ["financing_source"]],
    ["Additional information", ["additional_information", "addon_description"]],
    ["Technical description", ["technical_description"]],
    ["Min. point", ["min_point", "minimum_point"]],
    ["Number of views", ["views", "number_of_views"]],
    ["Contact number", ["contact_number", "phone"]],
    ["Special conditions", ["special_conditions"]],
  ] as Array<[string, string[]]>) {
    keys.forEach((key) => consumed.add(key));
  }

  const languages = listOfRecords(parsedDetail.languages)
    .map((item) => item.Name ?? item.name)
    .filter((value) => !isEmptyValue(value))
    .map(String);
  const rows = [...candidateRows];
  if (languages.length && !rows.some((row) => row.label === "Submit languages")) {
    rows.push({ label: "Submit languages", value: languages.join(", ") });
  }

  const omitted = new Set([
    "_detail",
    "_documents",
    "_listing_deal_id",
    "_listing_status_id",
    "_listing_status_name",
    "_lots",
    "_parsed_detail",
    "addon_description",
    "budget_products",
    "contacts",
    "fields",
    "js_fields",
    "js_qualification_fields",
    "languages",
    "qualification_fields",
    "technical_description",
  ]);

  for (const mapping of [rawJson, parsedDetail]) {
    for (const [key, value] of Object.entries(mapping)) {
      if (consumed.has(key) || omitted.has(key) || isEmptyValue(value) || !isScalarOrListOfScalars(value)) continue;
      rows.push({ label: humanizeKey(key), value });
    }
  }
  return rows;
}

function RequirementList({
  items,
  forms,
  emptyText,
  formTitleKeys,
}: {
  items: JsonRecord[];
  forms: JsonRecord[];
  emptyText: string;
  formTitleKeys: string[];
}) {
  if (!items.length && !forms.length) return <p className="text-sm text-slate-500">{emptyText}</p>;
  return (
    <div className="space-y-4">
      {items.map((item, index) => (
        <article key={`item-${index}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <h3 className="text-base font-semibold text-slate-900">{prettyScalar(firstPresent(item, "name", "label") ?? "Requirement")}</h3>
          {item.description ? <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{prettyScalar(item.description)}</p> : null}
        </article>
      ))}
      {forms.map((item, index) => {
        const title = firstPresent(item, ...formTitleKeys) ?? "Form";
        return (
          <article key={`form-${index}`} className="rounded-2xl border border-slate-200 bg-white p-4">
            <h3 className="text-base font-semibold text-slate-900">{prettyScalar(title)}</h3>
            {item.Description ? <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{prettyScalar(item.Description)}</p> : null}
            {item.File_Path ? <p className="mt-2 text-sm text-slate-600">Attached file path: {prettyScalar(item.File_Path)}</p> : null}
          </article>
        );
      })}
    </div>
  );
}

export default function UzexDetail({ tender, rawJson, lots, documents }: SourceDetailProps) {
  const parsedDetail = isRecord(rawJson._parsed_detail) ? rawJson._parsed_detail : {};
  const budgetProducts = listOfRecords(parsedDetail.budget_products);
  const primaryLot = lots[0] ?? {};
  const primaryBudget = budgetProducts[0] ?? {};
  const technicalItems = listOfRecords(rawJson.js_fields);
  const qualificationItems = listOfRecords(rawJson.js_qualification_fields);
  const technicalForms = listOfRecords(parsedDetail.fields);
  const qualificationForms = listOfRecords(parsedDetail.qualification_fields);
  const contacts = listOfRecords(parsedDetail.contacts);
  const documentGroups = DOCUMENT_TAB_ORDER.map((label) => ({
    label,
    documents: documents.filter((document) => documentTabLabel(document) === label),
  })).filter((tab) => tab.documents.length);
  const infoRows = buildInfoRows(rawJson, parsedDetail);
  const primaryLotRows = rowsFromObject(primaryLot);
  const primaryBudgetRows = rowsFromObject(primaryBudget);
  const referenceNo = rawJson.display_no ?? rawJson.id ?? tender.external_id;
  const lotTitle = rawJson.name ?? primaryLot.name_ru ?? tender.title;
  const lotDescription = primaryLot.description_ru ?? rawJson.technical_description ?? rawJson.addon_description;
  const deadline = deadlineState(tender.deadline_at);

  return (
    <section className="space-y-5">
      <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm shadow-slate-200/70">
        <div className="border-b border-slate-200 bg-gradient-to-br from-white via-slate-50 to-blue-50/70 px-5 py-5 sm:px-7 sm:py-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-sm text-slate-500">Selection of the best offer</div>
              <div className="mt-1 text-sm text-slate-500">No.:</div>
              <div className="mt-2 inline-flex items-center rounded-xl bg-blue-900 px-3 py-2 font-mono text-sm font-semibold tracking-wide text-white">
                {prettyScalar(referenceNo)}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-blue-200 bg-white text-blue-800">
                <Bell className="h-4 w-4" />
              </div>
              <a href={tender.source_url} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center gap-2 rounded-xl bg-blue-900 px-4 text-sm font-medium text-white transition hover:bg-blue-800">
                <ExternalLink className="h-4 w-4" />
                Visit source
              </a>
            </div>
          </div>
        </div>

        <div className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-4 sm:p-6">
          <div className="rounded-[22px] border border-slate-200 bg-white p-4 shadow-sm shadow-slate-100">
            <div className="mb-3 text-center text-sm font-medium text-slate-700">Time left until end:</div>
            <div className="text-center">
              {tender.deadline_at && deadline.color !== "past" ? (
                <div className="inline-flex rounded-2xl bg-slate-900 px-3 py-2 font-mono text-2xl font-semibold tracking-[0.22em] text-white shadow-lg shadow-slate-900/10">
                  {deadline.label}
                </div>
              ) : (
                <div className="inline-flex rounded-2xl bg-slate-200 px-3 py-2 text-sm font-medium text-slate-600">{deadline.label}</div>
              )}
            </div>
          </div>
          <div className="rounded-[22px] border border-slate-200 bg-white p-4 shadow-sm shadow-slate-100">
            <div className="text-center text-sm font-medium text-slate-700">Start date</div>
            <div className="mt-3 text-center text-base font-medium text-emerald-600">{prettyScalar(rawJson.start_date ?? "—")}</div>
          </div>
          <div className="rounded-[22px] border border-slate-200 bg-white p-4 shadow-sm shadow-slate-100">
            <div className="text-center text-sm font-medium text-slate-700">End date</div>
            <div className="mt-3 text-center text-base font-medium text-red-500">{prettyScalar(rawJson.end_date ?? "—")}</div>
          </div>
          <div className="rounded-[22px] border border-slate-200 bg-white p-4 shadow-sm shadow-slate-100">
            <div className="text-center text-sm font-medium text-slate-700">Total starting price</div>
            <div className="mt-3 text-center text-2xl font-semibold text-emerald-600">
              {!isEmptyValue(rawJson.start_cost) ? <MoneyValue amount={rawJson.start_cost} currency={String(rawJson.currency_codeabc ?? tender.value_currency ?? "")} /> : "—"}
            </div>
            <div className="mt-2 text-center text-xs text-slate-500">Lotning boshlang&apos;ich narhi UZSda belgilangan!</div>
          </div>
        </div>
      </section>

      <section className="rounded-[24px] border border-slate-200 bg-white px-5 py-4 text-center text-2xl font-medium text-slate-900 shadow-sm shadow-slate-200/70">
        The starting price is denominated in {tender.value_currency || "the source currency"}.
      </section>

      {lotDescription ? (
        <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/70 sm:p-6">
          <div className="mb-5 text-2xl font-medium text-blue-900">1 - {prettyScalar(lotTitle)}</div>
          <DataTable
            rows={[primaryBudget]}
            emptyText="No commercial details were extracted for this lot."
            columns={[
              { header: "Quantity", cell: (row) => prettyScalar(row.Quantity ?? "1") },
              { header: "Unit", cell: (row) => prettyScalar(row.Measure ?? "—") },
              { header: "Properties", cell: (row) => prettyScalar(row.Properties ?? "—") },
              { header: "Category", cell: (row) => prettyScalar(row.Category ?? row.Description ?? "—") },
              { header: "Starting price", cell: () => (tender.value_amount !== null && tender.value_amount !== undefined ? prettyAmount(tender.value_amount, tender.value_currency) : "—") },
              { header: "Total amount", cell: () => (tender.value_amount !== null && tender.value_amount !== undefined ? prettyAmount(tender.value_amount, tender.value_currency) : "—") },
            ]}
          />
          <div className="mt-4 space-y-2 text-sm text-slate-700">
            <p><span className="font-medium">Detailed description:</span> {prettyScalar(lotDescription)}</p>
          </div>
        </section>
      ) : null}

      <SourceDetailTabs
        tabs={[
          { id: "lot-info", label: "Lot information" },
          { id: "qualification", label: "Qualification requirements" },
          { id: "technical", label: "Technical requirements" },
          { id: "files", label: "Files to download" },
        ]}
      >
        <div>
          <dl className="grid gap-x-8 gap-y-4 lg:grid-cols-[minmax(14rem,18rem)_1fr] xl:grid-cols-[minmax(16rem,22rem)_1fr]">
            {infoRows.map((row, index) => (
              <div key={`${row.label}-${index}`} className="contents">
                <dt className="text-right text-sm text-slate-700">{row.label}</dt>
                <dd className="whitespace-pre-wrap break-words text-sm font-medium text-slate-950">{prettyScalar(row.value)}</dd>
              </div>
            ))}
          </dl>

          {primaryLotRows.length ? (
            <div className="mt-8">
              <h3 className="mb-3 text-xl font-medium text-blue-900">Primary lot fields</h3>
              <dl className="grid gap-3 md:grid-cols-2">
                {primaryLotRows.map((row) => (
                  <div key={row.label} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{row.label}</dt>
                    <dd className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-900">{prettyScalar(row.value)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}

          {primaryBudgetRows.length ? (
            <div className="mt-8">
              <h3 className="mb-3 text-xl font-medium text-blue-900">Lot commercial details</h3>
              <dl className="grid gap-3 md:grid-cols-2">
                {primaryBudgetRows.map((row) => (
                  <div key={row.label} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{row.label}</dt>
                    <dd className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-900">{prettyScalar(row.value)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}

          {contacts.length ? (
            <div className="mt-8">
              <h3 className="mb-3 text-xl font-medium text-blue-900">Contacts</h3>
              <DataTable
                rows={contacts}
                emptyText="No contacts were extracted for this tender."
                columns={[
                  { header: "Full name", cell: (contact) => <span className="font-medium text-slate-900">{prettyScalar(contact.Fullname ?? contact.fullname ?? "—")}</span> },
                  { header: "Job title", cell: (contact) => prettyScalar(contact.Job_title ?? contact.job_title ?? "—") },
                ]}
              />
            </div>
          ) : null}
        </div>

        <RequirementList
          items={qualificationItems}
          forms={qualificationForms}
          emptyText="No qualification requirements were extracted for this tender."
          formTitleKeys={["Name"]}
        />

        <RequirementList
          items={technicalItems}
          forms={technicalForms}
          emptyText="No technical requirements were extracted for this tender."
          formTitleKeys={["Label", "Form_Name", "Name"]}
        />

        <div>
          {documentGroups.length ? (
            <SourceDetailTabs tabs={documentGroups.map((tab, index) => ({ id: `file-${index}`, label: tab.label }))}>
              {documentGroups.map((tab) => (
                <div key={tab.label} className="grid gap-3 md:grid-cols-2">
                  {tab.documents.map((doc, index) => (
                    <article key={index} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-100">
                      <h3 className="text-lg font-medium text-slate-900">{prettyScalar(doc.name ?? "Document")}</h3>
                      <div className="mt-3 space-y-1 text-sm text-slate-700">
                        <p>Type: {prettyScalar(doc.ext ?? "—")}</p>
                        {!isEmptyValue(doc.size_bytes) ? <p>Size: {prettyScalar(doc.size_bytes)} bytes</p> : null}
                      </div>
                      {doc.url ? (
                        <a href={doc.url} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-600">
                          <FileDown className="h-4 w-4" />
                          Download
                        </a>
                      ) : null}
                    </article>
                  ))}
                </div>
              ))}
            </SourceDetailTabs>
          ) : (
            <p className="text-sm text-slate-500">No downloadable files were extracted for this tender.</p>
          )}
        </div>
      </SourceDetailTabs>

      <RawPayload payload={rawJson} />
    </section>
  );
}
