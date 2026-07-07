import "server-only";

import { esgPrisma } from "@esgcredit/db-esg";

export type TenderDomain = "esg" | "credit";
export type TenderSort = "newest" | "deadline" | "value_desc" | "value_asc";

export interface TenderFilters {
  country: string[];
  source: string[];
  group: string[];
  matched: "any" | "none" | null;
  q: string | null;
  from: Date | null;
  to: Date | null;
}

export interface TenderListParams {
  domain: TenderDomain;
  searchParams: Record<string, string | string[] | undefined>;
}

export interface TenderListResult {
  rows: any[];
  total: number;
  page: number;
  perPage: number;
  pages: number;
  filters: TenderFilters;
  sort: TenderSort;
  setupRequired?: boolean;
}

const SORT_KEYS = new Set<TenderSort>(["newest", "deadline", "value_desc", "value_asc"]);
const DEFAULT_PER_PAGE = 25;
const MAX_PER_PAGE = 100;
const MONITORED_TABLE_NAMES = [
  "monitored_tenders",
  "monitored_tender_sources",
  "monitored_team_members",
  "monitored_tender_likes",
  "monitored_email_recipients",
  "monitored_notification_logs",
  "monitored_tender_feedback",
  "monitored_share_contacts",
  "monitored_ingest_runs",
  "monitored_tender_candidates",
  "monitored_system_alerts",
];

export function isMissingMonitoredTenderSchema(error: unknown): boolean {
  const candidate = error as { code?: string; message?: string; meta?: { table?: string } } | null;
  const message = candidate?.message ?? "";
  const table = candidate?.meta?.table ?? "";
  return (
    candidate?.code === "P2021" ||
    MONITORED_TABLE_NAMES.some((name) => message.includes(name) || table.includes(name))
  );
}

function firstParam(
  searchParams: Record<string, string | string[] | undefined>,
  key: string,
): string | undefined {
  const value = searchParams[key];
  return Array.isArray(value) ? value[0] : value;
}

function listParam(
  searchParams: Record<string, string | string[] | undefined>,
  key: string,
): string[] {
  const value = searchParams[key];
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values.flatMap((entry) => entry.split(",")).map((entry) => entry.trim()).filter(Boolean);
}

