import "server-only";

import { createHash } from "node:crypto";
import { esgPrisma } from "@esgcredit/db-esg";
import { creditPrisma } from "@esgcredit/db-credit";
import { getArticleAiWeeklyCalendar, type ArticleAiWeeklyCalendar } from "./weekly-calendar";
import { ARTICLE_AI_WEEKLY_POLICY_VERSION, type ArticleAiDomain, type ArticleAiWeeklyInputSnapshot, type ArticleAiWeeklyManifestResult } from "./types";

export interface WeeklySourceRow {
  kind: "history" | "candidate";
  id: number;
  resolved: boolean;
  title: string | null;
  summary: string | null;
  content: string | null;
  source: string | null;
  url: string | null;
  published_at: Date | null;
  eligible_at: Date | null;
  first_seen_at: Date | null;
}

const DAY_MS = 86_400_000;
const DUBAI_OFFSET_MS = 4 * 3_600_000;
// The manifest is currently processed in memory. Bound its allocation before
// fetching text; failing the whole run preserves all-or-nothing coverage.
const MAX_MANIFEST_MEMORY_BYTES = 64 * 1024 * 1024;

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** Preserve complete stored text. Cleaning HTML here must never silently truncate it. */
export function weeklyArticleContentHash(input: Pick<ArticleAiWeeklyInputSnapshot, "domain" | "articleId" | "title" | "summary" | "content" | "source" | "url" | "publishedAt">): string {
  return hash([input.domain, input.articleId, input.title, input.summary, input.content, input.source, input.url, input.publishedAt]);
}

function asIso(value: Date | null): string | null {
  return value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toISOString() : null;
}

function validUrl(value: string | null): boolean {
  try { return Boolean(value && ["http:", "https:"].includes(new URL(value).protocol)); }
  catch { return false; }
}

function sourceCalendar(instant: Date): ArticleAiWeeklyCalendar {
  const local = new Date(instant.getTime() + DUBAI_OFFSET_MS);
  const dayStart = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const sourceMonday = dayStart - ((local.getUTCDay() + 6) % 7) * DAY_MS;
  const targetKey = new Date(sourceMonday + 7 * DAY_MS).toISOString().slice(0, 10);
  return getArticleAiWeeklyCalendar(targetKey);
}

