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
  isRecord,
  listOfRecords,
  rowsFromKeys,
  type JsonRecord,
  type SourceDetailProps,
} from "./primitives";

function normalizeLots(lots: JsonRecord[]): JsonRecord[] {
  return lots.map((lot) => {
    const status = isRecord(lot.status) ? lot.status : {};
    const system = isRecord(lot.system) ? lot.system : {};
    return {
      ...lot,
      title: lot.name_ru ?? lot.name_kk,
      status_text: status.name,
      system_text: system.name,
      enstrus: listOfRecords(lot.enstrus),
      delivery_addresses: listOfRecords(lot.delivery_addresses),
    };
  });
}

export default function ZakupUnifiedDetail({ tender, rawJson, lots }: SourceDetailProps) {
  const status = isRecord(rawJson.status) ? rawJson.status : {};
  const purchaseMethod = isRecord(rawJson.purchase_method) ? rawJson.purchase_method : {};
  const purchaseSubject = isRecord(rawJson.purchase_subject) ? rawJson.purchase_subject : {};
  const organizer = isRecord(rawJson.organizer) ? rawJson.organizer : {};
  const normalizedLots = normalizeLots(lots);
  const announcementRows = [
    { label: "ID объявления", value: rawJson.id },
    { label: "Внешний ID", value: rawJson.external_id },
    { label: "Номер объявления", value: rawJson.announcement_number },
    { label: "Наименование", value: rawJson.name },
    { label: "Статус", value: status.name },
    { label: "Код статуса", value: status.code },
    { label: "Количество лотов", value: rawJson.lot_count },
  ].filter((row) => row.value !== null && row.value !== undefined && row.value !== "");
  const procurementRows = [
    { label: "Способ закупки", value: purchaseMethod.name },
    { label: "Способ закупки (KZ)", value: purchaseMethod.name_kk },
    { label: "Код способа", value: purchaseMethod.code },
    { label: "Предмет закупки", value: purchaseSubject.name },
    { label: "Предмет закупки (KZ)", value: purchaseSubject.name_kk },
    { label: "Код предмета", value: purchaseSubject.code },
  ].filter((row) => row.value !== null && row.value !== undefined && row.value !== "");
  const organizerRows = [
    { label: "Организатор", value: organizer.name },
    { label: "БИН/ИИН", value: organizer.iin_bin },
    { label: "Тип организации", value: organizer.organization_type },
    { label: "Адрес", value: organizer.address },
    { label: "ID организатора", value: organizer.id },
  ].filter((row) => row.value !== null && row.value !== undefined && row.value !== "");

  return (
    <section className="space-y-5">
      <SourceHero
        eyebrow="Unified Procurement Portal of Kazakhstan"
        title={<>Объявление № {prettyScalar(rawJson.announcement_number ?? rawJson.id ?? tender.external_id)}</>}
        subtitle={prettyScalar(rawJson.name ?? tender.title)}
        status={status.name}
        sourceUrl={tender.source_url}
        actionLabel="Open API record"
        variant="emerald"
      >
        <div className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-4 sm:p-6">
          <MetricCard label="Способ закупки">{prettyScalar(purchaseMethod.name ?? "—")}</MetricCard>
          <MetricCard label="Предмет">{prettyScalar(purchaseSubject.name ?? "—")}</MetricCard>
          <MetricCard label="Лоты">{prettyScalar(rawJson.lot_count ?? normalizedLots.length)}</MetricCard>
          <MetricCard label="Сумма">{tender.value_amount !== null && tender.value_amount !== undefined ? <MoneyValue amount={tender.value_amount} currency={tender.value_currency} /> : "—"}</MetricCard>
        </div>
      </SourceHero>

      <SourceDetailTabs tabs={[{ id: "announcement", label: "Объявление" }, { id: "lots", label: "Лоты" }, { id: "organizer", label: "Организатор" }, { id: "api", label: "API payload" }]}>
        <div className="grid gap-5 xl:grid-cols-2">
          <section><SectionTitle>Данные объявления</SectionTitle><RowsTable rows={announcementRows} /></section>
          <section><SectionTitle>Закупочная процедура</SectionTitle><RowsTable rows={procurementRows} /></section>
          <div className="rounded-lg border border-emerald-100 bg-emerald-50/70 p-4 xl:col-span-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <MetricCard label="Опубликовано" tone="green">{tender.published_at ? prettyScalar(tender.published_at) : "—"}</MetricCard>
              <MetricCard label="Окончание приема" tone="red">{tender.deadline_at ? prettyScalar(tender.deadline_at) : "—"}<DeadlineBadge value={tender.deadline_at} /></MetricCard>
            </div>
          </div>
        </div>

        <DataTable
          rows={normalizedLots}
          emptyText="No lots were extracted for this unified procurement announcement."
          columns={[
            { header: "№", cell: (lot, index) => prettyScalar(lot.lot_number ?? index + 1) },
            { header: "Лот", cell: (lot) => <><div className="font-medium text-slate-950">{prettyScalar(lot.title ?? "—")}</div>{lot.description_ru ? <div className="mt-1 max-w-xl text-slate-600">{prettyScalar(lot.description_ru)}</div> : null}</> },
            { header: "ЕНСТРУ", cell: (lot) => listOfRecords(lot.enstrus).map((item, index) => <div key={index} className="mb-1">{prettyScalar(item.code ?? item.name_ru ?? item.name)}</div>) },
            { header: "Количество", cell: (lot) => prettyScalar(lot.quantity ?? "—") },
            { header: "Сумма", cell: (lot) => <MoneyValue amount={lot.total_price} currency={tender.value_currency} /> },
            { header: "Поставка", cell: (lot) => listOfRecords(lot.delivery_addresses).map((item, index) => <div key={index}>{prettyScalar(item.address ?? item.name_ru ?? item.value)}</div>) },
            { header: "Система", cell: (lot) => prettyScalar(lot.system_text ?? "—") },
          ]}
        />

        <section><SectionTitle>Организатор</SectionTitle><RowsTable rows={organizerRows} /></section>

        <RawPayload payload={rawJson} />
      </SourceDetailTabs>
    </section>
  );
}
