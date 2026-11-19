import { ARTICLE_AI_DAILY_POLICY_VERSION } from "./types";

export const ARTICLE_AI_DAILY_TIMEZONE = "Asia/Dubai" as const;
export const ARTICLE_AI_DAILY_PROCESS_HOUR = 0 as const;
export const ARTICLE_AI_DAILY_PROCESS_MINUTE = 15 as const;
export const ARTICLE_AI_DAILY_SELECTION_TTL_DAYS = 30 as const;
export const ARTICLE_AI_DAILY_CANDIDATE_LOOKBACK_DAYS = 7 as const;

const DUBAI_OFFSET_HOURS = 4;
const DAY_MS = 24 * 60 * 60 * 1_000;

export interface ArticleAiDailyCalendar {
  /** The Dubai calendar day whose articles are assessed. */
  sourceDayKey: string;
  sourceStart: Date;
  sourceEnd: Date;
  /** Bounded late-ingestion window; sourceDayKey remains the assessment date. */
  candidateStart: Date;
  processingAt: Date;
  /** Shared selections remain visible to the feed for approximately 30 days. */
  validUntil: Date;
  /** Jobs for a day may recover until the next daily processing boundary. */
  generationValidUntil: Date;
  timezone: typeof ARTICLE_AI_DAILY_TIMEZONE;
  policyVersion: typeof ARTICLE_AI_DAILY_POLICY_VERSION;
}

interface LocalDateParts {
  year: number;
  month: number;
  day: number;
}

function localDateParts(now: Date): LocalDateParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ARTICLE_AI_DAILY_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: string): number => Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day") };
}

function dateFromLocalParts(parts: LocalDateParts): Date {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
}

function partsFromDate(date: Date): LocalDateParts {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function addDays(parts: LocalDateParts, days: number): LocalDateParts {
  return partsFromDate(new Date(dateFromLocalParts(parts).getTime() + days * DAY_MS));
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function keyFromParts(parts: LocalDateParts): string {
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

function parseDayKey(value: string): LocalDateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const parts = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  const date = dateFromLocalParts(parts);
  if (
    date.getUTCFullYear() !== parts.year
    || date.getUTCMonth() + 1 !== parts.month
    || date.getUTCDate() !== parts.day
  ) return null;
  return parts;
}

function dubaiTime(parts: LocalDateParts, hour: number, minute = 0): Date {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, hour - DUBAI_OFFSET_HOURS, minute));
}

export function isArticleAiDailyDayKey(value: string): boolean {
  return parseDayKey(value) !== null;
}

/**
 * Build the immutable source window for one Dubai calendar day. The database
 * assessment_date is the source day, not the worker's UTC date.
 */
export function getArticleAiDailyCalendar(sourceDayKey: string): ArticleAiDailyCalendar {
  const source = parseDayKey(sourceDayKey);
  if (!source) throw new Error("Article AI daily source day must be YYYY-MM-DD");
  const next = addDays(source, 1);
  const sourceStart = dubaiTime(source, 0);
  const sourceEnd = dubaiTime(next, 0);
  const processingAt = dubaiTime(next, ARTICLE_AI_DAILY_PROCESS_HOUR, ARTICLE_AI_DAILY_PROCESS_MINUTE);
  const candidateStart = new Date(sourceStart.getTime() - ARTICLE_AI_DAILY_CANDIDATE_LOOKBACK_DAYS * DAY_MS);
  return {
    sourceDayKey,
    sourceStart,
    sourceEnd,
    candidateStart,
    processingAt,
    validUntil: new Date(sourceEnd.getTime() + ARTICLE_AI_DAILY_SELECTION_TTL_DAYS * DAY_MS),
    generationValidUntil: new Date(processingAt.getTime() + DAY_MS),
    timezone: ARTICLE_AI_DAILY_TIMEZONE,
    policyVersion: ARTICLE_AI_DAILY_POLICY_VERSION,
  };
}

/**
 * Return the one source day that is due after the daily 00:15 Dubai cutoff.
 * This deliberately does not backfill an onboarding history.
 */
export function getDueArticleAiDailySourceDay(now = new Date()): string | null {
  const local = localDateParts(now);
  const sourceDayKey = keyFromParts(addDays(local, -1));
  const calendar = getArticleAiDailyCalendar(sourceDayKey);
  if (now >= calendar.processingAt && now < calendar.generationValidUntil) return sourceDayKey;
  return null;
}

export function isArticleAiDailyGenerationDue(sourceDayKey: string, now = new Date()): boolean {
  const calendar = getArticleAiDailyCalendar(sourceDayKey);
  return now >= calendar.processingAt && now < calendar.generationValidUntil;
}
