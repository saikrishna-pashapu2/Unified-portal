import "server-only";

import { randomUUID } from "node:crypto";

import { esgPrisma } from "@esgcredit/db-esg";
import { creditPrisma } from "@esgcredit/db-credit";

import {
  enqueueBackgroundJob,
  throwIfJobCancelled,
  type BackgroundJobType,
  type ClaimedBackgroundJob,
} from "@/lib/jobs/queue";
import { getArticleAiConfig, isArticleAiEnabled } from "./config";
import { ArticleAiProviderError } from "./errors";
import {
  buildProfile,
  classifyHistory,
  normalizeArticle,
  rankCandidates,
  ARTICLE_AI_TEAM_HISTORY_MINIMUM,
  type NormalizedArticle,
} from "./policy";
import { buildArticleAiProviderRequest, requestArticleAiDecisions } from "./provider";
import {
  ARTICLE_AI_PERSONAL_HISTORY_MINIMUM,
  type ArticleAiDomain,
  type ArticleAiJobPayload,
} from "./types";

const ESG_JOB = "article_ai_esg_v1" as BackgroundJobType;
const CREDIT_JOB = "article_ai_credit_v1" as BackgroundJobType;

interface PreferenceJobRow {
  user_id: number;
  domain: ArticleAiDomain;
  settings_version: number;
}

