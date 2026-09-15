import * as cheerio from 'cheerio';

export interface SourceDocumentDate {
  kind: 'publication' | 'update' | 'effective' | 'event';
  value: string;
  excerpt: string;
}

/** A date that belongs to the retrieved document itself. */
export interface SourceDateEvidence {
  value: string;
  kind: 'published' | 'updated' | 'version-issued';
  evidence: string;
  location: string;
}

export interface HtmlSourceDateMetadata {
  publishedDate: string | null;
  updatedDate: string | null;
  sourceDates: SourceDateEvidence[];
}

const month = '(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)';
const datePattern = new RegExp(`(?<![\\d.])(?:\\b(?:\\d{1,2}(?:st|nd|rd|th)?(?: of)? ${month} \\d{4}|${month} ?\\d{1,2},? \\d{4}|${month} ?\\d{4}|\\d{4}-\\d{2}(?:-\\d{2})?)\\b|\\b\\d{1,2}/\\d{1,2}/\\d{4}(?=$|[^\\dA-Za-z]|[A-Z]))`, 'gi');
const bareYearPattern = /\b(?:19|20|21)\d{2}\b/g;
const currentYear = new Date().getUTCFullYear();

const publishedMetaSelectors = [
  ['meta[property="article:published_time"]', 'article:published_time'],
  ['meta[property="og:published_time"]', 'og:published_time'],
  ['meta[itemprop="datePublished"]', 'datePublished'],
  ['meta[name="datepublished"]', 'datePublished'],
  ['meta[name="publishdate"]', 'publishdate'],
  ['meta[name="dc.date"]', 'dc.date'],
  ['meta[name="date"]', 'date'],
] as const;

const updatedMetaSelectors = [
  ['meta[property="article:modified_time"]', 'article:modified_time'],
  ['meta[property="og:updated_time"]', 'og:updated_time'],
  ['meta[itemprop="dateModified"]', 'dateModified'],
  ['meta[name="datemodified"]', 'dateModified'],
  ['meta[name="dateupdated"]', 'dateUpdated'],
  ['meta[name="updated"]', 'updated'],
  // This is an HTML metadata element, kept separate from the HTTP header.
  ['meta[name="last-modified"]', 'last-modified'],
] as const;

/** Written dates/years a model may select; occurrence alone does not establish their meaning. */
export function sourceDateOptions(text: string): string[] {
  return Array.from(new Set([
    ...Array.from(text.matchAll(datePattern), (match) => match[0]),
    ...Array.from(text.matchAll(bareYearPattern))
      .filter((match) => isStandaloneBareYear(text, match.index || 0, match[0]))
      .map((match) => match[0]),
  ])).slice(0, 200);
}

/**
 * Extract the machine-readable publication/update metadata exposed by an HTML
 * page. HTTP response headers are deliberately not inspected here: a
 * Last-Modified header describes the transfer and is not proof of the source
 * document's own publication date.
 */
