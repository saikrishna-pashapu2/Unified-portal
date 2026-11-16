import "server-only";

import { esgPrisma } from "@esgcredit/db-esg";
import { creditPrisma } from "@esgcredit/db-credit";

import {
  ARTICLE_AI_MAX_WEEKLY_PICKS,
  isArticleAiDomain,
  type ArticleAiDigestPick,
  type ArticleAiDomain,
  type ArticleAiFeedbackResult,
  type ArticleAiPreference,
  type ArticleAiSelection,
} from "./types";
import { getArticleAiConfig, isArticleAiEmailEnabled } from "./config";
import {
  ArticleAiConflictError,
  ArticleAiNotFoundError,
  ArticleAiUnauthorizedError,
} from "./errors";
import {
  classifyHistory,
  normalizeArticle,
  type ArticleAiArticle,
} from "./policy";

type RawQueryClient = Pick<typeof esgPrisma, "$queryRaw">;

interface UserRow {
  id: number;
  email: string | null;
  team: string | null;
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

interface SelectionRow {
  id?: string;
  article_id: number;
  domain: string;
  state: string;
  reason: string;
  relevance_score?: number | null;
  version: number;
  selected_at: Date;
  expires_at: Date;
  content_hash?: string;
  pending_confirmation: boolean;
}

interface ArticleRow {
  id: number;
  title: string | null;
  summary: string | null;
  content: string | null;
  source: string | null;
  url: string | null;
  published_at: Date | null;
}

function normalizeDomain(value: unknown): ArticleAiDomain {
  if (isArticleAiDomain(value)) return value;
  throw new Error("Unsupported article AI domain");
}

function normalizeArticleIds(articleIds: readonly number[]): number[] {
  return Array.from(new Set(articleIds.filter((id) => Number.isSafeInteger(id) && id > 0))).slice(0, 100);
}

function normalizedEmail(value: string | null | undefined): string {
  return (value ?? "").trim().toLocaleLowerCase("en-US");
}

async function getActiveUser(userId: number): Promise<UserRow> {
  const rows = await esgPrisma.$queryRaw<UserRow[]>`
    SELECT id, email, team, email_notifications, is_active_db
    FROM users
    WHERE id = ${userId}
    LIMIT 1
  `;
  const user = rows[0];
  if (!user || !user.is_active_db) throw new ArticleAiUnauthorizedError();
  return user;
}

async function weeklyDigestConfigured(userId: number, domain: ArticleAiDomain, user?: UserRow): Promise<boolean> {
  const currentUser = user ?? await getActiveUser(userId);
  if (currentUser.email_notifications === false) return false;
  const accountEmail = normalizedEmail(currentUser.email);
  if (!accountEmail) return false;
  const rows = await esgPrisma.$queryRaw<Array<{ configured: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM alert_preferences ap
      WHERE ap.user_id = ${userId}
        AND COALESCE(ap.is_active, TRUE) = TRUE
        AND COALESCE(ap.email_enabled, TRUE) = TRUE
        AND COALESCE(ap.alert_articles, TRUE) = TRUE
        AND COALESCE(ap.alert_type, 'weekly_digest') = 'weekly_digest'
        AND (
          (COALESCE(cardinality(ap.domains), 0) > 0
            AND ${domain} = ANY(ap.domains))
          OR (COALESCE(cardinality(ap.domains), 0) = 0
            AND lower(trim(ap.domain)) = ${domain})
        )
        AND (
          NULLIF(trim(ap.email_address), '') IS NULL
          OR lower(trim(ap.email_address)) = ${accountEmail}
        )
    ) AS configured
  `;
  return Boolean(rows[0]?.configured);
}

async function humanLikeCount(userId: number, domain: ArticleAiDomain): Promise<number> {
  if (domain === "esg") {
    const rows = await esgPrisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count
      FROM likes
      WHERE user_id = ${userId} AND content_type = 'article'
    `;
    return Number(rows[0]?.count ?? 0);
  }
  const rows = await creditPrisma.$queryRaw<Array<{ count: number }>>`
    SELECT COUNT(*)::int AS count
    FROM likes
    WHERE user_id = ${userId} AND content_type = 'article'
  `;
  return Number(rows[0]?.count ?? 0);
}

