import "server-only";

import { createHash } from "node:crypto";

import { esgPrisma } from "@esgcredit/db-esg";
import { creditPrisma } from "@esgcredit/db-credit";

import type { ArticleAiDailyCalendar } from "./daily-calendar";
import {
  ARTICLE_AI_DAILY_POLICY_VERSION,
  type ArticleAiDomain,
  type ArticleAiWeeklyInputSnapshot,
  type ArticleAiWeeklyManifestResult,
} from "./types";
import { weeklyArticleContentHash, type WeeklySourceRow } from "./weekly-inputs";

/** Keep a daily source snapshot bounded even if a scraper has a bad burst. */
const MAX_DAILY_MANIFEST_MEMORY_BYTES = 64 * 1024 * 1024;

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function asIso(value: Date | null): string | null {
  return value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toISOString() : null;
}

function validUrl(value: string | null): boolean {
  try {
    return Boolean(value && ["http:", "https:"].includes(new URL(value).protocol));
  } catch {
    return false;
  }
}

/** Pure daily manifest policy. No user identity or personal preference enters the snapshot. */
export function buildDailyManifestInputs(
  domain: ArticleAiDomain,
  calendar: ArticleAiDailyCalendar,
  observedAt: Date,
  rows: readonly WeeklySourceRow[],
): ArticleAiWeeklyManifestResult {
  const history: ArticleAiWeeklyInputSnapshot[] = [];
  const candidates: ArticleAiWeeklyInputSnapshot[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const articleId = Number(row.id);
    if (!Number.isSafeInteger(articleId) || articleId <= 0) throw new Error("Invalid article ID in daily manifest");
    const identity = `${row.kind}:${articleId}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    const eligibleAt = asIso(row.eligible_at);
    const firstSeenAt = asIso(row.first_seen_at);
    const text = [row.title, row.summary, row.content].filter(Boolean).join(" ").trim();
    const eligibleMs = eligibleAt ? new Date(eligibleAt).getTime() : Number.NaN;
    const firstSeenMs = firstSeenAt ? new Date(firstSeenAt).getTime() : Number.NaN;
    const inPublicationLookback = Number.isFinite(eligibleMs)
      && eligibleMs >= calendar.candidateStart.getTime() && eligibleMs < calendar.sourceEnd.getTime();
    const ingestedInSourceDay = Number.isFinite(firstSeenMs)
      && firstSeenMs >= calendar.sourceStart.getTime() && firstSeenMs < calendar.sourceEnd.getTime();
    const outsideWindow = row.kind === "candidate" && !inPublicationLookback && !ingestedInSourceDay;
    const exclusionReason = !row.resolved ? "article_missing"
      : outsideWindow ? "outside_source_window"
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
      // Keep the original publication/eligibility date in eligibleAt and the
      // immutable daily source cohort in this period pair. A late scraper
      // arrival can therefore be audited without being mistaken for a new
      // publication day.
      // Historical evidence belongs to the domain across days. Keep its cache identity stable.
      sourcePeriodStart: row.kind === "candidate" ? calendar.sourceStart.toISOString() : null,
      sourcePeriodEnd: row.kind === "candidate" ? calendar.sourceEnd.toISOString() : null,
      carryoverFromWeek: null,
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
    candidateCarryover: candidates.filter((input) => {
      if (input.exclusionReason !== null || !input.eligibleAt) return false;
      return new Date(input.eligibleAt).getTime() < calendar.sourceStart.getTime();
    }).length,
    mergeLeaves: 0,
    mergeNodes: 0,
    mergeNodesCompleted: 0,
    status: "incomplete" as const,
  };
  return {
    history,
    candidates,
    coverage,
    manifestHash: hash({ domain, sourceDayKey: calendar.sourceDayKey, observedAt: observedAt.toISOString(), history, candidates }),
    manifestCutoffAt: observedAt,
  };
}

/**
 * Snapshot every resolvable human-liked article plus the unliked articles
 * published/ingested during the one preceding Dubai day. Previously processed
 * daily candidates are excluded so a pick is not repeatedly re-evaluated.
 */
export async function loadDailyManifestInputs(
  domain: ArticleAiDomain,
  calendar: ArticleAiDailyCalendar,
  observedAt: Date,
): Promise<ArticleAiWeeklyManifestResult> {
  const [floorRows, reviewed] = await Promise.all([
    esgPrisma.$queryRaw<Array<{ source_start: Date | null }>>`
      SELECT MIN(source_start_at) AS source_start
      FROM article_ai_domain_assessments
      WHERE domain = ${domain} AND policy_version = ${ARTICLE_AI_DAILY_POLICY_VERSION}
    `,
    esgPrisma.$queryRaw<Array<{ article_id: number }>>`
      SELECT DISTINCT i.article_id
      FROM article_ai_weekly_inputs i
      JOIN article_ai_domain_assessments a ON a.id = i.assessment_id
      WHERE a.domain = ${domain} AND a.policy_version = ${ARTICLE_AI_DAILY_POLICY_VERSION}
        AND a.assessment_date >= (${calendar.sourceStart} - INTERVAL '30 days')::date
        AND a.status = 'ready' AND a.coverage_json->>'status' = 'complete'
        AND i.kind = 'candidate' AND i.state = 'processed' AND i.exclusion_reason IS NULL
    `,
  ]);
  // Seed the first live run at yesterday's boundary. Later runs use only the
  // bounded late-arrival lookback, capped by the first policy-4 source floor.
  const sourceFloor = floorRows[0]?.source_start
    ? new Date(floorRows[0].source_start).getTime()
    : Number.POSITIVE_INFINITY;
  const effectiveCalendar = {
    ...calendar,
    candidateStart: Number.isFinite(sourceFloor)
      ? new Date(Math.max(calendar.candidateStart.getTime(), sourceFloor))
      : calendar.sourceStart,
  };
  const reviewedIds = reviewed.map((row) => Number(row.article_id)).filter((id) => Number.isSafeInteger(id) && id > 0);

  async function readSnapshot(database: Pick<typeof esgPrisma, "$queryRaw">): Promise<WeeklySourceRow[]> {
    const sizes = domain === "esg"
      ? await database.$queryRaw<Array<{ rows: bigint; bytes: bigint }>>`
          WITH human_ids AS (
            SELECT DISTINCT content_id FROM likes
            WHERE COALESCE(content_type, 'article') = 'article'
              AND (created_at IS NULL OR created_at AT TIME ZONE 'UTC' <= ${observedAt})
          ), inputs AS (
            SELECT a.title, a.summary, NULL::text AS content, a.source, a.link AS url
            FROM human_ids h LEFT JOIN esg_articles a ON a.id = h.content_id
            UNION ALL
            SELECT a.title, a.summary, NULL::text, a.source, a.link
            FROM esg_articles a
            WHERE (
              (COALESCE(a.published::timestamp AT TIME ZONE 'Asia/Dubai', a.save_time AT TIME ZONE 'UTC') >= ${effectiveCalendar.candidateStart}
                AND COALESCE(a.published::timestamp AT TIME ZONE 'Asia/Dubai', a.save_time AT TIME ZONE 'UTC') < ${calendar.sourceEnd})
              OR (a.save_time AT TIME ZONE 'UTC' >= ${calendar.sourceStart}
                AND a.save_time AT TIME ZONE 'UTC' < ${calendar.sourceEnd})
            )
              AND NOT EXISTS (SELECT 1 FROM human_ids h WHERE h.content_id = a.id)
              AND NOT (a.id = ANY(${reviewedIds}::int[]))
          )
          SELECT COUNT(*)::bigint AS rows,
            COALESCE(SUM(COALESCE(octet_length(title), 0)::bigint + COALESCE(octet_length(summary), 0)
              + COALESCE(octet_length(content), 0) + COALESCE(octet_length(source), 0)
              + COALESCE(octet_length(url), 0)), 0)::bigint AS bytes
          FROM inputs
        `
      : await database.$queryRaw<Array<{ rows: bigint; bytes: bigint }>>`
          WITH human_ids AS (
            SELECT DISTINCT content_id FROM likes
            WHERE COALESCE(content_type, 'article') = 'article'
              AND (created_at IS NULL OR created_at AT TIME ZONE 'UTC' <= ${observedAt})
          ), inputs AS (
            SELECT a.title, a.summary, a.content, a.source, COALESCE(a.url, a.link) AS url
            FROM human_ids h LEFT JOIN credit_articles a ON a.id = h.content_id
            UNION ALL
            SELECT a.title, a.summary, a.content, a.source, COALESCE(a.url, a.link)
            FROM credit_articles a
            WHERE (
              (COALESCE(a.date::timestamp AT TIME ZONE 'Asia/Dubai', a.created_at AT TIME ZONE 'UTC') >= ${effectiveCalendar.candidateStart}
                AND COALESCE(a.date::timestamp AT TIME ZONE 'Asia/Dubai', a.created_at AT TIME ZONE 'UTC') < ${calendar.sourceEnd})
              OR (COALESCE(a.created_at, a.save_time) AT TIME ZONE 'UTC' >= ${calendar.sourceStart}
                AND COALESCE(a.created_at, a.save_time) AT TIME ZONE 'UTC' < ${calendar.sourceEnd})
            )
              AND NOT EXISTS (SELECT 1 FROM human_ids h WHERE h.content_id = a.id)
              AND NOT (a.id = ANY(${reviewedIds}::int[]))
          )
          SELECT COUNT(*)::bigint AS rows,
            COALESCE(SUM(COALESCE(octet_length(title), 0)::bigint + COALESCE(octet_length(summary), 0)
              + COALESCE(octet_length(content), 0) + COALESCE(octet_length(source), 0)
              + COALESCE(octet_length(url), 0)), 0)::bigint AS bytes
          FROM inputs
        `;
    const allocation = BigInt(sizes[0]?.bytes ?? 0) * BigInt(8)
      + BigInt(sizes[0]?.rows ?? 0) * BigInt(4_096);
    if (allocation > BigInt(MAX_DAILY_MANIFEST_MEMORY_BYTES)) {
      throw new Error("Daily article input exceeds the worker memory budget; no articles were skipped or sent to the model");
    }
    return domain === "esg"
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
          WHERE (
            (COALESCE(a.published::timestamp AT TIME ZONE 'Asia/Dubai', a.save_time AT TIME ZONE 'UTC') >= ${effectiveCalendar.candidateStart}
              AND COALESCE(a.published::timestamp AT TIME ZONE 'Asia/Dubai', a.save_time AT TIME ZONE 'UTC') < ${calendar.sourceEnd})
            OR (a.save_time AT TIME ZONE 'UTC' >= ${calendar.sourceStart}
              AND a.save_time AT TIME ZONE 'UTC' < ${calendar.sourceEnd})
          )
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
          WHERE (
            (COALESCE(a.date::timestamp AT TIME ZONE 'Asia/Dubai', a.created_at AT TIME ZONE 'UTC') >= ${effectiveCalendar.candidateStart}
              AND COALESCE(a.date::timestamp AT TIME ZONE 'Asia/Dubai', a.created_at AT TIME ZONE 'UTC') < ${calendar.sourceEnd})
            OR (COALESCE(a.created_at, a.save_time) AT TIME ZONE 'UTC' >= ${calendar.sourceStart}
              AND COALESCE(a.created_at, a.save_time) AT TIME ZONE 'UTC' < ${calendar.sourceEnd})
          )
            AND NOT EXISTS (SELECT 1 FROM human_ids h WHERE h.content_id = a.id)
            AND NOT (a.id = ANY(${reviewedIds}::int[]))
          ORDER BY kind, id
        `;
  }

  const rows = domain === "esg"
    ? await esgPrisma.$transaction(readSnapshot, { isolationLevel: "RepeatableRead", timeout: 30_000 })
    : await creditPrisma.$transaction(readSnapshot, { isolationLevel: "RepeatableRead", timeout: 30_000 });
  return buildDailyManifestInputs(domain, effectiveCalendar, observedAt, rows);
}
