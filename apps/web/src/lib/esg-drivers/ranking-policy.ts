import type { DriverRelevance, DriverRelevanceDimension, DriverSelection, EsgDriver } from './types';

export const DRIVER_SELECTION_POLICY = 'relevance-top15-v1' as const;
export const RELEVANCE_ASSESSMENT_VERSION = 'driver-specific-v2' as const;
const RELEVANCE_REVIEW_ISSUE = 'Relevance assessment is missing its driver-specific evidence review.';
export const MAX_PUBLISHED_DRIVERS = 15 as const;
export const MIN_RELEVANCE_SCORE = 50 as const;
export const RELEVANCE_WEIGHTS = { country: 30, sector: 30, businessImpact: 25, urgency: 15 } as const;
export const RELEVANCE_DIMENSIONS = Object.keys(RELEVANCE_WEIGHTS) as DriverRelevanceDimension[];

/** Model ratings have anchored 0–5 bands; only application code computes points. */
export function computeRelevanceScore(dimensions: DriverRelevance['dimensions']): number {
  return RELEVANCE_DIMENSIONS.reduce((total, key) => {
    const rating = dimensions?.[key]?.rating;
    if (!Number.isInteger(rating) || rating < 0 || rating > 5) throw new Error(`Invalid ${key} relevance rating.`);
    return total + rating * RELEVANCE_WEIGHTS[key] / 5;
  }, 0);
}

export function relevanceBand(score: number): DriverRelevance['band'] {
  return score >= 80 ? 'high' : score >= MIN_RELEVANCE_SCORE ? 'medium' : 'low';
}

/** Suppress alternate legacy/reference labels of the same named driver, not distinct related frameworks. */
export function canonicalDriverKey(name: string): string {
  return name.normalize('NFKC').toLowerCase()
    .replace(/\((?:legacy\s*\/\s*reference|legacy|reference)\)/g, '')
    .replace(/[\u2010-\u2015]/g, '-').replace(/\s+/g, ' ').trim();
}

export function relevanceIssues(driver: EsgDriver): string[] {
  const score = driver.relevance;
  if (!score || score.policyVersion !== DRIVER_SELECTION_POLICY) return ['Missing relevance assessment.'];
  const issues: string[] = [];
  if (score.assessmentVersion !== RELEVANCE_ASSESSMENT_VERSION || !score.review?.reviewer?.model?.trim()
    || (['exactDriverSupport', 'noBorrowedObligations', 'urgencySupported', 'ratingsProportionate'] as const).some((check) => score.review?.checks?.[check] !== true)) issues.push(RELEVANCE_REVIEW_ISSUE);
  try {
    if (score.score !== computeRelevanceScore(score.dimensions) || score.band !== relevanceBand(score.score)) issues.push('Relevance total or band differs from the rubric.');
  } catch { issues.push('Invalid relevance rating.'); }
  const cited = new Set(driver.citations?.map((c) => c.passageId));
  for (const key of RELEVANCE_DIMENSIONS) {
    const dimension = score.dimensions?.[key];
    if (!dimension?.reason?.trim() || !Array.isArray(dimension.passageIds)
      || (dimension.rating > 0 && !dimension.passageIds.length)
      || dimension.passageIds.some((id) => !cited.has(id))) issues.push(`Unsubstantiated ${key} relevance rating.`);
  }
  if (!score.rationale?.trim() || !score.assessor?.model || !score.evidenceFingerprint?.trim() || !Number.isFinite(Date.parse(score.assessedAt))) issues.push('Incomplete relevance provenance.');
  return issues;
}

/** Preserve a failed qualification without presenting its rejected numeric score. */
export function relevanceFailureIssues(driver: EsgDriver): string[] {
  const failure = driver.relevanceFailure;
  const assessment = failure?.assessment;
  if (driver.relevance || !assessment || assessment.assessmentVersion !== RELEVANCE_ASSESSMENT_VERSION
    || !assessment.review?.reviewer?.model?.trim() || !driver.statusReason?.trim()
    || !Array.isArray(failure?.reasons) || !failure.reasons.length || failure.reasons.some((reason) => !reason?.trim())) return ['An unscored candidate is missing its failed relevance review.'];
  const checks = ['exactDriverSupport', 'noBorrowedObligations', 'urgencySupported', 'ratingsProportionate'] as const;
  if (checks.some((key) => typeof assessment.review?.checks?.[key] !== 'boolean') || checks.every((key) => assessment.review!.checks[key])) return ['An unscored candidate does not contain a rejected relevance review.'];
  return relevanceIssues({ ...driver, relevance: assessment }).filter((issue) => issue !== RELEVANCE_REVIEW_ISSUE);
}

/** Pure, locale-independent selection. The full candidate pool stays in workbook order. */
export function selectRankedDrivers(candidatePool: EsgDriver[], assessedAt = new Date().toISOString()): { drivers: EsgDriver[]; selection: DriverSelection } {
  const excluded = new Map<string, DriverSelection['excluded'][number]>();
  const eligible = candidatePool.filter((driver) => {
    const reason = driver.generationStatus !== 'verified' ? 'unavailable'
      : relevanceIssues(driver).length ? 'unscored'
        : driver.relevance!.score < MIN_RELEVANCE_SCORE ? 'below-threshold' : null;
    if (reason) excluded.set(driver.id, { driverId: driver.id, reason });
    return !reason;
  }).sort((a, b) => b.relevance!.score - a.relevance!.score
    || (a.workbookRow ?? Number.MAX_SAFE_INTEGER) - (b.workbookRow ?? Number.MAX_SAFE_INTEGER)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const retained = new Map<string, string>();
  const distinct: EsgDriver[] = [];
  for (const driver of eligible) {
    const key = canonicalDriverKey(driver.driverTitle);
    const duplicateOf = retained.get(key);
    if (duplicateOf) excluded.set(driver.id, { driverId: driver.id, reason: 'duplicate', duplicateOf });
    else { retained.set(key, driver.id); distinct.push(driver); }
  }
  const drivers = distinct.slice(0, MAX_PUBLISHED_DRIVERS);
  for (const driver of distinct.slice(MAX_PUBLISHED_DRIVERS)) excluded.set(driver.id, { driverId: driver.id, reason: 'below-cutoff' });
  return { drivers, selection: {
    policyVersion: DRIVER_SELECTION_POLICY, requestedCount: MAX_PUBLISHED_DRIVERS, minimumScore: MIN_RELEVANCE_SCORE,
    candidateCount: candidatePool.length, supportedCandidateCount: candidatePool.filter((d) => d.generationStatus === 'verified').length,
    eligibleCandidateCount: distinct.length, publishedDriverIds: drivers.map((d) => d.id),
    excluded: candidatePool.flatMap((d) => excluded.has(d.id) ? [excluded.get(d.id)!] : []), assessedAt,
  } };
}