async function teamUserIds(team: string | null): Promise<number[]> {
  if (!team?.trim()) return [];
  const rows = await esgPrisma.$queryRaw<Array<{ id: number }>>`
    SELECT id FROM users WHERE is_active_db = TRUE AND team = ${team.trim()}
  `;
  return rows.map((row) => Number(row.id)).filter((id) => Number.isSafeInteger(id));
}

async function teamHumanLikeCount(user: UserRow, domain: ArticleAiDomain): Promise<number> {
  const ids = await teamUserIds(user.team);
  if (ids.length === 0) return 0;
  const database = domain === "esg" ? esgPrisma : creditPrisma;
  const rows = await database.$queryRaw<Array<{ count: number }>>`
    SELECT COUNT(DISTINCT content_id)::int AS count
    FROM likes
    WHERE user_id = ANY(${ids}::int[]) AND content_type = 'article'
  `;
  return Number(rows[0]?.count ?? 0);
}

async function articleRows(domain: ArticleAiDomain, ids?: readonly number[], limit = 200): Promise<ArticleRow[]> {
  const safeIds = ids ? normalizeArticleIds(ids) : [];
  if (domain === "esg") {
    if (safeIds.length > 0) {
      return esgPrisma.$queryRaw<ArticleRow[]>`
        SELECT id, title, summary, NULL::text AS content, source,
               link AS url, published AS published_at
        FROM esg_articles
        WHERE id = ANY(${safeIds}::int[])
      `;
    }
    return esgPrisma.$queryRaw<ArticleRow[]>`
      SELECT id, title, summary, NULL::text AS content, source,
             link AS url, published AS published_at
      FROM esg_articles
      WHERE (published >= now() - INTERVAL '14 days' AND published <= now())
         OR (published IS NULL AND save_time >= now() - INTERVAL '14 days' AND save_time <= now())
      ORDER BY COALESCE(published, save_time) DESC NULLS LAST, id DESC
      LIMIT ${Math.max(1, Math.min(limit, 500))}
    `;
  }
  if (safeIds.length > 0) {
    return creditPrisma.$queryRaw<ArticleRow[]>`
      SELECT id, title, summary, content, source,
             COALESCE(url, link) AS url, date AS published_at
      FROM credit_articles
      WHERE id = ANY(${safeIds}::int[])
    `;
  }
  return creditPrisma.$queryRaw<ArticleRow[]>`
    SELECT id, title, summary, content, source,
           COALESCE(url, link) AS url, date AS published_at
    FROM credit_articles
    WHERE (date >= CURRENT_DATE - INTERVAL '14 days' AND date <= CURRENT_DATE)
       OR (date IS NULL AND updated_at >= now() - INTERVAL '14 days' AND updated_at <= now())
    ORDER BY date DESC NULLS LAST, id DESC
    LIMIT ${Math.max(1, Math.min(limit, 500))}
  `;
}

function toAiArticle(row: ArticleRow): ArticleAiArticle {
  return {
    id: Number(row.id),
    title: row.title,
    summary: row.summary,
    content: row.content,
    source: row.source,
    url: row.url,
    publishedAt: row.published_at ? new Date(row.published_at) : null,
  };
}

function mapPreference(row: PreferenceRow, configured: boolean): ArticleAiPreference {
  const config = getArticleAiConfig();
  const profileSource = row.profile_source === "personal" || row.profile_source === "team"
    ? row.profile_source
    : "insufficient";
  const status = row.status === "queued" || row.status === "ready" || row.status === "insufficient_history" || row.status === "error" || row.status === "preview"
    ? row.status
    : "off";
  return {
    domain: normalizeDomain(row.domain),
    enabled: Boolean(row.enabled),
    settingsVersion: Number(row.settings_version),
    historyCount: Number(row.history_count),
    profileSource,
    weeklyDigestConfigured: configured,
    status: row.enabled ? status : "off",
    lastRunAt: row.last_run_at ? new Date(row.last_run_at).toISOString() : null,
    emailInclusionEnabled: config.enabled && config.emailEnabled,
  };
}

