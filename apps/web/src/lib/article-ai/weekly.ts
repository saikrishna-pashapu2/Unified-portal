import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { esgPrisma } from "@esgcredit/db-esg";

import { JobLeaseLostError, throwIfJobCancelled, type ClaimedBackgroundJob } from "@/lib/jobs/queue";
import { getArticleAiConfig } from "./config";
import {
  getArticleAiWeeklyCalendar,
  type ArticleAiWeeklyCalendar,
} from "./weekly-calendar";
import {
  buildWeeklyCandidateProviderRequest,
  buildWeeklyHistoryProviderRequest,
  buildWeeklyMergeProviderRequest,
  ARTICLE_AI_WEEKLY_MODEL,
  ARTICLE_AI_WEEKLY_PROMPT_VERSION,
  WEEKLY_STRUCTURED_SCHEMA_OVERHEAD_BYTES,
  requestWeeklyCandidateBatch,
  requestWeeklyHistoryProfile,
  requestWeeklyMerge,
} from "./weekly-provider";
import {
  ARTICLE_AI_MAX_SHARED_SELECTIONS,
  ARTICLE_AI_WEEKLY_POLICY_VERSION,
  type ArticleAiDomain,
  type ArticleAiWeeklyBatchPhase,
  type ArticleAiWeeklyCandidateBatchResult,
  type ArticleAiWeeklyCoverage,
  type ArticleAiWeeklyHistoryBatchResult,
  type ArticleAiWeeklyInputSnapshot,
  type ArticleAiWeeklyJobPayload,
  type ArticleAiWeeklyManifestResult,
  type ArticleAiWeeklyMergeResult,
  type ArticleAiWeeklyTextFragment,
} from "./types";
import { loadWeeklyManifestInputs, weeklyArticleContentHash } from "./weekly-inputs";

const LEASE_DURATION_SECONDS = 300;

export interface ArticleAiWeeklyRunResult {
  status: string;
  domain: ArticleAiDomain;
  targetWeekKey: string;
  selectionCount: number;
  coverage: ArticleAiWeeklyCoverage;
  model: typeof ARTICLE_AI_WEEKLY_MODEL;
}

interface AssessmentRow {
  id: string;
  domain: ArticleAiDomain;
  assessment_date: Date;
  policy_version: number;
  status: string;
  profile_source: string;
  history_count: number;
  profile_json: unknown;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  request_count: number;
  request_limit: number;
  requests_reserved: number;
  token_limit: number;
  tokens_reserved: number;
  completed_at: Date | null;
  manifest_hash: string | null;
  manifest_cutoff_at: Date | null;
  coverage_json: unknown;
  lease_token: string | null;
  lease_expires_at: Date | null;
}

interface BatchRow {
  id: string;
  phase: ArticleAiWeeklyBatchPhase;
  level: number;
  batch_index: number;
  state: string;
  input_hash: string;
  input_refs_json: unknown;
  output_json: unknown;
  output_hash: string | null;
  eliminations_json: unknown;
  lease_token: string | null;
  lease_expires_at: Date | null;
}

interface PreparedBatch {
  phase: ArticleAiWeeklyBatchPhase;
  level: number;
  batchIndex: number;
  inputHash: string;
  stableBatchId: string;
  databaseManifestIds: string[];
  providerInputs: ArticleAiWeeklyInputSnapshot[];
  fragments: ArticleAiWeeklyTextFragment[];
}

interface MergeChild {
  stableBatchId: string;
  outputHash: string;
  output: unknown;
}

interface MergePlan {
  phase: Extract<ArticleAiWeeklyBatchPhase, "history_merge" | "candidate_merge">;
  level: number;
  batchIndex: number;
  inputHash: string;
  stableBatchId: string;
  children: MergeChild[];
}

type ExecutedLeafOutput = {
  output: ArticleAiWeeklyHistoryBatchResult | ArticleAiWeeklyCandidateBatchResult;
  outputHash: string;
};

class WeeklyCoverageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WeeklyCoverageError";
  }
}

class WeeklyBudgetExhaustedError extends Error {
  constructor(message = "Weekly Article AI budget exhausted") {
    super(message);
    this.name = "WeeklyBudgetExhaustedError";
  }
}

class WeeklyWindowExpiredError extends Error {
  constructor() {
    super("Weekly Article AI generation window has closed");
    this.name = "WeeklyWindowExpiredError";
  }
}