interface UserJobRow {
  id: number;
  team: string | null;
  is_active_db: boolean;
  email_notifications: boolean | null;
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

interface RunRow {
  status: string;
  settings_version: number;
}

interface PendingFeedbackRow {
  id: string;
  user_id: number;
  article_id: number;
  selection_id: string;
  expected_version: number;
}

function isDomain(value: unknown): value is ArticleAiDomain {
  return value === "esg" || value === "credit";
}

function utcDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function parsePayload(job: ClaimedBackgroundJob): ArticleAiJobPayload {
  const payload = job.payload as Record<string, unknown>;
  const domain = payload.domain;
  const settingsVersion = Number(payload.settingsVersion);
  const runDate = typeof payload.runDate === "string" ? payload.runDate : "";
  if (!isDomain(domain) || !Number.isSafeInteger(settingsVersion) || settingsVersion < 1 || !/^\d{4}-\d{2}-\d{2}$/.test(runDate)) {
    throw new Error("Invalid article AI job payload");
  }
  return { domain, settingsVersion, runDate };
}

function articleQuery(domain: ArticleAiDomain) {
  return domain === "esg" ? esgPrisma : creditPrisma;
}

async function getUser(userId: number): Promise<UserJobRow | null> {
  const rows = await esgPrisma.$queryRaw<UserJobRow[]>`
    SELECT id, team, is_active_db, email_notifications
    FROM users WHERE id = ${userId} LIMIT 1
  `;
  return rows[0] ?? null;
}

async function teamIds(team: string | null): Promise<number[]> {
  if (!team?.trim()) return [];
  const rows = await esgPrisma.$queryRaw<Array<{ id: number }>>`
    SELECT id FROM users
    WHERE team = ${team.trim()} AND is_active_db = TRUE
    ORDER BY id ASC
    LIMIT 1000
  `;
  return rows.map((row) => Number(row.id));
}

async function humanLikeArticleIds(userId: number, domain: ArticleAiDomain, user: UserJobRow, maxHistoryExamples: number): Promise<{ ids: number[]; count: number; source: "personal" | "team" | "insufficient" }> {
  const database = articleQuery(domain);
  const personalCountRows = await database.$queryRaw<Array<{ count: number }>>`
    SELECT COUNT(*)::int AS count FROM likes
    WHERE user_id = ${userId} AND content_type = 'article'
  `;
  const personalCount = Number(personalCountRows[0]?.count ?? 0);
  const personalRows = await database.$queryRaw<Array<{ content_id: number }>>`
    SELECT content_id
    FROM likes
    WHERE user_id = ${userId} AND content_type = 'article'
    GROUP BY content_id
    ORDER BY MAX(created_at) DESC NULLS LAST, content_id DESC
    LIMIT ${Math.max(1, Math.min(maxHistoryExamples, 200))}
  `;
  const personalIds = personalRows.map((row) => Number(row.content_id)).filter((id) => Number.isSafeInteger(id));
  if (personalCount >= 20) return { ids: personalIds, count: personalCount, source: "personal" };
  const ids = await teamIds(user.team);
  if (ids.length === 0) return { ids: personalIds, count: personalCount, source: "insufficient" };
  const teamCountRows = await database.$queryRaw<Array<{ count: number }>>`
    SELECT COUNT(DISTINCT content_id)::int AS count FROM likes
    WHERE user_id = ANY(${ids}::int[]) AND content_type = 'article'
  `;
  const teamCount = Number(teamCountRows[0]?.count ?? 0);
  const teamRows = await database.$queryRaw<Array<{ content_id: number }>>`
    SELECT content_id
    FROM likes
    WHERE user_id = ANY(${ids}::int[]) AND content_type = 'article'
    GROUP BY content_id
    ORDER BY MAX(created_at) DESC NULLS LAST, content_id DESC
    LIMIT ${Math.max(1, Math.min(maxHistoryExamples, 200))}
  `;
  const teamArticleIds = Array.from(new Set(teamRows.map((row) => Number(row.content_id)).filter((id) => Number.isSafeInteger(id))));
  if (teamArticleIds.length === 0) return { ids: personalIds, count: personalCount, source: "insufficient" };
  const classified = classifyHistory(personalCount, teamCount);
  return { ids: teamArticleIds, count: classified.count, source: classified.source };
}

async function loadArticles(domain: ArticleAiDomain, ids?: readonly number[], limit = 200): Promise<NormalizedArticle[]> {
  const database = articleQuery(domain);
  const safeIds = ids ? Array.from(new Set(ids.filter((id) => Number.isSafeInteger(id) && id > 0))).slice(0, 300) : [];
  let rows: ArticleRow[];
  if (domain === "esg") {
    rows = safeIds.length > 0
      ? await database.$queryRaw<ArticleRow[]>`
          SELECT id, title, summary, NULL::text AS content, source,
                 link AS url, published AS published_at
          FROM esg_articles WHERE id = ANY(${safeIds}::int[])
        `
      : await database.$queryRaw<ArticleRow[]>`
          SELECT id, title, summary, NULL::text AS content, source,
                 link AS url, published AS published_at
          FROM esg_articles
          WHERE (published >= now() - INTERVAL '14 days' AND published <= now())
             OR (published IS NULL AND save_time >= now() - INTERVAL '14 days' AND save_time <= now())
          ORDER BY COALESCE(published, save_time) DESC NULLS LAST, id DESC
          LIMIT ${Math.max(1, Math.min(limit, 500))}
        `;
  } else {
    rows = safeIds.length > 0
      ? await database.$queryRaw<ArticleRow[]>`
          SELECT id, title, summary, content, source,
                 COALESCE(url, link) AS url, date AS published_at
          FROM credit_articles WHERE id = ANY(${safeIds}::int[])
        `
      : await database.$queryRaw<ArticleRow[]>`
          SELECT id, title, summary, content, source,
                 COALESCE(url, link) AS url, date AS published_at
          FROM credit_articles
          WHERE (date >= CURRENT_DATE - INTERVAL '14 days' AND date <= CURRENT_DATE)
             OR (date IS NULL AND COALESCE(created_at, updated_at) >= now() - INTERVAL '14 days'
                 AND COALESCE(created_at, updated_at) <= now())
          ORDER BY date DESC NULLS LAST, id DESC
          LIMIT ${Math.max(1, Math.min(limit, 500))}
        `;
  }
  return rows.map((row) => normalizeArticle({
    id: Number(row.id),
    title: row.title,
    summary: row.summary,
    content: row.content,
    source: row.source,
    url: row.url,
    publishedAt: row.published_at ? new Date(row.published_at) : null,
  }));
}

export async function queueDueArticleAiJobs(now = new Date()): Promise<number> {
  if (!isArticleAiEnabled()) return 0;
  const runDate = utcDate(now);
  const rows = await esgPrisma.$queryRaw<PreferenceJobRow[]>`
    SELECT p.user_id, p.domain, p.settings_version
    FROM article_ai_preferences p
    JOIN users u ON u.id = p.user_id
    WHERE p.enabled = TRUE
      AND u.is_active_db = TRUE
      AND COALESCE(u.email_notifications, TRUE) = TRUE
    ORDER BY p.user_id ASC, p.domain ASC
    LIMIT 2000
  `;
  let queued = 0;
  for (const row of rows) {
    const domain = row.domain;
    const jobType = domain === "esg" ? ESG_JOB : CREDIT_JOB;
    await enqueueBackgroundJob({
      id: randomUUID(),
      jobType,
      userId: Number(row.user_id),
      payload: {
        domain,
        settingsVersion: Number(row.settings_version),
        runDate,
      } satisfies ArticleAiJobPayload,
      maxAttempts: 2,
      idempotencyKey: `article-ai:${domain}:${Number(row.user_id)}:${runDate}:${Number(row.settings_version)}`,
    });
    queued += 1;
  }
  return queued;
}

async function getRun(userId: number, domain: ArticleAiDomain, runDate: string): Promise<RunRow | null> {
  const rows = await esgPrisma.$queryRaw<RunRow[]>`
    SELECT status, settings_version
    FROM article_ai_runs
    WHERE user_id = ${userId} AND domain = ${domain} AND run_date = ${runDate}::date
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function finishStaleRun(userId: number, payload: ArticleAiJobPayload): Promise<void> {
  await esgPrisma.$executeRaw`
    UPDATE article_ai_runs
    SET status = 'cancelled', error = 'Article AI settings changed', completed_at = now()
    WHERE user_id = ${userId} AND domain = ${payload.domain}
      AND run_date = ${payload.runDate}::date AND settings_version = ${payload.settingsVersion}
  `;
}

async function reserveBudget(userId: number, domain: ArticleAiDomain, runDate: string, estimate: number): Promise<boolean> {
  const config = getArticleAiConfig();
  const rows = await esgPrisma.$queryRaw<Array<{ user_id: number }>>`
    INSERT INTO article_ai_budgets (
      user_id, domain, budget_date, request_limit, token_limit, updated_at
    ) VALUES (
      ${userId}, ${domain}, ${runDate}::date, ${config.dailyRequestLimit}, ${config.dailyTokenLimit}, now()
    )
    ON CONFLICT (user_id, domain, budget_date) DO UPDATE SET
      request_limit = EXCLUDED.request_limit,
      token_limit = EXCLUDED.token_limit,
      updated_at = now()
    RETURNING user_id
  `;
  if (!rows.length) return false;
  const reserved = await esgPrisma.$queryRaw<Array<{ user_id: number }>>`
    UPDATE article_ai_budgets
    SET requests_reserved = requests_reserved + 1,
        tokens_reserved = tokens_reserved + ${Math.max(1, estimate)},
        updated_at = now()
    WHERE user_id = ${userId}
      AND domain = ${domain}
      AND budget_date = ${runDate}::date
      AND requests_reserved + 1 <= request_limit
      AND tokens_reserved + ${Math.max(1, estimate)} <= token_limit
    RETURNING user_id
  `;
  return reserved.length > 0;
}

async function persistFeatures(domain: ArticleAiDomain, articles: readonly NormalizedArticle[], model: string): Promise<void> {
  const database = esgPrisma;
  for (const article of articles) {
    await database.$executeRaw`
      INSERT INTO article_ai_article_features (
        domain, article_id, content_hash, normalized_text, feature_json, model, created_at, updated_at
      ) VALUES (
        ${domain}, ${article.id}, ${article.contentHash}, ${article.normalizedText},
        ${JSON.stringify({ tokens: article.tokens.slice(0, 120) })}::jsonb,
        ${model}, now(), now()
      )
      ON CONFLICT (domain, article_id, content_hash) DO UPDATE SET
        normalized_text = EXCLUDED.normalized_text,
        feature_json = EXCLUDED.feature_json,
        model = EXCLUDED.model,
        updated_at = now()
    `;
  }
}

export async function runArticleAiJob(job: ClaimedBackgroundJob): Promise<{ result: unknown }> {
  if (!isArticleAiEnabled()) return { result: { status: "disabled" } };
  const payload = parsePayload(job);
  // Credit work can remain unclaimed during an outage. Never spend today's
  // provider allowance against an old (or future) payload's budget date.
  if (payload.runDate !== utcDate(new Date())) {
    return { result: { status: "expired_run", domain: payload.domain, runDate: payload.runDate } };
  }
  const config = getArticleAiConfig();
  await throwIfJobCancelled(job.id, job.leaseOwner);

  const preferenceRows = await esgPrisma.$queryRaw<Array<{ enabled: boolean; settings_version: number }>>`
    SELECT enabled, settings_version
    FROM article_ai_preferences
    WHERE user_id = ${job.userId} AND domain = ${payload.domain}
    LIMIT 1
  `;
  const preference = preferenceRows[0];
  if (!preference?.enabled || Number(preference.settings_version) !== payload.settingsVersion) {
    return { result: { status: "stale_settings", domain: payload.domain } };
  }
  const prior = await getRun(job.userId, payload.domain, payload.runDate);
  if (prior?.status === "done" && Number(prior.settings_version) === payload.settingsVersion) {
    return { result: { status: "already_done", domain: payload.domain, runDate: payload.runDate } };
  }

  await esgPrisma.$executeRaw`
    INSERT INTO article_ai_runs (
      user_id, domain, run_date, settings_version, status, model, started_at
    ) VALUES (
      ${job.userId}, ${payload.domain}, ${payload.runDate}::date,
      ${payload.settingsVersion}, 'running', ${config.model}, now()
    )
    ON CONFLICT (user_id, domain, run_date) DO UPDATE SET
      settings_version = EXCLUDED.settings_version,
      status = 'running', model = EXCLUDED.model,
      error = NULL, started_at = now(), completed_at = NULL
    WHERE article_ai_runs.settings_version <= EXCLUDED.settings_version
  `;

  try {
    const user = await getUser(job.userId);
    if (!user || !user.is_active_db || user.email_notifications === false) {
      await esgPrisma.$executeRaw`
        UPDATE article_ai_runs
        SET status = 'cancelled', error = 'Inactive account', completed_at = now()
        WHERE user_id = ${job.userId} AND domain = ${payload.domain} AND run_date = ${payload.runDate}::date
          AND settings_version = ${payload.settingsVersion}
      `;
      return { result: { status: "inactive" } };
    }
    const history = await humanLikeArticleIds(job.userId, payload.domain, user, config.maxHistoryExamples);
    const likedArticles = await loadArticles(payload.domain, history.ids, config.maxHistoryExamples);
    const usableLikedArticles = likedArticles.filter((article) => article.tokens.length >= 3 && article.normalizedText.length >= 40);
    const profile = buildProfile(payload.domain, history.source, usableLikedArticles, history.count, config.maxHistoryExamples);
    const requiredUsableHistory = history.source === "personal"
      ? ARTICLE_AI_PERSONAL_HISTORY_MINIMUM
      : history.source === "team"
        ? ARTICLE_AI_TEAM_HISTORY_MINIMUM
        : Number.POSITIVE_INFINITY;
    if (history.source === "insufficient" || usableLikedArticles.length < requiredUsableHistory) {
      await esgPrisma.$executeRaw`
        UPDATE article_ai_preferences
        SET status = 'insufficient_history', history_count = ${history.count},
            profile_source = ${history.source}, last_run_at = now(), last_error = NULL, updated_at = now()
        WHERE user_id = ${job.userId} AND domain = ${payload.domain}
          AND enabled = TRUE AND settings_version = ${payload.settingsVersion}
      `;
      await esgPrisma.$executeRaw`
        UPDATE article_ai_runs
        SET status = 'done', profile_source = ${history.source}, completed_at = now(),
            error = 'Insufficient human article history'
        WHERE user_id = ${job.userId} AND domain = ${payload.domain} AND run_date = ${payload.runDate}::date
          AND settings_version = ${payload.settingsVersion}
      `;
      return { result: { status: "insufficient_history", historyCount: history.count } };
    }

    const candidates = await loadArticles(payload.domain, undefined, Math.max(config.maxCandidates * 3, 100));
    const existingRows = await esgPrisma.$queryRaw<Array<{ article_id: number }>>`
      SELECT article_id
      FROM article_ai_selections
      WHERE user_id = ${job.userId} AND domain = ${payload.domain}
    `;
    const excluded = new Set([
      ...history.ids,
      ...existingRows.map((row) => Number(row.article_id)),
    ]);
    const ranked = rankCandidates(profile, candidates, excluded, config.maxCandidates);
    const shortlist = ranked.slice(0, Math.min(config.maxCandidates, 24));
    await persistFeatures(payload.domain, [...usableLikedArticles, ...shortlist], config.model);
    if (shortlist.length === 0) {
      await esgPrisma.$executeRaw`
        UPDATE article_ai_preferences
        SET status = 'ready', history_count = ${history.count}, profile_source = ${history.source},
            last_run_at = now(), last_error = NULL, updated_at = now()
        WHERE user_id = ${job.userId} AND domain = ${payload.domain}
          AND enabled = TRUE AND settings_version = ${payload.settingsVersion}
      `;
      await esgPrisma.$executeRaw`
        UPDATE article_ai_runs
        SET status = 'done', profile_source = ${history.source}, completed_at = now(),
            error = 'No conservative candidates'
        WHERE user_id = ${job.userId} AND domain = ${payload.domain} AND run_date = ${payload.runDate}::date
          AND settings_version = ${payload.settingsVersion}
      `;
      return { result: { status: "ready", selected: 0 } };
    }

    // Build the exact request and shrink it until a conservative UTF-8 byte
    // ceiling plus the provider's 4k output reserve fits the daily budget.
    let providerCandidates = shortlist.slice(0, Math.min(shortlist.length, 24));
    let providerProfile = profile;
    let request = buildArticleAiProviderRequest(providerProfile, providerCandidates);
    while (request.inputBytes + 4_000 > config.dailyTokenLimit && (providerCandidates.length > 1 || providerProfile.examples.length > 0)) {
      if (providerCandidates.length > 1) {
        providerCandidates = providerCandidates.slice(0, -1);
      } else {
        providerProfile = { ...providerProfile, examples: providerProfile.examples.slice(0, -1) };
      }
      request = buildArticleAiProviderRequest(providerProfile, providerCandidates);
    }
    const estimatedTokens = request.inputBytes + 4_000;
    if (estimatedTokens > config.dailyTokenLimit) {
      await esgPrisma.$executeRaw`
        UPDATE article_ai_runs
        SET status = 'budget_exhausted', profile_source = ${history.source},
            error = 'Daily AI prompt budget exhausted', completed_at = now()
        WHERE user_id = ${job.userId} AND domain = ${payload.domain} AND run_date = ${payload.runDate}::date
          AND settings_version = ${payload.settingsVersion}
      `;
      return { result: { status: "budget_exhausted" } };
    }
    if (!(await reserveBudget(job.userId, payload.domain, payload.runDate, estimatedTokens))) {
      await esgPrisma.$executeRaw`
        UPDATE article_ai_runs
        SET status = 'budget_exhausted', profile_source = ${history.source},
            error = 'Daily AI budget exhausted', completed_at = now()
        WHERE user_id = ${job.userId} AND domain = ${payload.domain} AND run_date = ${payload.runDate}::date
          AND settings_version = ${payload.settingsVersion}
      `;
      return { result: { status: "budget_exhausted" } };
    }
    await throwIfJobCancelled(job.id, job.leaseOwner);

    const beforeProvider = await esgPrisma.$queryRaw<Array<{ enabled: boolean; settings_version: number }>>`
      SELECT enabled, settings_version
      FROM article_ai_preferences
      WHERE user_id = ${job.userId} AND domain = ${payload.domain}
      LIMIT 1
    `;
    if (!beforeProvider[0]?.enabled || Number(beforeProvider[0].settings_version) !== payload.settingsVersion) {
      await finishStaleRun(job.userId, payload);
      return { result: { status: "stale_settings" } };
    }

    const provider = await requestArticleAiDecisions(providerProfile, providerCandidates);
    await throwIfJobCancelled(job.id, job.leaseOwner);
    const allowed = new Map(providerCandidates.map((article) => [article.id, article]));
    const decisions = provider.decisions
      .filter((decision) => decision.action === "select" && decision.confidence >= 0.65 && allowed.has(decision.articleId))
      .slice(0, 5);
    const expiresAt = new Date(Date.now() + config.selectionTtlDays * 24 * 60 * 60 * 1_000);
    const committed = await esgPrisma.$transaction(async (tx) => {
      const fences = await tx.$queryRaw<Array<{ enabled: boolean; settings_version: number }>>`
        SELECT enabled, settings_version
        FROM article_ai_preferences
        WHERE user_id = ${job.userId} AND domain = ${payload.domain}
        FOR UPDATE
      `;
      if (!fences[0]?.enabled || Number(fences[0].settings_version) !== payload.settingsVersion) return false;
      await tx.$executeRaw`
        INSERT INTO article_ai_profiles (
          user_id, domain, profile_version, profile_source, human_like_count,
          profile_json, content_hash, model, created_at, updated_at
        ) VALUES (
          ${job.userId}, ${payload.domain}, ${payload.settingsVersion}, ${profile.profileSource},
          ${profile.humanLikeCount}, ${JSON.stringify(profile)}::jsonb,
          ${profile.contentHash}, ${provider.model}, now(), now()
        )
        ON CONFLICT (user_id, domain, profile_version) DO UPDATE SET
          profile_source = EXCLUDED.profile_source,
          human_like_count = EXCLUDED.human_like_count,
          profile_json = EXCLUDED.profile_json,
          content_hash = EXCLUDED.content_hash,
          model = EXCLUDED.model,
          updated_at = now()
      `;
      for (const decision of decisions) {
        const article = allowed.get(decision.articleId);
        if (!article) continue;
        await tx.$executeRaw`
          INSERT INTO article_ai_selections (
            user_id, domain, article_id, state, reason, relevance_score,
            decision_json, version, selected_at, expires_at, content_hash,
            pending_confirmation, profile_version, model, created_at, updated_at
          ) VALUES (
            ${job.userId}, ${payload.domain}, ${article.id}, 'selected', ${decision.reason},
            ${decision.confidence}, ${JSON.stringify({ confidence: decision.confidence, rubricVersion: "article-ai-v1", profileExamples: profile.exampleArticleIds.slice(0, 20) })}::jsonb,
            1, now(), ${expiresAt}, ${article.contentHash}, FALSE,
            ${payload.settingsVersion}, ${provider.model}, now(), now()
          )
          ON CONFLICT (user_id, domain, article_id) DO UPDATE SET
            state = CASE WHEN article_ai_selections.state IN ('dismissed', 'confirmed') OR article_ai_selections.pending_confirmation THEN article_ai_selections.state ELSE 'selected' END,
            reason = CASE WHEN article_ai_selections.state IN ('dismissed', 'confirmed') OR article_ai_selections.pending_confirmation THEN article_ai_selections.reason ELSE EXCLUDED.reason END,
            relevance_score = CASE WHEN article_ai_selections.state IN ('dismissed', 'confirmed') OR article_ai_selections.pending_confirmation THEN article_ai_selections.relevance_score ELSE EXCLUDED.relevance_score END,
            decision_json = CASE WHEN article_ai_selections.state IN ('dismissed', 'confirmed') OR article_ai_selections.pending_confirmation THEN article_ai_selections.decision_json ELSE EXCLUDED.decision_json END,
            version = CASE WHEN article_ai_selections.state IN ('dismissed', 'confirmed') OR article_ai_selections.pending_confirmation THEN article_ai_selections.version ELSE article_ai_selections.version + 1 END,
            selected_at = CASE WHEN article_ai_selections.state IN ('dismissed', 'confirmed') OR article_ai_selections.pending_confirmation THEN article_ai_selections.selected_at ELSE now() END,
            expires_at = CASE WHEN article_ai_selections.state IN ('dismissed', 'confirmed') OR article_ai_selections.pending_confirmation THEN article_ai_selections.expires_at ELSE EXCLUDED.expires_at END,
            content_hash = CASE WHEN article_ai_selections.state IN ('dismissed', 'confirmed') OR article_ai_selections.pending_confirmation THEN article_ai_selections.content_hash ELSE EXCLUDED.content_hash END,
            pending_confirmation = CASE WHEN article_ai_selections.state IN ('dismissed', 'confirmed') OR article_ai_selections.pending_confirmation THEN article_ai_selections.pending_confirmation ELSE FALSE END,
            profile_version = CASE WHEN article_ai_selections.state IN ('dismissed', 'confirmed') OR article_ai_selections.pending_confirmation THEN article_ai_selections.profile_version ELSE EXCLUDED.profile_version END,
            model = CASE WHEN article_ai_selections.state IN ('dismissed', 'confirmed') OR article_ai_selections.pending_confirmation THEN article_ai_selections.model ELSE EXCLUDED.model END,
            updated_at = now()
        `;
      }
      await tx.$executeRaw`
        UPDATE article_ai_preferences
        SET status = 'ready', history_count = ${history.count}, profile_source = ${history.source},
            last_run_at = now(), last_error = NULL, updated_at = now()
        WHERE user_id = ${job.userId} AND domain = ${payload.domain}
          AND enabled = TRUE AND settings_version = ${payload.settingsVersion}
      `;
      return true;
    });
    if (!committed) {
      await finishStaleRun(job.userId, payload);
      return { result: { status: "stale_settings" } };
    }
    await esgPrisma.$executeRaw`
      UPDATE article_ai_runs
      SET status = 'done', model = ${provider.model}, profile_source = ${profile.profileSource},
          input_tokens = ${provider.inputTokens}, output_tokens = ${provider.outputTokens},
          request_count = 1, completed_at = now(), error = NULL
      WHERE user_id = ${job.userId} AND domain = ${payload.domain} AND run_date = ${payload.runDate}::date
        AND settings_version = ${payload.settingsVersion}
    `;
    return {
      result: {
        status: "done",
        domain: payload.domain,
        runDate: payload.runDate,
        selected: decisions.length,
        model: provider.model,
        inputTokens: provider.inputTokens,
        outputTokens: provider.outputTokens,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Article AI job failed";
    await esgPrisma.$executeRaw`
      UPDATE article_ai_runs
      SET status = 'error', error = ${message.slice(0, 2_000)}, completed_at = now()
      WHERE user_id = ${job.userId} AND domain = ${payload.domain} AND run_date = ${payload.runDate}::date
        AND settings_version = ${payload.settingsVersion}
    `;
    await esgPrisma.$executeRaw`
      UPDATE article_ai_preferences
      SET status = 'error', last_error = ${message.slice(0, 2_000)}, updated_at = now()
      WHERE user_id = ${job.userId} AND domain = ${payload.domain}
        AND enabled = TRUE AND settings_version = ${payload.settingsVersion}
    `;
    if (error instanceof ArticleAiProviderError) throw error;
    throw error;
  }
}

export async function reconcileArticleAiFeedback(): Promise<void> {
  if (!isArticleAiEnabled()) return;
  const rows = await esgPrisma.$queryRaw<PendingFeedbackRow[]>`
    SELECT id, user_id, article_id, selection_id, expected_version
    FROM article_ai_feedback
    WHERE domain = 'credit' AND action = 'confirm' AND status = 'pending'
    ORDER BY created_at ASC
    LIMIT 50
  `;
  for (const feedback of rows) {
    try {
      // Hold the ESG row lock across the short Credit upsert and the final
      // ESG CAS. If Credit is unavailable the transaction times out and the
      // outbox row remains pending; a retry is safe because the Credit unique
      // key makes the insert idempotent.
      await esgPrisma.$transaction(async (tx) => {
        const selections = await tx.$queryRaw<Array<{ version: number; pending_confirmation: boolean; state: string }>>`
          SELECT version, pending_confirmation, state
          FROM article_ai_selections
          WHERE id = ${feedback.selection_id}::uuid AND user_id = ${feedback.user_id}
          FOR UPDATE
        `;
        const selection = selections[0];
        if (!selection || Number(selection.version) !== feedback.expected_version || !selection.pending_confirmation || selection.state === "dismissed") {
          await tx.$executeRaw`
            UPDATE article_ai_feedback
            SET status = 'error', error = 'Selection version changed during Credit confirmation', applied_at = now()
            WHERE id = ${feedback.id}::uuid AND status = 'pending'
          `;
          return;
        }
        // Credit has no identity FK by design. The uniqueness contract makes
        // retries safe and preserves the original timestamp on conflict.
        await creditPrisma.$executeRaw`
          INSERT INTO likes (user_id, content_type, content_id, created_at)
          VALUES (${feedback.user_id}, 'article', ${feedback.article_id}, now())
          ON CONFLICT (user_id, content_type, content_id) DO NOTHING
        `;
        await tx.$executeRaw`
          UPDATE article_ai_selections
          SET state = 'confirmed', pending_confirmation = FALSE,
              version = version + 1, updated_at = now()
          WHERE id = ${feedback.selection_id}::uuid
            AND version = ${feedback.expected_version}
            AND pending_confirmation = TRUE
        `;
        await tx.$executeRaw`
          UPDATE article_ai_feedback
          SET status = 'confirmed', applied_at = now(), error = NULL
          WHERE id = ${feedback.id}::uuid AND status = 'pending'
        `;
      }, { timeout: 15_000, maxWait: 5_000 });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Credit like reconciliation failed";
      // Keep the row pending for the next worker poll. This is intentionally
      // not a destructive error transition: a transient Credit outage must not
      // strand a valid confirmation or poison ESG jobs.
      await esgPrisma.$executeRaw`
        UPDATE article_ai_feedback
        SET error = ${message.slice(0, 2_000)}
        WHERE id = ${feedback.id}::uuid AND status = 'pending'
      `;
    }
  }
}
