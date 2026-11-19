import "server-only";

import { getArticleAiDailyCalendar } from "./daily-calendar";
import { loadDailyManifestInputs } from "./daily-inputs";
import {
  ARTICLE_AI_DAILY_POLICY_VERSION,
  type ArticleAiDailyJobPayload,
  type ArticleAiDomain,
} from "./types";
import {
  ARTICLE_AI_WEEKLY_MODEL,
  ARTICLE_AI_WEEKLY_PROMPT_VERSION,
} from "./weekly-provider";
import {
  runArticleAiAssessmentWithRuntime,
  type ArticleAiEngineRuntime,
  type ArticleAiWeeklyRunResult,
} from "./weekly";
import type { ArticleAiWeeklyCalendar } from "./weekly-calendar";
import type { ClaimedBackgroundJob } from "@/lib/jobs/queue";

export interface ArticleAiDailyRunResult {
  status: string;
  domain: ArticleAiDomain;
  sourceDayKey: string;
  selectionCount: number;
  coverage: ArticleAiWeeklyRunResult["coverage"];
  model: typeof ARTICLE_AI_WEEKLY_MODEL;
}

function dailyEngineCalendar(sourceDayKey: string): {
  daily: ReturnType<typeof getArticleAiDailyCalendar>;
  engine: ArticleAiWeeklyCalendar;
} {
  const daily = getArticleAiDailyCalendar(sourceDayKey);
  // The shared DAG uses email_at as its durable processing fence. Daily runs
  // never enqueue email; this adapter simply maps that fence to the next
  // 00:15 recovery boundary while selections use valid_until for feed TTL.
  const engine: ArticleAiWeeklyCalendar = {
    targetWeekKey: daily.sourceDayKey,
    sourceStart: daily.sourceStart,
    sourceEnd: daily.sourceEnd,
    processingAt: daily.processingAt,
    emailAt: daily.generationValidUntil,
    validUntil: daily.validUntil,
    timezone: "Asia/Dubai",
  };
  return { daily, engine };
}

/** Run the validated complete-manifest/history/candidate DAG for policy 4. */
export async function runArticleAiDailyAssessment(
  job: ClaimedBackgroundJob,
  payload: ArticleAiDailyJobPayload,
): Promise<ArticleAiDailyRunResult> {
  const { daily, engine } = dailyEngineCalendar(payload.sourceDayKey);
  const runtime: ArticleAiEngineRuntime = {
    policyVersion: ARTICLE_AI_DAILY_POLICY_VERSION,
    promptVersion: `${ARTICLE_AI_WEEKLY_PROMPT_VERSION}:daily-v1`,
    manifestLoader: async (domain, calendar, observedAt) => loadDailyManifestInputs(
      domain,
      getArticleAiDailyCalendar(calendar.targetWeekKey),
      observedAt,
    ),
  };
  const result = await runArticleAiAssessmentWithRuntime(
    job,
    payload.domain,
    engine,
    runtime,
  );
  return {
    status: result.status,
    domain: result.domain,
    sourceDayKey: result.targetWeekKey,
    selectionCount: result.selectionCount,
    coverage: result.coverage,
    model: result.model,
  };
}
