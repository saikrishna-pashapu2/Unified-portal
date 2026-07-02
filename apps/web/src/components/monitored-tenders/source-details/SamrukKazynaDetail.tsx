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
  isRecord,
  listOfRecords,
  rowsFromKeys,
  type JsonRecord,
  type SourceDetailProps,
} from "./primitives";

function joinAddress(address: JsonRecord): string | null {
  const parts = [address.countryRu, address.katoFullNameRu, address.street, address.building, address.flat].filter(Boolean);
  return parts.length ? parts.map(String).join(", ") : null;
}

export default function SamrukKazynaDetail({ tender, rawJson, lots }: SourceDetailProps) {
  const customer = isRecord(rawJson.customer) ? rawJson.customer : {};
  const organizer = isRecord(rawJson.organizer) ? rawJson.organizer : {};
  const requirement = isRecord(rawJson.advertRequirement) ? rawJson.advertRequirement : {};
  const customerAddress = isRecord(customer.legalAddress) ? customer.legalAddress : {};
  const organizerAddress = isRecord(organizer.legalAddress) ? organizer.legalAddress : {};
  const documents = listOfRecords(rawJson.documents);
  const advertRows = rowsFromKeys(rawJson, [
    ["ID объявления", ["id"]],
    ["Номер объявления", ["number"]],
    ["Наименование (RU)", ["nameRu"]],
    ["Наименование (KZ)", ["nameKk"]],
    ["Тип тендера", ["tenderType"]],
    ["Статус", ["advertStatus", "simpleStatus"]],
    ["Прием заявок с", ["acceptanceBeginDateTime"]],
    ["Прием заявок до", ["acceptanceEndDateTime"]],
    ["Контактный телефон", ["phone"]],
    ["Внутренний номер", ["extensionNumber"]],
    ["Email", ["email"]],
  ]);
  const customerRows = [
    { label: "Заказчик", value: customer.nameRu },
    { label: "Заказчик (KZ)", value: customer.nameKk },
    { label: "БИН", value: customer.bin ?? customer.identifier },
    { label: "Телефон", value: customer.phone },
    { label: "Email", value: customer.email },
    { label: "Адрес", value: joinAddress(customerAddress) },
  ].filter((row) => row.value);
  const organizerRows = [
    { label: "Организатор", value: organizer.nameRu },
    { label: "Организатор (KZ)", value: organizer.nameKk },
    { label: "БИН", value: organizer.bin ?? organizer.identifier },
    { label: "Адрес", value: joinAddress(organizerAddress) },
  ].filter((row) => row.value);
  const requirementRows = [
    { label: "ID требований", value: requirement.id },
    { label: "ID объявления", value: requirement.advertId },
    { label: "Начало обсуждения", value: requirement.discussionBeginDateTime },
    { label: "Завершение обсуждения", value: requirement.discussionEndDateTime },
  ].filter((row) => row.value);
  const normalizedLots = lots.map((lot) => {
    const tru = isRecord(lot.truHistory) ? lot.truHistory : {};
    const deliveryCountry = isRecord(lot.deliveryCountry) ? lot.deliveryCountry : {};
    const deliveryKato = isRecord(lot.deliveryKato) ? lot.deliveryKato : {};
    const lotCustomer = isRecord(lot.customer) ? lot.customer : {};
    return {
      ...lot,
      title: lot.nameRu ?? lot.nameKk,
      category: tru.category ?? lot.tenderSubjectType,
      tru_code: tru.code,
      tru_name: tru.ru ?? tru.briefRu,
      customer_name: lotCustomer.nameRu,
      customer_bin: lotCustomer.bin,
      delivery_country: deliveryCountry.ru,
      delivery_kato: deliveryKato.ru ?? deliveryKato.fullRu,
    };
  });

  return (
    <section className="space-y-5">
      <SourceHero
        eyebrow="Samruk-Kazyna Electronic Procurement"
        title={<>Объявление № {prettyScalar(rawJson.number ?? rawJson.id ?? tender.external_id)}</>}
        subtitle={prettyScalar(rawJson.nameRu ?? tender.title)}
        status={rawJson.advertStatus ?? rawJson.simpleStatus}
        sourceUrl={tender.source_url}
        actionLabel="Open Samruk"
        variant="amber"
      >
        <div className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-4 sm:p-6">
          <MetricCard label="Тип тендера">{prettyScalar(rawJson.tenderType ?? "—")}</MetricCard>
          <MetricCard label="Начало приема" tone="green">{prettyScalar(rawJson.acceptanceBeginDateTime ?? tender.published_at ?? "—")}</MetricCard>
          <MetricCard label="Окончание приема" tone="red">{prettyScalar(rawJson.acceptanceEndDateTime ?? tender.deadline_at ?? "—")}<DeadlineBadge value={tender.deadline_at} /></MetricCard>
          <MetricCard label="Сумма без НДС"><MoneyValue amount={tender.value_amount} currency={tender.value_currency} /></MetricCard>
        </div>
      </SourceHero>

      <SourceDetailTabs tabs={[{ id: "advert", label: "Объявление" }, { id: "lots", label: "Лоты" }, { id: "parties", label: "Участники" }, { id: "documents", label: "Документы" }]}>
        <section><SectionTitle>Информация об объявлении</SectionTitle><RowsTable rows={advertRows} /></section>
        <DataTable
          rows={normalizedLots}
          emptyText="No lots were extracted for this Samruk tender."
          columns={[
            { header: "№", cell: (lot, index) => prettyScalar(lot.number ?? index + 1) },
            { header: "Наименование", cell: (lot) => <><div className="font-medium text-slate-950">{prettyScalar(lot.title ?? "—")}</div>{lot.title_kk ? <div className="mt-1 text-slate-500">{prettyScalar(lot.title_kk)}</div> : null}</> },
            { header: "ТРП / категория", cell: (lot) => <><div>{prettyScalar(lot.tru_code ?? "—")}</div><div className="text-xs text-slate-500">{prettyScalar(lot.category ?? lot.tru_name ?? "")}</div></> },
            { header: "Количество", cell: (lot) => prettyScalar(lot.count ?? lot.quantity ?? "—") },
            { header: "Цена", cell: (lot) => <MoneyValue amount={lot.price} currency={tender.value_currency} /> },
            { header: "Сумма", cell: (lot) => <MoneyValue amount={lot.sumTruNoNds ?? lot.total_amount} currency={tender.value_currency} /> },
            { header: "Поставка", cell: (lot) => prettyScalar(lot.deliveryLocationRu ?? lot.delivery_location ?? lot.location ?? "—") },
          ]}
        />
        <div className="grid gap-5 xl:grid-cols-2">
          <section><SectionTitle>Заказчик</SectionTitle><RowsTable rows={customerRows} /></section>
          <section><SectionTitle>Организатор</SectionTitle><RowsTable rows={organizerRows} /></section>
          {requirementRows.length ? <section className="xl:col-span-2"><SectionTitle>Требования</SectionTitle><RowsTable rows={requirementRows} /></section> : null}
        </div>
        <DocumentCards documents={documents} accent="emerald" />
      </SourceDetailTabs>
      <RawPayload payload={rawJson} />
    </section>
  );
}
