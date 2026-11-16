import "server-only";

/**
 * Article AI is deliberately disabled until a deployment opts in. Weekly v3
 * uses fixed Dubai calendar times and an exact provider model; only bounded
 * budget and request-size controls are configurable.
 */
export interface ArticleAiConfig {
  enabled: boolean;
  emailEnabled: boolean;
  model: "gpt-6-luna";
  weeklyTimezone: "Asia/Dubai";
  weeklyProcessHour: 0;
  weeklyProcessMinute: 15;
  weeklyEmailHour: 9;
  weeklyRequestLimit: number;
  weeklyTokenLimit: number;
  weeklyBatchInputBytes: number;
  weeklyBatchOutputTokens: number;
  weeklyMergeInputBytes: number;

  /** @deprecated Retained only while retired v1/v2 consumers drain. */
  maxCandidates: number;
  /** @deprecated Retained only while retired v1/v2 consumers drain. */
  dailyRequestLimit: number;
  /** @deprecated Retained only while retired v1/v2 consumers drain. */
  dailyTokenLimit: number;
  /** @deprecated v3 validity is derived from the weekly calendar. */
  selectionTtlDays: number;
  /** @deprecated v3 sends complete manifests, not a history sample. */
  maxHistoryExamples: number;
}

function positiveInt(value: string | undefined, fallback: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

export function getArticleAiConfig(): ArticleAiConfig {
  return {
    enabled: process.env.ARTICLE_AI_ENABLED === "true",
    emailEnabled: process.env.ARTICLE_AI_EMAIL_ENABLED === "true",
    model: "gpt-6-luna",
    weeklyTimezone: "Asia/Dubai",
    weeklyProcessHour: 0,
    weeklyProcessMinute: 15,
    weeklyEmailHour: 9,
    weeklyRequestLimit: positiveInt(process.env.ARTICLE_AI_WEEKLY_REQUEST_LIMIT, 128, 1_024),
    weeklyTokenLimit: positiveInt(process.env.ARTICLE_AI_WEEKLY_TOKEN_LIMIT, 4_000_000, 8_000_000),
    weeklyBatchInputBytes: positiveInt(process.env.ARTICLE_AI_WEEKLY_BATCH_INPUT_BYTES, 60_000, 120_000),
    weeklyBatchOutputTokens: positiveInt(process.env.ARTICLE_AI_WEEKLY_BATCH_OUTPUT_TOKENS, 8_192, 8_192),
    weeklyMergeInputBytes: positiveInt(process.env.ARTICLE_AI_WEEKLY_MERGE_INPUT_BYTES, 60_000, 120_000),

    // Legacy compatibility values. Weekly v3 code must not use these as
    // history/candidate caps or as its durable budget.
    maxCandidates: positiveInt(process.env.ARTICLE_AI_MAX_CANDIDATES, 40, 100),
    dailyRequestLimit: positiveInt(process.env.ARTICLE_AI_DAILY_REQUEST_LIMIT, 2, 10),
    dailyTokenLimit: positiveInt(process.env.ARTICLE_AI_DAILY_TOKEN_LIMIT, 12_000, 100_000),
    selectionTtlDays: positiveInt(process.env.ARTICLE_AI_SELECTION_TTL_DAYS, 8, 31),
    maxHistoryExamples: positiveInt(process.env.ARTICLE_AI_MAX_HISTORY_EXAMPLES, 200, 200),
  };
}

export function isArticleAiEnabled(): boolean {
  return getArticleAiConfig().enabled;
}

export function isArticleAiEmailEnabled(): boolean {
  const config = getArticleAiConfig();
  return config.enabled && config.emailEnabled;
}