function hashValue(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function stableInputId(input: ArticleAiWeeklyInputSnapshot): string {
  return hashValue({
    kind: input.kind,
    domain: input.domain,
    articleId: input.articleId,
    contentHash: input.contentHash,
    sourcePeriodStart: input.sourcePeriodStart,
    sourcePeriodEnd: input.sourcePeriodEnd,
    carryoverFromWeek: input.carryoverFromWeek,
  });
}

function providerInput(input: ArticleAiWeeklyInputSnapshot): ArticleAiWeeklyInputSnapshot {
  return { ...input, manifestId: stableInputId(input) };
}

function fullText(input: ArticleAiWeeklyInputSnapshot): string {
  return [input.title, input.summary, input.content, input.source]
    .filter((part): part is string => Boolean(part))
    .join("\n\n");
}

/** Split without dropping any character; the manifest retains the full original text. */
function splitText(input: ArticleAiWeeklyInputSnapshot, maxBytes: number): ArticleAiWeeklyTextFragment[] {
  const text = fullText(input);
  if (!text) return [];
  const logicalId = stableInputId(input);
  const targetBytes = Math.max(1_024, Math.floor(maxBytes / 3));
  const chunks: string[] = [];
  let current = "";
  let currentBytes = 0;
  for (const character of text) {
    const characterBytes = Buffer.byteLength(character, "utf8");
    if (current && currentBytes + characterBytes > targetBytes) {
      chunks.push(current);
      current = "";
      currentBytes = 0;
    }
    current += character;
    currentBytes += characterBytes;
  }
  if (current) chunks.push(current);
  const contentHash = input.contentHash ?? hashValue(text);
  return chunks.map((chunk, fragmentIndex) => ({
    fragmentId: `${logicalId}:fragment:${fragmentIndex}`,
    manifestId: logicalId,
    fragmentIndex,
    fragmentCount: chunks.length,
    contentHash,
    text: chunk,
  }));
}

function inputSize(inputs: ArticleAiWeeklyInputSnapshot[], fragments: ArticleAiWeeklyTextFragment[]): number {
  return Buffer.byteLength(JSON.stringify({
    inputs: inputs.map((input) => ({
      id: stableInputId(input),
      articleId: input.articleId,
      // Provider metadata is bounded; complete source text lives in fragments.
      title: input.title?.slice(0, 500),
      source: input.source?.slice(0, 255),
      url: input.url?.slice(0, 2_000),
      publishedAt: input.publishedAt,
    })),
    fragments,
  }), "utf8");
}

function estimatedStructuredOutputBytes(
  phase: ArticleAiWeeklyBatchPhase,
  inputs: ArticleAiWeeklyInputSnapshot[],
  fragments: ArticleAiWeeklyTextFragment[],
): number {
  // Candidate wire reasons (160 chars) and fragment notes (80 chars) need room
  // for four-byte UTF-8 characters, identifiers, and structured-output metadata.
  const perInput = phase === "candidate_evaluation" ? 1_000 : 180;
  const perFragment = phase === "candidate_evaluation" ? 450 : 110;
  return 2_000 + inputs.length * perInput + fragments.length * perFragment;
}

export function estimateArticleAiWeeklyStructuredOutputBytes(
  phase: Extract<ArticleAiWeeklyBatchPhase, "history_profile" | "candidate_evaluation">,
  inputCount: number,
  fragmentCount: number,
): number {
  return estimatedStructuredOutputBytes(phase,
    Array.from({ length: Math.max(0, inputCount) }, () => ({}) as ArticleAiWeeklyInputSnapshot),
    Array.from({ length: Math.max(0, fragmentCount) }, () => ({}) as ArticleAiWeeklyTextFragment));
}

function isTerminal(status: string): boolean {
  return status === "ready" || status === "insufficient" || status === "insufficient_history" || status === "budget_exhausted";
}

async function readAssessment(id: string): Promise<AssessmentRow | null> {
  const rows = await esgPrisma.$queryRaw<AssessmentRow[]>`
    SELECT id::text, domain, assessment_date, policy_version, status, profile_source,
           history_count, profile_json, model, input_tokens, output_tokens,
           request_count, request_limit, requests_reserved, token_limit,
           tokens_reserved, completed_at, manifest_hash, manifest_cutoff_at,
           coverage_json, lease_token::text, lease_expires_at
    FROM article_ai_domain_assessments
    WHERE id = ${id}::uuid
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function ensureAssessment(
  domain: ArticleAiDomain,
  calendar: ArticleAiWeeklyCalendar,
): Promise<AssessmentRow> {
  const config = getArticleAiConfig();
  await esgPrisma.$executeRaw`
    INSERT INTO article_ai_domain_assessments (
      domain, assessment_date, policy_version, status, profile_source,
      request_limit, token_limit, source_start_at, source_cutoff_at,
      processing_at, email_at, valid_until, phase, updated_at
    ) VALUES (
      ${domain}, ${calendar.targetWeekKey}::date, ${ARTICLE_AI_WEEKLY_POLICY_VERSION},
      'queued', 'insufficient', ${config.weeklyRequestLimit}, ${config.weeklyTokenLimit},
      ${calendar.sourceStart}, ${calendar.sourceEnd}, ${calendar.processingAt},
      ${calendar.emailAt}, ${calendar.validUntil}, 'manifest', now()
    )
    ON CONFLICT (domain, assessment_date, policy_version) DO NOTHING
  `;
  const rows = await esgPrisma.$queryRaw<Array<{ id: string }>>`
    SELECT id::text
    FROM article_ai_domain_assessments
    WHERE domain = ${domain}
      AND assessment_date = ${calendar.targetWeekKey}::date
      AND policy_version = ${ARTICLE_AI_WEEKLY_POLICY_VERSION}
    LIMIT 1
  `;
  const id = rows[0]?.id;
  if (!id) throw new Error("Unable to create weekly Article AI assessment");
  const assessment = await readAssessment(id);
  if (!assessment) throw new Error("Weekly Article AI assessment disappeared");
  return assessment;
}

async function claimAssessment(assessmentId: string, job: ClaimedBackgroundJob): Promise<string> {
  const token = randomUUID();
  const owner = `${job.leaseOwner}:${job.id}`.slice(0, 180);
  const rows = await esgPrisma.$queryRaw<Array<{ id: string }>>`
    UPDATE article_ai_domain_assessments
    SET status = 'running', lease_owner = ${owner}, lease_token = ${token}::uuid,
        lease_expires_at = now() + (${LEASE_DURATION_SECONDS} * interval '1 second'),
        started_at = COALESCE(started_at, now()), updated_at = now(), error = NULL
    WHERE id = ${assessmentId}::uuid
      AND status NOT IN ('ready', 'insufficient', 'budget_exhausted')
      AND (lease_expires_at IS NULL OR lease_expires_at <= now())
    RETURNING id::text
  `;
  if (rows.length === 0) throw new JobLeaseLostError();
  return token;
}

async function assertAssessmentLease(assessmentId: string, token: string): Promise<void> {
  const rows = await esgPrisma.$queryRaw<Array<{ id: string }>>`
    SELECT id::text
    FROM article_ai_domain_assessments
    WHERE id = ${assessmentId}::uuid
      AND status = 'running'
      AND lease_token = ${token}::uuid
      AND lease_expires_at IS NOT NULL
      AND lease_expires_at > now()
  `;
  if (rows.length === 0) throw new JobLeaseLostError();
}

async function renewAssessmentLease(assessmentId: string, token: string): Promise<void> {
  const rows = await esgPrisma.$queryRaw<Array<{ id: string }>>`
    UPDATE article_ai_domain_assessments
    SET lease_expires_at = now() + (${LEASE_DURATION_SECONDS} * interval '1 second'), updated_at = now()
    WHERE id = ${assessmentId}::uuid AND status = 'running' AND lease_token = ${token}::uuid
      AND lease_expires_at IS NOT NULL AND lease_expires_at > now()
    RETURNING id::text
  `;
  if (!rows.length) throw new JobLeaseLostError();
}

async function assertWeeklyWindow(assessmentId: string, token: string): Promise<void> {
  const rows = await esgPrisma.$queryRaw<Array<{ email_at: Date }>>`
    SELECT email_at FROM article_ai_domain_assessments
    WHERE id = ${assessmentId}::uuid AND status = 'running' AND lease_token = ${token}::uuid
      AND lease_expires_at IS NOT NULL AND lease_expires_at > now()
  `;
  if (!rows.length) throw new JobLeaseLostError();
  if (new Date(rows[0].email_at).getTime() <= Date.now()) {
    await esgPrisma.$executeRaw`
      UPDATE article_ai_domain_assessments
      SET status = 'error', error = 'Weekly Article AI generation window expired before email',
          completed_at = now(), lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL, updated_at = now()
      WHERE id = ${assessmentId}::uuid AND status = 'running' AND lease_token = ${token}::uuid
    `;
    throw new WeeklyWindowExpiredError();
  }
}

async function markAssessmentError(assessmentId: string, token: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : "Weekly Article AI assessment failed";
  await esgPrisma.$executeRaw`
    UPDATE article_ai_domain_assessments
    SET status = 'error', error = ${message.slice(0, 2_000)}, updated_at = now(),
        lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL
    WHERE id = ${assessmentId}::uuid AND lease_token = ${token}::uuid
  `;
}

async function persistManifest(
  assessmentId: string,
  manifest: ArticleAiWeeklyManifestResult,
  leaseToken: string,
): Promise<ArticleAiWeeklyManifestResult> {
  const existingRows = await esgPrisma.$queryRaw<Array<{ manifest_hash: string | null }>>`
    SELECT manifest_hash FROM article_ai_domain_assessments WHERE id = ${assessmentId}::uuid
  `;
  if (existingRows[0]?.manifest_hash) {
    return loadPersistedManifest(assessmentId, manifest.coverage, existingRows[0].manifest_hash);
  }

  const allInputs = [...manifest.history, ...manifest.candidates];
  await esgPrisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ manifest_hash: string | null; lease_token: string | null }>>`
      SELECT manifest_hash, lease_token::text
      FROM article_ai_domain_assessments
      WHERE id = ${assessmentId}::uuid AND status = 'running' AND lease_token = ${leaseToken}::uuid
        AND lease_expires_at IS NOT NULL AND lease_expires_at > now() AND email_at > now()
      FOR UPDATE
    `;
    if (!locked[0] || locked[0].lease_token !== leaseToken) throw new JobLeaseLostError();
    if (locked[0].manifest_hash) return;
    for (let ordinal = 0; ordinal < allInputs.length; ordinal += 1) {
      const input = allInputs[ordinal];
      const id = randomUUID();
      const snapshot = { ...input, manifestId: id };
      await tx.$executeRaw`
        INSERT INTO article_ai_weekly_inputs (
          id, assessment_id, kind, domain, article_id, content_hash, title, summary,
          content, source, url, published_at, observed_at, eligible_at, first_seen_at,
          first_seen_known, source_period_start, source_period_end, carryover_from_week,
          exclusion_reason, snapshot_json, state, ordinal, created_at, updated_at
        ) VALUES (
          ${id}::uuid, ${assessmentId}::uuid, ${input.kind}, ${input.domain}, ${input.articleId},
          ${input.contentHash}, ${input.title}, ${input.summary}, ${input.content}, ${input.source},
          ${input.url}, ${input.publishedAt}::timestamptz, ${input.observedAt}::timestamptz,
          ${input.eligibleAt}::timestamptz, ${input.firstSeenAt}::timestamptz,
          ${input.firstSeenKnown}, ${input.sourcePeriodStart}::timestamptz, ${input.sourcePeriodEnd}::timestamptz,
          ${input.carryoverFromWeek}::date,
          ${input.exclusionReason}, ${JSON.stringify(snapshot)}::jsonb,
          ${input.exclusionReason ? "excluded" : "pending"}, ${ordinal}, now(), now()
        )
        ON CONFLICT (assessment_id, kind, article_id) DO UPDATE SET
          content_hash = EXCLUDED.content_hash, title = EXCLUDED.title, summary = EXCLUDED.summary,
          content = EXCLUDED.content, source = EXCLUDED.source, url = EXCLUDED.url,
          published_at = EXCLUDED.published_at, observed_at = EXCLUDED.observed_at,
          eligible_at = EXCLUDED.eligible_at, first_seen_at = EXCLUDED.first_seen_at,
          first_seen_known = EXCLUDED.first_seen_known, source_period_start = EXCLUDED.source_period_start,
          source_period_end = EXCLUDED.source_period_end, carryover_from_week = EXCLUDED.carryover_from_week,
          exclusion_reason = EXCLUDED.exclusion_reason, snapshot_json = EXCLUDED.snapshot_json,
          state = EXCLUDED.state, ordinal = EXCLUDED.ordinal, updated_at = now()
      `;
    }
    const updated = await tx.$queryRaw<Array<{ id: string }>>`
      UPDATE article_ai_domain_assessments
      SET manifest_hash = ${manifest.manifestHash}, manifest_cutoff_at = ${manifest.manifestCutoffAt},
          history_count = ${manifest.coverage.historyResolved}, coverage_json = ${JSON.stringify(manifest.coverage)}::jsonb,
          phase = 'history_profile', status = 'running', model = ${ARTICLE_AI_WEEKLY_MODEL}, updated_at = now()
      WHERE id = ${assessmentId}::uuid AND status = 'running' AND lease_token = ${leaseToken}::uuid
        AND lease_expires_at IS NOT NULL AND lease_expires_at > now() AND email_at > now()
      RETURNING id::text
    `;
    if (!updated.length) throw new JobLeaseLostError();
  }, { timeout: 30_000, maxWait: 5_000 });
  return loadPersistedManifest(assessmentId, manifest.coverage, manifest.manifestHash);
}

async function loadPersistedManifest(
  assessmentId: string,
  coverage: ArticleAiWeeklyCoverage,
  manifestHash: string,
): Promise<ArticleAiWeeklyManifestResult> {
  const rows = await esgPrisma.$queryRaw<Array<{
    id: string;
    kind: string;
    snapshot_json: ArticleAiWeeklyInputSnapshot;
  }>>`
    SELECT id::text, kind, snapshot_json
    FROM article_ai_weekly_inputs
    WHERE assessment_id = ${assessmentId}::uuid
    ORDER BY ordinal ASC, id ASC
  `;
  const inputs = rows.map((row) => ({ ...row.snapshot_json, manifestId: row.id }));
  const assessment = await esgPrisma.$queryRaw<Array<{ manifest_cutoff_at: Date }>>`
    SELECT manifest_cutoff_at FROM article_ai_domain_assessments WHERE id = ${assessmentId}::uuid
  `;
  return {
    history: inputs.filter((input) => input.kind === "history"),
    candidates: inputs.filter((input) => input.kind === "candidate"),
    coverage,
    manifestHash,
    manifestCutoffAt: assessment[0]?.manifest_cutoff_at ?? new Date(),
  };
}

async function getManifest(
  assessment: AssessmentRow,
  calendar: ArticleAiWeeklyCalendar,
  domain: ArticleAiDomain,
  leaseToken: string,
): Promise<ArticleAiWeeklyManifestResult> {
  if (assessment.manifest_hash) {
    const coverage = (assessment.coverage_json ?? {}) as ArticleAiWeeklyCoverage;
    return loadPersistedManifest(assessment.id, coverage, assessment.manifest_hash);
  }
  const cutoff = assessment.manifest_cutoff_at ?? new Date();
  if (!assessment.manifest_cutoff_at) {
    const rows = await esgPrisma.$queryRaw<Array<{ manifest_cutoff_at: Date }>>`
      UPDATE article_ai_domain_assessments
      SET manifest_cutoff_at = ${cutoff}, phase = 'manifest', status = 'running', updated_at = now()
      WHERE id = ${assessment.id}::uuid AND status = 'running' AND lease_token = ${leaseToken}::uuid
      RETURNING manifest_cutoff_at
    `;
    if (!rows.length) throw new JobLeaseLostError();
  }
  const generated = await loadWeeklyManifestInputs(domain, calendar, cutoff);
  return persistManifest(assessment.id, generated, leaseToken);
}

function prepareBatches(
  phase: ArticleAiWeeklyBatchPhase,
  inputs: ArticleAiWeeklyInputSnapshot[],
  maxBytes: number,
): PreparedBatch[] {
  const usable = inputs.filter((input) => !input.exclusionReason && fullText(input).length > 0);
  const batches: PreparedBatch[] = [];
  let currentInputs: ArticleAiWeeklyInputSnapshot[] = [];
  let currentFragments: ArticleAiWeeklyTextFragment[] = [];
  let batchIndex = 0;
  const flush = () => {
    if (!currentFragments.length) return;
    const providerInputs = currentInputs.map(providerInput);
    const inputHash = hashValue({
      promptVersion: ARTICLE_AI_WEEKLY_PROMPT_VERSION,
      model: ARTICLE_AI_WEEKLY_MODEL,
      policyVersion: ARTICLE_AI_WEEKLY_POLICY_VERSION,
      phase,
      inputs: providerInputs.map((input) => ({ id: input.manifestId, contentHash: input.contentHash })),
      fragments: currentFragments.map((fragment) => ({ id: fragment.fragmentId, hash: fragment.contentHash })),
    });
    batches.push({
      phase,
      level: 0,
      batchIndex,
      inputHash,
      stableBatchId: `${phase}:0:${batchIndex}:${inputHash.slice(0, 16)}`,
      databaseManifestIds: currentInputs.map((input) => input.manifestId),
      providerInputs,
      fragments: currentFragments,
    });
    batchIndex += 1;
    currentInputs = [];
    currentFragments = [];
  };
  for (const input of usable) {
    const fragments = splitText(input, Math.max(4_096, Math.floor(maxBytes / 2)));
    if (!fragments.length) continue;
    for (const fragment of fragments) {
      const candidateInputs = currentInputs.some((row) => row.manifestId === input.manifestId)
        ? currentInputs
        : [...currentInputs, input];
      const candidateFragments = [...currentFragments, fragment];
      const exceedsInput = inputSize(candidateInputs, candidateFragments) > maxBytes;
      const exceedsOutput = estimatedStructuredOutputBytes(phase, candidateInputs, candidateFragments) > MAX_MERGE_OUTPUT_BYTES;
      if (currentFragments.length && (exceedsInput || exceedsOutput)) {
        flush();
        currentInputs = [input];
        currentFragments = [fragment];
      } else {
        currentInputs = candidateInputs;
        currentFragments = candidateFragments;
      }
      if (inputSize(currentInputs, currentFragments) > maxBytes) {
        throw new WeeklyCoverageError(`Weekly ${phase} fragment exceeds the configured request bound`);
      }
      if (estimatedStructuredOutputBytes(phase, currentInputs, currentFragments) > MAX_MERGE_OUTPUT_BYTES) {
        throw new WeeklyCoverageError(`Weekly ${phase} batch cannot fit the structured output coverage bound`);
      }
    }
  }
  flush();
  return batches;
}

async function ensureBatch(
  assessmentId: string,
  plan: PreparedBatch,
  refsOverride?: Record<string, unknown>,
): Promise<BatchRow> {
  const refs = refsOverride ?? {
    manifestIds: plan.databaseManifestIds,
    logicalIds: plan.providerInputs.map((input) => input.manifestId),
    fragmentIds: plan.fragments.map((fragment) => fragment.fragmentId),
  };
  await esgPrisma.$executeRaw`
    INSERT INTO article_ai_weekly_batches (
      assessment_id, phase, level, batch_index, state, input_hash,
      input_count, input_refs_json, created_at, updated_at
    ) VALUES (
      ${assessmentId}::uuid, ${plan.phase}, ${plan.level}, ${plan.batchIndex}, 'queued',
        ${plan.inputHash}, ${refsOverride ? Number(refsOverride.childCount ?? 0) : plan.providerInputs.length}, ${JSON.stringify(refs)}::jsonb, now(), now()
    )
    ON CONFLICT (assessment_id, phase, level, batch_index, input_hash) DO NOTHING
  `;
  const rows = await esgPrisma.$queryRaw<BatchRow[]>`
    SELECT id::text, phase, level, batch_index, state, input_hash, input_refs_json,
           output_json, output_hash, eliminations_json, lease_token::text, lease_expires_at
    FROM article_ai_weekly_batches
    WHERE assessment_id = ${assessmentId}::uuid
      AND phase = ${plan.phase} AND level = ${plan.level}
      AND batch_index = ${plan.batchIndex} AND input_hash = ${plan.inputHash}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) throw new Error("Weekly Article AI batch disappeared");
  return row;
}

