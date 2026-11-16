import "server-only";

import { esgPrisma } from "@esgcredit/db-esg";
import { creditPrisma } from "@esgcredit/db-credit";

import {
  ARTICLE_AI_MAX_WEEKLY_PICKS,
  ARTICLE_AI_WEEKLY_POLICY_VERSION,
  isArticleAiDomain,
  isArticleAiWeeklyPolicy,
  type ArticleAiDigestPick,
  type ArticleAiDomain,
  type ArticleAiFeedbackResult,
  type ArticleAiPreference,
  type ArticleAiSelection,
  type ArticleAiWeeklyCoverage,
  type ArticleAiWeeklyPhase,
  type ArticleAiWeeklyStatus,
} from "./types";
import { getArticleAiConfig, isArticleAiEmailEnabled } from "./config";
import { getArticleAiWeeklyCalendar, isArticleAiWeeklyWeekKey, toArticleAiWeeklySummary } from "./weekly-calendar";
import { weeklyArticleContentHash } from "./weekly-inputs";
import {
  ArticleAiConflictError,
  ArticleAiNotFoundError,
  ArticleAiUnauthorizedError,
} from "./errors";
import {
  getDomainHistorySummary,
} from "./shared";

type RawQueryClient = Pick<typeof esgPrisma, "$queryRaw">;

interface UserRow {
  id: number;
  email: string | null;
  email_notifications: boolean | null;
  is_active_db: boolean;
}

interface PreferenceRow {
  domain: string;
  enabled: boolean;
  settings_version: number;
  status: string;
  history_count: number;
  profile_source: string;
  last_run_at: Date | null;
}

interface WeeklyAssessmentRow {
  id: string;
  domain: string;
  assessment_date: Date;
  policy_version: number;
  status: string;
  profile_source: string;
  history_count: number;
  profile_json: unknown;
  content_hash: string | null;
  model: string | null;
  completed_at: Date | null;
  source_start_at: Date | null;
  source_cutoff_at: Date | null;
  processing_at: Date | null;
  email_at: Date | null;
  valid_until: Date | null;
  phase: string | null;
  coverage_json: unknown;
  selection_count: number;
}

interface WeeklySelectionRow {
  id: string;
  assessment_id: string;
  assessment_date: Date;
  policy_version: number;
  article_id: number;
  domain: ArticleAiDomain;
  reason: string;
  relevance_score: number | null;
  selected_at: Date;
  expires_at: Date;
  content_hash: string;
  model: string | null;
}

interface SharedWithOverlay extends WeeklySelectionRow {
  user_selection_id: string | null;
  user_state: string | null;
  user_version: number | null;
  user_pending_confirmation: boolean;
}

function normalizeDomain(value: unknown): ArticleAiDomain {
  if (isArticleAiDomain(value)) return value;
  throw new Error("Unsupported article AI domain");
}

function normalizeIds(ids: readonly number[]): number[] {
  return Array.from(new Set(ids.filter((id) => Number.isSafeInteger(id) && id > 0))).slice(0, 100);
}

function normalizeEmail(value: string | null | undefined): string {
  return (value ?? "").trim().toLocaleLowerCase("en-US");
}

async function getActiveUser(userId: number): Promise<UserRow> {
  const rows = await esgPrisma.$queryRaw<UserRow[]>`
    SELECT id, email, email_notifications, is_active_db FROM users WHERE id = ${userId} LIMIT 1
  `;
  const user = rows[0];
  if (!user || !user.is_active_db) throw new ArticleAiUnauthorizedError();
  return user;
}

interface WeeklyDigestSchedule {
  configured: boolean;
  mismatch: boolean;
}

async function weeklyDigestSchedule(userId: number, domain: ArticleAiDomain, user?: UserRow): Promise<WeeklyDigestSchedule> {
  const current = user ?? await getActiveUser(userId);
  if (current.email_notifications === false) return { configured: false, mismatch: false };
  const email = normalizeEmail(current.email);
  if (!email) return { configured: false, mismatch: false };
  const rows = await esgPrisma.$queryRaw<Array<{ configured: boolean; mismatch: boolean }>>`
    SELECT
      EXISTS (
        SELECT 1 FROM alert_preferences ap
        WHERE ap.user_id = ${userId}
          AND COALESCE(ap.is_active, TRUE) = TRUE
          AND COALESCE(ap.email_enabled, TRUE) = TRUE
          AND COALESCE(ap.alert_articles, TRUE) = TRUE
          AND COALESCE(ap.alert_type, 'weekly_digest') = 'weekly_digest'
          AND ((COALESCE(cardinality(ap.domains), 0) > 0 AND ${domain} = ANY(ap.domains))
            OR (COALESCE(cardinality(ap.domains), 0) = 0 AND lower(trim(ap.domain)) = ${domain}))
          AND (NULLIF(trim(ap.email_address), '') IS NULL OR lower(trim(ap.email_address)) = ${email})
          AND lower(trim(COALESCE(ap.digest_day, 'monday'))) = 'monday'
          AND COALESCE(ap.digest_hour, 9) = 9
          AND lower(trim(COALESCE(ap.timezone, 'Asia/Dubai'))) = 'asia/dubai'
      ) AS configured,
      EXISTS (
        SELECT 1 FROM alert_preferences ap
        WHERE ap.user_id = ${userId}
          AND COALESCE(ap.is_active, TRUE) = TRUE
          AND COALESCE(ap.email_enabled, TRUE) = TRUE
          AND COALESCE(ap.alert_articles, TRUE) = TRUE
          AND COALESCE(ap.alert_type, 'weekly_digest') = 'weekly_digest'
          AND ((COALESCE(cardinality(ap.domains), 0) > 0 AND ${domain} = ANY(ap.domains))
            OR (COALESCE(cardinality(ap.domains), 0) = 0 AND lower(trim(ap.domain)) = ${domain}))
          AND (NULLIF(trim(ap.email_address), '') IS NULL OR lower(trim(ap.email_address)) = ${email})
          AND NOT (
            lower(trim(COALESCE(ap.digest_day, 'monday'))) = 'monday'
            AND COALESCE(ap.digest_hour, 9) = 9
            AND lower(trim(COALESCE(ap.timezone, 'Asia/Dubai'))) = 'asia/dubai'
          )
      ) AS mismatch
  `;
  const configured = Boolean(rows[0]?.configured);
  return { configured, mismatch: !configured && Boolean(rows[0]?.mismatch) };
}