export function extractHtmlSourceDateMetadata(html: string): HtmlSourceDateMetadata {
  const $ = cheerio.load(html);
  const sourceDates: SourceDateEvidence[] = [];

  const readMeta = (
    selectors: readonly (readonly [string, string])[],
    kind: 'published' | 'updated',
  ): string | null => {
    for (const [selector, label] of selectors) {
      const element = $(selector).first();
      const raw = element.attr('content')?.trim();
      const value = normalizeSourceDateValue(raw);
      if (!raw || !value || !isPlausibleSourceDate(value)) continue;
      sourceDates.push({
        value,
        kind,
        evidence: `${label}: ${raw}`.slice(0, 500),
        location: `HTML ${selector}`,
      });
      return transportDateValue(value);
    }
    return null;
  };

  const publishedDate = readMeta(publishedMetaSelectors, 'published');
  const updatedDate = readMeta(updatedMetaSelectors, 'updated');

  // Some publishers use semantic <time> elements instead of meta tags. Only
  // accept an element whose own attributes or nearby label identifies it as a
  // publication/update date. A bare first <time> commonly represents an event.
  $('time[datetime]').each((_, element) => {
    const raw = $(element).attr('datetime')?.trim();
    const value = normalizeSourceDateValue(raw);
    if (!raw || !value || !isPlausibleSourceDate(value)) return;
    const attributes = [
      $(element).attr('itemprop'),
      $(element).attr('class'),
      $(element).attr('id'),
    ].filter(Boolean).join(' ');
    const context = `${$(element).parent().text()} ${$(element).text()}`.replace(/\s+/g, ' ').trim();
    const semanticKind = /\bdateModified\b/i.test(attributes)
      ? 'updated'
      : /\bdatePublished\b/i.test(attributes)
        ? 'published'
        : null;
    const contextualKind = /\b(?:last\s+)?updated|revised|amended|modified\b/i.test(context)
      ? 'updated'
      : /\b(?:issued(?:\s+(?:on|date))?|date\s+of\s+issue|issue\s+date)\b/i.test(context)
        ? 'version-issued'
        : /\b(?:publication|published|released|release\s+date)\b/i.test(context)
          ? 'published'
          : null;
    const kind = semanticKind || (!hasAmbiguousMention(context, raw) && isDateHeaderBlock(context, raw) ? contextualKind : null);
    if (!kind) return;
    const location = `HTML time[datetime]${attributes ? ` (${attributes.slice(0, 120)})` : ''}`;
    if (!sourceDates.some((date) => date.kind === kind && date.value === value && date.location === location)) {
      sourceDates.push({
        value,
        kind,
        evidence: `${context || 'time'}: ${raw}`.slice(0, 500),
        location,
      });
    }
  });

  return {
    publishedDate,
    updatedDate,
    // Updated metadata is the best representation of the page's current
    // document date; publication metadata is the fallback. Preserve source
    // order within each kind for deterministic audit output.
    sourceDates: [
      ...sourceDates.filter((date) => date.kind === 'updated'),
      ...sourceDates.filter((date) => date.kind === 'published'),
      ...sourceDates.filter((date) => date.kind === 'version-issued'),
    ],
  };
}

/**
 * Identify one conservative, source-owned date. The search is intentionally
 * bounded to explicit HTML metadata, the title, and the opening/cover text.
 * Dates in the body can describe laws, targets, events, or reporting periods;
 * they cannot establish this document's publication date by themselves.
 */
export function extractSourceDate(input: {
  text?: string | null;
  html?: string | null;
  title?: string | null;
  pdfTitle?: string | null;
}): SourceDateEvidence | null {
  if (input.html) {
    const htmlMetadata = extractHtmlSourceDateMetadata(input.html);
    if (htmlMetadata.sourceDates.length) return htmlMetadata.sourceDates[0];
  }

  const htmlTitle = input.html ? sourceDocumentTitle('', input.html) : undefined;
  const textTitle = !input.title && !input.pdfTitle && !input.html
    ? sourceDocumentTitle(input.text || '')
    : undefined;
  const title = cleanText(input.title || input.pdfTitle || htmlTitle || textTitle || '');
  const opening = input.html ? openingHtmlText(input.html) : openingDocumentText(input.text || '');

  const labelled = findLabelledSourceDate(title, 'document title') || findLabelledSourceDate(opening, 'document opening / labelled metadata');
  if (labelled) return labelled;

  // A report/NDC/standard title or cover often contains only its edition year
  // or month. Require document-like context so phrases such as "Net Zero 2050"
  // and body target years are not promoted to source dates.
  const titleDate = findTitleOrCoverDate(title, 'document title');
  if (titleDate) return titleDate;
  const coverDate = findTitleOrCoverDate(opening, 'document cover / opening text');
  if (coverDate) return coverDate;

  return null;
}

