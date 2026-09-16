const HYPHEN = '[-‐‑‒–—]';
const LETTER = 'A-Za-z\\u0400-\\u04FF';
const TOKEN_START = `(?<![0-9${LETTER}])`;

const DAY = '(?:0?[1-9]|[12]\\d|3[01])';

const UZBEK_MONTHS: ReadonlyArray<readonly [string, number]> = [
  ['yanvar', 1],
  ['fevral', 2],
  ['mart', 3],
  ['aprel', 4],
  ['may', 5],
  ['iyun', 6],
  ['iyul', 7],
  ['avgust', 8],
  ['sentyabr', 9],
  ['sentabr', 9],
  ['oktyabr', 10],
  ['oktabr', 10],
  ['noyabr', 11],
  ['dekabr', 12],
  ['январь', 1],
  ['январ', 1],
  ['февраль', 2],
  ['феврал', 2],
  ['март', 3],
  ['апрель', 4],
  ['апрел', 4],
  ['май', 5],
  ['июнь', 6],
  ['июн', 6],
  ['июль', 7],
  ['июл', 7],
  ['август', 8],
  ['сентябрь', 9],
  ['сентябр', 9],
  ['октябрь', 10],
  ['октябр', 10],
  ['ноябрь', 11],
  ['ноябр', 11],
  ['декабрь', 12],
  ['декабр', 12],
];

const RUSSIAN_MONTHS: ReadonlyArray<readonly [string, number]> = [
  ['января', 1],
  ['январь', 1],
  ['январ', 1],
  ['февраля', 2],
  ['февраль', 2],
  ['феврал', 2],
  ['марта', 3],
  ['март', 3],
  ['апреля', 4],
  ['апрель', 4],
  ['апрел', 4],
  ['мая', 5],
  ['май', 5],
  ['июня', 6],
  ['июнь', 6],
  ['июн', 6],
  ['июля', 7],
  ['июль', 7],
  ['июл', 7],
  ['августа', 8],
  ['август', 8],
  ['сентября', 9],
  ['сентябрь', 9],
  ['сентябр', 9],
  ['октября', 10],
  ['октябрь', 10],
  ['октябр', 10],
  ['ноября', 11],
  ['ноябрь', 11],
  ['ноябр', 11],
  ['декабря', 12],
  ['декабрь', 12],
  ['декабр', 12],
];

function monthAlternation(months: ReadonlyArray<readonly [string, number]>): string {
  return [...months]
    .sort((left, right) => right[0].length - left[0].length)
    .map(([name]) => name)
    .join('|');
}

const UZBEK_MONTH = monthAlternation(UZBEK_MONTHS);
const RUSSIAN_MONTH = monthAlternation(RUSSIAN_MONTHS);
const UZBEK_MONTH_NUMBER = new Map(UZBEK_MONTHS);
const RUSSIAN_MONTH_NUMBER = new Map(RUSSIAN_MONTHS);

const YEAR_MARKER_RE = new RegExp(
  `${TOKEN_START}(\\d{4})\\s*${HYPHEN}?\\s*(?:yil|йил)(?![${LETTER}])`,
  'gi',
);

const UZBEK_DATE_RE = new RegExp(
  `${TOKEN_START}(${DAY})\\s*${HYPHEN}?\\s*(${UZBEK_MONTH})`,
  'gi',
);

const RUSSIAN_DATE_RE = new RegExp(
  `${TOKEN_START}(${DAY})\\s*${HYPHEN}?\\s*(${RUSSIAN_MONTH})(?![${LETTER}])`,
  'gi',
);

const RUSSIAN_RANGE_RE = new RegExp(
  `${TOKEN_START}с\\s+` +
    `(${DAY})\\s*${HYPHEN}?\\s*(${RUSSIAN_MONTH})(?![${LETTER}])` +
    `(\\s+)(\\d{4})(?:\\s+(?:года?|г\\.))?` +
    `\\s+по\\s+` +
    `(${DAY})\\s*${HYPHEN}?\\s*(${RUSSIAN_MONTH})(?![${LETTER}])` +
    `\\s+(\\d{4})(?:\\s+(?:года?|г\\.))?`,
  'gi',
);

interface DateToken {
  day: string;
  month: number;
  start: number;
  end: number;
}

interface SourceDateRange {
  year: string;
  first: DateToken;
  second: DateToken;
}

interface RussianDateRange extends SourceDateRange {
  firstYearStart: number;
  firstYearEnd: number;
}

function allMatches(regex: RegExp, text: string): RegExpExecArray[] {
  regex.lastIndex = 0;
  const matches: RegExpExecArray[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    matches.push(match);
    if (match[0].length === 0) regex.lastIndex += 1;
  }
  return matches;
}

function monthNumber(
  value: string,
  months: ReadonlyMap<string, number>,
): number | undefined {
  return months.get(value.toLocaleLowerCase());
}

function collectDateTokens(
  text: string,
  regex: RegExp,
  months: ReadonlyMap<string, number>,
  boundary?: (text: string, end: number) => boolean,
): DateToken[] {
  return allMatches(regex, text).flatMap((match) => {
    const day = match[1];
    const month = monthNumber(match[2], months);
    if (!day || month === undefined || match.index === undefined) return [];
    const end = match.index + match[0].length;
    if (boundary && !boundary(text, end)) return [];
    return [{ day, month, start: match.index, end }];
  });
}

function hasUzbekMonthBoundary(text: string, end: number): boolean {
  const after = text.slice(end);
  if (!after || !/[A-Za-z\u0400-\u04FF]/.test(after[0])) return true;
  return /^(?:[-‐‑‒–—\s]*(?:(?:kuni?|куни?)[-‐‑‒–—\s]*)?(?:dan|дан))(?![A-Za-z\u0400-\u04FF])/i.test(after);
}

