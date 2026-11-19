import "server-only";

import { esgPrisma } from "@esgcredit/db-esg";
import { isArticleAiEnabled } from "./config";
import { loadCurrentArticles } from "./current-articles";
import { ARTICLE_AI_DAILY_POLICY_VERSION, type ArticleAiDomain } from "./types";

export interface DailyArticlePick {
  articleId: number;
  domain: ArticleAiDomain;
  sourceDay: string;
  title: string;
  source: string | null;
  reason: string;
}

interface DailyRun {
  sourceDay: string;
  status: string;
  pickCount: number;
}

async function canReadDailyPicks(viewerId: number): Promise<boolean> {
  if (!isArticleAiEnabled() || !Number.isSafeInteger(viewerId) || viewerId <= 0) return false;
  const user = await esgPrisma.users.findUnique({ where: { id: viewerId }, select: { is_active_db: true } });
  return user?.is_active_db === true;
}

export async function getDailyArticlePickIds(domain: ArticleAiDomain, viewerId: number): Promise<number[]> {
  if (!await canReadDailyPicks(viewerId)) return [];
  const rows = await esgPrisma.$queryRaw<{ article_id: number; content_hash: string }[]>`
    SELECT DISTINCT ON (s.article_id) s.article_id, s.content_hash
    FROM article_ai_domain_assessments a
    JOIN article_ai_domain_selections s ON s.assessment_id = a.id AND s.domain = a.domain
    WHERE a.domain = ${domain} AND a.policy_version = ${ARTICLE_AI_DAILY_POLICY_VERSION}
      AND a.assessment_date >= (now() AT TIME ZONE 'Asia/Dubai')::date - 30
      AND a.assessment_date < (now() AT TIME ZONE 'Asia/Dubai')::date
      AND a.status = 'ready' AND a.coverage_json->>'status' = 'complete'
      AND a.valid_until > now() AND s.expires_at > now()
    ORDER BY s.article_id, a.assessment_date DESC
  `;
  // Credit articles can contain full text. Validate current versions in bounded batches.
  const validIds: number[] = [];
  for (let start = 0; start < rows.length; start += 50) {
    const hashes = new Map(rows.slice(start, start + 50).map(row => [row.article_id, row.content_hash]));
    const articles = await loadCurrentArticles(domain, Array.from(hashes.keys()));
    validIds.push(...articles.filter(article => article.contentHash === hashes.get(article.id)).map(article => article.id));
  }
  return validIds;
}

export async function getDailyArticlePickFeed(
  domain: ArticleAiDomain,
  { viewerId, limit = 20, sourceDay }: { viewerId: number; limit?: number; sourceDay?: string },
): Promise<{ runs: DailyRun[]; picks: DailyArticlePick[] }> {
  if (!await canReadDailyPicks(viewerId)) return { runs: [], picks: [] };
  // Compare a requested day as text, so even a malformed URL cannot cause a date-cast error.
  const maxRows = Number.isFinite(limit) ? Math.max(1, Math.min(600, Math.trunc(limit))) : 20;
  const [runs, picks] = await esgPrisma.$transaction([
    esgPrisma.$queryRaw<DailyRun[]>`
      SELECT a.assessment_date::text AS "sourceDay", a.status,
             COUNT(s.id) FILTER (WHERE a.status = 'ready' AND a.coverage_json->>'status' = 'complete'
               AND a.valid_until > now() AND s.expires_at > now())::int AS "pickCount"
      FROM article_ai_domain_assessments a
      LEFT JOIN article_ai_domain_selections s ON s.assessment_id = a.id AND s.domain = a.domain
      WHERE a.domain = ${domain} AND a.policy_version = ${ARTICLE_AI_DAILY_POLICY_VERSION}
        AND a.assessment_date >= (now() AT TIME ZONE 'Asia/Dubai')::date - 30
        AND a.assessment_date < (now() AT TIME ZONE 'Asia/Dubai')::date
        AND (${sourceDay ?? null}::text IS NULL OR a.assessment_date::text = ${sourceDay ?? null}::text)
      GROUP BY a.id ORDER BY a.assessment_date DESC
    `,
    esgPrisma.$queryRaw<DailyArticlePick[]>`
      SELECT s.article_id AS "articleId", a.domain, a.assessment_date::text AS "sourceDay",
             COALESCE(NULLIF(i.title, ''), 'Untitled article') AS title, i.source, s.reason
      FROM article_ai_domain_assessments a
      JOIN article_ai_domain_selections s ON s.assessment_id = a.id AND s.domain = a.domain
      JOIN article_ai_weekly_inputs i ON i.assessment_id = a.id AND i.domain = s.domain
        AND i.kind = 'candidate' AND i.article_id = s.article_id AND i.content_hash = s.content_hash
      WHERE a.domain = ${domain} AND a.policy_version = ${ARTICLE_AI_DAILY_POLICY_VERSION}
        AND a.status = 'ready' AND a.coverage_json->>'status' = 'complete'
        AND a.valid_until > now() AND s.expires_at > now()
        AND a.assessment_date >= (now() AT TIME ZONE 'Asia/Dubai')::date - 30
        AND a.assessment_date < (now() AT TIME ZONE 'Asia/Dubai')::date
        AND (${sourceDay ?? null}::text IS NULL OR a.assessment_date::text = ${sourceDay ?? null}::text)
      ORDER BY a.assessment_date DESC, s.relevance_score DESC NULLS LAST, s.article_id
      LIMIT ${maxRows}
    `,
  ], { isolationLevel: "RepeatableRead" });
  return { runs, picks };
}
