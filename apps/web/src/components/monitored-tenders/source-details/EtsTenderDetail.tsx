import { prettyScalar } from "@/lib/monitored-tenders/format";
import {
  DocumentCards,
  MetricCard,
  MoneyValue,
  RawPayload,
  RowsTable,
  SectionTitle,
  SourceDetailTabs,
  SourceHero,
  rowsFromKeys,
  type SourceDetailProps,
} from "./primitives";

export default function EtsTenderDetail({ tender, rawJson, lots, documents }: SourceDetailProps) {
  const procedureRows = rowsFromKeys(rawJson, [
    ["ID тендера", ["external_id"]],
    ["Тип процедуры", ["procedure_type_text"]],
    ["Краткое название", ["title_short"]],
    ["Название из карточки", ["title_full"]],
    ["Организатор", ["organizer_link_text", "buyer_name"]],
    ["Ссылка на организатора", ["organizer_link_url", "buyer_url"]],
    ["Опубликовано", ["published_text"]],
    ["Актуально до", ["deadline_text"]],
    ["Последнее изменение", ["last_edited_text"]],
    ["Страница тендера", ["detail_url"]],
  ]);
  const commercialRows = rowsFromKeys(rawJson, [
    ["Категория ЕНС ТРУ", ["enstru_text"]],
    ["Код ЕНС ТРУ", ["enstru_code"]],
    ["Наименование ЕНС ТРУ", ["enstru_label"]],
    ["Количество", ["quantity_text"]],
    ["Цена за единицу", ["unit_price_text"]],
    ["Общая стоимость", ["total_price_text"]],
    ["НДС", ["vat_note"]],
  ]);
  const deliveryRows = rowsFromKeys(rawJson, [
    ["Место поставки", ["delivery_address"]],
    ["Условия оплаты", ["payment_terms"]],
  ]);
  const descriptionRows = rowsFromKeys(rawJson, [
    ["Описание из листинга", ["title_description"]],
    ["Полное описание", ["description_full"]],
  ]);
  const primaryLotRows = rowsFromKeys(lots[0] ?? {}, [
    ["Наименование", ["name_ru", "name"]],
    ["Описание", ["description_ru", "description"]],
  ]);

  return (
    <section className="space-y-5">
      <SourceHero
        eyebrow="ETS-Tender Commercial Procurement"
        title={<>Тендер № {prettyScalar(rawJson.external_id ?? tender.external_id)}</>}
        subtitle={prettyScalar(rawJson.title_full ?? rawJson.title_description ?? rawJson.title_short ?? tender.title)}
        status={rawJson.procedure_type_text}
        sourceUrl={tender.source_url}
        actionLabel="Open ETS-Tender"
        variant="red"
      >
        <div className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-4 sm:p-6">
          <MetricCard label="ЕНС ТРУ">{prettyScalar(rawJson.enstru_code ?? rawJson.enstru_label ?? "—")}</MetricCard>
          <MetricCard label="Опубликовано" tone="green">{prettyScalar(rawJson.published_text ?? tender.published_at ?? "—")}</MetricCard>
          <MetricCard label="Актуально до" tone="red">{prettyScalar(rawJson.deadline_text ?? tender.deadline_at ?? "—")}</MetricCard>
          <MetricCard label="Общая стоимость">{tender.value_amount !== null && tender.value_amount !== undefined ? <MoneyValue amount={tender.value_amount} currency={tender.value_currency} /> : prettyScalar(rawJson.total_price_text ?? "—")}</MetricCard>
        </div>
      </SourceHero>

      <SourceDetailTabs tabs={[{ id: "card", label: "Карточка" }, { id: "commercial", label: "Товары и цена" }, { id: "delivery", label: "Поставка" }, { id: "documents", label: "Документы" }]}>
        <div className="grid gap-5 xl:grid-cols-2">
          <section><SectionTitle>Процедура</SectionTitle><RowsTable rows={procedureRows} accent="red" /></section>
          <section><SectionTitle>Описание</SectionTitle><RowsTable rows={descriptionRows.length ? descriptionRows : primaryLotRows} accent="red" /></section>
        </div>
        <div className="grid gap-5 xl:grid-cols-2">
          <section><SectionTitle>Коммерческие данные</SectionTitle><RowsTable rows={commercialRows} accent="red" /></section>
          <section className="rounded-lg border border-slate-200 bg-slate-50 p-4"><div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Value snapshot</div><div className="mt-2 text-lg font-semibold text-slate-950">{tender.value_amount !== null && tender.value_amount !== undefined ? <MoneyValue amount={tender.value_amount} currency={tender.value_currency} /> : prettyScalar(rawJson.total_price_text ?? "—")}</div></section>
        </div>
        <section><SectionTitle>Поставка и оплата</SectionTitle><RowsTable rows={deliveryRows} accent="red" /></section>
        <DocumentCards documents={documents} accent="red" />
      </SourceDetailTabs>
      <RawPayload payload={rawJson} />
    </section>
  );
}
