import { prettyScalar } from "@/lib/monitored-tenders/format";
import {
  DataTable,
  DeadlineBadge,
  DocumentCards,
  MetricCard,
  MoneyValue,
  RawPayload,
  RowsTable,
  SectionTitle,
  SourceDetailTabs,
  SourceHero,
  compactRows,
  isRecord,
  rowsFromKeys,
  type SourceDetailProps,
} from "./primitives";

export default function MitworkDetail({ tender, rawJson, lots, documents }: SourceDetailProps) {
  const detailFields = isRecord(rawJson.detail_fields) ? rawJson.detail_fields : {};
  const merged = { ...rawJson, ...detailFields };
  const identityRows = rowsFromKeys(merged, [
    ["Номер закупки", ["announcement_number"]],
    ["Внутренний ID", ["data_key"]],
    ["Лотов", ["lots_label"]],
    ["Наименование (RU)", ["title_ru_detail", "title_ru"]],
    ["Наименование (KZ)", ["title_kk"]],
    ["Страница закупки", ["detail_url"]],
  ]);
  const timelineRows = rowsFromKeys(merged, [
    ["Начало приема заявок", ["offer_start_text_detail", "offer_start_text"]],
    ["Окончание приема заявок", ["offer_end_text_detail", "offer_end_text"]],
    ["Статус", ["status_text_detail", "status_text"]],
  ]);
  const organizerRows = rowsFromKeys(merged, [
    ["Организатор", ["organizer_name", "buyer_name"]],
    ["БИН/ИИН", ["buyer_bin"]],
    ["Карточка организатора", ["organizer_url", "subject_url"]],
  ]);
  const processRows = rowsFromKeys(merged, [
    ["Способ закупки", ["procurement_method_detail", "procurement_method"]],
    ["Тип закупки", ["purchase_type"]],
    ["Правила закупок", ["rules_name"]],
    ["Ссылка на правила", ["rules_url"]],
  ]);
  const commercialRows = rowsFromKeys(merged, [
    ["Стоимость", ["value_text"]],
    ["Валюта", ["currency"]],
  ]);
  const primaryLotRows = rowsFromKeys(lots[0] ?? {}, [
    ["Номер", ["number"]],
    ["Код классификации", ["classification_code"]],
    ["Наименование", ["name_ru", "name"]],
    ["Описание", ["description_ru", "description"]],
    ["Количество", ["quantity_text"]],
    ["Цена за единицу", ["unit_price_text"]],
    ["Сумма", ["total_amount_text"]],
    ["Подано заявок", ["submitted_bids_text"]],
    ["Страница лота", ["lot_url"]],
  ]);

  return (
    <section className="space-y-5">
      <SourceHero
        eyebrow="Eurasian Electronic Portal"
        title={<>Закупка № {prettyScalar(rawJson.announcement_number ?? tender.external_id)}</>}
        subtitle={prettyScalar(detailFields.title_ru_detail ?? rawJson.title_ru ?? rawJson.title ?? tender.title)}
        status={detailFields.status_text_detail ?? rawJson.status_text}
        sourceUrl={tender.source_url}
        actionLabel="Открыть на EEP"
        variant="light"
      >
        <div className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-4 sm:p-6">
          <MetricCard label="Начало приема" tone="green">
            {tender.published_at ? prettyScalar(tender.published_at) : "—"}
            {timelineRows[0] ? <div className="mt-1 text-xs font-normal text-slate-500">{prettyScalar(timelineRows[0].value)}</div> : null}
          </MetricCard>
          <MetricCard label="Окончание приема" tone="red">
            {tender.deadline_at ? prettyScalar(tender.deadline_at) : "—"}
            <DeadlineBadge value={tender.deadline_at} />
          </MetricCard>
          <MetricCard label="Стоимость">
            {tender.value_amount !== null && tender.value_amount !== undefined ? <MoneyValue amount={tender.value_amount} currency={tender.value_currency} /> : prettyScalar(commercialRows[0]?.value ?? "—")}
          </MetricCard>
          <MetricCard label="Покрытие">
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-700">{lots.length} lot{lots.length === 1 ? "" : "s"}</span>
              <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-700">{documents.length} doc{documents.length === 1 ? "" : "s"}</span>
            </div>
            <div className="mt-2 text-xs font-normal text-slate-500">Listing + detail page payload</div>
          </MetricCard>
        </div>
      </SourceHero>

      <SourceDetailTabs tabs={[{ id: "profile", label: "Сведения о закупке" }, { id: "lots", label: "Лоты" }, { id: "documents", label: "Документы" }]}>
        <div className="grid gap-5 xl:grid-cols-2">
          <section><SectionTitle>Основные данные</SectionTitle><RowsTable rows={identityRows} accent="sky" /></section>
          <section><SectionTitle>Сроки</SectionTitle><RowsTable rows={timelineRows} accent="sky" /></section>
          <section><SectionTitle>Организатор</SectionTitle><RowsTable rows={organizerRows} accent="sky" /></section>
          <section><SectionTitle>Процедура</SectionTitle><RowsTable rows={processRows} accent="sky" /></section>
        </div>

        <div>
          <DataTable
            rows={lots}
            emptyText="No lots were extracted for this Mitwork tender."
            columns={[
              { header: "Номер", cell: (lot, index) => <><div>{prettyScalar(lot.number ?? index + 1)}</div>{lot.classification_code ? <div className="mt-1 rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-500">{prettyScalar(lot.classification_code)}</div> : null}</> },
              { header: "Наименование", cell: (lot) => lot.lot_url ? <a href={lot.lot_url} target="_blank" rel="noopener noreferrer" className="font-medium text-sky-700 hover:text-sky-900">{prettyScalar(lot.name_ru ?? "—")}</a> : <span className="font-medium text-slate-950">{prettyScalar(lot.name_ru ?? "—")}</span> },
              { header: "Описание", cell: (lot) => prettyScalar(lot.description_ru ?? "—") },
              { header: "Количество", cell: (lot) => prettyScalar(lot.quantity_text ?? "—") },
              { header: "Цена", cell: (lot) => prettyScalar(lot.unit_price_text ?? "—") },
              { header: "Сумма", cell: (lot) => lot.total_amount ? <MoneyValue amount={lot.total_amount} currency={lot.currency} /> : prettyScalar(lot.total_amount_text ?? "—") },
              { header: "Заявки", cell: (lot) => prettyScalar(lot.submitted_bids_text ?? "—") },
            ]}
          />
          {primaryLotRows.length ? (
            <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <SectionTitle>Выбранный лот</SectionTitle>
              <dl className="grid gap-3 md:grid-cols-2">
                {primaryLotRows.map((row) => (
                  <div key={row.label} className="rounded-md border border-slate-200 bg-white p-3">
                    <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{row.label}</dt>
                    <dd className="mt-2 text-sm text-slate-900 whitespace-pre-wrap break-words">{prettyScalar(row.value)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}
        </div>

        <DocumentCards documents={documents} accent="sky" />
      </SourceDetailTabs>
      <RawPayload payload={rawJson} />
    </section>
  );
}