async function derivedHistory(user: UserRow, domain: ArticleAiDomain): Promise<{ count: number; source: "personal" | "team" | "insufficient" }> {
  const personal = await humanLikeCount(user.id, domain);
  const team = await teamHumanLikeCount(user, domain);
  return classifyHistory(personal, team);
}

export async function getArticleAiPreference(
  userId: number,
  domain: ArticleAiDomain,
): Promise<ArticleAiPreference> {
  const safeDomain = normalizeDomain(domain);
  const user = await getActiveUser(userId);
  const [rows, history, configured] = await Promise.all([
    esgPrisma.$queryRaw<PreferenceRow[]>`
      SELECT domain, enabled, settings_version, status, history_count,
             profile_source, last_run_at
      FROM article_ai_preferences
      WHERE user_id = ${userId} AND domain = ${safeDomain}
      LIMIT 1
    `,
    derivedHistory(user, safeDomain),
    weeklyDigestConfigured(userId, safeDomain, user),
  ]);
  const row = rows[0];
  if (!row) {
    return mapPreference({
      domain: safeDomain,
      enabled: false,
      settings_version: 0,
      status: "off",
      history_count: history.count,
      profile_source: history.source,
      last_run_at: null,
    }, configured);
  }
  return mapPreference({
    ...row,
    history_count: row.history_count || history.count,
    profile_source: row.profile_source || history.source,
  }, configured);
}

export async function setArticleAiPreference(
  userId: number,
  domain: ArticleAiDomain,
  enabled: boolean,
): Promise<ArticleAiPreference> {
  const safeDomain = normalizeDomain(domain);
  const user = await getActiveUser(userId);
  const history = await derivedHistory(user, safeDomain);
  const rows = await esgPrisma.$queryRaw<PreferenceRow[]>`
    INSERT INTO article_ai_preferences (
      user_id, domain, enabled, settings_version, status,
      history_count, profile_source, last_error, updated_at
    ) VALUES (
      ${userId}, ${safeDomain}, ${enabled}, 1,
      CASE WHEN ${enabled} THEN 'queued' ELSE 'off' END,
      ${history.count}, ${history.source}, NULL, now()
    )
    ON CONFLICT (user_id, domain) DO UPDATE SET
      enabled = EXCLUDED.enabled,
      settings_version = CASE
        WHEN article_ai_preferences.enabled = EXCLUDED.enabled
          THEN article_ai_preferences.settings_version
        ELSE article_ai_preferences.settings_version + 1
      END,
      status = CASE
        WHEN article_ai_preferences.enabled = EXCLUDED.enabled
          THEN article_ai_preferences.status
        ELSE CASE WHEN EXCLUDED.enabled THEN 'queued' ELSE 'off' END
      END,
      history_count = EXCLUDED.history_count,
      profile_source = EXCLUDED.profile_source,
      last_error = NULL,
      updated_at = now()
    RETURNING domain, enabled, settings_version, status, history_count,
              profile_source, last_run_at
  `;
  const configured = await weeklyDigestConfigured(userId, safeDomain, user);
  const row = rows[0];
  if (!row) throw new Error("Unable to persist article AI preference");
  return mapPreference(row, configured);
}

function mapSelection(row: SelectionRow): ArticleAiSelection {
  const domain = normalizeDomain(row.domain);
  const state = row.state === "confirmed" || row.state === "dismissed" ? row.state : "selected";
  return {
    articleId: Number(row.article_id),
    domain,
    state,
    reason: String(row.reason).slice(0, 600),
    version: Number(row.version),
    selectedAt: new Date(row.selected_at).toISOString(),
    expiresAt: new Date(row.expires_at).toISOString(),
    pendingConfirmation: Boolean(row.pending_confirmation),
  };
}