async function claimBatch(batchId: string): Promise<string> {
  const token = randomUUID();
  const rows = await esgPrisma.$queryRaw<Array<{ id: string }>>`
    UPDATE article_ai_weekly_batches
    SET state = 'running', lease_token = ${token}::uuid,
        lease_expires_at = now() + (${LEASE_DURATION_SECONDS} * interval '1 second'),
        attempt = attempt + 1, started_at = COALESCE(started_at, now()), updated_at = now(), error = NULL
    WHERE id = ${batchId}::uuid
      AND state <> 'ready'
      AND (lease_expires_at IS NULL OR lease_expires_at <= now())
    RETURNING id::text
  `;
  if (!rows.length) throw new JobLeaseLostError();
  return token;
}

async function readBatch(batchId: string): Promise<BatchRow | null> {
  const rows = await esgPrisma.$queryRaw<BatchRow[]>`
    SELECT id::text, phase, level, batch_index, state, input_hash, input_refs_json,
           output_json, output_hash, eliminations_json, lease_token::text, lease_expires_at
    FROM article_ai_weekly_batches WHERE id = ${batchId}::uuid LIMIT 1
  `;
  return rows[0] ?? null;
}

async function readCachedBatch(
  domain: ArticleAiDomain,
  phase: ArticleAiWeeklyBatchPhase,
  inputHash: string,
): Promise<{ output: unknown; outputHash: string } | null> {
  const rows = await esgPrisma.$queryRaw<Array<{ output_json: unknown; output_hash: string }>>`
    SELECT output_json, output_hash
    FROM article_ai_weekly_batch_cache
    WHERE domain = ${domain} AND policy_version = ${ARTICLE_AI_WEEKLY_POLICY_VERSION}
      AND model = ${ARTICLE_AI_WEEKLY_MODEL} AND phase = ${phase} AND input_hash = ${inputHash}
    LIMIT 1
  `;
  return rows[0] ? { output: rows[0].output_json, outputHash: rows[0].output_hash } : null;
}

async function readReadyBatchOutput(
  assessmentId: string,
  plan: PreparedBatch,
): Promise<{ output: unknown; outputHash: string } | null> {
  const rows = await esgPrisma.$queryRaw<Array<{ output_json: unknown; output_hash: string | null }>>`
    SELECT output_json, output_hash FROM article_ai_weekly_batches
    WHERE assessment_id = ${assessmentId}::uuid AND phase = ${plan.phase} AND level = ${plan.level}
      AND batch_index = ${plan.batchIndex} AND input_hash = ${plan.inputHash} AND state = 'ready'
    LIMIT 1
  `;
  return rows[0]?.output_json && rows[0].output_hash
    ? { output: rows[0].output_json, outputHash: rows[0].output_hash }
    : null;
}

async function reusableLeaf(
  assessmentId: string,
  domain: ArticleAiDomain,
  plan: PreparedBatch,
  profile: string | null,
): Promise<MergeChild | null> {
  const effective = effectiveWeeklyPlan(plan, profile);
  const stored = await readReadyBatchOutput(assessmentId, effective);
  const cached = stored ?? await readCachedBatch(domain, effective.phase, effective.inputHash);
  if (!cached) return null;
  if (effective.phase === "history_profile") validateHistoryOutput(cached.output, effective);
  else validateCandidateOutput(cached.output, effective);
  assertWeeklyOutputSize(cached.output);
  return { stableBatchId: plan.stableBatchId, outputHash: cached.outputHash, output: cached.output };
}

async function reusableMerge(
  assessmentId: string,
  domain: ArticleAiDomain,
  mergeKind: "history" | "candidate",
  level: number,
  batchIndex: number,
  children: MergeChild[],
): Promise<{ child: MergeChild | null; inputHash: string; inputBytes: number }> {
  const inputHash = hashValue({ promptVersion: ARTICLE_AI_WEEKLY_PROMPT_VERSION, mergeKind,
    children: children.map((child) => ({ id: child.stableBatchId, hash: child.outputHash })) });
  const phase = mergeKind === "history" ? "history_merge" : "candidate_merge" as const;
  const request = buildMergeRequestInput(domain, assessmentId, "preflight", inputHash, mergeKind, children);
  const plan: PreparedBatch = { phase, level, batchIndex, inputHash, stableBatchId: `${mergeKind}_merge:${level}:${batchIndex}:${inputHash.slice(0, 16)}`, databaseManifestIds: [], providerInputs: [], fragments: [] };
  const stored = await readReadyBatchOutput(assessmentId, plan);
  const cached = stored ?? await readCachedBatch(domain, phase, inputHash);
  if (!cached) return { child: null, inputHash, inputBytes: request.inputBytes };
  const output = validateMergeOutput(cached.output, children, mergeKind);
  if (Buffer.byteLength(JSON.stringify(output), "utf8") > MAX_MERGE_OUTPUT_BYTES) throw new WeeklyCoverageError("Weekly merge cache output exceeds the bounded merge contract");
  return { child: { stableBatchId: plan.stableBatchId, outputHash: cached.outputHash, output }, inputHash, inputBytes: request.inputBytes };
}

