import { parsePdfxV2Pagination } from "@/lib/pdfx-v2/pagination";

export const HISTORY_FILTERS = [
  { key: "all", label: "All documents" },
  { key: "active", label: "In progress" },
  { key: "completed", label: "Completed" },
  { key: "attention", label: "Needs attention" },
  { key: "draft", label: "Drafts" },
] as const;
export type HistoryFilter = (typeof HISTORY_FILTERS)[number]["key"];
export type HistoryKind = "all" | "pdf" | "xlsx";
export const ACTIVE_HISTORY_STATUSES = new Set([
  "queued",
  "processing",
  "cancelling",
]);
export const MAX_HISTORY_SEARCH_LENGTH = 200;
export type HistoryItem = {
  kind: "pdf" | "xlsx";
  id: string;
  filename: string;
  target_lang: string;
  status: string;
  stage: string;
  message: string | null;
  progress: number;
  total_pages: number;
  created_at: string;
  canDownload: boolean;
};
export type HistoryResponse = {
  items: HistoryItem[];
  total: number;
  allTotal: number;
  counts: Record<HistoryFilter, number>;
  page: number;
  size: number;
};

export function parseHistoryQuery(params: URLSearchParams) {
  const pagination = parsePdfxV2Pagination(params);
  const status = params.get("status") ?? "all";
  const kind = params.get("kind") ?? "all";
  const search = (params.get("q") ?? "").trim();
  if (
    !pagination ||
    !HISTORY_FILTERS.some((filter) => filter.key === status) ||
    !["all", "pdf", "xlsx"].includes(kind) ||
    search.length > MAX_HISTORY_SEARCH_LENGTH
  )
    return null;
  return {
    ...pagination,
    status: status as HistoryFilter,
    kind: kind as HistoryKind,
    search,
  };
}