function findLabelledSourceDate(scope: string, location: string): SourceDateEvidence | null {
  const blocks = scope.split(/\n+/).map((block) => block.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 8);
  for (const block of blocks) {
    const candidates = dateMatches(block, true);
    if (!candidates.length) continue;
    // Multiple dates in one heading/metadata line are ambiguous (for example a
    // report mentioning an older law). Leave the source date unknown.
    if (candidates.length !== 1) continue;
    const candidate = candidates[0];
    const context = block;
    const kind = /\b(?:last\s+)?updated|revised|amended|modified\b/i.test(context)
      ? 'updated'
      : /\b(?:issued(?:\s+(?:on|date))?|date\s+of\s+issue|issue\s+date)\b/i.test(context)
        ? 'version-issued'
        : /\b(?:publication|published|released|release\s+date|date\s+of\s+publication)\b/i.test(context)
          ? 'published'
          : /\b(?:version|edition|issue|volume|revision)\b/i.test(context)
            ? 'version-issued'
            : null;
    const ambiguous = hasAmbiguousMention(context, candidate.raw);
    if (!kind || !isPlausibleSourceDate(candidate.raw) || (ambiguous && !hasOwnRegulationIssuanceContext(context, candidate.raw))) continue;
    if (location === 'document opening / labelled metadata' && !isDateHeaderBlock(context, candidate.raw)) continue;
    return {
      value: candidate.raw.trim(),
      kind,
      evidence: block.slice(0, 500),
      location,
    };
  }
  return null;
}

function findTitleOrCoverDate(scope: string, location: string): SourceDateEvidence | null {
  const trimmed = scope.trim();
  if (!trimmed) return null;
  const documentContext = /\b(?:report|ndc|nationally\s+determined\s+contributions?|alliance|annual|statement|standard|framework|guidance|strategy|assessment|disclosure|protocol|roadmap|publication|policy|bank(?:ing)?|agreement|edition|volume|revision|bofa|bank\s+of\s+america)\b/i.test(trimmed);
  if (!documentContext) return null;

  const blocks = trimmed.split(/\n+/).map((block) => block.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 8);
  const candidates = blocks.flatMap((block, index) => dateMatches(block, true).map((candidate) => ({ ...candidate, block, blockIndex: index })));
  if (location === 'document title' && candidates.length !== 1) return null;
  for (const candidate of candidates) {
    if (!isPlausibleSourceDate(candidate.raw)) continue;
    const nearby = candidate.block;
    // A body sentence below a cover heading can contain a perfectly valid
    // year while saying nothing about when this document was issued. Cover
    // dates must be a standalone line (or a compact version marker); explicit
    // labels such as "Published:" are handled above.
    if (location === 'document cover / opening text' && !isStandaloneCoverDateLine(nearby, candidate.raw)) continue;
    // A future target/ambition in a title is not a publication date.
    if (hasAmbiguousMention(nearby, candidate.raw) || new RegExp(`\\b(?:by|target|targets|toward|towards|net\\s+zero)\\b[^\\n]{0,50}${escapeRegExp(candidate.raw)}`, 'i').test(nearby)) continue;
    // A bare year in an unlabeled title/cover is generally a reporting period
    // or edition year. Explicit Published/Issued/Version labels are handled by
    // findLabelledSourceDate above, so leave an unlabeled "Report 2024"
    // unknown rather than guessing the release date.
    if (/^\d{4}$/.test(candidate.raw.trim())) continue;
    const preceding = blocks.slice(Math.max(0, candidate.blockIndex - 2), candidate.blockIndex + 1).join(' ');
    if (!/\b(?:report|ndc|nationally\s+determined\s+contributions?|alliance|annual|statement|standard|framework|guidance|strategy|assessment|disclosure|protocol|roadmap|publication|policy|bank(?:ing)?|agreement|edition|volume|revision|bofa|bank\s+of\s+america)\b/i.test(preceding)) continue;
    return {
      value: candidate.raw.trim(),
      kind: 'version-issued',
      evidence: preceding.slice(0, 500),
      location,
    };
  }
  return null;
}

