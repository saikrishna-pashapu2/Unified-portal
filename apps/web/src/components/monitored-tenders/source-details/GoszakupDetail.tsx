import { FileDown } from "lucide-react";
import { prettyAmount, prettyScalar } from "@/lib/monitored-tenders/format";
import {
  DataTable,
  MetricCard,
  MoneyValue,
  RawPayload,
  RowsTable,
  SectionTitle,
  SourceDetailTabs,
  SourceHero,
  compactRows,
  firstPresent,
  listOfRecords,
  rowsFromKeys,
  type SourceDetailProps,
} from "./primitives";

export default function GoszakupDetail({ tender, rawJson, lots, documents }: SourceDetailProps) {
  const announcementLots = listOfRecords(rawJson.announcement_lots).length
    ? listOfRecords(rawJson.announcement_lots)
    : listOfRecords(rawJson._announcement_lots);
  const selectedLot = lots[0] ?? {};

  const selectedLotRows = rowsFromKeys({ ...selectedLot, ...rawJson }, [
    ["Номер лота", ["lot_reference_number"]],
    ["ID лота", ["lot_id"]],
    ["Наименование лота", ["lot_title", "name_ru"]],
    ["Количество", ["quantity_text"]],
    ["Сумма", ["amount_text"]],
    ["Способ закупки", ["procurement_method"]],
    ["Статус", ["status_text"]],
    ["Ссылка на лот", ["lot_detail_url", "lot_url"]],
  ]);
  const announcementRows = rowsFromKeys(rawJson, [
    ["Номер объявления", ["announcement_number"]],
    ["Наименование объявления", ["announcement_title_ru", "announcement_title"]],
    ["Статус объявления", ["announcement_status"]],
    ["Дата публикации объявления", ["publish_date_text"]],
    ["Срок начала приема заявок", ["offer_start_text"]],
    ["Срок окончания приема заявок", ["offer_end_text"]],
  ]);
  const generalRows = rowsFromKeys(rawJson, [
    ["Способ проведения закупки", ["procurement_method"]],
    ["Тип закупки", ["purchase_type"]],
    ["Способ несостоявшейся закупки", ["failed_procurement_method"]],
    ["Вид предмета закупок", ["subject_type"]],
    ["Кол-во лотов в объявлении", ["lot_count_text"]],
    ["Сумма закупки", ["total_amount_text"]],
    ["Признаки", ["signs"]],
    ["Приглашенный поставщик", ["invited_supplier"]],
  ]);
  const organizerRows = rowsFromKeys(rawJson, [
    ["БИН организатора", ["organizer_bin"]],
    ["Организатор", ["organizer_name", "organizer_text"]],
    ["Юр. адрес организатора", ["organizer_legal_address"]],
    ["ФИО представителя", ["organizer_representative"]],
    ["Должность", ["organizer_position"]],
    ["E-Mail", ["organizer_email"]],
    ["Создатель объявления", ["announcement_creator"]],
  ]);

  return (
    <section className="space-y-5">
      <SourceHero
        eyebrow="Портал государственных закупок"
        title={<>Просмотр объявления № {prettyScalar(firstPresent(rawJson, "announcement_number", "announcement_id") ?? tender.external_id)}</>}
        subtitle={prettyScalar(firstPresent(rawJson, "announcement_title_ru", "announcement_title"))}
        status={firstPresent(rawJson, "announcement_status", "status_text")}
        sourceUrl={tender.source_url}
        actionLabel="Открыть на портале"
        variant="light"
      >
        <div className="grid gap-x-8 gap-y-4 px-5 py-5 sm:px-6 lg:grid-cols-2">
          {announcementRows.map((row) => (
            <div key={row.label} className="grid gap-2 sm:grid-cols-[12rem_1fr]">
              <div className="text-sm font-medium text-slate-500">{row.label}</div>
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-950">
                {prettyScalar(row.value)}
              </div>
            </div>
          ))}
        </div>
      </SourceHero>

      <SourceDetailTabs
        tabs={[
          { id: "general", label: "Общие сведения" },
          { id: "selected-lot", label: "Выбранный лот" },
          { id: "lots", label: "Лоты" },
          { id: "documents", label: "Документация" },
        ]}
      >
        <div className="grid gap-5 xl:grid-cols-2">
          <section>
            <SectionTitle>Общие сведения</SectionTitle>
            <RowsTable rows={generalRows} />
          </section>
          <section>
            <SectionTitle>Организатор</SectionTitle>
            <RowsTable rows={organizerRows} />
          </section>
        </div>

        <div>
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h3 className="text-lg font-semibold text-slate-950">{tender.title}</h3>
              <p className="mt-1 text-sm text-slate-500">Lot record {tender.external_id}</p>
            </div>
            {tender.value_amount !== null && tender.value_amount !== undefined ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-right">
                <div className="text-sm font-semibold text-slate-950">{prettyAmount(tender.value_amount, tender.value_currency)}</div>
              </div>
            ) : null}
          </div>
          <RowsTable rows={selectedLotRows} wideLabel />
        </div>

        <DataTable
          rows={announcementLots}
          emptyText="No announcement lots were extracted for this tender."
          highlight={(lot) => lot.lot_url === tender.source_url || lot.name_ru === tender.title}
          columns={[
            { header: "№", cell: (lot, index) => prettyScalar(lot.sequence_text ?? index + 1) },
            {
              header: "Наименование",
              cell: (lot) =>
                lot.lot_url ? (
                  <a href={lot.lot_url} target="_blank" rel="noopener noreferrer" className="font-medium text-blue-700 hover:text-blue-900">
                    {prettyScalar(lot.name_ru ?? "—")}
                  </a>
                ) : (
                  <span className="font-medium text-slate-950">{prettyScalar(lot.name_ru ?? "—")}</span>
                ),
            },
            { header: "Описание", cell: (lot) => prettyScalar(lot.description_ru ?? "—") },
            { header: "Количество", cell: (lot) => prettyScalar(lot.quantity_text ?? "—") },
            {
              header: "Сумма",
              cell: (lot) => (lot.amount ? <MoneyValue amount={lot.amount} currency={lot.currency} /> : prettyScalar(lot.amount_text ?? "—")),
            },
          ]}
        />

        <DataTable
          rows={documents}
          emptyText="No documentation files were extracted for this tender."
          columns={[
            { header: "Наименование документа", cell: (doc) => <span className="font-medium text-slate-950">{prettyScalar(doc.name ?? "Document")}</span> },
            { header: "Признак", cell: (doc) => prettyScalar(doc.signed_text ?? doc.category ?? "—") },
            {
              header: "Файл",
              cell: (doc) =>
                doc.url ? (
                  <a href={doc.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 transition hover:bg-blue-100">
                    <FileDown className="h-4 w-4" />
                    Перейти
                  </a>
                ) : (
                  <span className="text-slate-400">—</span>
                ),
            },
          ]}
        />
      </SourceDetailTabs>
      <RawPayload payload={rawJson} />
    </section>
  );
}