function parseIsoDate(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizePagination(
  searchParams: Record<string, string | string[] | undefined>,
): { page: number; perPage: number } {
  const rawPage = Number(firstParam(searchParams, "page") ?? "1");
  const rawPerPage = Number(firstParam(searchParams, "per_page") ?? firstParam(searchParams, "limit") ?? DEFAULT_PER_PAGE);
  return {
    page: Math.max(1, Number.isFinite(rawPage) ? Math.floor(rawPage) : 1),
    perPage: Math.max(1, Math.min(MAX_PER_PAGE, Number.isFinite(rawPerPage) ? Math.floor(rawPerPage) : DEFAULT_PER_PAGE)),
  };
}

export function groupForDomain(domain: TenderDomain): string {
  return domain === "credit" ? "credit_rating" : "esg";
}

export function normalizeSort(value: string | undefined): TenderSort {
  return SORT_KEYS.has(value as TenderSort) ? (value as TenderSort) : "newest";
}

export function parseTenderFilters({
  domain,
  searchParams,
}: TenderListParams): TenderFilters {
  const matchedRaw = firstParam(searchParams, "matched");
  const groups = listParam(searchParams, "group");
  const defaultGroup = groupForDomain(domain);
  return {
    country: listParam(searchParams, "country").map((value) => value.toUpperCase()).filter((value) => value === "KZ" || value === "UZ"),
    source: listParam(searchParams, "source"),
    group: groups.length ? groups : [defaultGroup],
    matched: matchedRaw === "none" ? "none" : matchedRaw === "all" ? null : "any",
    q: (firstParam(searchParams, "q") ?? firstParam(searchParams, "search") ?? "").trim() || null,
    from: parseIsoDate(firstParam(searchParams, "from")),
    to: parseIsoDate(firstParam(searchParams, "to")),
  };
}

export function filtersAreEmpty(filters: TenderFilters): boolean {
  return !(
    filters.country.length ||
    filters.source.length ||
    filters.group.length ||
    filters.matched ||
    filters.q ||
    filters.from ||
    filters.to
  );
}

function buildWhere(filters: TenderFilters): any {
  const AND: any[] = [{ is_active: true }];

  if (filters.country.length) AND.push({ country: { in: filters.country } });
  if (filters.source.length) AND.push({ source_name: { in: filters.source } });
  if (filters.matched === "any") AND.push({ matched_groups: { isEmpty: false } });
  if (filters.matched === "none") AND.push({ matched_groups: { isEmpty: true } });
  for (const group of filters.group) {
    AND.push({ matched_groups: { has: group } });
  }
  if (filters.q) {
    AND.push({
      OR: [
        { title: { contains: filters.q, mode: "insensitive" } },
        { title_en: { contains: filters.q, mode: "insensitive" } },
        { buyer_name: { contains: filters.q, mode: "insensitive" } },
      ],
    });
  }
  if (filters.from) AND.push({ published_at: { gte: filters.from } });
  if (filters.to) AND.push({ published_at: { lte: filters.to } });

  return { AND };
}

function orderByFor(sort: TenderSort): any[] {
  if (sort === "deadline") return [{ deadline_at: { sort: "asc", nulls: "last" } }, { id: "asc" }];
  if (sort === "value_desc") return [{ value_amount: { sort: "desc", nulls: "last" } }, { id: "asc" }];
  if (sort === "value_asc") return [{ value_amount: { sort: "asc", nulls: "last" } }, { id: "asc" }];
  return [
    { first_seen_at: "desc" },
    { published_at: { sort: "desc", nulls: "last" } },
    { id: "asc" },
  ];
}

export async function listMonitoredTenders(params: TenderListParams): Promise<TenderListResult> {
  const filters = parseTenderFilters(params);
  const sort = normalizeSort(firstParam(params.searchParams, "sort"));
  const { page, perPage } = normalizePagination(params.searchParams);
  const where = buildWhere(filters);

  try {
    const [rows, total] = await Promise.all([
      esgPrisma.monitored_tenders.findMany({
        where,
        include: {
          source: true,
          likes: { include: { team_member: true }, orderBy: { created_at: "desc" } },
        },
        orderBy: orderByFor(sort),
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      esgPrisma.monitored_tenders.count({ where }),
    ]);

    return {
      rows,
      total,
      page,
      perPage,
      pages: total <= 0 ? 1 : Math.max(1, Math.ceil(total / perPage)),
      filters,
      sort,
    };
  } catch (error) {
    if (!isMissingMonitoredTenderSchema(error)) throw error;
    return {
      rows: [],
      total: 0,
      page,
      perPage,
      pages: 1,
      filters,
      sort,
      setupRequired: true,
    };
  }
}

export async function getMonitoredTender(id: string): Promise<any | null> {
  try {
    return await esgPrisma.monitored_tenders.findUnique({
      where: { id },
      include: {
        source: true,
        likes: { include: { team_member: true }, orderBy: { created_at: "desc" } },
      },
    });
  } catch (error) {
    if (!isMissingMonitoredTenderSchema(error)) throw error;
    return null;
  }
}

export async function listRelatedMonitoredTenders(tender: { id: string; source_name: string }): Promise<any[]> {
  try {
    return await esgPrisma.monitored_tenders.findMany({
      where: {
        source_name: tender.source_name,
        id: { not: tender.id },
        is_active: true,
      },
      include: {
        likes: { include: { team_member: true }, orderBy: { created_at: "desc" } },
      },
      orderBy: [{ first_seen_at: "desc" }, { id: "asc" }],
      take: 100,
    });
  } catch (error) {
    if (!isMissingMonitoredTenderSchema(error)) throw error;
    return [];
  }
}

export async function listMonitoredSources(): Promise<any[]> {
  try {
    return await esgPrisma.monitored_tender_sources.findMany({
      orderBy: [{ country: "asc" }, { display_name: "asc" }],
    });
  } catch (error) {
    if (!isMissingMonitoredTenderSchema(error)) throw error;
    return [];
  }
}

export async function listMonitoredTeamMembers(): Promise<any[]> {
  try {
    return await esgPrisma.monitored_team_members.findMany({
      orderBy: [{ last_used_at: "desc" }, { display_name: "asc" }],
    });
  } catch (error) {
    if (!isMissingMonitoredTenderSchema(error)) throw error;
    return [];
  }
}

export async function overallMonitoredCounters(): Promise<{
  totalTenders: number;
  totalSources: number;
  lastSeen: Date | null;
  setupRequired?: boolean;
}> {
  try {
    const [totalTenders, totalSources, aggregate] = await Promise.all([
      esgPrisma.monitored_tenders.count(),
      esgPrisma.monitored_tender_sources.count(),
      esgPrisma.monitored_tenders.aggregate({ _max: { last_seen_at: true } }),
    ]);
    return {
      totalTenders,
      totalSources,
      lastSeen: aggregate._max.last_seen_at,
    };
  } catch (error) {
    if (!isMissingMonitoredTenderSchema(error)) throw error;
    return {
      totalTenders: 0,
      totalSources: 0,
      lastSeen: null,
      setupRequired: true,
    };
  }
}
