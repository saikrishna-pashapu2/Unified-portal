import { prismaCredit } from "@/db/credit";

export type CreditRegion = "global" | "MiddleEast" | "CentralAsia";
export type CreditSector =
  | "sovereigns"
  | "banks"
  | "sovereignsRACS"
  | "banksRACS"
  | "corporates"
  | "corporatesRACS";

export type CreditArticle = {
  id: number;
  title: string;
  source: string | null;
  date: Date | null;
  link: string | null;
  region: CreditRegion;
  sector: CreditSector;
  matched_keywords: string | null;
};

type ListCreditArticlesOpts = {
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  region?: CreditRegion | null;
  sector?: CreditSector | null;
  source?: string | null;
  page?: number;
  pageSize?: number;
};

export async function listCreditArticles(opts: ListCreditArticlesOpts) {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(50, Math.max(6, opts.pageSize ?? 18));
  const offset = (page - 1) * pageSize;

  const params: any[] = [];
  let where = `WHERE 1=1`;

  // Date filtering logic:
  // - Both dateFrom and dateTo: date range
  // - Only dateFrom: single date filter
  // - Only dateTo: all articles up to that date
  // - Legacy 'date' param: single date filter
  // - Nothing: today only
  if (opts.dateFrom && opts.dateTo) {
    // Date range mode
    params.push(opts.dateFrom);
    where += ` AND date::date >= $${params.length}::date`;
    params.push(opts.dateTo);
    where += ` AND date::date <= $${params.length}::date`;
  } else if (opts.dateFrom) {
    // Single date mode (from date only)
    params.push(opts.dateFrom);
    where += ` AND date::date = $${params.length}::date`;
  } else if (opts.dateTo) {
    // Up to date mode (to date only)
    params.push(opts.dateTo);
    where += ` AND date::date <= $${params.length}::date`;
  } else if (opts.date) {
    // Single date mode (legacy)
    params.push(opts.date);
    where += ` AND date::date = $${params.length}::date`;
  } else {
    // Default: today only, unless source is specified (then show all history for that source)
    if (!opts.source) {
      const today = new Date().toISOString().slice(0, 10);
      params.push(today);
      where += ` AND date::date = $${params.length}::date`;
    }
  }

  if (opts.region) {
    params.push(opts.region);
    where += ` AND region = $${params.length}`;
  }

  if (opts.sector) {
    params.push(opts.sector);
    where += ` AND sector = $${params.length}`;
  }

  if (opts.source) {
    params.push(opts.source);
    where += ` AND source = $${params.length}`;
  }

  const countQuery = `
    SELECT COUNT(*)::int AS total
    FROM credit_articles
    ${where}
  `;

  const dataQuery = `
    SELECT id, title, source, date, link, region, sector, matched_keywords
    FROM credit_articles
    ${where}
    ORDER BY date DESC, id DESC
    LIMIT ${pageSize} OFFSET ${offset}
  `;

  const [countRow] = await prismaCredit.$queryRawUnsafe<any[]>(countQuery, ...params);
  const rows = await prismaCredit.$queryRawUnsafe<CreditArticle[]>(dataQuery, ...params);

  return {
    total: countRow?.total ?? 0,
    page,
    pageSize,
    items: rows,
  };
}