export async function getArticleAiSelections(
  userId: number,
  domain: ArticleAiDomain,
  articleIds: readonly number[],
): Promise<ArticleAiSelection[]> {
  await getActiveUser(userId);
  const safeDomain = normalizeDomain(domain);
  const safeIds = normalizeArticleIds(articleIds);
  if (safeIds.length === 0) return [];
  const rows = await esgPrisma.$queryRaw<SelectionRow[]>`
    SELECT article_id, domain, state, reason, version, content_hash,
           selected_at, expires_at, pending_confirmation
    FROM article_ai_selections
    WHERE user_id = ${userId}
      AND domain = ${safeDomain}
      AND article_id = ANY(${safeIds}::int[])
      AND (expires_at > now() OR state IN ('dismissed', 'confirmed'))
    ORDER BY article_id
  `;
  if (rows.length === 0) return [];
  const articles = await articleRows(safeDomain, rows.map((row) => row.article_id));
  const currentHashes = new Map(
    articles.map((article) => [Number(article.id), normalizeArticle(toAiArticle(article)).contentHash]),
  );
  return rows
    .filter((row) => row.state === "dismissed" || currentHashes.get(Number(row.article_id)) === row.content_hash)
    .map(mapSelection);
}

function feedbackKey(userId: number, domain: ArticleAiDomain, articleId: number, version: number, action: "confirm" | "dismiss"): string {
  return `article-ai:${userId}:${domain}:${articleId}:${version}:${action}`;
}

