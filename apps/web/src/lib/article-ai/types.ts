/** Shared wire contracts. This module must remain safe to import in the browser. */
export type ArticleAiDomain = "esg" | "credit";

export const ARTICLE_AI_PERSONAL_HISTORY_MINIMUM = 20;
export const ARTICLE_AI_MAX_WEEKLY_PICKS = 5;

export interface ArticleAiPreference {
  domain: ArticleAiDomain;
  enabled: boolean;
  settingsVersion: number;
  historyCount: number;
  profileSource: "personal" | "team" | "insufficient";
  weeklyDigestConfigured: boolean;
  status: "off" | "queued" | "ready" | "insufficient_history" | "error" | "preview";
  lastRunAt: string | null;
  /** Whether this deployment currently permits AI inclusion in weekly email. */
  emailInclusionEnabled: boolean;
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
}

export interface ArticleAiJobPayload {
  domain: ArticleAiDomain;
  settingsVersion: number;
  /** UTC date for the bounded daily run and its idempotency key. */
  runDate: string;
}

export function isArticleAiDomain(value: unknown): value is ArticleAiDomain {
  return value === "esg" || value === "credit";
}
