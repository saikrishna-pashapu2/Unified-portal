import "server-only";

import { randomUUID } from "node:crypto";

import { esgPrisma } from "@esgcredit/db-esg";
import { creditPrisma } from "@esgcredit/db-credit";

import { JobLeaseLostError, throwIfJobCancelled, type ClaimedBackgroundJob } from "@/lib/jobs/queue";
import { getArticleAiConfig } from "./config";
import { ArticleAiProviderError } from "./errors";
import {
  buildProfile,
  classifyDomainHistory,
  hashContent,
  normalizeArticle,
  rankCandidates,
  type ArticleAiArticle,
  type NormalizedArticle,
} from "./policy";
import { buildArticleAiProviderRequest, requestArticleAiDecisions } from "./provider";
import {
  ARTICLE_AI_MAX_SHARED_SELECTIONS,
  ARTICLE_AI_POLICY_VERSION,
  type ArticleAiDomain,
  type ArticleAiDomainJobPayload,
} from "./types";

const LEASE_DURATION_SECONDS = 120;
const ASSESSMENT_WAIT_ATTEMPTS = 15;
const ASSESSMENT_WAIT_MS = 100;

export interface SharedAssessmentRow {
  id: string;
  domain: ArticleAiDomain;
  assessment_date: Date;
  policy_version: number;
  status: string;
  profile_source: string;
  history_count: number;
  profile_json: unknown;
  content_hash: string | null;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  request_count: number;
  completed_at: Date | null;
  lease_token: string | null;
  lease_expires_at: Date | null;
}