/** Pure snapshot policy, also used by fixtures. No ranking, sampling, or keyword matching. */
export function buildWeeklyManifestInputs(
  domain: ArticleAiDomain,
  calendar: ArticleAiWeeklyCalendar,
  observedAt: Date,
  rolloutSourceStart: Date,
  reviewedArticleIds: ReadonlySet<number>,
  rows: readonly WeeklySourceRow[],
): ArticleAiWeeklyManifestResult {
  const history: ArticleAiWeeklyInputSnapshot[] = [];
  const candidates: ArticleAiWeeklyInputSnapshot[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const articleId = Number(row.id);
    if (!Number.isSafeInteger(articleId)) throw new Error("Invalid article ID in weekly manifest");
    const identity = `${row.kind}:${articleId}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    const eligibleAt = asIso(row.eligible_at);
    const firstSeenAt = asIso(row.first_seen_at);
    let original: ArticleAiWeeklyCalendar | null = null;
    if (row.kind === "candidate") {
      if (!eligibleAt || reviewedArticleIds.has(articleId)) continue;
      const eligible = new Date(eligibleAt);
      if (eligible < rolloutSourceStart || eligible >= calendar.sourceEnd) continue;
      // Both publication DATE columns are interpreted at Dubai midnight in SQL.
      const weekday = new Date(eligible.getTime() + DUBAI_OFFSET_MS).getUTCDay();
      if (weekday === 0 || weekday === 6) continue;
      // Known late ingestion stays unreviewed until a later cohort's cutoff.
      // Unknown ingestion is explicitly recorded and uses actual availability.
      if (firstSeenAt && new Date(firstSeenAt) >= calendar.sourceEnd) continue;
      original = sourceCalendar(eligible);
    }
    const text = [row.title, row.summary, row.content].filter(Boolean).join(" ").trim();
    const exclusionReason = !row.resolved ? "article_missing"
      : !text ? "article_text_empty"
      : row.kind === "candidate" && !validUrl(row.url) ? "article_url_unusable"
      : null;
    const input: ArticleAiWeeklyInputSnapshot = {
      manifestId: `${domain}:${row.kind}:${articleId}`,
      kind: row.kind,
      domain,
      articleId,
      contentHash: null,
      title: row.title,
      summary: row.summary,
      content: row.content,
      source: row.source,
      url: row.url,
      publishedAt: asIso(row.published_at),
      observedAt: observedAt.toISOString(),
      eligibleAt,
      firstSeenAt,
      firstSeenKnown: firstSeenAt !== null,
      sourcePeriodStart: original?.sourceStart.toISOString() ?? null,
      sourcePeriodEnd: original?.sourceEnd.toISOString() ?? null,
      carryoverFromWeek: original && original.targetWeekKey !== calendar.targetWeekKey ? original.targetWeekKey : null,
      exclusionReason,
    };
    input.contentHash = row.resolved ? weeklyArticleContentHash(input) : null;
    (row.kind === "history" ? history : candidates).push(input);
  }
  history.sort((a, b) => a.articleId - b.articleId);
  candidates.sort((a, b) => a.articleId - b.articleId);
  const historyExcluded = history.filter((input) => input.exclusionReason !== null).length;
  const candidateExcluded = candidates.filter((input) => input.exclusionReason !== null).length;
  const coverage = {
    historyTotal: history.length,
    historyResolved: history.length - historyExcluded,
    historyProcessed: 0,
    historyUnusable: historyExcluded,
    historyExcluded,
    candidateTotal: candidates.length,
    candidateProcessed: 0,
    candidateUnusable: candidateExcluded,
    candidateExcluded,
    candidateCarryover: candidates.filter((input) => input.carryoverFromWeek !== null).length,
    mergeLeaves: 0, mergeNodes: 0, mergeNodesCompleted: 0,
    status: "incomplete" as const,
  };
  return {
    history, candidates, coverage,
    manifestHash: hash({ domain, targetWeekKey: calendar.targetWeekKey, observedAt: observedAt.toISOString(), history, candidates }),
    manifestCutoffAt: observedAt,
  };
}

/** One source-DB statement snapshots all distinct human likes and eligible unliked articles. */
export async function loadWeeklyManifestInputs(
  domain: ArticleAiDomain,
  calendar: ArticleAiWeeklyCalendar,
  observedAt: Date,
): Promise<ArticleAiWeeklyManifestResult> {
  const [floorRows, reviewed] = await Promise.all([
    esgPrisma.$queryRaw<Array<{ source_start: Date | null }>>`
      SELECT MIN(source_start_at) AS source_start FROM article_ai_domain_assessments
      WHERE domain = ${domain} AND policy_version = ${ARTICLE_AI_WEEKLY_POLICY_VERSION}
    `,
    esgPrisma.$queryRaw<Array<{ article_id: number }>>`
      SELECT DISTINCT i.article_id FROM article_ai_weekly_inputs i
      JOIN article_ai_domain_assessments a ON a.id = i.assessment_id
      WHERE a.domain = ${domain} AND a.policy_version = ${ARTICLE_AI_WEEKLY_POLICY_VERSION}
        AND a.assessment_date < ${calendar.targetWeekKey}::date
        AND a.status = 'ready' AND a.coverage_json->>'status' = 'complete'
        AND i.kind = 'candidate' AND i.state = 'processed' AND i.exclusion_reason IS NULL
    `,
  ]);
  const rolloutSourceStart = floorRows[0]?.source_start ?? calendar.sourceStart;
  const reviewedIds = reviewed.map((row) => Number(row.article_id));
  async function readSnapshot(database: Pick<typeof esgPrisma, "$queryRaw">): Promise<WeeklySourceRow[]> {
    const sizes = domain === "esg"
      ? await database.$queryRaw<Array<{ rows: bigint; bytes: bigint }>>`
          WITH human_ids AS (
            SELECT DISTINCT content_id FROM likes WHERE COALESCE(content_type, 'article') = 'article'
              AND (created_at IS NULL OR created_at AT TIME ZONE 'UTC' <= ${observedAt})
          ), inputs AS (
            SELECT a.title, a.summary, NULL::text AS content, a.source, a.link AS url
            FROM human_ids h LEFT JOIN esg_articles a ON a.id = h.content_id
            UNION ALL
            SELECT a.title, a.summary, NULL::text, a.source, a.link FROM esg_articles a
            WHERE COALESCE(a.published::timestamp AT TIME ZONE 'Asia/Dubai', a.save_time AT TIME ZONE 'UTC') >= ${rolloutSourceStart}
              AND COALESCE(a.published::timestamp AT TIME ZONE 'Asia/Dubai', a.save_time AT TIME ZONE 'UTC') < ${calendar.sourceEnd}
              AND NOT EXISTS (SELECT 1 FROM human_ids h WHERE h.content_id = a.id)
              AND NOT (a.id = ANY(${reviewedIds}::int[]))
          ) SELECT COUNT(*)::bigint AS rows,
            COALESCE(SUM(COALESCE(octet_length(title), 0)::bigint + COALESCE(octet_length(summary), 0)
              + COALESCE(octet_length(content), 0) + COALESCE(octet_length(source), 0) + COALESCE(octet_length(url), 0)), 0)::bigint AS bytes
          FROM inputs
        `
      : await database.$queryRaw<Array<{ rows: bigint; bytes: bigint }>>`
          WITH human_ids AS (
            SELECT DISTINCT content_id FROM likes WHERE COALESCE(content_type, 'article') = 'article'
              AND (created_at IS NULL OR created_at AT TIME ZONE 'UTC' <= ${observedAt})
          ), inputs AS (
            SELECT a.title, a.summary, a.content, a.source, COALESCE(a.url, a.link) AS url
            FROM human_ids h LEFT JOIN credit_articles a ON a.id = h.content_id
            UNION ALL
            SELECT a.title, a.summary, a.content, a.source, COALESCE(a.url, a.link) FROM credit_articles a
            WHERE COALESCE(a.date::timestamp AT TIME ZONE 'Asia/Dubai', a.created_at AT TIME ZONE 'UTC') >= ${rolloutSourceStart}
              AND COALESCE(a.date::timestamp AT TIME ZONE 'Asia/Dubai', a.created_at AT TIME ZONE 'UTC') < ${calendar.sourceEnd}
              AND NOT EXISTS (SELECT 1 FROM human_ids h WHERE h.content_id = a.id)
              AND NOT (a.id = ANY(${reviewedIds}::int[]))
          ) SELECT COUNT(*)::bigint AS rows,
            COALESCE(SUM(COALESCE(octet_length(title), 0)::bigint + COALESCE(octet_length(summary), 0)
              + COALESCE(octet_length(content), 0) + COALESCE(octet_length(source), 0) + COALESCE(octet_length(url), 0)), 0)::bigint AS bytes
          FROM inputs
        `;
    // Allow for UTF-16 strings, JSON escaping/hash copies and per-row metadata.
    const allocation = BigInt(sizes[0]?.bytes ?? 0) * BigInt(8) + BigInt(sizes[0]?.rows ?? 0) * BigInt(4096);
    if (allocation > BigInt(MAX_MANIFEST_MEMORY_BYTES)) {
      throw new Error("Weekly article input exceeds the worker memory budget; no articles were skipped or sent to the model. Increase processing capacity before retrying.");
    }
  const rows = domain === "esg"
    ? await database.$queryRaw<WeeklySourceRow[]>`
        WITH human_ids AS (
          SELECT DISTINCT content_id FROM likes
          WHERE COALESCE(content_type, 'article') = 'article'
            AND (created_at IS NULL OR created_at AT TIME ZONE 'UTC' <= ${observedAt})
        )
        SELECT 'history'::text AS kind, h.content_id AS id, a.id IS NOT NULL AS resolved,
          a.title, a.summary, NULL::text AS content, a.source, a.link AS url,
          a.published::timestamp AT TIME ZONE 'Asia/Dubai' AS published_at,
          COALESCE(a.published::timestamp AT TIME ZONE 'Asia/Dubai', a.save_time AT TIME ZONE 'UTC') AS eligible_at,
          a.save_time AT TIME ZONE 'UTC' AS first_seen_at
        FROM human_ids h LEFT JOIN esg_articles a ON a.id = h.content_id
        UNION ALL
        SELECT 'candidate'::text, a.id, TRUE, a.title, a.summary, NULL::text,
          a.source, a.link, a.published::timestamp AT TIME ZONE 'Asia/Dubai',
          COALESCE(a.published::timestamp AT TIME ZONE 'Asia/Dubai', a.save_time AT TIME ZONE 'UTC'),
          a.save_time AT TIME ZONE 'UTC'
        FROM esg_articles a
        WHERE COALESCE(a.published::timestamp AT TIME ZONE 'Asia/Dubai', a.save_time AT TIME ZONE 'UTC') >= ${rolloutSourceStart}
          AND COALESCE(a.published::timestamp AT TIME ZONE 'Asia/Dubai', a.save_time AT TIME ZONE 'UTC') < ${calendar.sourceEnd}
          AND NOT EXISTS (SELECT 1 FROM human_ids h WHERE h.content_id = a.id)
          AND NOT (a.id = ANY(${reviewedIds}::int[]))
        ORDER BY kind, id
      `
    : await database.$queryRaw<WeeklySourceRow[]>`
        WITH human_ids AS (
          SELECT DISTINCT content_id FROM likes
          WHERE COALESCE(content_type, 'article') = 'article'
            AND (created_at IS NULL OR created_at AT TIME ZONE 'UTC' <= ${observedAt})
        )
        SELECT 'history'::text AS kind, h.content_id AS id, a.id IS NOT NULL AS resolved,
          a.title, a.summary, a.content, a.source, COALESCE(a.url, a.link) AS url,
          a.date::timestamp AT TIME ZONE 'Asia/Dubai' AS published_at,
          COALESCE(a.date::timestamp AT TIME ZONE 'Asia/Dubai', a.created_at AT TIME ZONE 'UTC') AS eligible_at,
          COALESCE(a.created_at, a.save_time) AT TIME ZONE 'UTC' AS first_seen_at
        FROM human_ids h LEFT JOIN credit_articles a ON a.id = h.content_id
        UNION ALL
        SELECT 'candidate'::text, a.id, TRUE, a.title, a.summary, a.content,
          a.source, COALESCE(a.url, a.link), a.date::timestamp AT TIME ZONE 'Asia/Dubai',
          COALESCE(a.date::timestamp AT TIME ZONE 'Asia/Dubai', a.created_at AT TIME ZONE 'UTC'),
          COALESCE(a.created_at, a.save_time) AT TIME ZONE 'UTC'
        FROM credit_articles a
        WHERE COALESCE(a.date::timestamp AT TIME ZONE 'Asia/Dubai', a.created_at AT TIME ZONE 'UTC') >= ${rolloutSourceStart}
          AND COALESCE(a.date::timestamp AT TIME ZONE 'Asia/Dubai', a.created_at AT TIME ZONE 'UTC') < ${calendar.sourceEnd}
          AND NOT EXISTS (SELECT 1 FROM human_ids h WHERE h.content_id = a.id)
          AND NOT (a.id = ANY(${reviewedIds}::int[]))
        ORDER BY kind, id
      `;
    return rows;
  }
  // Use one repeatable-read source snapshot for the capacity check and payload,
  // including Credit. Concurrent scraper updates cannot bypass the size guard.
  const rows = domain === "esg"
    ? await esgPrisma.$transaction(readSnapshot, { isolationLevel: "RepeatableRead", timeout: 30_000 })
    : await creditPrisma.$transaction(readSnapshot, { isolationLevel: "RepeatableRead", timeout: 30_000 });
  return buildWeeklyManifestInputs(domain, calendar, observedAt, rolloutSourceStart,
    new Set(reviewedIds), rows);
}
