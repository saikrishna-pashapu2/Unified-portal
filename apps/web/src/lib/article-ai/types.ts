/** Shared wire contracts. This module must remain safe to import in the browser. */
export type ArticleAiDomain = "esg" | "credit";

/** Policy 2 is retained only for draining the retired daily implementation. */
export const ARTICLE_AI_V2_POLICY_VERSION = 2;
export const ARTICLE_AI_WEEKLY_POLICY_VERSION = 3;
/** Daily shared domain assessments. Human history is pooled by domain. */
export const ARTICLE_AI_DAILY_POLICY_VERSION = 4;
export const ARTICLE_AI_POLICY_VERSION = ARTICLE_AI_WEEKLY_POLICY_VERSION;
export const ARTICLE_AI_DOMAIN_HISTORY_MINIMUM = 1;
export const ARTICLE_AI_MAX_SHARED_SELECTIONS = 20;
export const ARTICLE_AI_MAX_WEEKLY_PICKS = 5;

export type ArticleAiWeeklyStatus =
  | "queued"
  | "manifesting"
  | "assessing_history"
  | "merging_history"
  | "evaluating_candidates"
  | "merging_candidates"
  | "ready"
  | "error"
  | "budget_exhausted"
  | "insufficient_history"
  | "expired"
  | "cancelled";

export type ArticleAiWeeklyPhase =
  | "manifest"
  | "history_profile"
  | "history_merge"
  | "candidate_evaluation"
  | "candidate_merge"
  | "finalize";

export type ArticleAiWeeklyInputKind = "history" | "candidate";
export type ArticleAiWeeklyInputState = "pending" | "assigned" | "processed" | "excluded";
export type ArticleAiWeeklyBatchPhase =
  | "history_profile"
  | "history_merge"
  | "candidate_evaluation"
  | "candidate_merge";
export type ArticleAiWeeklyBatchState = "queued" | "running" | "ready" | "error";

export interface ArticleAiWeeklyCoverage {
  historyTotal: number;
  historyResolved: number;
  historyProcessed: number;
  historyUnusable: number;
  historyExcluded: number;
  candidateTotal: number;
  candidateProcessed: number;
  candidateUnusable: number;
  candidateExcluded: number;
  candidateCarryover: number;
  mergeLeaves: number;
  mergeNodes: number;
  mergeNodesCompleted: number;
  status: "complete" | "incomplete";
}

export interface ArticleAiWeeklySummary {
  targetWeekKey: string;
  sourceStart: string;
  sourceEnd: string;
  processingAt: string;
  emailAt: string;
  validUntil: string;
  timezone: "Asia/Dubai";
  model: string;
  status: ArticleAiWeeklyStatus;
  phase: ArticleAiWeeklyPhase;
  coverage: ArticleAiWeeklyCoverage;
  selectionCount: number;
  completedAt: string | null;
  assessmentSummary: string | null;
}

export interface ArticleAiPreference {
  domain: ArticleAiDomain;
  enabled: boolean;
  settingsVersion: number;
  historyCount: number;
  profileSource: "domain" | "insufficient";
  weeklyDigestConfigured: boolean;
  /** Legacy preference status retained for existing consumers. */
  status: "off" | "queued" | "ready" | "insufficient_history" | "error" | "preview";
  lastRunAt: string | null;
  /** Whether this deployment currently permits AI inclusion in weekly email. */
  emailInclusionEnabled: boolean;
  /** Shared weekly run state; independent of this user's enabled switch. */
  weekly: ArticleAiWeeklySummary | null;
  /** Latest shared daily run; the source day is a Dubai calendar date. */
  daily?: { sourceDay: string; status: ArticleAiWeeklyStatus; selectionCount: number };
  /** True when the recipient's alert schedule is not the canonical Monday 09:00 Dubai schedule. */
  scheduleMismatch: boolean;
}

export interface ArticleAiSelection {
  articleId: number;
  domain: ArticleAiDomain;
  state: "selected" | "confirmed" | "dismissed";
  reason: string;
  version: number;
  selectedAt: string;
  expiresAt: string;
  pendingConfirmation: boolean;
  sharedSelectionId: string | null;
  assessmentDate: string | null;
  policyVersion: number;
  targetWeekKey: string | null;
}

export interface ArticleAiFeedbackResult {
  selection: ArticleAiSelection;
  humanLiked: boolean;
  pending: boolean;
}

/** Private per-recipient items. Never feed these into public like counts. */
export interface ArticleAiDigestPick {
  articleId: number;
  domain: ArticleAiDomain;
  title: string;
  url: string;
  source: string;
  publishedAt: string | null;
  reason: string;
  contentHash: string;
  sharedSelectionId: string;
  assessmentDate: string;
  policyVersion: number;
  targetWeekKey: string;
}

/** Retained so retired v1/v2 rows can be parsed and fenced safely. */
export interface ArticleAiJobPayload {
  domain: ArticleAiDomain;
  settingsVersion: number;
  runDate: string;
  policyVersion?: number;
}

