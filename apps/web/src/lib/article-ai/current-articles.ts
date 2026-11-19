import "server-only";

import { esgPrisma } from "@esgcredit/db-esg";
import { creditPrisma } from "@esgcredit/db-credit";
import type { ArticleAiDomain } from "./types";
import { weeklyArticleContentHash } from "./weekly-inputs";

interface CurrentWeeklyArticle {
  id: number;
  title: string | null;
  summary: string | null;
  content: string | null;
  source: string | null;
  url: string | null;
  publishedAt: Date | null;
  contentHash: string;
}

export async function loadCurrentArticles(
  domain: ArticleAiDomain,
  ids: readonly number[],
): Promise<CurrentWeeklyArticle[]> {
  const safeIds = Array.from(new Set(ids));
  if (!safeIds.length) return [];
  type RawArticle = {
    id: number;
    title: string | null;
    summary: string | null;
    content: string | null;
    source: string | null;
    url: string | null;
    published_at: Date | null;
  };
  const rows = domain === "esg"
    ? await esgPrisma.$queryRaw<RawArticle[]>`
        SELECT id, title, summary, NULL::text AS content, source,
               link AS url, published::timestamp AT TIME ZONE 'Asia/Dubai' AS published_at
        FROM esg_articles WHERE id = ANY(${safeIds}::int[])
      `
    : await creditPrisma.$queryRaw<RawArticle[]>`
        SELECT id, title, summary, content, source,
               COALESCE(url, link) AS url, date::timestamp AT TIME ZONE 'Asia/Dubai' AS published_at
        FROM credit_articles WHERE id = ANY(${safeIds}::int[])
      `;
  return rows.map((row) => ({
    id: Number(row.id), title: row.title, summary: row.summary, content: row.content,
    source: row.source, url: row.url, publishedAt: row.published_at ? new Date(row.published_at) : null,
    contentHash: weeklyArticleContentHash({
      domain, articleId: Number(row.id), title: row.title, summary: row.summary,
      content: row.content, source: row.source, url: row.url,
      publishedAt: row.published_at ? new Date(row.published_at).toISOString() : null,
    }),
  }));
}
