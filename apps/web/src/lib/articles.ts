import { getPrisma, Domain } from "./db";

export type ArticleRow = {
  id: number;
  title: string | null;
  url: string | null;
  source: string | null;
  published: string | null; // ISO string for client components
  summary?: string | null;
  matched_keywords?: string | null;
};

export type ListArticleArgs = {
  domain: Domain;
  page?: number;     // 1-based
  pageSize?: number; // default 24
  date?: string;     // YYYY-MM-DD   -> default: today
  source?: string;   // optional source filter
};

const todayISO = () => new Date().toISOString().slice(0, 10);

// Utility functions to safely convert dates and normalize data
function isoOrNull(d: any): string | null {
  if (!d) return null;
  try { return new Date(d).toISOString(); } catch { return null; }
}

function normalizeCreditRow(row: any): ArticleRow {
  return {
    id: row.id,
    title: row.title ?? row.headline ?? "Untitled",
    url: row.link ?? row.url ?? row.article_url ?? null,
    source: row.source ?? null,
    published: isoOrNull(row.date ?? row.published ?? row.pub_date),
    matched_keywords: row.matched_keywords ?? null,
    // credit_articles might not have summary/details; try common alternatives
    summary: row.summary ?? row.description ?? row.snippet ?? row.content ?? null,
  };
}

function normalizeESGRow(row: any): ArticleRow {
  return {
    id: row.id,
    title: row.title ?? row.headline ?? "Untitled",
    url: row.link ?? row.url ?? row.article_url ?? null,
    source: row.source ?? null,
    published: isoOrNull(row.published ?? row.save_time),
    matched_keywords: row.matched_keywords ?? null,
    summary: row.summary ?? row.description ?? row.details ?? null,
  };
}

export async function listArticles({
  domain,
  page = 1,
  pageSize = 24,
  date,
  source,
}: ListArticleArgs) {
  const d = (date ?? todayISO());
  const offset = (page - 1) * pageSize;

  if (domain === "credit") {
    const prisma = getPrisma("credit");
    
    if (source) {
      // With source filter
      const rawRows = await prisma.$queryRaw<any[]>`
        SELECT *
        FROM credit_articles
        WHERE date::date = ${d}::date AND source = ${source}
        ORDER BY date DESC NULLS LAST, id DESC
        LIMIT ${pageSize} OFFSET ${offset}
      `;
      const rows = rawRows.map(normalizeCreditRow);
      
      const [{ count }] = await prisma.$queryRaw<{ count: number }[]>`
        SELECT COUNT(*)::int AS count
        FROM credit_articles
        WHERE date::date = ${d}::date AND source = ${source}
      `;
      return { rows, total: count, date: d };
    } else {
      // Without source filter (original logic)
      const rawRows = await prisma.$queryRaw<any[]>`
        SELECT *
        FROM credit_articles
        WHERE date::date = ${d}::date
        ORDER BY date DESC NULLS LAST, id DESC
        LIMIT ${pageSize} OFFSET ${offset}
      `;
      const rows = rawRows.map(normalizeCreditRow);
      
      const [{ count }] = await prisma.$queryRaw<{ count: number }[]>`
        SELECT COUNT(*)::int AS count
        FROM credit_articles
        WHERE date::date = ${d}::date
      `;
      return { rows, total: count, date: d };
    }
  }

  // ESG domain
  const prisma = getPrisma("esg");
  
  if (source) {
    // With source filter
    const rawRows = await prisma.$queryRaw<any[]>`
      SELECT *
      FROM esg_articles
      WHERE COALESCE(published, save_time)::date = ${d}::date AND source = ${source}
      ORDER BY COALESCE(published, save_time) DESC NULLS LAST, id DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `;
    const rows = rawRows.map(normalizeESGRow);
    
    const [{ count }] = await prisma.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::int AS count
      FROM esg_articles
      WHERE COALESCE(published, save_time)::date = ${d}::date AND source = ${source}
    `;
    return { rows, total: count, date: d };
  } else {
    // Without source filter (original logic)
    const rawRows = await prisma.$queryRaw<any[]>`
      SELECT *
      FROM esg_articles
      WHERE COALESCE(published, save_time)::date = ${d}::date
      ORDER BY COALESCE(published, save_time) DESC NULLS LAST, id DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `;
    const rows = rawRows.map(normalizeESGRow);
    
    const [{ count }] = await prisma.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::int AS count
      FROM esg_articles
      WHERE COALESCE(published, save_time)::date = ${d}::date
    `;
    return { rows, total: count, date: d };
  }
}

// Legacy compatibility - keeping for existing components that might use fetchArticles
export async function fetchArticles(domain: Domain, page = 1, pageSize = 24) {
  const prisma = getPrisma(domain);
  const offset = (page - 1) * pageSize;

  if (domain === "esg") {
    // ESG: Use SELECT * and normalize to avoid column issues
    const rawRows = await prisma.$queryRaw<any[]>`
      SELECT *
      FROM esg_articles
      ORDER BY COALESCE(published, save_time) DESC NULLS LAST
      LIMIT ${pageSize} OFFSET ${offset}
    `;
    return rawRows.map(normalizeESGRow);
  } else {
    // CREDIT: Use SELECT * and normalize to avoid column issues
    const rawRows = await prisma.$queryRaw<any[]>`
      SELECT *
      FROM credit_articles
      ORDER BY date DESC NULLS LAST
      LIMIT ${pageSize} OFFSET ${offset}
    `;
    return rawRows.map(normalizeCreditRow);
  }
}

export async function fetchSources(domain: Domain): Promise<string[]> {
  const prisma = getPrisma(domain);
  if (domain === "esg") {
    const rows = await prisma.$queryRaw<{ source: string | null }[]>`
      SELECT DISTINCT source FROM esg_articles WHERE source IS NOT NULL ORDER BY source ASC;
    `;
    return rows.map((r: { source: string | null }) => r.source!).filter(Boolean);
  } else {
    const rows = await prisma.$queryRaw<{ source: string | null }[]>`
      SELECT DISTINCT source FROM credit_articles WHERE source IS NOT NULL ORDER BY source ASC;
    `;
    return rows.map((r: { source: string | null }) => r.source!).filter(Boolean);
  }
}

export async function fetchCreditSources(opts?: { 
  region?: string | null; 
  sector?: string | null;
}): Promise<string[]> {
  const prisma = getPrisma("credit");
  
  const conditions: string[] = ["source IS NOT NULL"];
  const params: any[] = [];
  
  if (opts?.region) {
    params.push(opts.region);
    conditions.push(`region = $${params.length}`);
  }
  
  if (opts?.sector) {
    params.push(opts.sector);
    conditions.push(`sector = $${params.length}`);
  }
  
  const whereClause = conditions.join(" AND ");
  const query = `SELECT DISTINCT source FROM credit_articles WHERE ${whereClause} ORDER BY source ASC`;
  
  const rows = await prisma.$queryRawUnsafe<{ source: string | null }[]>(query, ...params);
  
  return rows.map((r: { source: string | null }) => r.source!).filter(Boolean);
}