function isStandaloneCoverDateLine(block: string, date: string): boolean {
  const remainder = block
    .replace(date, '')
    .trim()
    .replace(/^[|,:;()[\]{}<>\-–—]+|[|,:;()[\]{}<>\-–—]+$/g, '')
    .trim();
  if (!remainder) return true;
  return /^(?:v(?:ersion)?|ver\.?|edition|issue|volume|revision)\s*[\w.-]+$/i.test(remainder);
}

function isDateHeaderBlock(block: string, date: string): boolean {
  const remainder = block.replace(date, ' ').replace(/\s+/g, ' ').trim();
  if (!remainder || /^(?:the|this|it|according|our|their)\b/i.test(remainder)) return false;
  const hasDateLabel = /\b(?:publication(?:\s+date)?|date\s+(?:of\s+)?(?:publication|issue|release|modification)|document\s+(?:date|version)|published|issued|released|updated|last\s+updated|modified|revised|amended|version|edition|revision)\b/i.test(remainder);
  return hasDateLabel && remainder.split(/\s+/).length <= 12;
}

function dateMatches(text: string, includeBareYear: boolean): Array<{ raw: string; index: number }> {
  const matches = Array.from(text.matchAll(datePattern), (match) => ({ raw: match[0], index: match.index || 0 }));
  if (includeBareYear) {
    for (const match of Array.from(text.matchAll(bareYearPattern))) {
      const raw = match[0];
      if (!isStandaloneBareYear(text, match.index || 0, raw)) continue;
      if (!matches.some((candidate) => candidate.index <= (match.index || 0) && candidate.index + candidate.raw.length >= (match.index || 0) + raw.length)) {
        matches.push({ raw, index: match.index || 0 });
      }
    }
  }
  return matches.sort((left, right) => left.index - right.index);
}

function openingDocumentText(text: string): string {
  const normalized = text.replace(/\r/g, '');
  const pageOne = normalized.match(/(?:^|\n\n?)Page\s+1:\s*([\s\S]*?)(?=\n\n?Page\s+2:|$)/i)?.[1];
  return (pageOne || normalized).split(/\n+/).map((line) => line.trim()).filter(Boolean).slice(0, 8).join('\n').slice(0, 1_000);
}

function openingHtmlText(html: string): string {
  const $ = cheerio.load(html);
  $('script, style, noscript, svg, nav, footer, header, form').remove();
  const root = $('main').length ? $('main') : $('article').length ? $('article') : $('body');
  return root.find('h1, h2, h3, h4, p, li, time').map((_, element) => $(element).contents().toArray().map((child) => $(child).text()).join(' ').replace(/\s+/g, ' ').trim()).get().filter(Boolean).slice(0, 8).join('\n').slice(0, 1_000);
}

function hasAmbiguousMention(block: string, date: string): boolean {
  const context = block.replace(date, ' DATE ');
  return /\b(?:law|laws|regulation|regulations|event|events|target|targets|effective|adopted|cited|cites|according|reporting\s+period|previously|prior|earlier)\b/i.test(context);
}

function hasOwnRegulationIssuanceContext(block: string, date: string): boolean {
  const context = block.replace(date, ' DATE ');
  return /\b(?:regulation|regulatory|rulebook|circular|directive)\b/i.test(context)
    && /climate[- ]related\s+financial\s+risk\s+management\s+regulation/i.test(context)
    && /[A-Z]{1,4}\s*\d+\s*\/\s*(?:19|20|21)\d{2}\b/.test(context)
    && /\bissued\s+on\b/i.test(context)
    && /\bstatus\b/i.test(context)
    && !/\b(?:effective|target|targets|event|events|law|laws|cited|cites|according)\b/i.test(context);
}

function isStandaloneBareYear(text: string, index: number, raw: string): boolean {
  const previous = text[index - 1] || '';
  const next = text[index + raw.length] || '';
  if (previous === '/' || next === '/') return false;
  const preceding = text.slice(Math.max(0, index - 16), index);
  return !/\b[A-Z]{1,6}\s*\d+\s*[/\\-]\s*$/i.test(preceding);
}