export interface SharedSelectionRow {
  id: string;
  assessment_id: string;
  assessment_date: Date;
  article_id: number;
  domain: ArticleAiDomain;
  reason: string;
  relevance_score: number | null;
  selected_at: Date;
  expires_at: Date;
  content_hash: string;
  model: string | null;
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

function articleQuery(domain: ArticleAiDomain) {
  return domain === "esg" ? esgPrisma : creditPrisma;
}

function asDomain(value: string): ArticleAiDomain {
  if (value === "esg" || value === "credit") return value;
  throw new Error(`Unsupported article AI domain: ${value}`);
}

function utcDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function safeIds(ids: readonly number[], limit = 300): number[] {
  return Array.from(new Set(ids.filter((id) => Number.isSafeInteger(id) && id > 0))).slice(0, limit);
}

function toArticle(row: ArticleRow): ArticleAiArticle {
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

export async function loadDomainArticles(
  domain: ArticleAiDomain,
  ids?: readonly number[],
  limit = 200,
): Promise<NormalizedArticle[]> {
  const database = articleQuery(domain);
  const selectedIds = ids ? safeIds(ids) : [];
  let rows: ArticleRow[];
  if (domain === "esg") {
    rows = selectedIds.length > 0
      ? await database.$queryRaw<ArticleRow[]>`
          SELECT id, title, summary, NULL::text AS content, source,
                 link AS url, published AS published_at
          FROM esg_articles
          WHERE id = ANY(${selectedIds}::int[])
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
    rows = selectedIds.length > 0
      ? await database.$queryRaw<ArticleRow[]>`
          SELECT id, title, summary, content,
                 source, COALESCE(url, link) AS url, date AS published_at
          FROM credit_articles
          WHERE id = ANY(${selectedIds}::int[])
        `
      : await database.$queryRaw<ArticleRow[]>`
          SELECT id, title, summary, content,
                 source, COALESCE(url, link) AS url, date AS published_at
          FROM credit_articles
          WHERE (date >= CURRENT_DATE - INTERVAL '14 days' AND date <= CURRENT_DATE)
             OR (date IS NULL AND COALESCE(created_at, updated_at) >= now() - INTERVAL '14 days'
                 AND COALESCE(created_at, updated_at) <= now())
          ORDER BY date DESC NULLS LAST, id DESC
          LIMIT ${Math.max(1, Math.min(limit, 500))}
        `;
  }
  return rows.map((row) => normalizeArticle(toArticle(row)));
}

/** Load recent candidates while excluding every human-liked article in this domain. */
export async function loadDomainCandidates(domain: ArticleAiDomain, limit = 200): Promise<NormalizedArticle[]> {
  const database = articleQuery(domain);
  const bounded = Math.max(1, Math.min(limit, 500));
  const rows = domain === "esg"
    ? await database.$queryRaw<ArticleRow[]>`
        SELECT a.id, a.title, a.summary, NULL::text AS content, a.source,
               a.link AS url, a.published AS published_at
        FROM esg_articles a
        WHERE ((a.published >= now() - INTERVAL '14 days' AND a.published <= now())
           OR (a.published IS NULL AND a.save_time >= now() - INTERVAL '14 days' AND a.save_time <= now()))
          AND NOT EXISTS (
            SELECT 1 FROM likes l
            WHERE COALESCE(l.content_type, 'article') = 'article' AND l.content_id = a.id
          )
        ORDER BY COALESCE(a.published, a.save_time) DESC NULLS LAST, a.id DESC
        LIMIT ${bounded}
      `
    : await database.$queryRaw<ArticleRow[]>`
        SELECT a.id, a.title, a.summary, a.content, a.source,
               COALESCE(a.url, a.link) AS url, a.date AS published_at
        FROM credit_articles a
        WHERE ((a.date >= CURRENT_DATE - INTERVAL '14 days' AND a.date <= CURRENT_DATE)
           OR (a.date IS NULL AND COALESCE(a.created_at, a.updated_at) >= now() - INTERVAL '14 days'
               AND COALESCE(a.created_at, a.updated_at) <= now()))
          AND NOT EXISTS (
            SELECT 1 FROM likes l
            WHERE COALESCE(l.content_type, 'article') = 'article' AND l.content_id = a.id
          )
        ORDER BY a.date DESC NULLS LAST, a.id DESC
        LIMIT ${bounded}
      `;
  return rows.map((row) => normalizeArticle(toArticle(row)));
}

/**
 * Query the bounded representative history. The count is deliberately taken
 * from a join against the article table so it represents resolvable content,
 * while the prompt receives at most the configured sample size.
 */
export async function getDomainLikeSnapshot(
  domain: ArticleAiDomain,
  maxExamples: number,
): Promise<{ ids: number[]; count: number; usable: NormalizedArticle[] }> {
  const database = articleQuery(domain);
  const countRows = domain === "esg"
    ? await database.$queryRaw<Array<{ count: number }>>`
        SELECT COUNT(DISTINCT l.content_id)::int AS count
        FROM likes l
        JOIN esg_articles a ON a.id = l.content_id
        WHERE COALESCE(l.content_type, 'article') = 'article'
      `
    : await database.$queryRaw<Array<{ count: number }>>`
        SELECT COUNT(DISTINCT l.content_id)::int AS count
        FROM likes l
        JOIN credit_articles a ON a.id = l.content_id
        WHERE COALESCE(l.content_type, 'article') = 'article'
      `;
  const idRows = domain === "esg"
    ? await database.$queryRaw<Array<{ content_id: number }>>`
        SELECT l.content_id
        FROM likes l
        JOIN esg_articles a ON a.id = l.content_id
        WHERE COALESCE(l.content_type, 'article') = 'article'
        GROUP BY l.content_id
        ORDER BY MAX(l.created_at) DESC NULLS LAST, l.content_id DESC
        LIMIT ${Math.max(1, Math.min(maxExamples, 200))}
      `
    : await database.$queryRaw<Array<{ content_id: number }>>`
        SELECT l.content_id
        FROM likes l
        JOIN credit_articles a ON a.id = l.content_id
        WHERE COALESCE(l.content_type, 'article') = 'article'
        GROUP BY l.content_id
        ORDER BY MAX(l.created_at) DESC NULLS LAST, l.content_id DESC
        LIMIT ${Math.max(1, Math.min(maxExamples, 200))}
      `;
  const ids = idRows.map((row) => Number(row.content_id)).filter((id) => Number.isSafeInteger(id) && id > 0);
  const articles = await loadDomainArticles(domain, ids, maxExamples);
  const usable = articles.filter((article) => article.tokens.length >= 3 && article.normalizedText.length >= 40);
  return { ids, count: Number(countRows[0]?.count ?? 0), usable };
}

export async function getDomainHistorySummary(domain: ArticleAiDomain): Promise<{ count: number; source: "domain" | "insufficient" }> {
  const snapshot = await getDomainLikeSnapshot(domain, 1);
  return classifyDomainHistory(snapshot.count);
}

export async function getLatestDomainAssessment(
  domain: ArticleAiDomain,
  policyVersion = ARTICLE_AI_POLICY_VERSION,
): Promise<SharedAssessmentRow | null> {
  const rows = await esgPrisma.$queryRaw<SharedAssessmentRow[]>`
    SELECT id::text, domain, assessment_date, policy_version, status,
           profile_source, history_count, profile_json, content_hash, model,
           input_tokens, output_tokens, request_count,
           completed_at, lease_token::text, lease_expires_at
    FROM article_ai_domain_assessments
    WHERE domain = ${domain} AND policy_version = ${policyVersion}
    ORDER BY assessment_date DESC
    LIMIT 1
  `;
  return rows[0] ? { ...rows[0], domain: asDomain(String(rows[0].domain)) } : null;
}

export async function getCurrentSharedSelections(
  userId: number,
  domain: ArticleAiDomain,
  articleIds?: readonly number[],
  now = new Date(),
): Promise<Array<SharedSelectionRow & {
  user_selection_id: string | null;
  user_state: string | null;
  user_version: number | null;
  user_pending_confirmation: boolean;
}>> {
  const ids = articleIds ? safeIds(articleIds, 100) : [];
  type SelectionWithOverlay = SharedSelectionRow & {
    user_selection_id: string | null;
    user_state: string | null;
    user_version: number | null;
    user_pending_confirmation: boolean;
  };
  const rows = ids.length > 0
    ? await esgPrisma.$queryRaw<SelectionWithOverlay[]>`
    WITH latest AS (
      SELECT id, domain, assessment_date, status
      FROM article_ai_domain_assessments
      WHERE domain = ${domain} AND policy_version = ${ARTICLE_AI_POLICY_VERSION}
        AND status = 'ready'
      ORDER BY assessment_date DESC
      LIMIT 1
    )
    SELECT ds.id::text, ds.assessment_id::text, latest.assessment_date,
           ds.article_id, ds.domain, ds.reason, ds.relevance_score,
           ds.selected_at, ds.expires_at, ds.content_hash, ds.model,
           us.id::text AS user_selection_id, us.state AS user_state,
           us.version AS user_version,
           COALESCE(us.pending_confirmation, FALSE) AS user_pending_confirmation
    FROM latest
    JOIN article_ai_domain_selections ds ON ds.assessment_id = latest.id
    LEFT JOIN article_ai_user_selections us
      ON us.user_id = ${userId}
     AND us.domain = ds.domain
     AND us.article_id = ds.article_id
    WHERE latest.status = 'ready'
      AND ds.expires_at > ${now}
      AND ds.article_id = ANY(${ids}::int[])
    ORDER BY ds.relevance_score DESC NULLS LAST, ds.selected_at DESC, ds.article_id ASC
  `
    : await esgPrisma.$queryRaw<SelectionWithOverlay[]>`
    WITH latest AS (
      SELECT id, domain, assessment_date, status
      FROM article_ai_domain_assessments
      WHERE domain = ${domain} AND policy_version = ${ARTICLE_AI_POLICY_VERSION}
        AND status = 'ready'
      ORDER BY assessment_date DESC
      LIMIT 1
    )
    SELECT ds.id::text, ds.assessment_id::text, latest.assessment_date,
           ds.article_id, ds.domain, ds.reason, ds.relevance_score,
           ds.selected_at, ds.expires_at, ds.content_hash, ds.model,
           us.id::text AS user_selection_id, us.state AS user_state,
           us.version AS user_version,
           COALESCE(us.pending_confirmation, FALSE) AS user_pending_confirmation
    FROM latest
    JOIN article_ai_domain_selections ds ON ds.assessment_id = latest.id
    LEFT JOIN article_ai_user_selections us
      ON us.user_id = ${userId}
     AND us.domain = ds.domain
     AND us.article_id = ds.article_id
    WHERE latest.status = 'ready'
      AND ds.expires_at > ${now}
    ORDER BY ds.relevance_score DESC NULLS LAST, ds.selected_at DESC, ds.article_id ASC
  `;
  return rows.map((row) => ({ ...row, domain: asDomain(String(row.domain)) }));
}

async function persistFeatures(domain: ArticleAiDomain, articles: readonly NormalizedArticle[], model: string): Promise<void> {
  for (const article of articles) {
    await esgPrisma.$executeRaw`
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

async function readAssessment(id: string): Promise<SharedAssessmentRow | null> {
  const rows = await esgPrisma.$queryRaw<SharedAssessmentRow[]>`
    SELECT id::text, domain, assessment_date, policy_version, status,
           profile_source, history_count, profile_json, content_hash, model,
           input_tokens, output_tokens, request_count,
           completed_at, lease_token::text, lease_expires_at
    FROM article_ai_domain_assessments
    WHERE id = ${id}::uuid
    LIMIT 1
  `;
  return rows[0] ? { ...rows[0], domain: asDomain(String(rows[0].domain)) } : null;
}

function leaseOwner(job: ClaimedBackgroundJob): string {
  return `${job.leaseOwner || "article-ai-worker"}:${job.id}`.slice(0, 180);
}

function isTerminal(status: string): boolean {
  return status === "ready" || status === "insufficient" || status === "budget_exhausted";
}

async function waitForAssessment(id: string): Promise<SharedAssessmentRow | null> {
  for (let attempt = 0; attempt < ASSESSMENT_WAIT_ATTEMPTS; attempt += 1) {
    const row = await readAssessment(id);
    if (!row || isTerminal(row.status)) return row;
    await new Promise((resolve) => setTimeout(resolve, ASSESSMENT_WAIT_MS));
  }
  return readAssessment(id);
}

export async function runSharedArticleAiAssessment(
  job: ClaimedBackgroundJob,
  payload: ArticleAiDomainJobPayload,
): Promise<{ status: string; domain: ArticleAiDomain; runDate: string; historyCount?: number; selected?: number; model?: string }> {
  const config = getArticleAiConfig();
  const domain = payload.domain;
  const runDate = payload.runDate;
  await esgPrisma.$executeRaw`
    INSERT INTO article_ai_domain_assessments (
      domain, assessment_date, policy_version, status, request_limit, token_limit, updated_at
    ) VALUES (
      ${domain}, ${runDate}::date, ${ARTICLE_AI_POLICY_VERSION}, 'queued', ${config.dailyRequestLimit},
      ${config.dailyTokenLimit}, now()
    )
    ON CONFLICT (domain, assessment_date, policy_version) DO NOTHING
  `;
  const initial = await esgPrisma.$queryRaw<Array<{ id: string }>>`
    SELECT id::text FROM article_ai_domain_assessments
    WHERE domain = ${domain} AND assessment_date = ${runDate}::date
      AND policy_version = ${ARTICLE_AI_POLICY_VERSION}
    LIMIT 1
  `;
  const assessmentId = initial[0]?.id;
  if (!assessmentId) throw new Error("Unable to create shared article AI assessment");
  let assessment = await readAssessment(assessmentId);
  if (!assessment) throw new Error("Shared article AI assessment disappeared");
  if (isTerminal(assessment.status)) {
    return { status: assessment.status, domain, runDate, historyCount: Number(assessment.history_count) };
  }

  const token = randomUUID();
  const owner = leaseOwner(job);
  const acquired = await esgPrisma.$queryRaw<Array<{ id: string }>>`
    UPDATE article_ai_domain_assessments
    SET status = 'running', lease_owner = ${owner}, lease_token = ${token}::uuid,
        lease_expires_at = now() + (${LEASE_DURATION_SECONDS} * interval '1 second'),
        started_at = COALESCE(started_at, now()), updated_at = now(), error = NULL
    WHERE id = ${assessmentId}::uuid
      AND status NOT IN ('ready', 'insufficient', 'budget_exhausted')
      AND (lease_expires_at IS NULL OR lease_expires_at <= now())
    RETURNING id::text
  `;
  if (acquired.length === 0) {
    assessment = await waitForAssessment(assessmentId);
    if (assessment && isTerminal(assessment.status)) {
      return { status: assessment.status, domain, runDate, historyCount: Number(assessment.history_count) };
    }
    throw new JobLeaseLostError();
  }

  try {
    const history = await getDomainLikeSnapshot(domain, config.maxHistoryExamples);
    const classified = classifyDomainHistory(history.usable.length);
    const profile = buildProfile(domain, classified.source, history.usable, history.count, config.maxHistoryExamples);
    await persistFeatures(domain, history.usable, config.model);
    if (classified.source === "insufficient") {
      await esgPrisma.$executeRaw`
        UPDATE article_ai_domain_assessments
        SET status = 'insufficient', profile_source = 'insufficient', history_count = ${history.count},
            profile_json = ${JSON.stringify(profile)}::jsonb, content_hash = ${profile.contentHash},
            completed_at = now(), updated_at = now(), lease_owner = NULL,
            lease_token = NULL, lease_expires_at = NULL
        WHERE id = ${assessmentId}::uuid AND lease_token = ${token}::uuid
      `;
      return { status: "insufficient", domain, runDate, historyCount: history.count, selected: 0 };
    }

    const candidates = await loadDomainCandidates(domain, Math.max(config.maxCandidates * 3, 100));
    const excluded = new Set(history.ids);
    const ranked = rankCandidates(profile, candidates, excluded, config.maxCandidates);
    const shortlist = ranked.slice(0, Math.min(config.maxCandidates, 40));
    if (shortlist.length === 0) {
      await esgPrisma.$executeRaw`
        UPDATE article_ai_domain_assessments
        SET status = 'ready', profile_source = 'domain', history_count = ${history.count},
            profile_json = ${JSON.stringify(profile)}::jsonb, content_hash = ${profile.contentHash},
            completed_at = now(), updated_at = now(), lease_owner = NULL,
            lease_token = NULL, lease_expires_at = NULL
        WHERE id = ${assessmentId}::uuid AND lease_token = ${token}::uuid
      `;
      return { status: "ready", domain, runDate, historyCount: history.count, selected: 0 };
    }
    await persistFeatures(domain, shortlist, config.model);
    let providerCandidates = shortlist.slice(0, Math.min(shortlist.length, 24));
    let providerProfile = profile;
    let request = buildArticleAiProviderRequest(providerProfile, providerCandidates);
    while (request.inputBytes + 4_000 > config.dailyTokenLimit && (providerCandidates.length > 1 || providerProfile.examples.length > 0)) {
      if (providerCandidates.length > 1) providerCandidates = providerCandidates.slice(0, -1);
      else providerProfile = { ...providerProfile, examples: providerProfile.examples.slice(0, -1) };
      request = buildArticleAiProviderRequest(providerProfile, providerCandidates);
    }
    const estimatedTokens = request.inputBytes + 4_000;
    if (estimatedTokens > config.dailyTokenLimit) {
      await esgPrisma.$executeRaw`
        UPDATE article_ai_domain_assessments
        SET status = 'budget_exhausted', profile_source = 'domain', history_count = ${history.count},
            profile_json = ${JSON.stringify(profile)}::jsonb, error = 'Daily AI prompt budget exhausted',
            completed_at = now(), updated_at = now(), lease_owner = NULL,
            lease_token = NULL, lease_expires_at = NULL
        WHERE id = ${assessmentId}::uuid AND lease_token = ${token}::uuid
      `;
      return { status: "budget_exhausted", domain, runDate, historyCount: history.count };
    }
    const reservationTokens = Math.max(1, estimatedTokens);
    const reserved = await esgPrisma.$queryRaw<Array<{ id: string }>>`
      UPDATE article_ai_domain_assessments
      SET requests_reserved = requests_reserved + 1,
          tokens_reserved = tokens_reserved + ${reservationTokens},
          lease_expires_at = now() + (${LEASE_DURATION_SECONDS} * interval '1 second'),
          updated_at = now()
      WHERE id = ${assessmentId}::uuid AND lease_token = ${token}::uuid
        AND status = 'running'
        AND lease_expires_at IS NOT NULL AND lease_expires_at > now()
        AND requests_reserved + 1 <= request_limit
        AND tokens_reserved + ${reservationTokens} <= token_limit
      RETURNING id::text
    `;
    if (reserved.length === 0) {
      const fence = await esgPrisma.$queryRaw<Array<{
        status: string;
        lease_token: string | null;
        lease_expires_at: Date | null;
        requests_reserved: number;
        request_limit: number;
        tokens_reserved: number;
        token_limit: number;
      }>>`
        SELECT status, lease_token::text, lease_expires_at,
               requests_reserved, request_limit, tokens_reserved, token_limit
        FROM article_ai_domain_assessments
        WHERE id = ${assessmentId}::uuid
        LIMIT 1
      `;
      const current = fence[0];
      const leaseValid = current?.status === "running"
        && current.lease_token === token
        && current.lease_expires_at !== null
        && new Date(current.lease_expires_at).getTime() > Date.now();
      if (!leaseValid) throw new JobLeaseLostError();

      const budgetExhausted = Number(current.requests_reserved) + 1 > Number(current.request_limit)
        || Number(current.tokens_reserved) + reservationTokens > Number(current.token_limit);
      if (!budgetExhausted) throw new JobLeaseLostError();

      const marked = await esgPrisma.$queryRaw<Array<{ id: string }>>`
        UPDATE article_ai_domain_assessments
        SET status = 'budget_exhausted', profile_source = 'domain', history_count = ${history.count},
            profile_json = ${JSON.stringify(profile)}::jsonb, error = 'Daily AI budget exhausted',
            completed_at = now(), updated_at = now(), lease_owner = NULL,
            lease_token = NULL, lease_expires_at = NULL
        WHERE id = ${assessmentId}::uuid AND lease_token = ${token}::uuid
          AND status = 'running'
          AND lease_expires_at IS NOT NULL AND lease_expires_at > now()
        RETURNING id::text
      `;
      if (marked.length === 0) throw new JobLeaseLostError();
      return { status: "budget_exhausted", domain, runDate, historyCount: history.count };
    }
    await throwIfJobCancelled(job.id, job.leaseOwner);
    const stillOwned = await esgPrisma.$queryRaw<Array<{ id: string }>>`
      SELECT id::text
      FROM article_ai_domain_assessments
      WHERE id = ${assessmentId}::uuid AND lease_token = ${token}::uuid
        AND status = 'running'
        AND lease_expires_at IS NOT NULL AND lease_expires_at > now()
    `;
    if (stillOwned.length === 0) throw new JobLeaseLostError();
    const provider = await requestArticleAiDecisions(providerProfile, providerCandidates);
    await throwIfJobCancelled(job.id, job.leaseOwner);
    const allowed = new Map(providerCandidates.map((article) => [article.id, article]));
    const decisions = provider.decisions
      .filter((decision) => decision.action === "select" && decision.confidence >= 0.65 && allowed.has(decision.articleId))
      .slice(0, ARTICLE_AI_MAX_SHARED_SELECTIONS);
    const expiresAt = new Date(Date.now() + config.selectionTtlDays * 24 * 60 * 60 * 1_000);
    const committed = await esgPrisma.$transaction(async (tx) => {
      const fences = await tx.$queryRaw<Array<{ lease_token: string | null; lease_expires_at: Date | null }>>`
        SELECT lease_token::text, lease_expires_at
        FROM article_ai_domain_assessments
        WHERE id = ${assessmentId}::uuid AND status = 'running'
        FOR UPDATE
      `;
      if (!fences[0] || fences[0].lease_token !== token || !fences[0].lease_expires_at || new Date(fences[0].lease_expires_at).getTime() <= Date.now()) return false;
      for (const decision of decisions) {
        const article = allowed.get(decision.articleId);
        if (!article) continue;
        await tx.$executeRaw`
          INSERT INTO article_ai_domain_selections (
            assessment_id, domain, article_id, reason, relevance_score,
            selected_at, expires_at, content_hash, model, created_at, updated_at
          ) VALUES (
            ${assessmentId}::uuid, ${domain}, ${article.id}, ${decision.reason},
            ${decision.confidence}, now(), ${expiresAt}, ${article.contentHash},
            ${provider.model}, now(), now()
          )
          ON CONFLICT (assessment_id, article_id) DO UPDATE SET
            reason = EXCLUDED.reason, relevance_score = EXCLUDED.relevance_score,
            expires_at = EXCLUDED.expires_at, content_hash = EXCLUDED.content_hash,
            model = EXCLUDED.model, updated_at = now()
        `;
      }
      await tx.$executeRaw`
        UPDATE article_ai_domain_assessments
        SET status = 'ready', profile_source = 'domain', history_count = ${history.count},
            profile_json = ${JSON.stringify(profile)}::jsonb, content_hash = ${profile.contentHash},
            model = ${provider.model}, input_tokens = ${provider.inputTokens},
            output_tokens = ${provider.outputTokens}, request_count = 1,
            completed_at = now(), updated_at = now(), lease_owner = NULL,
            lease_token = NULL, lease_expires_at = NULL, error = NULL
        WHERE id = ${assessmentId}::uuid AND lease_token = ${token}::uuid
      `;
      return true;
    });
    if (!committed) throw new JobLeaseLostError();
    return { status: "ready", domain, runDate, historyCount: history.count, selected: decisions.length, model: provider.model };
  } catch (error) {
    if (error instanceof JobLeaseLostError) throw error;
    const message = error instanceof Error ? error.message : "Shared article AI assessment failed";
    await esgPrisma.$executeRaw`
      UPDATE article_ai_domain_assessments
      SET status = 'error', error = ${message.slice(0, 2_000)}, updated_at = now(),
          lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL
      WHERE id = ${assessmentId}::uuid AND lease_token = ${token}::uuid
    `;
    if (error instanceof ArticleAiProviderError) throw error;
    throw error;
  }
}

export function sharedContentHash(domain: ArticleAiDomain, article: NormalizedArticle): string {
  return hashContent(`${domain}|${article.id}|${article.contentHash}`);
}
