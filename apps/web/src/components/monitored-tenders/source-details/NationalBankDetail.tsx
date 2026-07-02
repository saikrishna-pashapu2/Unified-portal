import { prettyScalar } from "@/lib/monitored-tenders/format";
import {
  DataTable,
  DeadlineBadge,
  MetricCard,
  MoneyValue,
  RawPayload,
  RowsTable,
  SectionTitle,
  SourceDetailTabs,
  SourceHero,
  listOfRecords,
  rowsFromKeys,
  type SourceDetailProps,
} from "./primitives";

export default function NationalBankDetail({ tender, rawJson, documents }: SourceDetailProps) {
  const lotRows = rowsFromKeys(rawJson, [
    ["Номер лота", ["data_key"]],
    ["Номер объявления", ["announcement_number"]],
    ["ID объявления", ["announcement_id"]],
    ["Код ЕНСТРУ", ["detail_enstru_code", "enstru_code"]],
    ["Тип пункта плана", ["plan_type"]],
    ["Год", ["year"]],
    ["Срок проведения закупки", ["period"]],
    ["Страница лота", ["detail_url"]],
  ]);
  const lotDetailRows = rowsFromKeys(rawJson, [
    ["Наименование на русском языке", ["name_ru", "title_ru"]],
    ["Наименование на государственном языке", ["name_kk"]],
    ["Характеристика на русском языке", ["detail_characteristic_ru", "characteristic_ru"]],
    ["Характеристика на государственном языке", ["characteristic_kk"]],
    ["Количество и сумма", ["amount_summary"]],
    ["Стоимость из списка", ["value_text"]],
  ]);
  const announcementRows = rowsFromKeys(rawJson, [
    ["Наименование объявления (RU)", ["announcement_name_ru"]],
    ["Наименование объявления (KZ)", ["announcement_name_kk"]],
    ["Дата начала приема заявок", ["announcement_start_text"]],
    ["Дата вскрытия и завершения приема заявок", ["announcement_end_text"]],
    ["Способ закупки", ["procurement_method"]],
    ["Статус объявления", ["announcement_status"]],
    ["Ссылка на объявление", ["announcement_url"]],
  ]);
  const organizerRows = rowsFromKeys(rawJson, [
    ["Организатор", ["organizer_name", "buyer_name"]],
    ["БИН организатора", ["buyer_bin"]],
    ["Email организатора", ["organizer_email"]],
    ["Карточка организатора", ["organizer_url", "subject_url"]],
  ]);
  const deliveryPlaces = listOfRecords(rawJson.delivery_places);
  const lotTitle = rawJson.name_ru ?? rawJson.title_ru ?? rawJson.title ?? tender.title;

  return (
    <section className="space-y-5">
      <SourceHero
        eyebrow="National Bank of Kazakhstan Procurement Portal"
        title={<>Информация о лоте № {tender.external_id}</>}
        subtitle={prettyScalar(lotTitle)}
        status={rawJson.announcement_status ?? rawJson.status_text}
        sourceUrl={tender.source_url}
        actionLabel="Открыть на портале"
        variant="blue"
      >
        <div className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-4 sm:p-6">
          <MetricCard label="Объявление">{prettyScalar(rawJson.announcement_id ?? rawJson.announcement_number ?? "—")}</MetricCard>
          <MetricCard label="Начало приема" tone="green">{tender.published_at ? prettyScalar(tender.published_at) : "—"}</MetricCard>
          <MetricCard label="Завершение приема" tone="red">{tender.deadline_at ? prettyScalar(tender.deadline_at) : "—"}<DeadlineBadge value={tender.deadline_at} /></MetricCard>
          <MetricCard label="Сумма">{tender.value_amount !== null && tender.value_amount !== undefined ? <MoneyValue amount={tender.value_amount} currency={tender.value_currency} /> : prettyScalar(rawJson.amount_summary ?? rawJson.value_text ?? "—")}</MetricCard>
        </div>
      </SourceHero>

      <SourceDetailTabs tabs={[{ id: "lot", label: "Информация о лоте" }, { id: "delivery", label: "Место поставки" }, { id: "announcement", label: "Объявление" }, { id: "documents", label: "Документы" }]}>
        <div>
          <div className="mb-5 rounded-lg border border-blue-100 bg-blue-50/60 p-4">
            <h3 className="text-lg font-semibold text-blue-950">{prettyScalar(lotTitle)}</h3>
            {rawJson.name_kk ? <p className="mt-1 text-sm text-blue-900">{prettyScalar(rawJson.name_kk)}</p> : null}
            {rawJson.detail_characteristic_ru || rawJson.characteristic_ru ? <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-800">{prettyScalar(rawJson.detail_characteristic_ru ?? rawJson.characteristic_ru)}</p> : null}
            {rawJson.characteristic_kk ? <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-600">{prettyScalar(rawJson.characteristic_kk)}</p> : null}
          </div>
          <div className="grid gap-5 xl:grid-cols-2">
            <section><SectionTitle>Реквизиты лота</SectionTitle><RowsTable rows={lotRows} /></section>
            <section><SectionTitle>Описание и сумма</SectionTitle><RowsTable rows={lotDetailRows} /></section>
          </div>
        </div>

        <DataTable
          rows={deliveryPlaces}
          emptyText="No delivery places were extracted for this tender."
          columns={[
            { header: "Страна", cell: (place) => prettyScalar(place.country ?? "—") },
            { header: "Место поставки", cell: (place) => <span className="font-medium text-slate-950">{prettyScalar(place.place ?? "—")}</span> },
            { header: "Количество", cell: (place) => prettyScalar(place.quantity ?? "—") },
          ]}
        />

        <div className="grid gap-5 xl:grid-cols-2">
          <section><SectionTitle>Информация об объявлении</SectionTitle><RowsTable rows={announcementRows} /></section>
          <section><SectionTitle>Организатор</SectionTitle><RowsTable rows={organizerRows} /></section>
        </div>

        <DataTable
          rows={documents}
          emptyText="No documentation files were extracted for this tender."
          columns={[
            { header: "Категория", cell: (doc) => prettyScalar(doc.category ?? "—") },
            { header: "Файл", cell: (doc) => <><span className="font-medium text-slate-950">{prettyScalar(doc.name ?? "Document")}</span>{doc.ext ? <span className="ml-2 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">{prettyScalar(doc.ext)}</span> : null}{doc.hash ? <div className="mt-1 break-all font-mono text-[11px] text-slate-400">{prettyScalar(doc.hash)}</div> : null}</> },
            { header: "Размер", cell: (doc) => prettyScalar(doc.size_text ?? "—") },
            { header: "Загружен", cell: (doc) => prettyScalar(doc.uploaded_at_text ?? "—") },
            { header: "Скачать", cell: (doc) => doc.url ? <a href={doc.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-md bg-blue-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-blue-800">Скачать</a> : <span className="text-slate-400">—</span> },
          ]}
        />
      </SourceDetailTabs>
      <RawPayload payload={rawJson} />
    </section>
  );
}