async function reserveBudget(assessmentId: string, token: string, inputBytes: number): Promise<number> {
  const config = getArticleAiConfig();
  const estimate = Math.max(1, inputBytes + config.weeklyBatchOutputTokens);
  const rows = await esgPrisma.$queryRaw<Array<{ id: string }>>`
    UPDATE article_ai_domain_assessments
    SET requests_reserved = requests_reserved + 1,
        tokens_reserved = tokens_reserved + ${estimate},
        lease_expires_at = now() + (${LEASE_DURATION_SECONDS} * interval '1 second'),
        updated_at = now()
    WHERE id = ${assessmentId}::uuid
      AND status = 'running' AND lease_token = ${token}::uuid
      AND lease_expires_at IS NOT NULL AND lease_expires_at > now()
      AND email_at > now()
      AND requests_reserved + 1 <= request_limit
      AND tokens_reserved + ${estimate} <= token_limit
    RETURNING id::text
  `;
  if (rows.length) return estimate;
  const state = await esgPrisma.$queryRaw<Array<{
    status: string;
    lease_token: string | null;
    lease_expires_at: Date | null;
    email_at: Date;
    requests_reserved: number;
    request_limit: number;
    tokens_reserved: number;
    token_limit: number;
  }>>`
    SELECT status, lease_token::text, lease_expires_at, requests_reserved, request_limit,
           tokens_reserved, token_limit, email_at
    FROM article_ai_domain_assessments WHERE id = ${assessmentId}::uuid LIMIT 1
  `;
  const current = state[0];
  if (current?.email_at && new Date(current.email_at).getTime() <= Date.now()) {
    await esgPrisma.$executeRaw`
      UPDATE article_ai_domain_assessments
      SET status = 'error', error = 'Weekly Article AI generation window expired before reservation',
          completed_at = now(), lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL, updated_at = now()
      WHERE id = ${assessmentId}::uuid AND status = 'running' AND lease_token = ${token}::uuid
    `;
    throw new WeeklyWindowExpiredError();
  }
  if (!current || current.status !== "running" || current.lease_token !== token
      || !current.lease_expires_at || new Date(current.lease_expires_at).getTime() <= Date.now()) {
    throw new JobLeaseLostError();
  }
  await esgPrisma.$queryRaw<Array<{ id: string }>>`
    UPDATE article_ai_domain_assessments
    SET status = 'budget_exhausted', error = 'Weekly Article AI budget exhausted',
        completed_at = now(), lease_owner = NULL, lease_token = NULL,
        lease_expires_at = NULL, updated_at = now()
    WHERE id = ${assessmentId}::uuid AND status = 'running' AND lease_token = ${token}::uuid
      AND lease_expires_at > now() AND email_at > now()
    RETURNING id::text
  `;
  throw new WeeklyBudgetExhaustedError();
}

async function preflightBudget(assessmentId: string, token: string, requestCount: number, tokenEstimate: number): Promise<void> {
  const rows = await esgPrisma.$queryRaw<Array<{
    request_limit: number;
    requests_reserved: number;
    token_limit: number;
    tokens_reserved: number;
    status: string;
    lease_token: string | null;
    lease_expires_at: Date | null;
    email_at: Date;
  }>>`
    SELECT request_limit, requests_reserved, token_limit, tokens_reserved, status,
           lease_token::text, lease_expires_at, email_at
    FROM article_ai_domain_assessments WHERE id = ${assessmentId}::uuid LIMIT 1
  `;
  const row = rows[0];
  if (row && new Date(row.email_at).getTime() <= Date.now()) {
    await esgPrisma.$executeRaw`
      UPDATE article_ai_domain_assessments
      SET status = 'error', error = 'Weekly Article AI generation window expired during preflight',
          completed_at = now(), lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL, updated_at = now()
      WHERE id = ${assessmentId}::uuid AND status = 'running' AND lease_token = ${token}::uuid
    `;
    throw new WeeklyWindowExpiredError();
  }
  if (!row || row.status !== "running" || row.lease_token !== token
      || !row.lease_expires_at || new Date(row.lease_expires_at).getTime() <= Date.now()) {
    throw new JobLeaseLostError();
  }
  if (row.requests_reserved + requestCount <= row.request_limit && row.tokens_reserved + tokenEstimate <= row.token_limit) return;
  const marked = await esgPrisma.$queryRaw<Array<{ id: string }>>`
    UPDATE article_ai_domain_assessments
    SET status = 'budget_exhausted', error = 'Weekly Article AI preflight budget exhausted',
        completed_at = now(), lease_owner = NULL, lease_token = NULL,
        lease_expires_at = NULL, updated_at = now()
    WHERE id = ${assessmentId}::uuid AND status = 'running' AND lease_token = ${token}::uuid
      AND lease_expires_at > now() AND email_at > now()
    RETURNING id::text
  `;
  if (!marked.length) throw new JobLeaseLostError();
  throw new WeeklyBudgetExhaustedError("Weekly Article AI budget cannot cover the complete DAG");
}