/** Retired daily v2 payload. New jobs must use ArticleAiWeeklyJobPayload. */
export interface ArticleAiDomainJobPayload {
  domain: ArticleAiDomain;
  runDate: string;
  policyVersion: typeof ARTICLE_AI_V2_POLICY_VERSION;
}

/** The only payload shape accepted by v3 workers. Calendar boundaries are derived server-side. */
export interface ArticleAiWeeklyJobPayload {
  domain: ArticleAiDomain;
  targetWeekKey: string;
  policyVersion: typeof ARTICLE_AI_WEEKLY_POLICY_VERSION;
}

/** Daily jobs process the preceding Dubai calendar day. */
export interface ArticleAiDailyJobPayload {
  domain: ArticleAiDomain;
  sourceDayKey: string;
  policyVersion: typeof ARTICLE_AI_DAILY_POLICY_VERSION;
}

export interface ArticleAiWeeklyInputSnapshot {
  manifestId: string;
  kind: ArticleAiWeeklyInputKind;
  domain: ArticleAiDomain;
  articleId: number;
  contentHash: string | null;
  title: string | null;
  summary: string | null;
  content: string | null;
  source: string | null;
  url: string | null;
  publishedAt: string | null;
  observedAt: string;
  eligibleAt: string | null;
  firstSeenAt: string | null;
  firstSeenKnown: boolean;
  sourcePeriodStart: string | null;
  sourcePeriodEnd: string | null;
  carryoverFromWeek: string | null;
  exclusionReason: string | null;
}

export interface ArticleAiWeeklyTextFragment {
  fragmentId: string;
  manifestId: string;
  fragmentIndex: number;
  fragmentCount: number;
  contentHash: string;
  text: string;
}

export interface ArticleAiWeeklyManifestResult {
  history: ArticleAiWeeklyInputSnapshot[];
  candidates: ArticleAiWeeklyInputSnapshot[];
  coverage: ArticleAiWeeklyCoverage;
  manifestHash: string;
  manifestCutoffAt: Date;
}

export interface ArticleAiWeeklyHistoryBatchRequest {
  domain: ArticleAiDomain;
  /** The keyed provider contract is shared by weekly v3 and daily v4. */
  policyVersion: number;
  model: "gpt-6-luna";
  runId: string;
  batchId: string;
  inputHash: string;
  articles: ArticleAiWeeklyInputSnapshot[];
  fragments: ArticleAiWeeklyTextFragment[];
}

export interface ArticleAiWeeklyHistoryBatchResult {
  status: "complete";
  coveredManifestIds: string[];
  coveredFragmentIds: string[];
  profileFacets: Array<{ name: string; evidenceManifestIds: string[]; summary: string }>;
  summary: string;
  coverage: "complete";
  model: "gpt-6-luna";
  inputTokens: number;
  outputTokens: number;
}

export interface ArticleAiWeeklyCandidateBatchRequest {
  domain: ArticleAiDomain;
  policyVersion: number;
  model: "gpt-6-luna";
  runId: string;
  batchId: string;
  inputHash: string;
  profile: string;
  candidates: ArticleAiWeeklyInputSnapshot[];
  fragments: ArticleAiWeeklyTextFragment[];
}

export interface ArticleAiWeeklyCandidateDecision {
  manifestId: string;
  articleId: number;
  action: "select" | "abstain";
  confidence: number;
  reason: string;
}

export interface ArticleAiWeeklyCandidateBatchResult {
  status: "complete";
  decisions: ArticleAiWeeklyCandidateDecision[];
  coveredManifestIds: string[];
  coveredFragmentIds: string[];
  eliminated: Array<{ manifestId: string; reason: string }>;
  coverage: "complete";
  model: "gpt-6-luna";
  inputTokens: number;
  outputTokens: number;
}

export interface ArticleAiWeeklyMergeRequest {
  domain: ArticleAiDomain;
  policyVersion: number;
  model: "gpt-6-luna";
  runId: string;
  batchId: string;
  inputHash: string;
  mergeKind: "history" | "candidate";
  childOutputs: Array<{ batchId: string; outputHash: string; output: unknown }>;
}

export interface ArticleAiWeeklyMergeResult {
  status: "complete";
  mergedProfile: string;
  selectedManifestIds: string[];
  rationale: Array<{ manifestId: string; reason: string }>;
  eliminated: Array<{ manifestId: string; reason: string }>;
  coveredChildBatchIds: string[];
  childOutputHashes: string[];
  coverage: "complete";
  model: "gpt-6-luna";
  inputTokens: number;
  outputTokens: number;
}

export function isArticleAiDomain(value: unknown): value is ArticleAiDomain {
  return value === "esg" || value === "credit";
}

export function isArticleAiWeeklyPolicy(value: unknown): value is typeof ARTICLE_AI_WEEKLY_POLICY_VERSION {
  return value === ARTICLE_AI_WEEKLY_POLICY_VERSION;
}

export function isArticleAiDailyPolicy(value: unknown): value is typeof ARTICLE_AI_DAILY_POLICY_VERSION {
  return value === ARTICLE_AI_DAILY_POLICY_VERSION;
}
