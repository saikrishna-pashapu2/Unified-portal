import type { ArticleAiWeeklySummary } from "./types";

export const ARTICLE_AI_WEEKLY_TIMEZONE = "Asia/Dubai" as const;
export const ARTICLE_AI_WEEKLY_PROCESS_HOUR = 0 as const;
export const ARTICLE_AI_WEEKLY_PROCESS_MINUTE = 15 as const;
export const ARTICLE_AI_WEEKLY_EMAIL_HOUR = 9 as const;

const DUBAI_OFFSET_HOURS = 4;
const DAY_MS = 24 * 60 * 60 * 1_000;

export interface ArticleAiWeeklyCalendar {
  targetWeekKey: string;
  sourceStart: Date;
  sourceEnd: Date;
  processingAt: Date;
  emailAt: Date;
  validUntil: Date;
  timezone: typeof ARTICLE_AI_WEEKLY_TIMEZONE;
}

export interface ArticleAiWeeklySchedule {
  targetWeekKey: string;
  processingAt: Date;
  emailAt: Date;
}

interface LocalDateParts {
  year: number;
  month: number;
  day: number;
}

function localDateParts(now: Date): LocalDateParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ARTICLE_AI_WEEKLY_TIMEZONE,
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

function parseWeekKeyParts(value: string): LocalDateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const parts = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  const date = dateFromLocalParts(parts);
  if (
    date.getUTCFullYear() !== parts.year
    || date.getUTCMonth() + 1 !== parts.month
    || date.getUTCDate() !== parts.day
    || date.getUTCDay() !== 1
  ) return null;
  return parts;
}

function dubaiTime(parts: LocalDateParts, hour: number, minute = 0): Date {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, hour - DUBAI_OFFSET_HOURS, minute));
}

export function isArticleAiWeeklyWeekKey(value: string): boolean {
  return parseWeekKeyParts(value) !== null;
}

export function getArticleAiWeeklyCalendar(targetWeekKey: string): ArticleAiWeeklyCalendar {
  const target = parseWeekKeyParts(targetWeekKey);
  if (!target) throw new Error("Article AI weekly target must be a Monday YYYY-MM-DD key");
  const sourceStartParts = addDays(target, -7);
  const sourceEndParts = addDays(target, -2);
  return {
    targetWeekKey,
    sourceStart: dubaiTime(sourceStartParts, 0),
    sourceEnd: dubaiTime(sourceEndParts, 0),
    processingAt: dubaiTime(sourceEndParts, ARTICLE_AI_WEEKLY_PROCESS_HOUR, ARTICLE_AI_WEEKLY_PROCESS_MINUTE),
    emailAt: dubaiTime(target, ARTICLE_AI_WEEKLY_EMAIL_HOUR),
    validUntil: dubaiTime(addDays(target, 7), 0),
    timezone: ARTICLE_AI_WEEKLY_TIMEZONE,
  };
}

function mondayForLocalDate(parts: LocalDateParts): LocalDateParts {
  const date = dateFromLocalParts(parts);
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  return addDays(parts, -daysSinceMonday);
}

/** Returns the target cohort currently eligible for Saturday/weekend recovery. */
export function getDueArticleAiWeeklyTarget(now = new Date()): string | null {
  const currentMondayParts = mondayForLocalDate(localDateParts(now));
  const candidateWeekKeys = [
    keyFromParts(currentMondayParts),
    keyFromParts(addDays(currentMondayParts, 7)),
  ];
  for (const targetWeekKey of candidateWeekKeys) {
    const calendar = getArticleAiWeeklyCalendar(targetWeekKey);
    if (now >= calendar.processingAt && now < calendar.emailAt) return targetWeekKey;
  }
  return null;
}

/** Returns the next schedule, including the current due cohort when in recovery. */
export function getNextArticleAiWeeklySchedule(now = new Date()): ArticleAiWeeklySchedule {
  const local = localDateParts(now);
  const currentMondayParts = mondayForLocalDate(local);
  const currentMonday = keyFromParts(currentMondayParts);
  const current = getArticleAiWeeklyCalendar(currentMonday);
  if (now < current.emailAt && now >= current.processingAt) {
    return { targetWeekKey: currentMonday, processingAt: current.processingAt, emailAt: current.emailAt };
  }
  const nextMonday = keyFromParts(addDays(currentMondayParts, 7));
  const next = getArticleAiWeeklyCalendar(nextMonday);
  if (now < next.emailAt && now >= next.processingAt) {
    return { targetWeekKey: nextMonday, processingAt: next.processingAt, emailAt: next.emailAt };
  }
  return { targetWeekKey: nextMonday, processingAt: next.processingAt, emailAt: next.emailAt };
}

export function isArticleAiWeeklyGenerationDue(targetWeekKey: string, now = new Date()): boolean {
  const calendar = getArticleAiWeeklyCalendar(targetWeekKey);
  return now >= calendar.processingAt && now < calendar.emailAt;
}

export function toArticleAiWeeklySummary(
  calendar: ArticleAiWeeklyCalendar,
  summary: Omit<ArticleAiWeeklySummary, "targetWeekKey" | "sourceStart" | "sourceEnd" | "processingAt" | "emailAt" | "validUntil" | "timezone">,
): ArticleAiWeeklySummary {
  return {
    ...summary,
    targetWeekKey: calendar.targetWeekKey,
    sourceStart: calendar.sourceStart.toISOString(),
    sourceEnd: calendar.sourceEnd.toISOString(),
    processingAt: calendar.processingAt.toISOString(),
    emailAt: calendar.emailAt.toISOString(),
    validUntil: calendar.validUntil.toISOString(),
    timezone: calendar.timezone,
  };
}
