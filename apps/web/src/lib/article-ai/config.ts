import "server-only";

/**
 * Article AI is deliberately disabled until a deployment opts in. Keep these
 * switches outside the shared env schema so a disabled deployment can boot
 * before the additive migration is present.
 */
export interface ArticleAiConfig {
  enabled: boolean;
  emailEnabled: boolean;
  model: string;
  maxCandidates: number;
  dailyRequestLimit: number;
  dailyTokenLimit: number;
  selectionTtlDays: number;
  maxHistoryExamples: number;
}

function positiveInt(value: string | undefined, fallback: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

export function getArticleAiConfig(): ArticleAiConfig {
  const model = (process.env.ARTICLE_AI_MODEL || process.env.OPENAI_ESG_DRIVERS_MODEL || "gpt-5.6-luna").trim();
  return {
    enabled: process.env.ARTICLE_AI_ENABLED === "true",
    emailEnabled: process.env.ARTICLE_AI_EMAIL_ENABLED === "true",
    model: model || "gpt-5.6-luna",
    maxCandidates: positiveInt(process.env.ARTICLE_AI_MAX_CANDIDATES, 40, 100),
    dailyRequestLimit: positiveInt(process.env.ARTICLE_AI_DAILY_REQUEST_LIMIT, 2, 10),
    dailyTokenLimit: positiveInt(process.env.ARTICLE_AI_DAILY_TOKEN_LIMIT, 12_000, 100_000),
    selectionTtlDays: positiveInt(process.env.ARTICLE_AI_SELECTION_TTL_DAYS, 8, 31),
    maxHistoryExamples: Math.max(1, positiveInt(process.env.ARTICLE_AI_MAX_HISTORY_EXAMPLES, 200, 200)),
  };
}

export function isArticleAiEnabled(): boolean {
  return getArticleAiConfig().enabled;
}

export function isArticleAiEmailEnabled(): boolean {
  const config = getArticleAiConfig();
  return config.enabled && config.emailEnabled;
}
