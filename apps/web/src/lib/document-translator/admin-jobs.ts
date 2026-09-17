import {
  HISTORY_FILTERS,
  MAX_HISTORY_SEARCH_LENGTH,
  type HistoryFilter,
  type HistoryKind,
} from "@/lib/document-translator/history";

export type AdminTranslatorJob = {
  kind: Exclude<HistoryKind, "all">;
  id: string;
  filename: string;
  targetLanguage: string;
  status: string;
  stage: string;
  progress: number;
  totalPages: number | null;
  changedCells: number | null;
  createdAt: string;
  completedAt: string | null;
  userName: string;
  userEmail: string | null;
  inputTokens: number;
  outputTokens: number;
  requests: number | null;
  message: string | null;
  error: string | null;
  errorTruncated: boolean;
};

export type AdminTranslatorJobPeriod = "7" | "30" | "90" | "365" | "all";
export type AdminTranslatorJobKind = HistoryKind;
export type AdminTranslatorJobStatus = HistoryFilter;

export type AdminTranslatorJobsQuery = {
  period: AdminTranslatorJobPeriod;
  kind: AdminTranslatorJobKind;
  status: AdminTranslatorJobStatus;
  q: string;
  page: number;
  pageSize: number;
  skip: number;
  createdSince: Date | null;
};

export type AdminTranslatorJobsResponse = {
  success: true;
  items: AdminTranslatorJob[];
  total: number;
  page: number;
  size: number;
};

const PERIODS = new Set<AdminTranslatorJobPeriod>([
  "7",
  "30",
  "90",
  "365",
  "all",
]);
const KINDS = new Set<AdminTranslatorJobKind>(["all", "pdf", "xlsx"]);
const STATUSES = new Set<AdminTranslatorJobStatus>(
  HISTORY_FILTERS.map((filter) => filter.key),
);
const MAX_PAGE = 100_000;
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
export const MAX_ADMIN_TRANSLATOR_ERROR_LENGTH = 12_000;
export const MAX_ADMIN_TRANSLATOR_MESSAGE_LENGTH = 2_000;
const SECRET_REDACTION_MARKER = "\uE000";

function positiveInteger(
  value: string | null,
  fallback: number,
  max: number,
): number | null {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) return null;
  return parsed;
}

/**
 * Parse the bounded admin-list query using the same status/kind/search
 * semantics as document-translator history. Search is trimmed and capped at
 * 200 characters; the SQL layer uses strpos so %, _ and backslashes stay
 * literal characters rather than LIKE wildcards.
 */
export function parseAdminTranslatorJobsQuery(
  params: URLSearchParams,
): AdminTranslatorJobsQuery | null {
  const rawPeriod = params.get("period") ?? "30";
  const rawKind = params.get("kind") ?? "all";
  const rawStatus = params.get("status") ?? "all";
  const q = (params.get("q") ?? "").trim();
  const page = positiveInteger(params.get("page"), 1, MAX_PAGE);
  const pageSize = positiveInteger(
    params.get("pageSize"),
    DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE,
  );

  if (
    !PERIODS.has(rawPeriod as AdminTranslatorJobPeriod) ||
    !KINDS.has(rawKind as AdminTranslatorJobKind) ||
    !STATUSES.has(rawStatus as AdminTranslatorJobStatus) ||
    page === null ||
    pageSize === null ||
    q.length > MAX_HISTORY_SEARCH_LENGTH
  ) {
    return null;
  }

  const period = rawPeriod as AdminTranslatorJobPeriod;
  const now = Date.now();
  const createdSince =
    period === "all"
      ? null
      : new Date(now - Number(period) * 24 * 60 * 60 * 1000);

  return {
    period,
    kind: rawKind as AdminTranslatorJobKind,
    status: rawStatus as AdminTranslatorJobStatus,
    q,
    page,
    pageSize,
    skip: (page - 1) * pageSize,
    createdSince,
  };
}