export async function recordArticleAiFeedback(
  userId: number,
  domain: ArticleAiDomain,
  articleId: number,
  action: "confirm" | "dismiss",
  expectedVersion: number,
): Promise<ArticleAiFeedbackResult> {
  const safeDomain = normalizeDomain(domain);
  if (!Number.isSafeInteger(articleId) || articleId <= 0) throw new ArticleAiNotFoundError();
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new ArticleAiConflictError();
  await getActiveUser(userId);
  const currentArticleRows = await articleRows(safeDomain, [articleId]);
  const currentArticle = currentArticleRows.find((row) => Number(row.id) === articleId);
  if (!currentArticle) throw new ArticleAiNotFoundError();
  const currentContentHash = normalizeArticle(toAiArticle(currentArticle)).contentHash;
  const key = feedbackKey(userId, safeDomain, articleId, expectedVersion, action);

  return esgPrisma.$transaction(async (tx) => {
    const priorRows = await tx.$queryRaw<Array<{ status: string }>>`
      SELECT status
      FROM article_ai_feedback
      WHERE idempotency_key = ${key}
      LIMIT 1
    `;
    if (priorRows[0]) {
      const currentRows = await tx.$queryRaw<SelectionRow[]>`
        SELECT id, article_id, domain, state, reason, version,
               selected_at, expires_at, content_hash, pending_confirmation
        FROM article_ai_selections
        WHERE user_id = ${userId} AND domain = ${safeDomain} AND article_id = ${articleId}
        LIMIT 1
      `;
      const current = currentRows[0];
      if (!current) throw new ArticleAiNotFoundError();
      return {
        selection: mapSelection(current),
        humanLiked: action === "confirm" && priorRows[0].status === "confirmed",
        pending: priorRows[0].status === "pending",
      };
    }
    const selectionRows = await tx.$queryRaw<SelectionRow[]>`
      SELECT id, article_id, domain, state, reason, version,
             selected_at, expires_at, content_hash, pending_confirmation
      FROM article_ai_selections
      WHERE user_id = ${userId} AND domain = ${safeDomain} AND article_id = ${articleId}
      FOR UPDATE
    `;
    const selection = selectionRows[0];
    if (!selection) throw new ArticleAiNotFoundError();
    if (Number(selection.version) !== expectedVersion || selection.pending_confirmation) {
      throw new ArticleAiConflictError();
    }
    if (selection.state === "dismissed") throw new ArticleAiConflictError("Dismissed selections cannot be reactivated");
    if (selection.content_hash && selection.content_hash !== currentContentHash) {
      throw new ArticleAiConflictError("Article changed; refresh the selection");
    }
    if (new Date(selection.expires_at).getTime() <= Date.now() && selection.state === "selected") {
      throw new ArticleAiConflictError("Selection expired; refresh for a new pick");
    }

    if (action === "dismiss") {
      await tx.$executeRaw`
        UPDATE article_ai_selections
        SET state = 'dismissed', version = version + 1, updated_at = now()
        WHERE id = ${selection.id}::uuid AND version = ${expectedVersion}
      `;
      await tx.$executeRaw`
        INSERT INTO article_ai_feedback (
          user_id, domain, article_id, selection_id, action, expected_version,
          status, idempotency_key, applied_at
        ) VALUES (
          ${userId}, ${safeDomain}, ${articleId}, ${selection.id}::uuid,
          'dismiss', ${expectedVersion}, 'dismissed', ${key}, now()
        )
        ON CONFLICT (idempotency_key) DO NOTHING
      `;
      return {
        selection: mapSelection({ ...selection, state: "dismissed", version: expectedVersion + 1 }),
        humanLiked: false,
        pending: false,
      };
    }

    if (safeDomain === "esg") {
      // Do not refresh a pre-existing human like's timestamp on a retry.
      await tx.$executeRaw`
        INSERT INTO likes (user_id, content_type, content_id, created_at)
        VALUES (${userId}, 'article', ${articleId}, now())
        ON CONFLICT (user_id, content_type, content_id) DO NOTHING
      `;
      await tx.$executeRaw`
        UPDATE article_ai_selections
        SET state = 'confirmed', pending_confirmation = FALSE,
            version = version + 1, updated_at = now()
        WHERE id = ${selection.id}::uuid AND version = ${expectedVersion}
      `;
      await tx.$executeRaw`
        INSERT INTO article_ai_feedback (
          user_id, domain, article_id, selection_id, action, expected_version,
          status, idempotency_key, applied_at
        ) VALUES (
          ${userId}, ${safeDomain}, ${articleId}, ${selection.id}::uuid,
          'confirm', ${expectedVersion}, 'confirmed', ${key}, now()
        )
        ON CONFLICT (idempotency_key) DO NOTHING
      `;
      return {
        selection: mapSelection({ ...selection, state: "confirmed", version: expectedVersion + 1, pending_confirmation: false }),
        humanLiked: true,
        pending: false,
      };
    }

    // Credit's content DB is separate. Keep an ESG outbox row and a visible
    // pending fence; the worker reconciler inserts the Credit like idempotently.
    await tx.$executeRaw`
      UPDATE article_ai_selections
      SET pending_confirmation = TRUE, updated_at = now()
      WHERE id = ${selection.id}::uuid AND version = ${expectedVersion}
    `;
    await tx.$executeRaw`
      INSERT INTO article_ai_feedback (
        user_id, domain, article_id, selection_id, action, expected_version,
        status, idempotency_key
      ) VALUES (
        ${userId}, ${safeDomain}, ${articleId}, ${selection.id}::uuid,
        'confirm', ${expectedVersion}, 'pending', ${key}
      )
      ON CONFLICT (idempotency_key) DO NOTHING
    `;
    return {
      selection: mapSelection({ ...selection, pending_confirmation: true }),
      humanLiked: false,
      pending: true,
    };
  });
}

