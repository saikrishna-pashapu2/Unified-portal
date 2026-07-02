import { formatDistanceToNowStrict } from "date-fns";

export const SOURCE_COLORS = [
  "blue",
  "green",
  "purple",
  "amber",
  "rose",
  "cyan",
  "indigo",
  "fuchsia",
] as const;

export const GROUP_COLORS: Record<string, string> = {
  esg: "emerald",
  credit_rating: "blue",
};

export const COUNTRY_FLAGS: Record<string, string> = {
  KZ: "🇰🇿",
  UZ: "🇺🇿",
};

const USD_FX_RATES: Record<string, number> = {
  USD: 1,
  KZT: 470.17,
  UZS: 11970.68,
};

const ISO_DATE_RE =
  /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;

const LANG_SUFFIXES: Record<string, string> = {
  _ru: "RU",
  _kk: "KK",
  _kz: "KK",
  _uz: "UZ",
  _oz: "UZ",
  _en: "EN",
};

const UPPER_ACRONYMS = new Set([
  "id",
  "url",
  "bin",
  "tin",
  "iin",
  "kpp",
  "ogrn",
  "esg",
  "gri",
  "tcfd",
  "sasb",
  "issb",
  "msci",
  "cdp",
  "ip",
  "ftp",
  "smtp",
  "html",
  "json",
  "xml",
  "csv",
  "pdf",
  "kz",
  "uz",
  "ru",
]);

export function countryFlag(value: unknown): string {
  return COUNTRY_FLAGS[String(value ?? "")] ?? "🌐";
}

export function groupColor(name: string): string {
  return GROUP_COLORS[name] ?? "gray";
}

export function sourceColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return SOURCE_COLORS[hash % SOURCE_COLORS.length];
}

export function timeAgo(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  if (date.getTime() > Date.now()) return date.toISOString().slice(0, 10);
  return `${formatDistanceToNowStrict(date)} ago`;
}

export function deadlineState(value: Date | string | null | undefined): {
  label: string;
  color: "gray" | "yellow" | "orange" | "red" | "past";
} {
  if (!value) return { label: "no deadline", color: "gray" };
  const date = typeof value === "string" ? new Date(value) : value;
  const deltaMs = date.getTime() - Date.now();
  const days = deltaMs / 86_400_000;
  if (Number.isNaN(days)) return { label: "no deadline", color: "gray" };
  if (days < 0) return { label: "Past deadline", color: "past" };
  if (days < 1) {
    const hours = Math.max(0, Math.floor(deltaMs / 3_600_000));
    return { label: hours < 12 ? "Today" : `${hours}h left`, color: "red" };
  }
  if (days < 3) return { label: `${Math.floor(days)} day${Math.floor(days) === 1 ? "" : "s"}`, color: "orange" };
  if (days < 7) return { label: `${Math.floor(days)} days`, color: "yellow" };
  return { label: `${Math.floor(days)} days`, color: "gray" };
}

function numericValue(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "object" && "toString" in value) {
    const parsed = Number((value as { toString(): string }).toString());
    return Number.isFinite(parsed) ? parsed : null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function prettyAmount(value: unknown, currency?: string | null): string {
  const amount = numericValue(value);
  if (amount === null) return "—";
  const formatted = amount.toLocaleString("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  });
  return currency ? `${formatted} ${currency}` : formatted;
}

export function amountInUsd(value: unknown, currency?: string | null): number | null {
  const amount = numericValue(value);
  if (amount === null || amount < 0) return null;
  const normalized = (currency ?? "").trim().toUpperCase();
  const rate = USD_FX_RATES[normalized];
  if (!rate || rate <= 0) return null;
  return normalized === "USD" ? amount : amount / rate;
}

export function prettyScalar(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return value.toLocaleString("en-US", { maximumFractionDigits: 4 });
  if (value instanceof Date) return value.toISOString().slice(0, 16).replace("T", " ");
  const text = String(value);
  if (ISO_DATE_RE.test(text)) {
    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) {
      return text.includes("T") || text.includes(" ")
        ? parsed.toISOString().slice(0, 16).replace("T", " ")
        : parsed.toISOString().slice(0, 10);
    }
  }
  return text;
}

export function humanizeKey(rawKey: string): string {
  let key = rawKey;
  let langTag = "";
  for (const [suffix, tag] of Object.entries(LANG_SUFFIXES)) {
    if (key.endsWith(suffix) && key.length > suffix.length) {
      langTag = tag;
      key = key.slice(0, -suffix.length);
      break;
    }
  }
  const words = key.replaceAll("-", "_").split("_").filter(Boolean);
  const rendered = (words.length ? words : [key]).map((word, index) => {
    const lower = word.toLowerCase();
    if (UPPER_ACRONYMS.has(lower)) return word.toUpperCase();
    if (index === 0) return word.slice(0, 1).toUpperCase() + word.slice(1);
    return lower;
  });
  const label = rendered.join(" ");
  return langTag ? `${label} (${langTag})` : label;
}

export function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
