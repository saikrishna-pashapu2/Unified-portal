import { humanizeKey } from "./format";

export type JsonRecord = Record<string, any>;

export type PresentedNode =
  | { kind: "scalar"; value: unknown; title?: string }
  | { kind: "scalar_list"; items: unknown[] }
  | { kind: "mapping"; rows: PresentedRow[]; title?: string }
  | { kind: "sequence"; items: PresentedNode[] };

export interface PresentedRow {
  label: string;
  value: PresentedNode;
}

export interface SourceGroup {
  title: string;
  rows: PresentedRow[];
}

export interface SourceSection {
  title: string;
  summary: string | null;
  content: PresentedNode;
}

export interface KeyValueRow {
  label: string;
  value: unknown;
}

export interface SourceSpecificView {
  sourceName: string;
  heading: string;
  eyebrow: string;
  subtitle?: string | null;
  status?: string | null;
  metricCards: KeyValueRow[];
  tabs: Array<{
    id: string;
    label: string;
    sections: Array<{
      title: string;
      rows?: KeyValueRow[];
      items?: JsonRecord[];
      emptyText?: string;
    }>;
  }>;
}

const SOURCE_DETAIL_OMITTED_KEYS = new Set([
  "_documents",
  "_lots",
  "title",
  "buyer_name",
  "buyer_external_id",
  "source_url",
]);

const SOURCE_GROUP_ORDER = [
  "Identity",
  "Timeline",
  "Commercial",
  "Parties",
  "Process",
  "References",
  "Additional facts",
];

const SOURCE_SECTION_TITLES: Record<string, string> = {
  detail_fields: "Announcement profile",
  _detail: "Tender record",
  _parsed_detail: "Parsed embedded detail",
  announcement_lots: "Announcement lots",
  _announcement_lots: "Announcement lots",
  fields: "Criteria forms",
  qualification_fields: "Qualification forms",
  js_fields: "Dynamic criteria",
  js_qualification_fields: "Qualification prompts",
};

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isScalar(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    value instanceof Date ||
    ["string", "number", "boolean", "bigint"].includes(typeof value)
  );
}

function isListOfScalars(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.length > 0 && value.every(isScalar);
}

function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (isRecord(value)) return Object.keys(value).length === 0;
  return false;
}

function displaySourceKey(key: string): string {
  return key.replace(/^_+/, "");
}

function sequenceItemTitle(item: JsonRecord, index: number): string {
  for (const key of ["label", "name", "name_ru", "title", "title_ru_detail", "number", "display_no", "id", "Id"]) {
    if (!isEmptyValue(item[key])) return String(item[key]);
  }
  return `Item ${index}`;
}

export function presentValue(value: unknown): PresentedNode {
  if (isScalar(value)) return { kind: "scalar", value };
  if (isListOfScalars(value)) return { kind: "scalar_list", items: value };
  if (isRecord(value)) {
    const rows = Object.entries(value)
      .filter(([, nested]) => !isEmptyValue(nested))
      .map(([key, nested]) => ({
        label: humanizeKey(displaySourceKey(key)),
        value: presentValue(nested),
      }));
    return { kind: "mapping", rows };
  }
  if (Array.isArray(value)) {
    const items = value
      .filter((item) => !isEmptyValue(item))
      .map((item, index) => {
        if (isRecord(item)) {
          const rows = Object.entries(item)
            .filter(([, nested]) => !isEmptyValue(nested))
            .map(([key, nested]) => ({
              label: humanizeKey(displaySourceKey(key)),
              value: presentValue(nested),
            }));
          return { kind: "mapping", title: sequenceItemTitle(item, index + 1), rows } as PresentedNode;
        }
        return { kind: "scalar", title: `Item ${index + 1}`, value: item } as PresentedNode;
      });
    return { kind: "sequence", items };
  }
  return { kind: "scalar", value };
}

function bucketSourceField(key: string): string {
  const normalized = key.toLowerCase();
  if (["number", "id", "display", "code", "label", "title", "category", "classification", "name"].some((token) => normalized.includes(token))) return "Identity";
  if (["date", "time", "start", "end", "deadline", "created", "updated", "opening", "placement", "submit"].some((token) => normalized.includes(token))) return "Timeline";
  if (["amount", "sum", "cost", "price", "currency", "deposit", "advance", "value", "point"].some((token) => normalized.includes(token))) return "Commercial";
  if (["buyer", "customer", "seller", "organizer", "address", "contact", "region", "district", "bin", "tin", "inn", "fullname", "job"].some((token) => normalized.includes(token))) return "Parties";
  if (["status", "method", "procedure", "language", "rule", "type", "source", "qualification", "financing", "evaluation"].some((token) => normalized.includes(token))) return "Process";
  if (normalized.includes("url") || normalized.includes("link") || normalized.includes("path")) return "References";
  return "Additional facts";
}