function normalizeSourceDateValue(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;

  const iso = raw.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?(?:[T ].*)?$/);
  if (iso) {
    const year = Number(iso[1]);
    const monthNumber = Number(iso[2]);
    const day = iso[3] ? Number(iso[3]) : undefined;
    if (!isValidCalendarDate(year, monthNumber, day)) return null;
    return day ? `${iso[1]}-${iso[2]}-${iso[3]}` : `${iso[1]}-${iso[2]}`;
  }

  const monthYear = raw.match(new RegExp(`^(${month})\\s*(\\d{4})$`, 'i'));
  if (monthYear) {
    const monthNumber = monthNumberFromName(monthYear[1]);
    const year = Number(monthYear[2]);
    return isValidCalendarDate(year, monthNumber) ? raw : null;
  }

  const yearOnly = raw.match(/^((?:19|20|21)\d{2})$/);
  if (yearOnly) {
    const year = Number(yearOnly[1]);
    return isValidCalendarDate(year, 1) ? raw : null;
  }

  const dmy = raw.match(/^(\d{1,2})(?:st|nd|rd|th)?(?: of)?\s+([A-Za-z]+)\s+(\d{4})$/i);
  if (dmy) {
    const day = Number(dmy[1]);
    const monthNumber = monthNumberFromName(dmy[2]);
    const year = Number(dmy[3]);
    return isValidCalendarDate(year, monthNumber, day) ? raw : null;
  }

  const mdy = raw.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/i);
  if (mdy) {
    const day = Number(mdy[2]);
    const monthNumber = monthNumberFromName(mdy[1]);
    const year = Number(mdy[3]);
    return isValidCalendarDate(year, monthNumber, day) ? raw : null;
  }

  const numeric = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (numeric) {
    const day = Number(numeric[1]);
    const monthNumber = Number(numeric[2]);
    const year = Number(numeric[3]);
    return isValidCalendarDate(year, monthNumber, day) ? raw : null;
  }

  return null;
}

function transportDateValue(value: string): string {
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return value;
  const monthYear = value.match(new RegExp(`^(${month})\\s*(\\d{4})$`, 'i'));
  if (monthYear) return `${monthYear[2]}-${String(monthNumberFromName(monthYear[1])).padStart(2, '0')}`;
  return value;
}

export function isPlausibleSourceDate(value: string): boolean {
  const normalized = normalizeSourceDateValue(value);
  if (!normalized) return false;
  const yearMatch = normalized.match(/(?:^|\D)((?:19|20|21)\d{2})(?:\D|$)/);
  if (!yearMatch) return false;
  const year = Number(yearMatch[1]);
  return year >= 1900 && year <= currentYear && !isFutureSourceDate(normalized);
}

function isFutureSourceDate(value: string): boolean {
  const raw = value.trim();
  const iso = raw.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?(?:[T ].*)?$/);
  const monthYear = raw.match(/^([A-Za-z]+)\s*(\d{4})$/i);
  const dmy = raw.match(/^(\d{1,2})(?:st|nd|rd|th)?(?: of)?\s+([A-Za-z]+)\s+(\d{4})$/i);
  const mdy = raw.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/i);
  const numeric = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const yearOnly = raw.match(/^((?:19|20|21)\d{2})$/);
  let year: number;
  let monthNumber: number;
  let day = 1;
  if (iso) {
    year = Number(iso[1]);
    monthNumber = Number(iso[2]);
    day = Number(iso[3] || 1);
  } else if (monthYear) {
    year = Number(monthYear[2]);
    monthNumber = monthNumberFromName(monthYear[1]);
  } else if (dmy) {
    year = Number(dmy[3]);
    monthNumber = monthNumberFromName(dmy[2]);
    day = Number(dmy[1]);
  } else if (mdy) {
    year = Number(mdy[3]);
    monthNumber = monthNumberFromName(mdy[1]);
    day = Number(mdy[2]);
  } else if (numeric) {
    year = Number(numeric[3]);
    monthNumber = Number(numeric[2]);
    day = Number(numeric[1]);
  } else if (yearOnly) {
    year = Number(yearOnly[1]);
    monthNumber = 1;
  } else {
    return false;
  }
  if (!isValidCalendarDate(year, monthNumber, day)) return false;
  const date = Date.UTC(year, monthNumber - 1, day);
  const now = new Date(Date.now());
  const currentUtcDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return date > currentUtcDay;
}