async function completeBatch(
  assessmentId: string,
  assessmentToken: string,
  batchId: string,
  batchToken: string,
  domain: ArticleAiDomain,
  phase: ArticleAiWeeklyBatchPhase,
  inputHash: string,
  output: unknown,
  outputHash: string,
  inputIds: string[],
  eliminations: unknown,
  inputTokens: number,
  outputTokens: number,
  requestCount: number,
  processedCount = inputIds.length,
): Promise<void> {
  await esgPrisma.$transaction(async (tx) => {
    const fences = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id::text
      FROM article_ai_domain_assessments
      WHERE id = ${assessmentId}::uuid AND status = 'running' AND lease_token = ${assessmentToken}::uuid
        AND lease_expires_at IS NOT NULL AND lease_expires_at > now() AND email_at > now()
      FOR UPDATE
    `;
    if (!fences.length) throw new JobLeaseLostError();
    const transitioned = await tx.$queryRaw<Array<{ id: string }>>`
      UPDATE article_ai_weekly_batches
      SET state = 'ready', processed_count = ${processedCount}, output_json = ${JSON.stringify(output)}::jsonb,
          output_hash = ${outputHash}, eliminations_json = ${JSON.stringify(eliminations ?? null)}::jsonb,
          input_tokens = ${inputTokens}, output_tokens = ${outputTokens}, request_count = ${requestCount},
          completed_at = now(), updated_at = now(), lease_token = NULL, lease_expires_at = NULL
      WHERE id = ${batchId}::uuid AND state = 'running' AND lease_token = ${batchToken}::uuid
        AND lease_expires_at IS NOT NULL AND lease_expires_at > now()
      RETURNING id::text
    `;
    if (!transitioned.length) throw new JobLeaseLostError();
    await tx.$executeRaw`
      INSERT INTO article_ai_weekly_batch_cache (
        domain, policy_version, model, phase, input_hash, input_count,
        output_json, output_hash, created_at, updated_at
      ) VALUES (
        ${domain}, ${ARTICLE_AI_WEEKLY_POLICY_VERSION}, ${ARTICLE_AI_WEEKLY_MODEL}, ${phase},
        ${inputHash}, ${processedCount}, ${JSON.stringify(output)}::jsonb,
        ${outputHash}, now(), now()
      )
      ON CONFLICT (domain, policy_version, model, phase, input_hash) DO NOTHING
    `;
    const accounting = await tx.$executeRaw`
      UPDATE article_ai_domain_assessments
      SET input_tokens = input_tokens + ${inputTokens}, output_tokens = output_tokens + ${outputTokens},
          request_count = request_count + ${requestCount}, updated_at = now()
      WHERE id = ${assessmentId}::uuid AND status = 'running' AND lease_token = ${assessmentToken}::uuid
        AND lease_expires_at IS NOT NULL AND lease_expires_at > now()
    `;
    if (!accounting) throw new JobLeaseLostError();
  }, { timeout: 30_000, maxWait: 5_000 });
}

function sortedUnique(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}

function requireExactIds(actual: string[], expected: string[], label: string): void {
  const actualSorted = sortedUnique(actual);
  const expectedSorted = sortedUnique(expected);
  if (actualSorted.length !== actual.length || actualSorted.length !== expectedSorted.length
      || actualSorted.some((value, index) => value !== expectedSorted[index])) {
    throw new WeeklyCoverageError(`Weekly ${label} coverage is incomplete`);
  }
}

function outputHash(output: unknown): string {
  return hashValue(output);
}

function parseOutput<T>(output: unknown, label: string): T {
  if (!output || typeof output !== "object") throw new WeeklyCoverageError(`Weekly ${label} output is missing`);
  return output as T;
}

function effectiveWeeklyPlan(plan: PreparedBatch, profile: string | null): PreparedBatch {
  return plan.phase === "candidate_evaluation"
    ? { ...plan, inputHash: hashValue({ promptVersion: ARTICLE_AI_WEEKLY_PROMPT_VERSION, baseInputHash: plan.inputHash, profileHash: hashValue(profile ?? "") }) }
    : plan;
}

function validateHistoryOutput(
  output: unknown,
  plan: PreparedBatch,
): ArticleAiWeeklyHistoryBatchResult {
  const result = parseOutput<ArticleAiWeeklyHistoryBatchResult>(output, "history");
  if (result.status !== "complete" || result.coverage !== "complete") {
    throw new WeeklyCoverageError("Weekly history provider did not complete coverage");
  }
  requireExactIds(result.coveredManifestIds, plan.providerInputs.map((input) => input.manifestId), "history manifest");
  requireExactIds(result.coveredFragmentIds, plan.fragments.map((fragment) => fragment.fragmentId), "history fragment");
  const allowed = new Set(plan.providerInputs.map((input) => input.manifestId));
  for (const facet of result.profileFacets) {
    for (const id of facet.evidenceManifestIds) {
      if (!allowed.has(id)) throw new WeeklyCoverageError("Weekly history evidence references an unknown manifest input");
    }
  }
  if (!result.summary.trim()) throw new WeeklyCoverageError("Weekly history provider returned an empty profile");
  return result;
}

function validateCandidateOutput(
  output: unknown,
  plan: PreparedBatch,
): ArticleAiWeeklyCandidateBatchResult {
  const result = parseOutput<ArticleAiWeeklyCandidateBatchResult>(output, "candidate");
  if (result.status !== "complete" || result.coverage !== "complete") {
    throw new WeeklyCoverageError("Weekly candidate provider did not complete coverage");
  }
  const expectedIds = plan.providerInputs.map((input) => input.manifestId);
  requireExactIds(result.coveredManifestIds, expectedIds, "candidate manifest");
  requireExactIds(result.coveredFragmentIds, plan.fragments.map((fragment) => fragment.fragmentId), "candidate fragment");
  requireExactIds(result.decisions.map((decision) => decision.manifestId), expectedIds, "candidate decision");
  if (result.decisions.filter((decision) => decision.action === "select").length > ARTICLE_AI_MAX_SHARED_SELECTIONS) {
    throw new WeeklyCoverageError("Weekly candidate batch exceeds the shared selection survivor limit");
  }
  const byId = new Map(plan.providerInputs.map((input) => [input.manifestId, input]));
  for (const decision of result.decisions) {
    const input = byId.get(decision.manifestId);
    if (!input || input.articleId !== decision.articleId) {
      throw new WeeklyCoverageError("Weekly candidate decision does not match its manifest input");
    }
  }
  const eliminatedIds = result.eliminated.map((item) => item.manifestId);
  requireExactIds(eliminatedIds, result.decisions.filter((decision) => decision.action === "abstain").map((decision) => decision.manifestId), "candidate elimination");
  for (const eliminated of result.eliminated) {
    if (!byId.has(eliminated.manifestId)) throw new WeeklyCoverageError("Weekly candidate elimination references an unknown input");
  }
  return result;
}

function descendantManifestIds(children: MergeChild[], mergeKind: "history" | "candidate"): string[] {
  const ids: string[] = [];
  for (const child of children) {
    const value = child.output as Record<string, unknown>;
    if (mergeKind === "history") {
      if (Array.isArray(value.coveredManifestIds)) ids.push(...value.coveredManifestIds.filter((id): id is string => typeof id === "string"));
      else if (Array.isArray(value.rationale)) ids.push(...(value.rationale as Array<{ manifestId?: unknown }>).map((item) => item.manifestId).filter((id): id is string => typeof id === "string"));
    } else if (Array.isArray(value.decisions)) {
      ids.push(...(value.decisions as Array<{ manifestId?: unknown; action?: unknown }>)
        .filter((item) => item.action === "select")
        .map((item) => item.manifestId).filter((id): id is string => typeof id === "string"));
    } else if (Array.isArray(value.selectedManifestIds)) {
      ids.push(...value.selectedManifestIds.filter((id): id is string => typeof id === "string"));
    } else {
      for (const key of ["rationale", "eliminated"]) {
        if (Array.isArray(value[key])) ids.push(...(value[key] as Array<{ manifestId?: unknown }>).map((item) => item.manifestId).filter((id): id is string => typeof id === "string"));
      }
    }
  }
  return sortedUnique(ids);
}

function validateMergeOutput(
  output: unknown,
  children: MergeChild[],
  mergeKind: "history" | "candidate",
): ArticleAiWeeklyMergeResult {
  const result = parseOutput<ArticleAiWeeklyMergeResult>(output, "merge");
  if (result.status !== "complete" || result.coverage !== "complete") {
    throw new WeeklyCoverageError(`Weekly ${mergeKind} merge did not complete coverage`);
  }
  requireExactIds(result.coveredChildBatchIds, children.map((child) => child.stableBatchId), `${mergeKind} merge child`);
  requireExactIds(result.childOutputHashes, children.map((child) => child.outputHash), `${mergeKind} merge hash`);
  const allowed = descendantManifestIds(children, mergeKind);
  const referenced = [
    ...result.selectedManifestIds,
    ...result.rationale.map((item) => item.manifestId),
    ...result.eliminated.map((item) => item.manifestId),
  ];
  if (referenced.some((id) => !allowed.includes(id))) {
    throw new WeeklyCoverageError(`Weekly ${mergeKind} merge references an unknown manifest input`);
  }
  if (sortedUnique(result.selectedManifestIds).length !== result.selectedManifestIds.length) {
    throw new WeeklyCoverageError(`Weekly ${mergeKind} merge contains duplicate selections`);
  }
  if (mergeKind === "candidate" && result.selectedManifestIds.length > ARTICLE_AI_MAX_SHARED_SELECTIONS) {
    throw new WeeklyCoverageError("Weekly candidate merge exceeds the shared selection limit");
  }
  if (result.rationale.some((item) => !allowed.includes(item.manifestId))
      || result.eliminated.some((item) => !allowed.includes(item.manifestId))) {
    throw new WeeklyCoverageError(`Weekly ${mergeKind} merge contains an unknown rationale or elimination`);
  }
  if (sortedUnique(result.rationale.map((item) => item.manifestId)).length !== result.rationale.length
      || sortedUnique(result.eliminated.map((item) => item.manifestId)).length !== result.eliminated.length) {
    throw new WeeklyCoverageError(`Weekly ${mergeKind} merge contains duplicate evidence`);
  }
  if (result.selectedManifestIds.some((id) => result.eliminated.some((item) => item.manifestId === id))) {
    throw new WeeklyCoverageError(`Weekly ${mergeKind} merge both selects and eliminates an input`);
  }
  if (result.selectedManifestIds.some((id) => !result.rationale.some((item) => item.manifestId === id))) {
    throw new WeeklyCoverageError(`Weekly ${mergeKind} merge selection lacks rationale`);
  }
  if (mergeKind === "candidate") {
    requireExactIds(
      [...result.selectedManifestIds, ...result.eliminated.map((item) => item.manifestId)],
      allowed,
      "candidate merge survivor partition",
    );
    requireExactIds(result.rationale.map((item) => item.manifestId), result.selectedManifestIds, "candidate merge rationale");
  }
  if (mergeKind === "history" && !result.mergedProfile.trim()) {
    throw new WeeklyCoverageError("Weekly history merge returned an empty profile");
  }
  if (mergeKind === "history" && Buffer.byteLength(result.mergedProfile, "utf8") > 16_000) {
    throw new WeeklyCoverageError("Weekly history merge profile exceeds the UTF-8 profile bound");
  }
  return result;
}

function profileTextFromHistory(result: ArticleAiWeeklyHistoryBatchResult): string {
  const facets = result.profileFacets.map((facet) => `${facet.name}: ${facet.summary}`).join("\n");
  const profile = [result.summary, facets].filter(Boolean).join("\n").slice(0, 16_000);
  if (Buffer.byteLength(profile, "utf8") > 16_000) throw new WeeklyCoverageError("Weekly history profile exceeds the UTF-8 profile bound");
  return profile;
}

function estimateProviderTokens(inputBytes: number): number {
  const config = getArticleAiConfig();
  // Reserve a conservative UTF-8 byte upper bound, not a bytes/4 average.
  return Math.max(1, inputBytes + config.weeklyBatchOutputTokens);
}

function mergeNodeCount(leafCount: number, fanout = 2): number {
  let current = leafCount;
  let total = 0;
  while (current > 1) {
    total += Math.floor(current / fanout);
    current = Math.ceil(current / fanout);
  }
  return total;
}

export function countArticleAiWeeklyMergeNodes(leafCount: number): number {
  return mergeNodeCount(leafCount);
}

function buildMergeRequestInput(
  domain: ArticleAiDomain,
  runId: string,
  batchId: string,
  inputHash: string,
  mergeKind: "history" | "candidate",
  children: MergeChild[],
) {
  return buildWeeklyMergeProviderRequest({
    domain,
    policyVersion: ARTICLE_AI_WEEKLY_POLICY_VERSION,
    model: ARTICLE_AI_WEEKLY_MODEL,
    runId,
    batchId,
    inputHash,
    mergeKind,
    childOutputs: children.map((child) => ({
      batchId: child.stableBatchId,
      outputHash: child.outputHash,
      output: child.output,
    })),
  });
}

function partitionMergeChildren(
  domain: ArticleAiDomain,
  runId: string,
  mergeKind: "history" | "candidate",
  children: MergeChild[],
  maxBytes: number,
): MergeChild[][] {
  const groups: MergeChild[][] = [];
  let current: MergeChild[] = [];
  for (const child of children) {
    const candidate = [...current, child];
    const hash = hashValue({ mergeKind, children: candidate.map((item) => ({ id: item.stableBatchId, hash: item.outputHash })) });
    const bytes = buildMergeRequestInput(domain, runId, "preflight", hash, mergeKind, candidate).inputBytes;
    if (current.length && bytes > maxBytes) {
      groups.push(current);
      current = [child];
    } else {
      current = candidate;
    }
    const currentHash = hashValue({ mergeKind, children: current.map((item) => ({ id: item.stableBatchId, hash: item.outputHash })) });
    if (buildMergeRequestInput(domain, runId, "preflight", currentHash, mergeKind, current).inputBytes > maxBytes) {
      throw new WeeklyCoverageError(`Weekly ${mergeKind} merge node exceeds the configured request bound`);
    }
  }
  if (current.length) groups.push(current);
  return groups;
}

async function markBatchError(batchId: string, batchToken: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : "Weekly Article AI batch failed";
  await esgPrisma.$executeRaw`
    UPDATE article_ai_weekly_batches
    SET state = 'error', error = ${message.slice(0, 2_000)}, updated_at = now(),
        lease_token = NULL, lease_expires_at = NULL
    WHERE id = ${batchId}::uuid AND state = 'running' AND lease_token = ${batchToken}::uuid
  `;
}

async function executeLeafBatch(
  job: ClaimedBackgroundJob,
  assessment: AssessmentRow,
  assessmentToken: string,
  domain: ArticleAiDomain,
  plan: PreparedBatch,
  profile: string | null,
): Promise<ExecutedLeafOutput> {
  const effectivePlan = effectiveWeeklyPlan(plan, profile);
  const row = await ensureBatch(assessment.id, effectivePlan);
  if (row.state === "ready") {
    if (!row.output_json || !row.output_hash) throw new WeeklyCoverageError("Weekly ready batch has no output hash");
    const output = effectivePlan.phase === "history_profile"
      ? validateHistoryOutput(row.output_json, effectivePlan)
      : validateCandidateOutput(row.output_json, effectivePlan);
    // Preserve the durable hash. Re-hashing JSONB-decoded output can change
    // when PostgreSQL canonicalizes object key order, invalidating merge
    // checkpoints on a retry.
    return { output, outputHash: row.output_hash };
  }
  const batchToken = await claimBatch(row.id);
  try {
    await renewAssessmentLease(assessment.id, assessmentToken);
    const cached = await readCachedBatch(domain, effectivePlan.phase, effectivePlan.inputHash);
    if (cached) {
      const output = effectivePlan.phase === "history_profile"
        ? validateHistoryOutput(cached.output, effectivePlan)
        : validateCandidateOutput(cached.output, effectivePlan);
      assertWeeklyOutputSize(output);
      await completeBatch(assessment.id, assessmentToken, row.id, batchToken, domain, effectivePlan.phase,
        effectivePlan.inputHash, output, cached.outputHash, effectivePlan.databaseManifestIds,
        effectivePlan.phase === "history_profile"
          ? (output as ArticleAiWeeklyHistoryBatchResult).profileFacets
          : (output as ArticleAiWeeklyCandidateBatchResult).eliminated, 0, 0, 0);
      return { output, outputHash: cached.outputHash };
    }
    await assertAssessmentLease(assessment.id, assessmentToken);
    await throwIfJobCancelled(job.id, job.leaseOwner);
    const request = effectivePlan.phase === "history_profile"
      ? buildWeeklyHistoryProviderRequest({ domain, policyVersion: ARTICLE_AI_WEEKLY_POLICY_VERSION, model: ARTICLE_AI_WEEKLY_MODEL,
          runId: assessment.id, batchId: row.id, inputHash: effectivePlan.inputHash, articles: effectivePlan.providerInputs, fragments: effectivePlan.fragments })
      : buildWeeklyCandidateProviderRequest({ domain, policyVersion: ARTICLE_AI_WEEKLY_POLICY_VERSION, model: ARTICLE_AI_WEEKLY_MODEL,
          runId: assessment.id, batchId: row.id, inputHash: effectivePlan.inputHash, profile: profile ?? "",
          candidates: effectivePlan.providerInputs, fragments: effectivePlan.fragments });
    await assertWeeklyWindow(assessment.id, assessmentToken);
    await reserveBudget(assessment.id, assessmentToken, request.inputBytes);
    await throwIfJobCancelled(job.id, job.leaseOwner);
    await assertAssessmentLease(assessment.id, assessmentToken);
    await assertWeeklyWindow(assessment.id, assessmentToken);
    const response = effectivePlan.phase === "history_profile"
      ? await requestWeeklyHistoryProfile({ domain, policyVersion: ARTICLE_AI_WEEKLY_POLICY_VERSION, model: ARTICLE_AI_WEEKLY_MODEL,
          runId: assessment.id, batchId: row.id, inputHash: effectivePlan.inputHash, articles: effectivePlan.providerInputs, fragments: effectivePlan.fragments })
      : await requestWeeklyCandidateBatch({ domain, policyVersion: ARTICLE_AI_WEEKLY_POLICY_VERSION, model: ARTICLE_AI_WEEKLY_MODEL,
          runId: assessment.id, batchId: row.id, inputHash: effectivePlan.inputHash, profile: profile ?? "",
          candidates: effectivePlan.providerInputs, fragments: effectivePlan.fragments });
    await throwIfJobCancelled(job.id, job.leaseOwner);
    await assertAssessmentLease(assessment.id, assessmentToken);
    await assertWeeklyWindow(assessment.id, assessmentToken);
    const output = effectivePlan.phase === "history_profile"
      ? validateHistoryOutput(response, effectivePlan)
      : validateCandidateOutput(response, effectivePlan);
    assertWeeklyOutputSize(output);
    const persistedOutputHash = outputHash(output);
    await completeBatch(assessment.id, assessmentToken, row.id, batchToken, domain, effectivePlan.phase,
      effectivePlan.inputHash, output, persistedOutputHash, effectivePlan.databaseManifestIds,
      effectivePlan.phase === "history_profile"
        ? (output as ArticleAiWeeklyHistoryBatchResult).profileFacets
        : (output as ArticleAiWeeklyCandidateBatchResult).eliminated,
      response.inputTokens, response.outputTokens, 1);
    return { output, outputHash: persistedOutputHash };
  } catch (error) {
    if (!(error instanceof JobLeaseLostError)) await markBatchError(row.id, batchToken, error);
    throw error;
  }
}

const MAX_MERGE_OUTPUT_BYTES = 24_000;

function assertWeeklyOutputSize(output: unknown): void {
  if (Buffer.byteLength(JSON.stringify(output), "utf8") > MAX_MERGE_OUTPUT_BYTES) {
    throw new WeeklyCoverageError("Weekly provider output exceeds the bounded merge contract");
  }
}

async function executeMergeNode(
  job: ClaimedBackgroundJob,
  assessment: AssessmentRow,
  assessmentToken: string,
  domain: ArticleAiDomain,
  mergeKind: "history" | "candidate",
  level: number,
  batchIndex: number,
  children: MergeChild[],
): Promise<MergeChild> {
  const config = getArticleAiConfig();
  if (children.length !== 2) throw new WeeklyCoverageError("Weekly merge tree requires binary nodes");
  if (children.some((child) => Buffer.byteLength(JSON.stringify(child.output), "utf8") > MAX_MERGE_OUTPUT_BYTES)) {
    throw new WeeklyCoverageError("Weekly merge child output exceeds the bounded merge contract");
  }
  const inputHash = hashValue({ promptVersion: ARTICLE_AI_WEEKLY_PROMPT_VERSION, mergeKind,
    children: children.map((child) => ({ id: child.stableBatchId, hash: child.outputHash })) });
  const stableBatchId = `${mergeKind}_merge:${level}:${batchIndex}:${inputHash.slice(0, 16)}`;
  const plan: PreparedBatch = {
    phase: mergeKind === "history" ? "history_merge" : "candidate_merge",
    level,
    batchIndex,
    inputHash,
    stableBatchId,
    databaseManifestIds: [],
    providerInputs: [],
    fragments: [],
  };
  const refs = {
    childBatchIds: children.map((child) => child.stableBatchId),
    childOutputHashes: children.map((child) => child.outputHash),
    childCount: children.length,
  };
  const row = await ensureBatch(assessment.id, plan, refs);
  if (row.state === "ready") {
    if (!row.output_json || !row.output_hash) throw new WeeklyCoverageError("Weekly ready merge has no output");
    const output = validateMergeOutput(row.output_json, children, mergeKind);
    return { stableBatchId, outputHash: row.output_hash, output };
  }
  const batchToken = await claimBatch(row.id);
  try {
    await renewAssessmentLease(assessment.id, assessmentToken);
    const cached = await readCachedBatch(domain, plan.phase, inputHash);
    if (cached) {
      const output = validateMergeOutput(cached.output, children, mergeKind);
      await completeBatch(assessment.id, assessmentToken, row.id, batchToken, domain, plan.phase,
        inputHash, output, cached.outputHash, [], output.eliminated, 0, 0, 0, children.length);
      return { stableBatchId, outputHash: cached.outputHash, output };
    }
    await assertAssessmentLease(assessment.id, assessmentToken);
    await throwIfJobCancelled(job.id, job.leaseOwner);
    const request = buildMergeRequestInput(domain, assessment.id, row.id, inputHash, mergeKind, children);
    if (request.inputBytes > config.weeklyMergeInputBytes) {
      throw new WeeklyCoverageError("Weekly merge request exceeds the configured input bound");
    }
    await assertWeeklyWindow(assessment.id, assessmentToken);
    await reserveBudget(assessment.id, assessmentToken, request.inputBytes);
    await throwIfJobCancelled(job.id, job.leaseOwner);
    await assertAssessmentLease(assessment.id, assessmentToken);
    await assertWeeklyWindow(assessment.id, assessmentToken);
    const response = await requestWeeklyMerge({
      domain, policyVersion: ARTICLE_AI_WEEKLY_POLICY_VERSION, model: ARTICLE_AI_WEEKLY_MODEL,
      runId: assessment.id, batchId: row.id, inputHash, mergeKind,
      childOutputs: children.map((child) => ({ batchId: child.stableBatchId, outputHash: child.outputHash, output: child.output })),
    });
    await throwIfJobCancelled(job.id, job.leaseOwner);
    await assertAssessmentLease(assessment.id, assessmentToken);
    await assertWeeklyWindow(assessment.id, assessmentToken);
    if (Buffer.byteLength(JSON.stringify(response), "utf8") > MAX_MERGE_OUTPUT_BYTES) {
      throw new WeeklyCoverageError("Weekly merge provider output exceeds the bounded merge contract");
    }
    const output = validateMergeOutput(response, children, mergeKind);
    await completeBatch(assessment.id, assessmentToken, row.id, batchToken, domain, plan.phase,
      inputHash, output, outputHash(output), [], output.eliminated,
      response.inputTokens, response.outputTokens, 1, children.length);
    return { stableBatchId, outputHash: outputHash(output), output };
  } catch (error) {
    if (!(error instanceof JobLeaseLostError)) await markBatchError(row.id, batchToken, error);
    throw error;
  }
}

async function runMergeTree(
  job: ClaimedBackgroundJob,
  assessment: AssessmentRow,
  assessmentToken: string,
  domain: ArticleAiDomain,
  mergeKind: "history" | "candidate",
  leaves: MergeChild[],
): Promise<{ root: MergeChild | null; nodeCount: number }> {
  if (leaves.length === 0) return { root: null, nodeCount: 0 };
  let current = leaves;
  let level = 1;
  let nodeCount = 0;
  while (current.length > 1) {
    const next: MergeChild[] = [];
    let batchIndex = 0;
    for (let index = 0; index < current.length; index += 2) {
      const pair = current.slice(index, index + 2);
      if (pair.length === 1) {
        next.push(pair[0]);
        continue;
      }
      next.push(await executeMergeNode(job, assessment, assessmentToken, domain, mergeKind, level, batchIndex, pair));
      batchIndex += 1;
      nodeCount += 1;
    }
    if (next.length >= current.length) {
      throw new WeeklyCoverageError(`Weekly ${mergeKind} merge tree did not reduce`);
    }
    current = next;
    level += 1;
  }
  return { root: current[0], nodeCount };
}

async function preflightDag(
  assessmentId: string,
  assessmentToken: string,
  domain: ArticleAiDomain,
  assessmentIdForPrompt: string,
  historyPlans: PreparedBatch[],
  candidatePlans: PreparedBatch[],
  existingProfile: string | null,
): Promise<void> {
  const config = getArticleAiConfig();
  let requestCount = 0;
  let tokenEstimate = 0;
  const maxMergeInput = config.weeklyMergeInputBytes;
  const historyChildren: Array<MergeChild | null> = [];
  for (const plan of historyPlans) {
    const reusable = await reusableLeaf(assessmentId, domain, plan, null);
    if (reusable) {
      historyChildren.push(reusable);
      continue;
    }
    const request = buildWeeklyHistoryProviderRequest({ domain, policyVersion: ARTICLE_AI_WEEKLY_POLICY_VERSION,
      model: ARTICLE_AI_WEEKLY_MODEL, runId: assessmentIdForPrompt, batchId: "preflight", inputHash: plan.inputHash,
      articles: plan.providerInputs, fragments: plan.fragments });
    if (request.inputBytes > config.weeklyBatchInputBytes) throw new WeeklyCoverageError("Weekly history batch exceeds the configured input bound");
    requestCount += 1;
    tokenEstimate += estimateProviderTokens(request.inputBytes);
    historyChildren.push(null);
  }
  const candidateChildren: Array<MergeChild | null> = [];
  for (const plan of candidatePlans) {
    const reusable = existingProfile ? await reusableLeaf(assessmentId, domain, plan, existingProfile) : null;
    if (reusable) {
      candidateChildren.push(reusable);
      continue;
    }
    const request = buildWeeklyCandidateProviderRequest({ domain, policyVersion: ARTICLE_AI_WEEKLY_POLICY_VERSION,
      model: ARTICLE_AI_WEEKLY_MODEL, runId: assessmentIdForPrompt, batchId: "preflight", inputHash: plan.inputHash,
      profile: "p".repeat(16_000), candidates: plan.providerInputs, fragments: plan.fragments });
    if (request.inputBytes > config.weeklyBatchInputBytes) throw new WeeklyCoverageError("Weekly candidate batch exceeds the configured input bound");
    requestCount += 1;
    tokenEstimate += estimateProviderTokens(request.inputBytes);
    candidateChildren.push(null);
  }
  const preflightMergeTree = async (mergeKind: "history" | "candidate", leaves: Array<MergeChild | null>) => {
    let current = leaves;
    let level = 1;
    while (current.length > 1) {
      const next: Array<MergeChild | null> = [];
      for (let index = 0; index < current.length; index += 2) {
        const pair = current.slice(index, index + 2);
        if (pair.length === 1) {
          next.push(pair[0]);
          continue;
        }
        if (pair[0] && pair[1]) {
          const reusable = await reusableMerge(assessmentId, domain, mergeKind, level, Math.floor(index / 2), [pair[0], pair[1]]);
          if (reusable.child) {
            next.push(reusable.child);
            continue;
          }
          if (reusable.inputBytes > config.weeklyMergeInputBytes) throw new WeeklyCoverageError("Weekly merge request exceeds the configured input bound");
          requestCount += 1;
          tokenEstimate += estimateProviderTokens(reusable.inputBytes);
          next.push(null);
          continue;
        }
        requestCount += 1;
        tokenEstimate += estimateProviderTokens(maxMergeInput);
        next.push(null);
      }
      if (next.length >= current.length) throw new WeeklyCoverageError(`Weekly ${mergeKind} preflight merge tree did not reduce`);
      current = next;
      level += 1;
    }
  };
  await preflightMergeTree("history", historyChildren);
  await preflightMergeTree("candidate", candidateChildren);
  if (config.weeklyMergeInputBytes < 2 * MAX_MERGE_OUTPUT_BYTES + WEEKLY_STRUCTURED_SCHEMA_OVERHEAD_BYTES + 2_000) {
    throw new WeeklyCoverageError("Weekly merge budget cannot fit two bounded child outputs");
  }
  await preflightBudget(assessmentId, assessmentToken, requestCount, tokenEstimate);
}

async function markInsufficient(
  assessmentId: string,
  assessmentToken: string,
  coverage: ArticleAiWeeklyCoverage,
): Promise<void> {
  const rows = await esgPrisma.$queryRaw<Array<{ id: string }>>`
    UPDATE article_ai_domain_assessments
    SET status = 'insufficient', profile_source = 'insufficient', history_count = ${coverage.historyResolved},
        coverage_json = ${JSON.stringify(coverage)}::jsonb, phase = 'history_profile',
        completed_at = now(), updated_at = now(), lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL
    WHERE id = ${assessmentId}::uuid AND status = 'running' AND lease_token = ${assessmentToken}::uuid
      AND lease_expires_at IS NOT NULL AND lease_expires_at > now()
    RETURNING id::text
  `;
  if (!rows.length) throw new JobLeaseLostError();
}

async function markManifestKindProcessed(
  assessmentId: string,
  assessmentToken: string,
  kind: "history" | "candidate",
): Promise<void> {
  const rows = await esgPrisma.$queryRaw<Array<{ id: string }>>`
    UPDATE article_ai_weekly_inputs
    SET state = 'processed', updated_at = now()
    WHERE assessment_id = ${assessmentId}::uuid AND kind = ${kind}
      AND exclusion_reason IS NULL AND state <> 'excluded'
      AND EXISTS (
        SELECT 1 FROM article_ai_domain_assessments a
        WHERE a.id = ${assessmentId}::uuid AND a.status = 'running'
          AND a.lease_token = ${assessmentToken}::uuid
          AND a.lease_expires_at IS NOT NULL AND a.lease_expires_at > now()
      )
    RETURNING id::text
  `;
  // An empty return is valid when this phase had no usable inputs; a lost lease is not.
  if (!rows.length) await assertAssessmentLease(assessmentId, assessmentToken);
}

async function persistRunningCoverage(
  assessmentId: string,
  assessmentToken: string,
  coverage: ArticleAiWeeklyCoverage,
  phase: "history_merge" | "candidate_merge",
): Promise<void> {
  const rows = await esgPrisma.$queryRaw<Array<{ id: string }>>`
    UPDATE article_ai_domain_assessments
    SET coverage_json = ${JSON.stringify(coverage)}::jsonb, phase = ${phase}, status = 'running', updated_at = now()
    WHERE id = ${assessmentId}::uuid AND status = 'running' AND lease_token = ${assessmentToken}::uuid
      AND lease_expires_at IS NOT NULL AND lease_expires_at > now()
    RETURNING id::text
  `;
  if (!rows.length) throw new JobLeaseLostError();
}

async function publishReady(
  assessment: AssessmentRow,
  assessmentToken: string,
  calendar: ArticleAiWeeklyCalendar,
  domain: ArticleAiDomain,
  manifest: ArticleAiWeeklyManifestResult,
  historyProfile: string,
  candidateInputs: ArticleAiWeeklyInputSnapshot[],
  candidateRoot: MergeChild | null,
  candidateLeaves: Array<{ plan: PreparedBatch; output: ArticleAiWeeklyCandidateBatchResult }>,
  coverage: ArticleAiWeeklyCoverage,
): Promise<ArticleAiWeeklyRunResult> {
  const byManifest = new Map(candidateInputs.map((input) => [stableInputId(input), input]));
  const leafDecisions = new Map<string, { confidence: number; reason: string; action: string }>();
  for (const leaf of candidateLeaves) {
    for (const decision of leaf.output.decisions) leafDecisions.set(decision.manifestId, decision);
  }
  const rootValue = candidateRoot?.output as Record<string, unknown> | undefined;
  const selectedManifestIds = Array.isArray(rootValue?.selectedManifestIds)
    ? rootValue.selectedManifestIds.filter((id): id is string => typeof id === "string")
    : Array.from(leafDecisions.entries()).filter(([, decision]) => decision.action === "select").map(([id]) => id);
  const rootReasons = new Map<string, string>();
  if (Array.isArray(rootValue?.rationale)) {
    for (const item of rootValue.rationale as Array<{ manifestId?: unknown; reason?: unknown }>) {
      if (typeof item.manifestId === "string" && typeof item.reason === "string") rootReasons.set(item.manifestId, item.reason);
    }
  }
  const selected = Array.from(new Set(selectedManifestIds)).map((manifestId) => {
    const input = byManifest.get(manifestId);
    const decision = leafDecisions.get(manifestId);
    return input ? { input, confidence: decision?.confidence ?? 0, reason: rootReasons.get(manifestId) ?? decision?.reason ?? "Selected by the shared weekly domain assessment" } : null;
  }).filter((item): item is { input: ArticleAiWeeklyInputSnapshot; confidence: number; reason: string } => Boolean(item))
    .sort((a, b) => b.confidence - a.confidence).slice(0, ARTICLE_AI_MAX_SHARED_SELECTIONS);
  const profileHash = hashValue({ manifestHash: manifest.manifestHash, profile: historyProfile });
  let expired = false;
  await esgPrisma.$transaction(async (tx) => {
    const fences = await tx.$queryRaw<Array<{ id: string; email_at: Date }>>`
      SELECT id::text, email_at FROM article_ai_domain_assessments
      WHERE id = ${assessment.id}::uuid AND status = 'running' AND lease_token = ${assessmentToken}::uuid
        AND lease_expires_at IS NOT NULL AND lease_expires_at > now()
      FOR UPDATE
    `;
    if (!fences.length) throw new JobLeaseLostError();
    if (new Date(fences[0].email_at).getTime() <= Date.now()) {
      await tx.$executeRaw`
        UPDATE article_ai_domain_assessments
        SET status = 'error', error = 'Weekly Article AI generation window expired before email',
            completed_at = now(), lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL, updated_at = now()
        WHERE id = ${assessment.id}::uuid AND status = 'running' AND lease_token = ${assessmentToken}::uuid
      `;
      expired = true;
      return;
    }
    for (const item of selected) {
      const contentHash = item.input.contentHash ?? weeklyArticleContentHash(item.input);
      await tx.$executeRaw`
        INSERT INTO article_ai_domain_selections (
          assessment_id, domain, article_id, reason, relevance_score,
          selected_at, expires_at, content_hash, model, created_at, updated_at
        ) VALUES (
          ${assessment.id}::uuid, ${domain}, ${item.input.articleId}, ${item.reason.slice(0, 2_000)},
          ${item.confidence}, now(), ${calendar.validUntil}, ${contentHash}, ${ARTICLE_AI_WEEKLY_MODEL}, now(), now()
        )
        ON CONFLICT (assessment_id, article_id) DO UPDATE SET
          reason = EXCLUDED.reason, relevance_score = EXCLUDED.relevance_score,
          expires_at = EXCLUDED.expires_at, content_hash = EXCLUDED.content_hash,
          model = EXCLUDED.model, updated_at = now()
      `;
    }
    const updated = await tx.$queryRaw<Array<{ id: string }>>`
      UPDATE article_ai_domain_assessments
      SET status = 'ready', profile_source = 'domain', history_count = ${manifest.coverage.historyResolved},
          profile_json = ${JSON.stringify({ summary: historyProfile, manifestHash: manifest.manifestHash })}::jsonb,
          content_hash = ${profileHash}, model = ${ARTICLE_AI_WEEKLY_MODEL}, phase = 'finalize',
          coverage_json = ${JSON.stringify(coverage)}::jsonb, completed_at = now(), updated_at = now(),
          error = NULL, lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL
      WHERE id = ${assessment.id}::uuid AND status = 'running' AND lease_token = ${assessmentToken}::uuid
        AND email_at > now()
      RETURNING id::text
    `;
    if (!updated.length) throw new JobLeaseLostError();
  }, { timeout: 30_000, maxWait: 5_000 });
  if (expired) throw new WeeklyWindowExpiredError();
  return {
    status: "ready",
    domain,
    targetWeekKey: calendar.targetWeekKey,
    selectionCount: selected.length,
    coverage,
    model: ARTICLE_AI_WEEKLY_MODEL,
  };
}

function coverageFromAssessment(row: AssessmentRow): ArticleAiWeeklyCoverage {
  return (row.coverage_json ?? {
    historyTotal: row.history_count,
    historyResolved: row.history_count,
    historyProcessed: 0,
    historyUnusable: 0,
    historyExcluded: 0,
    candidateTotal: 0,
    candidateProcessed: 0,
    candidateUnusable: 0,
    candidateExcluded: 0,
    candidateCarryover: 0,
    mergeLeaves: 0,
    mergeNodes: 0,
    mergeNodesCompleted: 0,
    status: "incomplete",
  }) as ArticleAiWeeklyCoverage;
}

export async function runArticleAiWeeklyAssessment(
  job: ClaimedBackgroundJob,
  payload: ArticleAiWeeklyJobPayload,
): Promise<ArticleAiWeeklyRunResult> {
  const calendar = getArticleAiWeeklyCalendar(payload.targetWeekKey);
  const now = new Date();
  const assessment = await ensureAssessment(payload.domain, calendar);
  if (isTerminal(assessment.status)) {
    return { status: assessment.status, domain: payload.domain, targetWeekKey: calendar.targetWeekKey,
      selectionCount: 0, coverage: coverageFromAssessment(assessment), model: ARTICLE_AI_WEEKLY_MODEL };
  }
  if (now < calendar.processingAt || now >= calendar.emailAt) {
    return { status: "expired", domain: payload.domain, targetWeekKey: calendar.targetWeekKey,
      selectionCount: 0, coverage: coverageFromAssessment(assessment), model: ARTICLE_AI_WEEKLY_MODEL };
  }
  const assessmentToken = await claimAssessment(assessment.id, job);
  try {
    const claimed = await readAssessment(assessment.id);
    if (!claimed) throw new Error("Weekly Article AI assessment disappeared after claim");
    const manifest = await getManifest(claimed, getArticleAiWeeklyCalendar(payload.targetWeekKey), payload.domain, assessmentToken);
    const historyUsable = manifest.history.filter((input) => !input.exclusionReason && fullText(input).length > 0);
    if (manifest.coverage.historyResolved < 1 || historyUsable.length < 1) {
      await markInsufficient(assessment.id, assessmentToken, manifest.coverage);
      return { status: "insufficient", domain: payload.domain, targetWeekKey: calendar.targetWeekKey,
        selectionCount: 0, coverage: { ...manifest.coverage, status: "complete" }, model: ARTICLE_AI_WEEKLY_MODEL };
    }
    const candidateUsable = manifest.candidates.filter((input) => !input.exclusionReason && fullText(input).length > 0);
    const batchBytes = getArticleAiConfig().weeklyBatchInputBytes;
    // Leave room for the structured envelope/system prompt and the full merged profile.
    const historyPlans = prepareBatches("history_profile", historyUsable, Math.max(8_192, batchBytes - WEEKLY_STRUCTURED_SCHEMA_OVERHEAD_BYTES - 4_000));
    const candidatePlans = prepareBatches("candidate_evaluation", candidateUsable, Math.max(8_192, batchBytes - WEEKLY_STRUCTURED_SCHEMA_OVERHEAD_BYTES - 20_000));
    if (!historyPlans.length) {
      await markInsufficient(assessment.id, assessmentToken, manifest.coverage);
      return { status: "insufficient", domain: payload.domain, targetWeekKey: calendar.targetWeekKey,
        selectionCount: 0, coverage: { ...manifest.coverage, status: "complete" }, model: ARTICLE_AI_WEEKLY_MODEL };
    }
    const existingProfile = claimed.profile_json && typeof claimed.profile_json === "object"
      && typeof (claimed.profile_json as { summary?: unknown }).summary === "string"
      ? (claimed.profile_json as { summary: string }).summary
      : null;
    await preflightDag(assessment.id, assessmentToken, payload.domain, assessment.id, historyPlans, candidatePlans, existingProfile);
    const historyLeaves: MergeChild[] = [];
    for (const plan of historyPlans) {
      const executed = await executeLeafBatch(job, claimed, assessmentToken, payload.domain, plan, null);
      const output = executed.output as ArticleAiWeeklyHistoryBatchResult;
      historyLeaves.push({ stableBatchId: plan.stableBatchId, outputHash: executed.outputHash, output });
    }
    const historyTree = await runMergeTree(job, claimed, assessmentToken, payload.domain, "history", historyLeaves);
    if (!historyTree.root) throw new WeeklyCoverageError("Weekly history DAG produced no root");
    await markManifestKindProcessed(assessment.id, assessmentToken, "history");
    await persistRunningCoverage(assessment.id, assessmentToken, {
      ...manifest.coverage, historyProcessed: historyUsable.length,
      mergeLeaves: historyPlans.length, mergeNodes: historyTree.nodeCount,
      mergeNodesCompleted: historyTree.nodeCount, status: "incomplete",
    }, "history_merge");
    const historyRoot = historyTree.root.output as ArticleAiWeeklyHistoryBatchResult | ArticleAiWeeklyMergeResult;
    const historyProfile = "mergedProfile" in historyRoot ? historyRoot.mergedProfile : profileTextFromHistory(historyRoot);
    await esgPrisma.$executeRaw`
      UPDATE article_ai_domain_assessments
      SET profile_json = ${JSON.stringify({ summary: historyProfile, manifestHash: manifest.manifestHash })}::jsonb,
          content_hash = ${hashValue({ manifestHash: manifest.manifestHash, profile: historyProfile })},
          updated_at = now()
      WHERE id = ${assessment.id}::uuid AND status = 'running' AND lease_token = ${assessmentToken}::uuid
    `;
    await esgPrisma.$executeRaw`
      UPDATE article_ai_domain_assessments SET phase = 'candidate_evaluation', status = 'running', updated_at = now()
      WHERE id = ${assessment.id}::uuid AND status = 'running' AND lease_token = ${assessmentToken}::uuid
    `;
    const candidateLeaves: Array<{ plan: PreparedBatch; output: ArticleAiWeeklyCandidateBatchResult }> = [];
    const candidateChildren: MergeChild[] = [];
    for (const plan of candidatePlans) {
      const executed = await executeLeafBatch(job, claimed, assessmentToken, payload.domain, plan, historyProfile);
      const output = executed.output as ArticleAiWeeklyCandidateBatchResult;
      candidateLeaves.push({ plan, output });
      candidateChildren.push({ stableBatchId: plan.stableBatchId, outputHash: executed.outputHash, output });
    }
    const candidateTree = await runMergeTree(job, claimed, assessmentToken, payload.domain, "candidate", candidateChildren);
    await markManifestKindProcessed(assessment.id, assessmentToken, "candidate");
    const coverage: ArticleAiWeeklyCoverage = {
      ...manifest.coverage,
      historyProcessed: historyUsable.length,
      candidateProcessed: candidateUsable.length,
      mergeLeaves: historyPlans.length + candidatePlans.length,
      mergeNodes: historyTree.nodeCount + candidateTree.nodeCount,
      mergeNodesCompleted: historyTree.nodeCount + candidateTree.nodeCount,
      status: "complete",
    };
    return publishReady(assessment, assessmentToken, calendar, payload.domain, manifest, historyProfile,
      candidateUsable, candidateTree.root, candidateLeaves, coverage);
  } catch (error) {
    if (error instanceof JobLeaseLostError) throw error;
    if (error instanceof WeeklyWindowExpiredError) {
      return { status: "expired", domain: payload.domain, targetWeekKey: calendar.targetWeekKey,
        selectionCount: 0, coverage: coverageFromAssessment(assessment), model: ARTICLE_AI_WEEKLY_MODEL };
    }
    if (error instanceof WeeklyBudgetExhaustedError) {
      const current = await readAssessment(assessment.id);
      return { status: "budget_exhausted", domain: payload.domain, targetWeekKey: calendar.targetWeekKey,
        selectionCount: 0, coverage: current ? coverageFromAssessment(current) : { ...coverageFromAssessment(assessment), status: "incomplete" },
        model: ARTICLE_AI_WEEKLY_MODEL };
    }
    await markAssessmentError(assessment.id, assessmentToken, error);
    throw error;
  }
}