async function getLatestWeeklyAssessment(domain: ArticleAiDomain): Promise<WeeklyAssessmentRow | null> {
  const rows = await esgPrisma.$queryRaw<WeeklyAssessmentRow[]>`
    SELECT a.id::text, a.domain, a.assessment_date, a.policy_version, a.status,
           a.profile_source, a.history_count, a.profile_json, a.content_hash, a.model,
           a.completed_at, a.source_start_at, a.source_cutoff_at, a.processing_at,
           a.email_at, a.valid_until, a.phase, a.coverage_json,
           (SELECT COUNT(*)::int FROM article_ai_domain_selections ds WHERE ds.assessment_id = a.id) AS selection_count
    FROM article_ai_domain_assessments a
    WHERE a.domain = ${domain} AND a.policy_version = ${ARTICLE_AI_WEEKLY_POLICY_VERSION}
    ORDER BY a.assessment_date DESC, a.created_at DESC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function getLatestReadyWeeklyAssessment(domain: ArticleAiDomain, now = new Date()): Promise<WeeklyAssessmentRow | null> {
  const rows = await esgPrisma.$queryRaw<WeeklyAssessmentRow[]>`
    SELECT a.id::text, a.domain, a.assessment_date, a.policy_version, a.status,
           a.profile_source, a.history_count, a.profile_json, a.content_hash, a.model,
           a.completed_at, a.source_start_at, a.source_cutoff_at, a.processing_at,
           a.email_at, a.valid_until, a.phase, a.coverage_json,
           (SELECT COUNT(*)::int FROM article_ai_domain_selections ds WHERE ds.assessment_id = a.id) AS selection_count
    FROM article_ai_domain_assessments a
    WHERE a.domain = ${domain} AND a.policy_version = ${ARTICLE_AI_WEEKLY_POLICY_VERSION}
      AND a.status = 'ready' AND a.valid_until > ${now}
    ORDER BY a.assessment_date DESC, a.created_at DESC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

function assessmentStatus(assessment: WeeklyAssessmentRow | null, now = new Date()): ArticleAiPreference["status"] {
  if (assessment?.status === "ready" && (!assessment.valid_until || new Date(assessment.valid_until).getTime() > now.getTime())) return "ready";
  if (assessment?.status === "insufficient") return "insufficient_history";
  if (assessment?.status === "error" || assessment?.status === "budget_exhausted") return "error";
  return "queued";
}

const WEEKLY_PHASES: readonly ArticleAiWeeklyPhase[] = [
  "manifest", "history_profile", "history_merge", "candidate_evaluation", "candidate_merge", "finalize",
];
function safeCoverage(value: unknown): ArticleAiWeeklyCoverage {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const number = (key: string): number => {
    const value = Number(source[key] ?? 0);
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
  };
  return {
    historyTotal: number("historyTotal"), historyResolved: number("historyResolved"),
    historyProcessed: number("historyProcessed"), historyUnusable: number("historyUnusable"),
    historyExcluded: number("historyExcluded"), candidateTotal: number("candidateTotal"),
    candidateProcessed: number("candidateProcessed"), candidateUnusable: number("candidateUnusable"),
    candidateExcluded: number("candidateExcluded"), candidateCarryover: number("candidateCarryover"),
    mergeLeaves: number("mergeLeaves"), mergeNodes: number("mergeNodes"),
    mergeNodesCompleted: number("mergeNodesCompleted"),
    status: source.status === "complete" ? "complete" : "incomplete",
  };
}

function weeklyAssessmentStatus(assessment: WeeklyAssessmentRow, now = new Date()): ArticleAiWeeklyStatus {
  if (assessment.status === "ready") {
    return assessment.valid_until && new Date(assessment.valid_until).getTime() <= now.getTime() ? "expired" : "ready";
  }
  if (assessment.status === "insufficient") return "insufficient_history";
  if (assessment.status === "error") return "error";
  if (assessment.status === "budget_exhausted") return "budget_exhausted";
  if (assessment.status === "queued") return "queued";
  switch (assessment.phase) {
    case "history_profile": return "assessing_history";
    case "history_merge": return "merging_history";
    case "candidate_evaluation": return "evaluating_candidates";
    case "candidate_merge": return "merging_candidates";
    case "finalize": return "queued";
    default: return "manifesting";
  }
}

function weeklyPhase(value: string | null): ArticleAiWeeklyPhase {
  return value && WEEKLY_PHASES.includes(value as ArticleAiWeeklyPhase)
    ? value as ArticleAiWeeklyPhase
    : "manifest";
}

function targetWeekKey(assessmentDate: Date): string {
  return new Date(assessmentDate).toISOString().slice(0, 10);
}

function assessmentSummary(assessment: WeeklyAssessmentRow): string | null {
  if (!assessment.profile_json || typeof assessment.profile_json !== "object") return null;
  const value = (assessment.profile_json as Record<string, unknown>).summary;
  return typeof value === "string" ? value.slice(0, 2_000) : null;
}

function mapWeeklySummary(assessment: WeeklyAssessmentRow | null): ArticleAiPreference["weekly"] {
  if (!assessment || !isArticleAiWeeklyPolicy(Number(assessment.policy_version))) return null;
  const key = targetWeekKey(assessment.assessment_date);
  const calendar = getArticleAiWeeklyCalendar(key);
  const summaryStatus = weeklyAssessmentStatus(assessment);
  return toArticleAiWeeklySummary(calendar, {
    model: assessment.model || getArticleAiConfig().model,
    status: summaryStatus,
    phase: weeklyPhase(assessment.phase),
    coverage: safeCoverage(assessment.coverage_json),
    selectionCount: Number(assessment.selection_count ?? 0),
    completedAt: assessment.completed_at ? new Date(assessment.completed_at).toISOString() : null,
    assessmentSummary: assessmentSummary(assessment),
  });
}

function mapPreference(
  row: PreferenceRow,
  history: { count: number; source: "domain" | "insufficient" },
  assessment: WeeklyAssessmentRow | null,
  schedule: WeeklyDigestSchedule,
  readyAssessment: WeeklyAssessmentRow | null,
): ArticleAiPreference {
  const source = assessment?.profile_source === "domain" || assessment?.profile_source === "insufficient"
    ? assessment.profile_source
    : history.source;
  return {
    domain: normalizeDomain(row.domain),
    enabled: Boolean(row.enabled),
    settingsVersion: Number(row.settings_version),
    // The v1 preference row may contain a stale personal count (for example
    // the old "2/20" status). Until a shared assessment exists, expose the
    // current all-user domain history instead of that legacy value.
    historyCount: assessment ? Number(assessment.history_count) : history.count,
    profileSource: source,
    weeklyDigestConfigured: schedule.configured,
    status: row.enabled ? assessmentStatus(assessment) : "off",
    lastRunAt: assessment?.completed_at
      ? new Date(assessment.completed_at).toISOString()
      : row.last_run_at ? new Date(row.last_run_at).toISOString() : null,
    emailInclusionEnabled: getArticleAiConfig().enabled && getArticleAiConfig().emailEnabled,
    weekly: mapWeeklySummary(readyAssessment ?? assessment),
    scheduleMismatch: schedule.mismatch,
  };
}

function sharedSelection(row: SharedWithOverlay): ArticleAiSelection {
  return {
    articleId: Number(row.article_id), domain: normalizeDomain(row.domain),
    state: row.user_state === "confirmed" ? "confirmed" : row.user_state === "dismissed" ? "dismissed" : "selected",
    reason: String(row.reason).slice(0, 600), version: Number(row.user_version ?? 1),
    selectedAt: new Date(row.selected_at).toISOString(), expiresAt: new Date(row.expires_at).toISOString(),
    pendingConfirmation: Boolean(row.user_pending_confirmation), sharedSelectionId: row.id,
    assessmentDate: new Date(row.assessment_date).toISOString().slice(0, 10),
    policyVersion: Number(row.policy_version), targetWeekKey: new Date(row.assessment_date).toISOString().slice(0, 10),
  };
}

function sharedKey(userId: number, domain: ArticleAiDomain, sharedId: string, version: number, action: string): string {
  return `article-ai:v2:${userId}:${domain}:${sharedId}:${version}:${action}`;
}

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

async function loadCurrentWeeklyArticles(
  domain: ArticleAiDomain,
  ids: readonly number[],
): Promise<CurrentWeeklyArticle[]> {
  const safeIds = normalizeIds(ids);
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

async function articleHash(domain: ArticleAiDomain, articleId: number): Promise<string> {
  const row = (await loadCurrentWeeklyArticles(domain, [articleId])).find((article) => article.id === articleId);
  if (!row) throw new ArticleAiNotFoundError();
  return row.contentHash;
}

export async function getArticleAiPreferenceV2(userId: number, domain: ArticleAiDomain): Promise<ArticleAiPreference> {
  const safeDomain = normalizeDomain(domain);
  const user = await getActiveUser(userId);
  const [rows, history, assessment, schedule, readyAssessment] = await Promise.all([
    esgPrisma.$queryRaw<PreferenceRow[]>`
      SELECT domain, enabled, settings_version, status, history_count, profile_source, last_run_at
      FROM article_ai_preferences WHERE user_id = ${userId} AND domain = ${safeDomain} LIMIT 1
    `,
    getDomainHistorySummary(safeDomain),
    getLatestWeeklyAssessment(safeDomain),
    weeklyDigestSchedule(userId, safeDomain, user),
    getLatestReadyWeeklyAssessment(safeDomain),
  ]);
  return mapPreference(rows[0] ?? {
    domain: safeDomain, enabled: false, settings_version: 0, status: "off",
    history_count: history.count, profile_source: history.source, last_run_at: null,
  }, history, assessment, schedule, readyAssessment);
}

export async function setArticleAiPreferenceV2(
  userId: number,
  domain: ArticleAiDomain,
  enabled: boolean,
): Promise<ArticleAiPreference> {
  const safeDomain = normalizeDomain(domain);
  const user = await getActiveUser(userId);
  const history = await getDomainHistorySummary(safeDomain);
  const rows = await esgPrisma.$queryRaw<PreferenceRow[]>`
    INSERT INTO article_ai_preferences (
      user_id, domain, enabled, settings_version, status, history_count, profile_source, last_error, updated_at
    ) VALUES (
      ${userId}, ${safeDomain}, ${enabled}, 1,
      CASE WHEN ${enabled} THEN 'queued' ELSE 'off' END,
      ${history.count}, ${history.source}, NULL, now()
    )
    ON CONFLICT (user_id, domain) DO UPDATE SET
      enabled = EXCLUDED.enabled,
      settings_version = CASE WHEN article_ai_preferences.enabled = EXCLUDED.enabled
        THEN article_ai_preferences.settings_version ELSE article_ai_preferences.settings_version + 1 END,
      status = CASE WHEN article_ai_preferences.enabled = EXCLUDED.enabled
        THEN article_ai_preferences.status ELSE CASE WHEN EXCLUDED.enabled THEN 'queued' ELSE 'off' END END,
      history_count = EXCLUDED.history_count, profile_source = EXCLUDED.profile_source,
      last_error = NULL, updated_at = now()
    RETURNING domain, enabled, settings_version, status, history_count, profile_source, last_run_at
  `;
  const row = rows[0];
  if (!row) throw new Error("Unable to persist article AI preference");
  const [assessment, schedule, readyAssessment] = await Promise.all([
    getLatestWeeklyAssessment(safeDomain),
    weeklyDigestSchedule(userId, safeDomain, user),
    getLatestReadyWeeklyAssessment(safeDomain),
  ]);
  return mapPreference(row, history, assessment, schedule, readyAssessment);
}

async function getWeeklySharedSelections(
  userId: number,
  domain: ArticleAiDomain,
  articleIds: readonly number[] | undefined,
  now: Date,
  exactTargetWeekKey?: string,
  mailEligible = false,
): Promise<SharedWithOverlay[]> {
  const ids = articleIds ? normalizeIds(articleIds) : [];
  const hasIds = ids.length > 0;
  if (exactTargetWeekKey && !isArticleAiWeeklyWeekKey(exactTargetWeekKey)) return [];
  const rows = exactTargetWeekKey
    ? hasIds
      ? await esgPrisma.$queryRaw<SharedWithOverlay[]>`
          SELECT ds.id::text, ds.assessment_id::text, a.assessment_date,
                 a.policy_version, ds.article_id, ds.domain, ds.reason,
                 ds.relevance_score, ds.selected_at, ds.expires_at,
                 ds.content_hash, ds.model,
                 us.id::text AS user_selection_id, us.state AS user_state,
                 us.version AS user_version,
                 COALESCE(us.pending_confirmation, FALSE) AS user_pending_confirmation
          FROM article_ai_domain_assessments a
          JOIN article_ai_domain_selections ds ON ds.assessment_id = a.id
          LEFT JOIN article_ai_user_selections us
            ON us.user_id = ${userId} AND us.domain = ds.domain AND us.article_id = ds.article_id
          WHERE a.domain = ${domain} AND a.policy_version = ${ARTICLE_AI_WEEKLY_POLICY_VERSION}
            AND a.status = 'ready' AND a.assessment_date = ${exactTargetWeekKey}::date
            AND a.valid_until > ${now}
            AND (${mailEligible} = FALSE OR (
              a.completed_at IS NOT NULL AND a.email_at IS NOT NULL AND a.completed_at <= a.email_at
              AND COALESCE(a.coverage_json->>'status', '') = 'complete'
            ))
            AND ds.domain = ${domain}
            AND ds.expires_at > ${now} AND ds.article_id = ANY(${ids}::int[])
          ORDER BY ds.relevance_score DESC NULLS LAST, ds.selected_at DESC, ds.article_id ASC
        `
      : await esgPrisma.$queryRaw<SharedWithOverlay[]>`
          SELECT ds.id::text, ds.assessment_id::text, a.assessment_date,
                 a.policy_version, ds.article_id, ds.domain, ds.reason,
                 ds.relevance_score, ds.selected_at, ds.expires_at,
                 ds.content_hash, ds.model,
                 us.id::text AS user_selection_id, us.state AS user_state,
                 us.version AS user_version,
                 COALESCE(us.pending_confirmation, FALSE) AS user_pending_confirmation
          FROM article_ai_domain_assessments a
          JOIN article_ai_domain_selections ds ON ds.assessment_id = a.id
          LEFT JOIN article_ai_user_selections us
            ON us.user_id = ${userId} AND us.domain = ds.domain AND us.article_id = ds.article_id
          WHERE a.domain = ${domain} AND a.policy_version = ${ARTICLE_AI_WEEKLY_POLICY_VERSION}
            AND a.status = 'ready' AND a.assessment_date = ${exactTargetWeekKey}::date
            AND a.valid_until > ${now}
            AND (${mailEligible} = FALSE OR (
              a.completed_at IS NOT NULL AND a.email_at IS NOT NULL AND a.completed_at <= a.email_at
              AND COALESCE(a.coverage_json->>'status', '') = 'complete'
            ))
            AND ds.domain = ${domain} AND ds.expires_at > ${now}
          ORDER BY ds.relevance_score DESC NULLS LAST, ds.selected_at DESC, ds.article_id ASC
        `
    : hasIds
      ? await esgPrisma.$queryRaw<SharedWithOverlay[]>`
          WITH latest AS (
            SELECT a.id, a.assessment_date, a.policy_version
            FROM article_ai_domain_assessments a
            WHERE a.domain = ${domain} AND a.policy_version = ${ARTICLE_AI_WEEKLY_POLICY_VERSION}
              AND a.status = 'ready' AND a.valid_until > ${now}
            ORDER BY a.assessment_date DESC, a.created_at DESC
            LIMIT 1
          )
          SELECT ds.id::text, ds.assessment_id::text, latest.assessment_date,
                 latest.policy_version, ds.article_id, ds.domain, ds.reason,
                 ds.relevance_score, ds.selected_at, ds.expires_at,
                 ds.content_hash, ds.model,
                 us.id::text AS user_selection_id, us.state AS user_state,
                 us.version AS user_version,
                 COALESCE(us.pending_confirmation, FALSE) AS user_pending_confirmation
          FROM latest
          JOIN article_ai_domain_selections ds ON ds.assessment_id = latest.id
          LEFT JOIN article_ai_user_selections us
            ON us.user_id = ${userId} AND us.domain = ds.domain AND us.article_id = ds.article_id
          WHERE ds.domain = ${domain} AND ds.expires_at > ${now}
            AND ds.article_id = ANY(${ids}::int[])
          ORDER BY ds.relevance_score DESC NULLS LAST, ds.selected_at DESC, ds.article_id ASC
        `
      : await esgPrisma.$queryRaw<SharedWithOverlay[]>`
          WITH latest AS (
            SELECT a.id, a.assessment_date, a.policy_version
            FROM article_ai_domain_assessments a
            WHERE a.domain = ${domain} AND a.policy_version = ${ARTICLE_AI_WEEKLY_POLICY_VERSION}
              AND a.status = 'ready' AND a.valid_until > ${now}
            ORDER BY a.assessment_date DESC, a.created_at DESC
            LIMIT 1
          )
          SELECT ds.id::text, ds.assessment_id::text, latest.assessment_date,
                 latest.policy_version, ds.article_id, ds.domain, ds.reason,
                 ds.relevance_score, ds.selected_at, ds.expires_at,
                 ds.content_hash, ds.model,
                 us.id::text AS user_selection_id, us.state AS user_state,
                 us.version AS user_version,
                 COALESCE(us.pending_confirmation, FALSE) AS user_pending_confirmation
          FROM latest
          JOIN article_ai_domain_selections ds ON ds.assessment_id = latest.id
          LEFT JOIN article_ai_user_selections us
            ON us.user_id = ${userId} AND us.domain = ds.domain AND us.article_id = ds.article_id
          WHERE ds.domain = ${domain} AND ds.expires_at > ${now}
          ORDER BY ds.relevance_score DESC NULLS LAST, ds.selected_at DESC, ds.article_id ASC
        `;
  return rows.map((row) => ({ ...row, domain: normalizeDomain(row.domain) }));
}

export async function getArticleAiSelectionsV2(
  userId: number,
  domain: ArticleAiDomain,
  articleIds: readonly number[],
): Promise<ArticleAiSelection[]> {
  await getActiveUser(userId);
  const safeDomain = normalizeDomain(domain);
  const safeIds = normalizeIds(articleIds);
  if (safeIds.length === 0) return [];
  const sharedRows = await getWeeklySharedSelections(userId, safeDomain, safeIds, new Date());
  const output = new Map<number, ArticleAiSelection>(sharedRows.map((row) => [Number(row.article_id), sharedSelection(row)]));
  const current = await loadCurrentWeeklyArticles(safeDomain, safeIds);
  const hashes = new Map(current.map((article) => [article.id, article.contentHash]));
  return Array.from(output.values()).filter((row) => {
    if (row.pendingConfirmation || row.state === "dismissed" || !row.sharedSelectionId) return true;
    const shared = sharedRows.find((candidate) => candidate.id === row.sharedSelectionId);
    return hashes.get(row.articleId) === shared?.content_hash;
  }).sort((a, b) => a.articleId - b.articleId);
}

export async function recordArticleAiFeedbackV2(
  userId: number,
  domain: ArticleAiDomain,
  articleId: number,
  action: "confirm" | "dismiss",
  expectedVersion: number,
  sharedSelectionId: string,
  expectedTargetWeekKey?: string,
): Promise<ArticleAiFeedbackResult> {
  const safeDomain = normalizeDomain(domain);
  if (!Number.isSafeInteger(articleId) || articleId <= 0) throw new ArticleAiNotFoundError();
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new ArticleAiConflictError();
  await getActiveUser(userId);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[4-9][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sharedSelectionId)) {
    throw new ArticleAiConflictError("Shared selection is missing or invalid; refresh the article");
  }
  if (expectedTargetWeekKey !== undefined && !isArticleAiWeeklyWeekKey(expectedTargetWeekKey)) {
    throw new ArticleAiConflictError("Shared selection week is invalid; refresh the article");
  }
  const key = sharedKey(userId, safeDomain, sharedSelectionId, expectedVersion, action);
  return esgPrisma.$transaction(async (tx) => {
    // Idempotent retries must remain safe after a newer assessment rolls over
    // the current page.  Resolve the original feedback first, without the
    // current-assessment gate, and return the same private overlay state.
    const prior = await tx.$queryRaw<Array<SharedWithOverlay & { feedback_status: string }>>`
      SELECT f.status AS feedback_status,
             ds.id::text, ds.assessment_id::text, a.assessment_date, a.policy_version, ds.article_id,
             ds.domain, ds.reason, ds.relevance_score, ds.selected_at, ds.expires_at,
             ds.content_hash, ds.model,
             us.id::text AS user_selection_id, us.state AS user_state,
             us.version AS user_version,
             COALESCE(us.pending_confirmation, FALSE) AS user_pending_confirmation
      FROM article_ai_domain_feedback f
      JOIN article_ai_domain_selections ds ON ds.id = f.domain_selection_id
      JOIN article_ai_domain_assessments a ON a.id = ds.assessment_id
      JOIN article_ai_user_selections us ON us.id = f.user_selection_id
      WHERE f.idempotency_key = ${key}
        AND f.user_id = ${userId} AND f.domain = ${safeDomain}
        AND f.article_id = ${articleId}
        AND f.domain_selection_id = ${sharedSelectionId}::uuid
        AND f.action = ${action} AND f.expected_version = ${expectedVersion}
        AND ds.domain = ${safeDomain} AND a.domain = ${safeDomain}
        AND (${expectedTargetWeekKey ?? null}::date IS NULL OR a.assessment_date = ${expectedTargetWeekKey ?? null}::date)
      LIMIT 1
      FOR SHARE OF ds, us
    `;
    if (prior[0]) {
      if (prior[0].feedback_status === "error") {
        throw new ArticleAiConflictError("The previous selection decision could not be applied");
      }
      return {
        selection: sharedSelection(prior[0]),
        humanLiked: action === "confirm" && prior[0].feedback_status === "confirmed",
        pending: prior[0].feedback_status === "pending",
      };
    }

    const hash = await articleHash(safeDomain, articleId);
    const exact = await tx.$queryRaw<Array<WeeklySelectionRow>>`
      SELECT ds.id::text, ds.assessment_id::text, a.assessment_date, a.policy_version, ds.article_id,
             ds.domain, ds.reason, ds.relevance_score, ds.selected_at, ds.expires_at,
             ds.content_hash, ds.model
      FROM article_ai_domain_selections ds
      JOIN article_ai_domain_assessments a ON a.id = ds.assessment_id
      WHERE ds.id = ${sharedSelectionId}::uuid AND ds.domain = ${safeDomain}
        AND ds.article_id = ${articleId} AND a.domain = ${safeDomain}
        AND a.policy_version = ${ARTICLE_AI_WEEKLY_POLICY_VERSION}
        AND a.status = 'ready'
        AND a.valid_until > now()
        AND (${expectedTargetWeekKey ?? null}::date IS NULL OR a.assessment_date = ${expectedTargetWeekKey ?? null}::date)
        AND a.assessment_date = (
          SELECT MAX(a2.assessment_date)
          FROM article_ai_domain_assessments a2
          WHERE a2.domain = ${safeDomain}
            AND a2.policy_version = ${ARTICLE_AI_WEEKLY_POLICY_VERSION}
            AND a2.status = 'ready'
        )
        AND ds.expires_at > now()
      FOR UPDATE OF ds
    `;
    const shared = exact[0];
    if (!shared || shared.content_hash !== hash) throw new ArticleAiConflictError("Shared selection changed; refresh the selection");
    const overlays = await tx.$queryRaw<Array<{ id: string; domain_selection_id: string; version: number; state: string; pending_confirmation: boolean }>>`
      SELECT id::text, domain_selection_id::text, version, state, pending_confirmation
      FROM article_ai_user_selections
      WHERE user_id = ${userId} AND domain = ${safeDomain} AND article_id = ${articleId}
      FOR UPDATE
    `;
    const overlay = overlays[0];
    if (overlay && overlay.domain_selection_id !== sharedSelectionId) throw new ArticleAiConflictError("A newer recipient decision exists; refresh the selection");
    if (overlay && (overlay.pending_confirmation || overlay.state === "dismissed" || overlay.state === "confirmed")) throw new ArticleAiConflictError("Selection has already been decided");
    if (Number(overlay?.version ?? 1) !== expectedVersion) throw new ArticleAiConflictError();
    const pending = action === "confirm" && safeDomain === "credit";
    const nextState = action === "dismiss" ? "dismissed" : "confirmed";
    const nextVersion = pending ? expectedVersion : expectedVersion + 1;
    const saved = overlay
      ? (await tx.$queryRaw<Array<{ id: string; version: number; state: string; pending_confirmation: boolean }>>`
          UPDATE article_ai_user_selections
          SET domain_selection_id = ${sharedSelectionId}::uuid, state = ${nextState},
              version = ${nextVersion}, pending_confirmation = ${pending}, updated_at = now()
          WHERE id = ${overlay.id}::uuid AND version = ${expectedVersion}
          RETURNING id::text, version, state, pending_confirmation
        `)[0]
      : (await tx.$queryRaw<Array<{ id: string; version: number; state: string; pending_confirmation: boolean }>>`
          INSERT INTO article_ai_user_selections (
            user_id, domain_selection_id, domain, article_id, state, version, pending_confirmation
          ) VALUES (
            ${userId}, ${sharedSelectionId}::uuid, ${safeDomain}, ${articleId}, ${nextState}, ${nextVersion}, ${pending}
          ) RETURNING id::text, version, state, pending_confirmation
        `)[0];
    if (!saved) throw new ArticleAiConflictError();
    if (action === "confirm" && safeDomain === "esg") {
      await tx.$executeRaw`INSERT INTO likes (user_id, content_type, content_id, created_at) VALUES (${userId}, 'article', ${articleId}, now()) ON CONFLICT (user_id, content_type, content_id) DO NOTHING`;
    }
    await tx.$executeRaw`
      INSERT INTO article_ai_domain_feedback (
        user_id, domain, article_id, domain_selection_id, user_selection_id,
        action, expected_version, status, idempotency_key, applied_at
      ) VALUES (
        ${userId}, ${safeDomain}, ${articleId}, ${sharedSelectionId}::uuid, ${saved.id}::uuid,
        ${action}, ${expectedVersion}, ${pending ? "pending" : action === "dismiss" ? "dismissed" : "confirmed"},
        ${key}, ${pending ? null : new Date()}
      ) ON CONFLICT (idempotency_key) DO NOTHING
    `;
    return {
      selection: sharedSelection({ ...shared, user_selection_id: saved.id, user_state: saved.state, user_version: saved.version, user_pending_confirmation: saved.pending_confirmation }),
      humanLiked: action === "confirm" && safeDomain === "esg",
      pending,
    };
  });
}

export async function getArticleAiDigestPicksV2(
  userId: number,
  domains: readonly ArticleAiDomain[],
  window: { since: Date; until: Date; targetWeekKey?: string },
  now = new Date(),
): Promise<ArticleAiDigestPick[]> {
  const target = window.targetWeekKey;
  // Mail must name its immutable cohort. Never fall back to whichever ready
  // assessment happens to be newest when a caller omits the target key.
  if (!isArticleAiEmailEnabled() || window.until <= window.since || !target || !isArticleAiWeeklyWeekKey(target)) return [];
  const output: ArticleAiDigestPick[] = [];
  for (const domain of Array.from(new Set(domains.map(normalizeDomain)))) {
    const preference = await getArticleAiPreferenceV2(userId, domain);
    if (!preference.enabled || !preference.weeklyDigestConfigured) continue;
    const rows = await getWeeklySharedSelections(userId, domain, undefined, now, target, true);
    const candidates = rows
      .filter((row) => !row.user_pending_confirmation && row.user_state !== "dismissed")
      .slice(0, ARTICLE_AI_MAX_WEEKLY_PICKS * 7);
    const articles = await loadCurrentWeeklyArticles(domain, candidates.map((row) => Number(row.article_id)));
    const byId = new Map(articles.map((article) => [article.id, article]));
    const seenSources = new Set<string>();
    let count = 0;
    for (const row of candidates) {
      if (count >= ARTICLE_AI_MAX_WEEKLY_PICKS) break;
      const article = byId.get(Number(row.article_id));
      if (!article || article.contentHash !== row.content_hash || !article.url) continue;
      const source = (article.source || `id:${article.id}`).toLocaleLowerCase("en-US");
      if (seenSources.has(source) && candidates.length > ARTICLE_AI_MAX_WEEKLY_PICKS) continue;
      seenSources.add(source);
      output.push({
        articleId: article.id, domain, title: article.title || "Untitled article", url: article.url,
        source: article.source || "Unknown source", publishedAt: article.publishedAt?.toISOString() ?? null,
        reason: row.reason.slice(0, 600), contentHash: article.contentHash,
        sharedSelectionId: row.id, assessmentDate: new Date(row.assessment_date).toISOString().slice(0, 10),
        policyVersion: Number(row.policy_version), targetWeekKey: target,
      });
      count += 1;
    }
  }
  return output;
}

export async function filterArticleAiDigestPicksForCommitV2(
  tx: RawQueryClient,
  userId: number,
  picks: readonly ArticleAiDigestPick[],
): Promise<ArticleAiDigestPick[]> {
  if (!isArticleAiEmailEnabled() || picks.length === 0) return [];
  const byDomain = new Map<string, { domain: ArticleAiDomain; targetWeekKey: string; rows: ArticleAiDigestPick[] }>();
  for (const pick of picks) {
    if (!isArticleAiDomain(pick.domain) || Number(pick.policyVersion) !== ARTICLE_AI_WEEKLY_POLICY_VERSION
      || !isArticleAiWeeklyWeekKey(pick.targetWeekKey) || !isArticleAiWeeklyWeekKey(pick.assessmentDate)
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[4-9][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(pick.sharedSelectionId)) continue;
    const key = `${pick.domain}:${pick.targetWeekKey}`;
    const group = byDomain.get(key) ?? { domain: pick.domain, targetWeekKey: pick.targetWeekKey, rows: [] };
    if (group.rows.length < ARTICLE_AI_MAX_WEEKLY_PICKS) group.rows.push(pick);
    byDomain.set(key, group);
  }
  const valid = new Set<string>();
  for (const group of Array.from(byDomain.values())) {
    const { domain, targetWeekKey, rows } = group;
    const ids = normalizeIds(rows.map((pick) => pick.articleId));
    const sharedIds = rows.map((pick) => pick.sharedSelectionId).filter(Boolean);
    if (ids.length === 0 || sharedIds.length === 0) continue;
    // Lock the shared consent rows first. Do not inspect the nullable
    // recipient overlay in this statement: if a feedback transaction is
    // inserting the first overlay, its ds lock may make this query wait while
    // retaining a pre-insert snapshot. The second statement below therefore
    // reads overlays only after these locks have been acquired.
    const locked = await tx.$queryRaw<Array<{ shared_id: string; article_id: number; content_hash: string }>>`
      SELECT ds.id::text AS shared_id, ds.article_id, ds.content_hash
      FROM article_ai_preferences p
      JOIN article_ai_domain_assessments a
        ON a.domain = ${domain} AND a.policy_version = ${ARTICLE_AI_WEEKLY_POLICY_VERSION} AND a.status = 'ready'
       AND a.assessment_date = ${targetWeekKey}::date
       AND a.valid_until > now()
       AND a.completed_at IS NOT NULL AND a.email_at IS NOT NULL AND a.completed_at <= a.email_at
       AND COALESCE(a.coverage_json->>'status', '') = 'complete'
      JOIN article_ai_domain_selections ds ON ds.assessment_id = a.id AND ds.domain = ${domain}
      WHERE p.user_id = ${userId} AND p.domain = ${domain} AND p.enabled = TRUE
        AND ds.id = ANY(${sharedIds}::uuid[]) AND ds.article_id = ANY(${ids}::int[])
        AND ds.expires_at > now()
      FOR SHARE OF p, a, ds
    `;
    if (locked.length === 0) continue;
    const lockedIds = locked.map((row) => row.shared_id);
    const overlays = await tx.$queryRaw<Array<{
      shared_id: string;
      article_id: number;
      content_hash: string;
      user_state: string | null;
      user_pending_confirmation: boolean;
    }>>`
      SELECT ds.id::text AS shared_id, ds.article_id, ds.content_hash,
             us.state AS user_state,
             COALESCE(us.pending_confirmation, FALSE) AS user_pending_confirmation
      FROM article_ai_domain_selections ds
      LEFT JOIN article_ai_user_selections us
        ON us.user_id = ${userId}
       AND us.domain = ds.domain
       AND us.article_id = ds.article_id
      WHERE ds.id = ANY(${lockedIds}::uuid[])
        AND ds.domain = ${domain}
        AND ds.article_id = ANY(${ids}::int[])
        AND COALESCE(us.state, 'selected') <> 'dismissed'
        AND COALESCE(us.pending_confirmation, FALSE) = FALSE
    `;
    for (const row of overlays) valid.add(`${row.shared_id}:${Number(row.article_id)}:${row.content_hash}`);
  }
  return picks.filter((pick) => valid.has(`${pick.sharedSelectionId}:${pick.articleId}:${pick.contentHash}`));
}

export async function reconcileDomainArticleAiFeedbackV2(): Promise<void> {
  const rows = await esgPrisma.$queryRaw<Array<{ id: string; user_id: number; article_id: number; user_selection_id: string; expected_version: number }>>`
    SELECT id::text, user_id, article_id, user_selection_id::text, expected_version
    FROM article_ai_domain_feedback
    WHERE domain = 'credit' AND action = 'confirm' AND status = 'pending'
    ORDER BY created_at ASC LIMIT 50
  `;
  for (const feedback of rows) {
    try {
      await esgPrisma.$transaction(async (tx) => {
        const overlays = await tx.$queryRaw<Array<{ version: number; pending_confirmation: boolean; state: string }>>`
          SELECT version, pending_confirmation, state FROM article_ai_user_selections
          WHERE id = ${feedback.user_selection_id}::uuid AND user_id = ${feedback.user_id} FOR UPDATE
        `;
        const overlay = overlays[0];
        if (!overlay || Number(overlay.version) !== feedback.expected_version || !overlay.pending_confirmation || overlay.state !== "confirmed") {
          await tx.$executeRaw`UPDATE article_ai_domain_feedback SET status = 'error', error = 'Selection version changed during Credit confirmation', applied_at = now() WHERE id = ${feedback.id}::uuid AND status = 'pending'`;
          return;
        }
        const shared = await tx.$queryRaw<Array<{ domain: string; article_id: number; content_hash: string }>>`
          SELECT ds.domain, ds.article_id, ds.content_hash FROM article_ai_domain_selections ds
          JOIN article_ai_domain_feedback f ON f.domain_selection_id = ds.id
          WHERE f.id = ${feedback.id}::uuid
        `;
        if (!shared[0] || shared[0].domain !== "credit" || shared[0].article_id !== feedback.article_id) throw new ArticleAiConflictError();
        await creditPrisma.$executeRaw`INSERT INTO likes (user_id, content_type, content_id, created_at) VALUES (${feedback.user_id}, 'article', ${feedback.article_id}, now()) ON CONFLICT (user_id, content_type, content_id) DO NOTHING`;
        await tx.$executeRaw`UPDATE article_ai_user_selections SET pending_confirmation = FALSE, version = version + 1, updated_at = now() WHERE id = ${feedback.user_selection_id}::uuid AND version = ${feedback.expected_version} AND pending_confirmation = TRUE`;
        await tx.$executeRaw`UPDATE article_ai_domain_feedback SET status = 'confirmed', applied_at = now(), error = NULL WHERE id = ${feedback.id}::uuid AND status = 'pending'`;
      }, { timeout: 15_000, maxWait: 5_000 });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Credit like reconciliation failed";
      await esgPrisma.$executeRaw`UPDATE article_ai_domain_feedback SET error = ${message.slice(0, 2_000)} WHERE id = ${feedback.id}::uuid AND status = 'pending'`;
    }
  }
}