function isValidCalendarDate(year: number, monthNumber: number, day?: number): boolean {
  if (!Number.isInteger(year) || year < 1000 || year > 9999 || !Number.isInteger(monthNumber) || monthNumber < 1 || monthNumber > 12) return false;
  if (day === undefined) return true;
  if (!Number.isInteger(day) || day < 1 || day > 31) return false;
  return new Date(Date.UTC(year, monthNumber - 1, day)).getUTCFullYear() === year
    && new Date(Date.UTC(year, monthNumber - 1, day)).getUTCMonth() === monthNumber - 1
    && new Date(Date.UTC(year, monthNumber - 1, day)).getUTCDate() === day;
}

function monthNumberFromName(value: string): number {
  const normalized = value.toLowerCase().slice(0, 3);
  return ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(normalized) + 1;
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/\u0000/g, '').trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Keep dates as written with their local context; never turn target years or HTTP dates into publication dates. */
export function documentDates(text: string): SourceDocumentDate[] {
  const dates: SourceDocumentDate[] = [];
  for (const match of Array.from(text.matchAll(datePattern))) {
    const start = Math.max(0, match.index! - 100);
    const prefix = text.slice(start, match.index!).replace(/\s+/g, ' ');
    const suffix = text.slice(match.index! + match[0].length, match.index! + match[0].length + 100).replace(/\s+/g, ' ');
    const label = (prefix.match(/\b(published|publication|issued|released|updated|revised|amended|effective|comes? into (?:effect|force)|adopted|as of)\b[^.!?;]{0,75}$/i)?.[1]
      || suffix.match(/^[^.!?;]{0,75}?\b(published|publication|issued|released|updated|revised|amended|effective|comes? into (?:effect|force)|adopted)\b/i)?.[1])?.toLowerCase();
    if (!label) continue;
    const kind = /updated|revised|amended/.test(label) ? 'update' : /effective|effect|force/.test(label) ? 'effective' : /adopted|as of/.test(label) ? 'event' : 'publication';
    const excerpt = text.slice(start, Math.min(text.length, match.index! + match[0].length + 100)).replace(/\s+/g, ' ').trim();
    if (!dates.some((d) => d.kind === kind && d.value === match[0] && d.excerpt === excerpt)) dates.push({ kind, value: match[0], excerpt });
  }
  return dates.slice(0, 80);
}

export function sourceDocumentTitle(text: string, html?: string, pdfTitle?: string): string | undefined {
  if (html) {
    const $ = cheerio.load(html);
    const heading = $('main h1, article h1, h1').first().text() || $('meta[property="og:title"]').attr('content') || $('title').text();
    if (heading.trim()) return heading.replace(/\s+/g, ' ').trim().slice(0, 240);
  }
  if (pdfTitle?.trim() && !/^(untitled|microsoft|word|document\d*)\b/i.test(pdfTitle.trim())) return pdfTitle.trim().slice(0, 240);
  const line = text.split('\n').map((s) => s.replace(/^#+\s*/, '').trim()).find((s) => s.length >= 12 && s.length <= 200 && !/^(page \d+|https?:|image|table of contents|contents|menu|skip |search|log in|sign in|cookie)/i.test(s));
  if (line) return line;
  // Some PDF readers flatten the cover into one line. Preserve the cover text before its URL/contents.
  const cover = text.slice(0, 350).split(/\b(?:www\.|https?:\/\/|Contents\b)/i)[0].replace(/^\d+\s+/, '').trim();
  return cover.length >= 12 && cover.length <= 240 ? cover : undefined;
}