export function extractSourceGroups(rawJson: JsonRecord): SourceGroup[] {
  const grouped = new Map(SOURCE_GROUP_ORDER.map((title) => [title, [] as PresentedRow[]]));
  for (const [key, value] of Object.entries(rawJson)) {
    if (SOURCE_DETAIL_OMITTED_KEYS.has(key) || key.startsWith("__")) continue;
    if (isEmptyValue(value)) continue;
    if (isRecord(value)) continue;
    if (Array.isArray(value) && value.some((item) => isRecord(item) || Array.isArray(item))) continue;
    const bucket = bucketSourceField(key);
    grouped.get(bucket)?.push({
      label: humanizeKey(displaySourceKey(key)),
      value: presentValue(value),
    });
  }
  return SOURCE_GROUP_ORDER.flatMap((title) => {
    const rows = grouped.get(title) ?? [];
    return rows.length ? [{ title, rows }] : [];
  });
}

function sectionSummary(value: unknown): string | null {
  if (isRecord(value)) return `${Object.keys(value).length} fields`;
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? "" : "s"}`;
  return null;
}

export function extractSourceSections(rawJson: JsonRecord): SourceSection[] {
  return Object.entries(rawJson).flatMap(([key, value]) => {
    if (key === "_documents" || key === "_lots" || isEmptyValue(value)) return [];
    const isDeep = isRecord(value) || (Array.isArray(value) && value.some((item) => isRecord(item) || Array.isArray(item)));
    if (!isDeep) return [];
    return [
      {
        title: SOURCE_SECTION_TITLES[key] ?? humanizeKey(displaySourceKey(key)),
        summary: sectionSummary(value),
        content: presentValue(value),
      },
    ];
  });
}

export function extractDocuments(rawJson: unknown): JsonRecord[] {
  if (!isRecord(rawJson) || !Array.isArray(rawJson._documents)) return [];
  return rawJson._documents.filter(isRecord);
}

export function extractLots(rawJson: unknown): JsonRecord[] {
  if (!isRecord(rawJson) || !Array.isArray(rawJson._lots)) return [];
  return rawJson._lots.filter(isRecord);
}

function firstPresent(mapping: JsonRecord, ...keys: string[]): unknown {
  for (const key of keys) {
    if (!isEmptyValue(mapping[key])) return mapping[key];
  }
  return null;
}

function rowsFromKeys(mapping: JsonRecord, candidates: Array<[string, string[]]>): KeyValueRow[] {
  return candidates.flatMap(([label, keys]) => {
    const value = firstPresent(mapping, ...keys);
    return isEmptyValue(value) ? [] : [{ label, value }];
  });
}

function simpleRows(mapping: JsonRecord, omitted = new Set<string>()): KeyValueRow[] {
  return Object.entries(mapping)
    .filter(([key, value]) => !omitted.has(key) && !key.startsWith("_") && isScalar(value) && !isEmptyValue(value))
    .slice(0, 28)
    .map(([key, value]) => ({ label: humanizeKey(displaySourceKey(key)), value }));
}

export function buildSourceSpecificView(
  sourceName: string,
  rawJson: JsonRecord,
  lots: JsonRecord[],
  documents: JsonRecord[],
): SourceSpecificView | null {
  const detailFields = isRecord(rawJson.detail_fields) ? rawJson.detail_fields : {};
  const merged = { ...rawJson, ...detailFields };

  if (sourceName === "goszakup") {
    const announcementLots = Array.isArray(rawJson.announcement_lots)
      ? rawJson.announcement_lots.filter(isRecord)
      : Array.isArray(rawJson._announcement_lots)
        ? rawJson._announcement_lots.filter(isRecord)
        : [];
    return {
      sourceName,
      eyebrow: "Портал государственных закупок",
      heading: `Просмотр объявления № ${rawJson.announcement_number ?? rawJson.announcement_id ?? rawJson.id ?? ""}`,
      subtitle: rawJson.announcement_title_ru ?? rawJson.announcement_title,
      status: rawJson.announcement_status ?? rawJson.status_text,
      metricCards: rowsFromKeys(rawJson, [
        ["Номер объявления", ["announcement_number"]],
        ["Статус", ["announcement_status", "status_text"]],
        ["Сумма закупки", ["total_amount_text", "amount_text"]],
        ["Кол-во лотов", ["lot_count_text", "lot_count"]],
      ]),
      tabs: [
        {
          id: "general",
          label: "Общие сведения",
          sections: [
            { title: "Общие сведения", rows: rowsFromKeys(rawJson, [["Способ проведения закупки", ["procurement_method"]], ["Тип закупки", ["purchase_type"]], ["Вид предмета закупок", ["subject_type"]], ["Признаки", ["signs"]]]) },
            { title: "Организатор", rows: rowsFromKeys(rawJson, [["БИН организатора", ["organizer_bin"]], ["Организатор", ["organizer_name", "organizer_text"]], ["Юр. адрес организатора", ["organizer_legal_address"]], ["E-Mail", ["organizer_email"]]]) },
          ],
        },
        { id: "lots", label: "Лоты", sections: [{ title: "Лоты", items: announcementLots.length ? announcementLots : lots, emptyText: "No announcement lots were extracted for this tender." }] },
        { id: "documents", label: "Документация", sections: [{ title: "Документация", items: documents, emptyText: "No documentation files were extracted for this tender." }] },
      ],
    };
  }

  if (sourceName === "mitwork") {
    return {
      sourceName,
      eyebrow: "Eurasian Electronic Portal",
      heading: `Закупка № ${rawJson.announcement_number ?? rawJson.data_key ?? ""}`,
      subtitle: detailFields.title_ru_detail ?? rawJson.title_ru ?? rawJson.title,
      status: detailFields.status_text_detail ?? rawJson.status_text,
      metricCards: rowsFromKeys(merged, [["Начало приема", ["offer_start_text_detail", "offer_start_text"]], ["Окончание приема", ["offer_end_text_detail", "offer_end_text"]], ["Стоимость", ["value_text"]], ["Лотов", ["lots_label"]]]),
      tabs: [
        { id: "profile", label: "Сведения о закупке", sections: [
          { title: "Основные данные", rows: rowsFromKeys(merged, [["Номер закупки", ["announcement_number"]], ["Внутренний ID", ["data_key"]], ["Наименование (RU)", ["title_ru_detail", "title_ru"]], ["Страница закупки", ["detail_url"]]]) },
          { title: "Организатор", rows: rowsFromKeys(merged, [["Организатор", ["organizer_name", "buyer_name"]], ["БИН/ИИН", ["buyer_bin"]], ["Карточка организатора", ["organizer_url", "subject_url"]]]) },
        ] },
        { id: "lots", label: "Лоты", sections: [{ title: "Лоты", items: lots, emptyText: "No lots were extracted for this Mitwork tender." }] },
        { id: "documents", label: "Документы", sections: [{ title: "Документы", items: documents, emptyText: "No documentation files were extracted for this tender." }] },
      ],
    };
  }

  if (sourceName === "zakup_unified") {
    const status = isRecord(rawJson.status) ? rawJson.status : {};
    const method = isRecord(rawJson.purchase_method) ? rawJson.purchase_method : {};
    const subject = isRecord(rawJson.purchase_subject) ? rawJson.purchase_subject : {};
    const organizer = isRecord(rawJson.organizer) ? rawJson.organizer : {};
    return {
      sourceName,
      eyebrow: "Unified Procurement Portal of Kazakhstan",
      heading: `Объявление № ${rawJson.announcement_number ?? rawJson.id ?? ""}`,
      subtitle: rawJson.name,
      status: status.name,
      metricCards: [
        { label: "Способ закупки", value: method.name },
        { label: "Предмет", value: subject.name },
        { label: "Лоты", value: rawJson.lot_count ?? lots.length },
        { label: "Код статуса", value: status.code },
      ].filter((row) => !isEmptyValue(row.value)),
      tabs: [
        { id: "announcement", label: "Объявление", sections: [{ title: "Данные объявления", rows: rowsFromKeys(rawJson, [["ID объявления", ["id"]], ["Внешний ID", ["external_id"]], ["Номер объявления", ["announcement_number"]], ["Наименование", ["name"]]]) }] },
        { id: "lots", label: "Лоты", sections: [{ title: "Лоты", items: lots, emptyText: "No lots were extracted for this unified procurement announcement." }] },
        { id: "organizer", label: "Организатор", sections: [{ title: "Организатор", rows: rowsFromKeys(organizer, [["Организатор", ["name"]], ["БИН/ИИН", ["iin_bin"]], ["Тип организации", ["organization_type"]], ["Адрес", ["address"]], ["ID организатора", ["id"]]]) }] },
      ],
    };
  }

  const sourceLabels: Record<string, string> = {
    national_bank: "National Bank of Kazakhstan Procurement Portal",
    samruk_kazyna: "Samruk-Kazyna Electronic Procurement Portal",
    ets_tender: "ETS-Tender",
    uzex_etender: "UZEX e-Tender",
    xt_xarid: "XT-Xarid Public Procurement",
    tendersinfo: "TendersInfo",
  };

  if (sourceLabels[sourceName]) {
    return {
      sourceName,
      eyebrow: sourceLabels[sourceName],
      heading: String(firstPresent(rawJson, "announcement_number", "number", "display_no", "id", "site_tender_id", "data_key") ?? sourceName),
      subtitle: String(firstPresent(rawJson, "name", "nameRu", "title", "title_ru", "short_desc") ?? ""),
      status: String(firstPresent(rawJson, "status_name", "status", "advertStatus", "announcement_status") ?? ""),
      metricCards: simpleRows(rawJson).slice(0, 4),
      tabs: [
        { id: "profile", label: "Profile", sections: [{ title: "Source profile", rows: simpleRows(rawJson) }] },
        { id: "lots", label: "Lots", sections: [{ title: "Lots", items: lots, emptyText: `No lots were extracted for this ${sourceName} tender.` }] },
        { id: "documents", label: "Documents", sections: [{ title: "Documents", items: documents, emptyText: "No documentation files were extracted for this tender." }] },
      ],
    };
  }

  return null;
}