export async function getArticleAiDigestPicks(
  userId: number,
  domains: readonly ArticleAiDomain[],
  window: { since: Date; until: Date },
  now = new Date(),
): Promise<ArticleAiDigestPick[]> {
  if (!isArticleAiEmailEnabled() || window.until <= window.since) return [];
  const output: ArticleAiDigestPick[] = [];
  for (const domain of Array.from(new Set(domains.map(normalizeDomain)))) {
    const preference = await getArticleAiPreference(userId, domain);
    if (!preference.enabled || !preference.weeklyDigestConfigured) continue;
    const selections = await esgPrisma.$queryRaw<SelectionRow[]>`
      SELECT article_id, domain, state, reason, relevance_score, version,
             selected_at, expires_at, content_hash, pending_confirmation
      FROM article_ai_selections
      WHERE user_id = ${userId}
        AND domain = ${domain}
        AND state IN ('selected', 'confirmed')
        AND pending_confirmation = FALSE
        AND selected_at >= ${window.since}
        AND selected_at < ${window.until}
        AND expires_at > ${now}
      ORDER BY relevance_score DESC NULLS LAST, selected_at DESC, article_id ASC
      LIMIT ${ARTICLE_AI_MAX_WEEKLY_PICKS * 7}
    `;
    if (!selections.length) continue;
    const articles = await articleRows(domain, selections.map((selection) => selection.article_id));
    const byId = new Map(articles.map((article) => [Number(article.id), normalizeArticle(toAiArticle(article))]));
    const seenSources = new Set<string>();
    let count = 0;
    for (const selection of selections) {
      if (count >= ARTICLE_AI_MAX_WEEKLY_PICKS) break;
      const article = byId.get(Number(selection.article_id));
      if (!article || !article.url || article.contentHash !== selection.content_hash) continue;
      const sourceKey = (article.source || `id:${article.id}`).toLocaleLowerCase("en-US");
      if (seenSources.has(sourceKey) && selections.length > ARTICLE_AI_MAX_WEEKLY_PICKS) continue;
      seenSources.add(sourceKey);
      output.push({
        articleId: article.id,
        domain,
        title: article.title || "Untitled article",
        url: article.url,
        source: article.source || "Unknown source",
        publishedAt: article.publishedAt?.toISOString() ?? null,
        reason: selection.reason.slice(0, 600),
        contentHash: article.contentHash,
      });
      count += 1;
    }
  }
  return output;
}

/**
 * Re-check picks while the caller is inside the email enqueue transaction.
 * Share locks make a concurrent preference disable or dismissal wait until
 * after this assembly transaction, so queued HTML cannot contain newly-invalid
 * private picks. The caller remains responsible for locking the owning alert
 * and checking its single-recipient policy.
 */
export async function filterArticleAiDigestPicksForCommit(
  tx: RawQueryClient,
  userId: number,
  picks: readonly ArticleAiDigestPick[],
): Promise<ArticleAiDigestPick[]> {
  if (!isArticleAiEmailEnabled() || picks.length === 0) return [];
  const byDomain = new Map<ArticleAiDomain, ArticleAiDigestPick[]>();
  for (const pick of picks) {
    if (!isArticleAiDomain(pick.domain)) continue;
    const list = byDomain.get(pick.domain) ?? [];
    if (list.length < ARTICLE_AI_MAX_WEEKLY_PICKS) list.push(pick);
    byDomain.set(pick.domain, list);
  }
  const valid = new Set<string>();
  for (const [domain, list] of Array.from(byDomain.entries())) {
    const ids = normalizeArticleIds(list.map((pick) => pick.articleId));
    if (ids.length === 0) continue;
    const rows = await tx.$queryRaw<Array<{ article_id: number; content_hash: string }>>`
      SELECT s.article_id, s.content_hash
      FROM article_ai_preferences p
      JOIN article_ai_selections s
        ON s.user_id = p.user_id AND s.domain = p.domain
      WHERE p.user_id = ${userId}
        AND p.domain = ${domain}
        AND p.enabled = TRUE
        AND s.article_id = ANY(${ids}::int[])
        AND s.state IN ('selected', 'confirmed')
        AND s.pending_confirmation = FALSE
        AND s.expires_at > now()
      FOR SHARE OF p, s
    `;
    for (const row of rows) valid.add(`${domain}:${Number(row.article_id)}:${row.content_hash}`);
  }
  return picks.filter((pick) => valid.has(`${pick.domain}:${pick.articleId}:${pick.contentHash}`));
}
