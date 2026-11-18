import type { CreditRegion, CreditSector } from "@/lib/credit-articles";
import { articleSearchParams, parseArticleSearchParams } from "@/lib/esg-article-search/query";
import type { CreditArticleSearchFilters } from "./types";

const regions: readonly CreditRegion[] = ["global", "MiddleEast", "CentralAsia"];
const sectors: readonly CreditSector[] = [
  "sovereigns", "sovereignsRACS", "banks", "banksRACS", "corporates", "corporatesRACS",
];
const wordsOrSignedGrades = new RegExp(
  "(?:aaa|aa|a|bbb|bb|b|ccc|cc|c)[+-](?![\\p{L}\\p{N}])|[\\p{L}\\p{N}]+", "giu",
);

export function creditArticleSearchTerms(q: string): string[] {
  return q.match(wordsOrSignedGrades) ?? [];
}

type Input = URLSearchParams | Record<string, string | string[] | undefined>;
type Result = { ok: true; filters: CreditArticleSearchFilters } | { ok: false; error: string };

export function parseCreditArticleSearchParams(input: Input): Result {
  const read = (name: string) => {
    const value = input instanceof URLSearchParams ? input.get(name) : input[name];
    return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
  };
  const region = regions.find((item) => item === read("region")) ?? "";
  const sector = sectors.find((item) => item === read("sector")) ?? "";
  if (read("region") && !region) return { ok: false, error: "Invalid credit region" };
  if (read("sector") && !sector) return { ok: false, error: "Invalid credit sector" };
  if (sector && region !== "CentralAsia" && region !== "MiddleEast") {
    return { ok: false, error: "Select a regional section before filtering by sector" };
  }
  // Credit's old dateFrom by itself meant that day. New from/to are open-ended.
  const canonical = Boolean(read("from") || read("to"));
  const parsed = parseArticleSearchParams({
    q: read("q"), source: read("source"), sort: read("sort"), page: read("page"), date: read("date"),
    from: canonical ? read("from") : read("dateFrom"),
    to: canonical ? read("to") : read("dateTo") || read("dateFrom"),
  });
  if (!parsed.ok) return parsed;
  return { ok: true, filters: { ...parsed.filters, region, sector } };
}

export function creditArticleSearchParams(filters: CreditArticleSearchFilters): URLSearchParams {
  const params = articleSearchParams(filters);
  // Newest is implicit when browsing; the UI treats an explicit sort as a
  // preference to keep when starting a search from a filtered section.
  if (!filters.q) params.delete("sort");
  if (filters.region) params.set("region", filters.region);
  if (filters.sector) params.set("sector", filters.sector);
  return params;
}

export function creditArticleBackPath(value: unknown): string {
  return typeof value === "string" && !/[\r\n\\]/.test(value) &&
    /^\/credit\/(?:articles|community)(?:\?[^#]*)?$/.test(value) ? value : "/credit/articles";
}