function redactCredentials(value: string): string {
  const marker = SECRET_REDACTION_MARKER;
  const redacted = value
    .replace(/\b(postgres(?:ql)?):\/\/[^\s@]+@/gi, `$1://${marker}@`)
    .replace(/\b(https?):\/\/[^\s@]+@/gi, `$1://${marker}@`)
    .replace(
      /\b(authorization\b\s*[:=]\s*)(Bearer|Basic)\s+[A-Za-z0-9._~+/-]+=*/gi,
      `$1$2 ${marker}`,
    )
    .replace(
      /\b(authorization\b\s*[:=]\s*)(?!\s*(?:Bearer|Basic)\s)(["']?)[^\s"'&,;)]+/gi,
      `$1$2${marker}`,
    )
    .replace(
      /\b((?:OPENAI|ANTHROPIC|GOOGLE|GEMINI|API)[_-]?(?:API[_-]?)?KEY|ACCESS[_-]?TOKEN|REFRESH[_-]?TOKEN|TOKEN|PASSWORD|PASSWD|SECRET)\b(\s*[:=]\s*)(["']?)[^\s"'&,;)]*/gi,
      `$1$2$3${marker}`,
    )
    .replace(
      /([?&](?:api[_-]?key|key|token|access[_-]?token|refresh[_-]?token|authorization|password|secret)=)[^&#\s]*/gi,
      `$1${marker}`,
    )
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/-]+=*/gi, `$1 ${marker}`)
    .replace(/\bsk-[A-Za-z0-9_-]{4,}/gi, marker)
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, marker)
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, marker)
    .replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, marker);

  return redacted.replaceAll(marker, "[REDACTED]");
}

function cleanStoredText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  return redactCredentials(value).slice(0, maxLength);
}

export function sanitizeAdminTranslatorError(value: unknown): {
  error: string | null;
  errorTruncated: boolean;
} {
  if (typeof value !== "string" || value.length === 0) {
    return { error: null, errorTruncated: false };
  }

  const redacted = redactCredentials(value);
  return {
    error: redacted.slice(0, MAX_ADMIN_TRANSLATOR_ERROR_LENGTH),
    errorTruncated: redacted.length > MAX_ADMIN_TRANSLATOR_ERROR_LENGTH,
  };
}

export function sanitizeAdminTranslatorMessage(value: unknown): string | null {
  return cleanStoredText(value, MAX_ADMIN_TRANSLATOR_MESSAGE_LENGTH);
}

function finiteNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nullableString(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  return value;
}

function isoString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : "";
}

function nullableIsoString(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  return nullableString(value);
}

/**
 * Whitelist and normalize one metadata-only SQL result row. This intentionally
 * ignores unknown fields so a future query change cannot leak payloads,
 * checkpoints, binary data or model response bodies to the admin client.
 */
export function normalizeAdminTranslatorJob(
  value: unknown,
): AdminTranslatorJob | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const row = value as Record<string, unknown>;
  const kind = row.kind === "xlsx" ? "xlsx" : row.kind === "pdf" ? "pdf" : null;
  if (!kind || typeof row.id !== "string" || typeof row.filename !== "string") {
    return null;
  }

  const storedError = sanitizeAdminTranslatorError(row.error);
  const targetLanguage =
    typeof row.targetLanguage === "string" && row.targetLanguage.length > 0
      ? row.targetLanguage
      : "Unknown";

  return {
    kind,
    id: row.id,
    filename: row.filename,
    targetLanguage,
    status: typeof row.status === "string" ? row.status : "unknown",
    stage: typeof row.stage === "string" ? row.stage : "unknown",
    progress: Math.min(100, Math.max(0, finiteNumber(row.progress, 0))),
    totalPages: nullableNumber(row.totalPages),
    changedCells: nullableNumber(row.changedCells),
    createdAt: isoString(row.createdAt),
    completedAt: nullableIsoString(row.completedAt),
    userName:
      typeof row.userName === "string" && row.userName.length > 0
        ? row.userName
        : "Unknown",
    userEmail: nullableString(row.userEmail),
    inputTokens: Math.max(0, finiteNumber(row.inputTokens, 0)),
    outputTokens: Math.max(0, finiteNumber(row.outputTokens, 0)),
    requests: nullableNumber(row.requests),
    message: sanitizeAdminTranslatorMessage(row.message),
    error: storedError.error,
    errorTruncated:
      storedError.errorTruncated || row.errorTruncated === true,
  };
}