function hasUzbekRangeStart(text: string, date: DateToken, nextDate: DateToken): boolean {
  const between = text.slice(date.end, nextDate.start);
  return /^[-‐‑‒–—\s]*(?:(?:kuni?|куни?)[-‐‑‒–—\s]*)?(?:dan|дан)(?![A-Za-z\u0400-\u04FF])[-‐‑‒–—\s]*$/i.test(between);
}

function hasUzbekRangeEnd(text: string, date: DateToken): boolean {
  const after = text.slice(date.end);
  return /^[-‐‑‒–—,\s]*(?:(?:kun(?:i|iga)?|кун(?:и|ига)?)[-‐‑‒–—\s]*)?(?:(?:ga|га)[-‐‑‒–—\s]*)?(?:qadar|gacha|қадар|гача)(?![A-Za-z\u0400-\u04FF])/i.test(after);
}

function parseSourceRange(sourceText: string): SourceDateRange | undefined {
  const yearMatches = allMatches(YEAR_MARKER_RE, sourceText);
  const dateTokens = collectDateTokens(
    sourceText,
    UZBEK_DATE_RE,
    UZBEK_MONTH_NUMBER,
    hasUzbekMonthBoundary,
  );

  // Requiring one year marker and exactly two recognized date tokens makes this
  // deliberately conservative in prose containing identifiers or other dates.
  if (yearMatches.length !== 1 || dateTokens.length !== 2) return undefined;

  const yearMatch = yearMatches[0];
  const first = dateTokens[0];
  const second = dateTokens[1];
  if (!yearMatch[1] || yearMatch.index === undefined || first.start < yearMatch.index + yearMatch[0].length) {
    return undefined;
  }
  if (!/^\s*$/.test(sourceText.slice(yearMatch.index + yearMatch[0].length, first.start))) {
    return undefined;
  }
  if (!hasUzbekRangeStart(sourceText, first, second) || !hasUzbekRangeEnd(sourceText, second)) {
    return undefined;
  }

  return { year: yearMatch[1], first, second };
}

function parseRussianRange(translatedText: string): RussianDateRange | undefined {
  const rangeMatches = allMatches(RUSSIAN_RANGE_RE, translatedText);
  const dateTokens = collectDateTokens(translatedText, RUSSIAN_DATE_RE, RUSSIAN_MONTH_NUMBER);
  if (rangeMatches.length !== 1 || dateTokens.length !== 2) return undefined;

  const match = rangeMatches[0];
  const year = match[4];
  const secondYear = match[7];
  if (!year || !secondYear || year !== secondYear || match.index === undefined) return undefined;

  const first = dateTokens[0];
  const second = dateTokens[1];
  const firstYearOffset = match[0].indexOf(year);
  const secondYearOffset = match[0].lastIndexOf(secondYear);
  if (firstYearOffset < 0 || secondYearOffset < 0) return undefined;

  // Include the separator before the first endpoint year and its optional
  // Russian year word ("года", "год", or "г.") in the removable span. This
  // leaves the surrounding prose and exactly one natural word separator intact.
  const firstYearStart = match.index + firstYearOffset - (match[3]?.length ?? 0);
  const secondYearStart = match.index + secondYearOffset;
  const poOffset = match[0].toLocaleLowerCase().indexOf('по', firstYearOffset);
  const firstYearEnd = secondYearStart > firstYearStart && poOffset > 0
    ? match.index + poOffset - 1
    : match.index + firstYearOffset + year.length;

  if (firstYearStart < match.index || firstYearEnd <= firstYearStart) return undefined;

  return {
    year,
    first,
    second,
    firstYearStart,
    firstYearEnd,
  };
}

function sameDate(left: DateToken, right: DateToken): boolean {
  return left.day === right.day && left.month === right.month;
}

function numericTokenCounts(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of text.match(/\d+(?:[.,:/-]\d+)*/g) ?? []) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}

function hasOnlyOneExtraYear(
  sourceText: string,
  translatedText: string,
  year: string,
): boolean {
  const source = numericTokenCounts(sourceText);
  const translated = numericTokenCounts(translatedText);
  const keys = Array.from(new Set(
    Array.from(source.keys()).concat(Array.from(translated.keys())),
  ));
  for (const key of keys) {
    const expected = source.get(key) ?? 0;
    const actual = translated.get(key) ?? 0;
    if (key === year) {
      if (actual !== expected + 1) return false;
    } else if (actual !== expected) {
      return false;
    }
  }
  return true;
}

/**
 * Removes only the duplicated first-endpoint year produced when a Russian
 * translation expands a one-year Uzbek date range into two full dates.
 *
 * The source and translation are intentionally inspected as one element/cell
 * pair. Any missing, extra, or ambiguous date shape returns the translation
 * byte-for-byte unchanged so the normal numeric-token validator remains the
 * authority for all other numbers.
 */
export function normalizeRedundantDateRangeYear(
  sourceText: string,
  translatedText: string,
): string {
  if (!sourceText || !translatedText) return translatedText;

  const sourceRange = parseSourceRange(sourceText);
  if (!sourceRange) return translatedText;

  const russianRange = parseRussianRange(translatedText);
  if (!russianRange || russianRange.year !== sourceRange.year) return translatedText;
  if (!sameDate(sourceRange.first, russianRange.first) ||
      !sameDate(sourceRange.second, russianRange.second)) {
    return translatedText;
  }
  if (!hasOnlyOneExtraYear(sourceText, translatedText, sourceRange.year)) {
    return translatedText;
  }

  return translatedText.slice(0, russianRange.firstYearStart) +
    translatedText.slice(russianRange.firstYearEnd);
}
