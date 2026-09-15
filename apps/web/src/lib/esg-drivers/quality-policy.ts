export const ESG_DRIVER_QUALITY_POLICY = '2026-09-editorial-v2' as const;
export const EVIDENCE_STATUS_LABELS = {
  'dated-update': 'Dated update',
  'framework-reference': 'Framework reference',
  historical: 'Historical evidence',
  'status-unresolved': 'Current status unverified',
} as const;
export type DriverEvidenceStatus = keyof typeof EVIDENCE_STATUS_LABELS;

/** Old NZBA progress reports establish historical membership/commitments, not present institutional status. */
export function hasCurrentNzbaClaimFromOldReport(driverName: string, text: string, status?: DriverEvidenceStatus, date?: string | null): boolean {
  if (!/Net[\s-]?Zero Banking Alliance|\bNZBA\b/i.test(driverName)) return false;
  const years = (date || '').match(/\b20\d{2}\b/g)?.map(Number) || [];
  if (!years.length || Math.max(...years) > new Date().getUTCFullYear() - 2) return false;
  return !['historical', 'status-unresolved'].includes(status || '')
    || /(?:\bNZBA|Net[\s-]?Zero Banking Alliance)\s+(?:is|has|requires|represents)\b|\b(?:its\s+)?members\s+(?:commit|are|have|represent|must)\b/i.test(text);
}

/** A secondary programme's description cannot establish PRI's numbered principles. */
export function hasUnverifiedPriMapping(driverName: string, text: string, citedUrls: string[]): boolean {
  if (!/Principles for Responsible Investment|\bPRI\b/i.test(driverName)) return false;
  const numbered = /\bprinciples?\s+(?:[1-6]|one|two|three|four|five|six)\b|\b(?:first\s+)?(?:[1-6]|one|two|three|four|five|six)\s+PRI\s+principles|принцип[а-яё]*\s+[1-6]|(?:مبدأ|مبادئ)\s+[1-6١-٦]/i.test(text);
  if (!numbered) return false;
  return !citedUrls.some((url) => {
    try { return new URL(url).hostname.replace(/^www\./, '') === 'unpri.org'; }
    catch { return false; }
  });
}

/** Suggestions are not factual evidence, even when honestly labelled. Regulatory monitoring requirements remain valid. */
export function hasSuggestedEvidenceKpi(text: string): boolean {
  return /\b(?:proposed|suggested)\s+(?:(?:UAE|banking|internal|portfolio|relevant)\s+){0,3}(?:monitoring|readiness|KPI|measure|indicator)|\b(?:relevant|suggested) (?:readiness KPIs?|monitoring indicators)|\breadiness KPIs?\b|(?:предлагаем[а-яё]*|предложенн[а-яё]*)\s+(?:показател[а-яё]*|метрик[а-яё]*|KPI)|(?:مؤشر|مقياس|مؤشرات)\s+(?:أداء\s+)?(?:مقترح|مقترحة)/i.test(text);
}
