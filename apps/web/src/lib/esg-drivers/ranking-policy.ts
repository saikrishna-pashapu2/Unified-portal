import type {
  DriverRelevance,
  DriverRelevanceAssessmentVersion,
  DriverRelevanceDimension,
  DriverSelection,
  DriverSelectionPolicy,
  EsgDriver,
  EsgDriverSection,
} from './types';
import { EVIDENCE_STATUS_LABELS, type DriverEvidenceStatus } from './quality-policy';

export const DRIVER_SELECTION_POLICY = 'relevance-top15-v1' as const;
export const CATEGORY_SELECTION_POLICY = 'category-balanced15-v1' as const;
export const LEGACY_RELEVANCE_ASSESSMENT_VERSION = 'driver-specific-v2' as const;
export const RELEVANCE_ASSESSMENT_VERSION = 'driver-specific-v3' as const;
export const MAX_UNRESOLVED_URGENCY_RATING = 2 as const;
const RELEVANCE_REVIEW_ISSUE = 'Relevance assessment is missing its driver-specific evidence review.';
export const MAX_PUBLISHED_DRIVERS = 15 as const;
export const CATEGORY_QUOTA = 3 as const;
/** The published report order is part of the persisted result contract. */
export const DRIVER_REPORT_CATEGORIES = [
  'Global Drivers',
  'Regulatory Requirements',
  'Capital Markets',
  'Climate Risks',
  'Supply Chain',
] as const satisfies readonly EsgDriverSection[];
export const MIN_RELEVANCE_SCORE = 50 as const;
export const RELEVANCE_WEIGHTS = { country: 30, sector: 30, businessImpact: 25, urgency: 15 } as const;
export const RELEVANCE_DIMENSIONS = Object.keys(RELEVANCE_WEIGHTS) as DriverRelevanceDimension[];

export function isRelevanceAssessmentVersion(value: unknown): value is DriverRelevanceAssessmentVersion {
  return value === LEGACY_RELEVANCE_ASSESSMENT_VERSION || value === RELEVANCE_ASSESSMENT_VERSION;
}

export function isDriverEvidenceStatus(value: unknown): value is DriverEvidenceStatus {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(EVIDENCE_STATUS_LABELS, value);
}

export function isRankedSelectionPolicy(value: unknown): value is DriverSelectionPolicy {
  return value === DRIVER_SELECTION_POLICY || value === CATEGORY_SELECTION_POLICY;
}

function normalizeCategoryLabel(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Map an immutable workbook row to a report category. Global rows are identified
 * by their section first; country rows use the workbook's normalized type label.
 * No category is inferred from prose, title or score, so an unmapped row can
 * never be silently relabelled to fill a quota.
 */
export function driverReportCategory(
  driver: Pick<EsgDriver, 'driverSection' | 'driverType'>,
): EsgDriverSection | null {
  const section = normalizeCategoryLabel(driver.driverSection || '');
  if (section === 'global drivers' || section === 'global driver') return 'Global Drivers';
  const type = normalizeCategoryLabel(driver.driverType || '');
  switch (type) {
    case 'regulatory requirements': return 'Regulatory Requirements';
    case 'capital markets': return 'Capital Markets';
    case 'climate risks': return 'Climate Risks';
    case 'supply chain': return 'Supply Chain';
    default: return null;
  }
}

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

export function relevanceIssues(
  driver: EsgDriver,
  expectedVersion: DriverRelevanceAssessmentVersion = RELEVANCE_ASSESSMENT_VERSION,
): string[] {
  const score = driver.relevance;
  if (!score || score.policyVersion !== DRIVER_SELECTION_POLICY) return ['Missing relevance assessment.'];
  const issues: string[] = [];
  if (score.assessmentVersion !== expectedVersion || !score.review?.reviewer?.model?.trim()
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
  // v2 reports are immutable historical artifacts. Apply the status-bound
  // safety rule only to the current v3 contract, so reading old history does
  // not rewrite or silently downgrade its original score.
  if (expectedVersion === RELEVANCE_ASSESSMENT_VERSION) {
    if (!isDriverEvidenceStatus(driver.evidenceStatus)) issues.push('Relevance assessment is missing its verified evidence status.');
    else if (driver.evidenceStatus === 'status-unresolved' && score.dimensions?.urgency?.rating > MAX_UNRESOLVED_URGENCY_RATING) {
      issues.push('An unresolved evidence status cannot carry urgency above 2.');
    }
  }
  return issues;
}

/** Preserve a failed qualification without presenting its rejected numeric score. */
export function relevanceFailureIssues(
  driver: EsgDriver,
  expectedVersion: DriverRelevanceAssessmentVersion = RELEVANCE_ASSESSMENT_VERSION,
): string[] {
  const failure = driver.relevanceFailure;
  if (failure && failure.kind !== undefined && failure.kind !== 'review-rejected' && failure.kind !== 'evidence-binding') {
    return ['An unscored candidate has an unknown relevance failure kind.'];
  }
  if (failure?.kind === 'evidence-binding') {
    const invalidShape = driver.relevance
      || !hasText(driver.statusReason)
      || failure.policyVersion !== DRIVER_SELECTION_POLICY
      || failure.assessmentVersion !== expectedVersion
      || (expectedVersion === RELEVANCE_ASSESSMENT_VERSION && !isDriverEvidenceStatus(driver.evidenceStatus))
      || !hasText(failure.evidenceFingerprint)
      || !hasText(failure.attemptedAt)
      || !Number.isFinite(Date.parse(failure.attemptedAt))
      || !hasText(failure.assessor?.model)
      || (failure.assessor.responseId !== null && !hasText(failure.assessor.responseId))
      || failure.attempts !== 2
      || !Array.isArray(failure.failedDimensions)
      || !failure.failedDimensions.length
      || failure.failedDimensions.some((dimension) => !RELEVANCE_DIMENSIONS.includes(dimension))
      || new Set(failure.failedDimensions).size !== failure.failedDimensions.length
      || !Array.isArray(failure.reasons)
      || !failure.reasons.length
      || failure.reasons.some((reason) => !hasText(reason))
      || Object.prototype.hasOwnProperty.call(failure, 'assessment')
      || Object.prototype.hasOwnProperty.call(failure, 'review')
      || Object.prototype.hasOwnProperty.call(failure, 'reviewer')
      || Object.prototype.hasOwnProperty.call(failure, 'score')
      || Object.prototype.hasOwnProperty.call(failure, 'band')
      || Object.prototype.hasOwnProperty.call(failure, 'dimensions')
      || Object.prototype.hasOwnProperty.call(failure, 'rating')
      || Object.prototype.hasOwnProperty.call(failure, 'rationale')
      || Object.prototype.hasOwnProperty.call(failure, 'raw');
    return invalidShape ? ['An unscored candidate is missing its failed evidence-binding assessment.'] : [];
  }
  const assessment = failure?.assessment;
  if (driver.relevance || !assessment || assessment.assessmentVersion !== expectedVersion
    || !assessment.review?.reviewer?.model?.trim() || !driver.statusReason?.trim()
    || !Array.isArray(failure?.reasons) || !failure.reasons.length || failure.reasons.some((reason) => !reason?.trim())) return ['An unscored candidate is missing its failed relevance review.'];
  const checks = ['exactDriverSupport', 'noBorrowedObligations', 'urgencySupported', 'ratingsProportionate'] as const;
  if (checks.some((key) => typeof assessment.review?.checks?.[key] !== 'boolean') || checks.every((key) => assessment.review!.checks[key])) return ['An unscored candidate does not contain a rejected relevance review.'];
  return relevanceIssues({ ...driver, relevance: assessment }, expectedVersion).filter((issue) => issue !== RELEVANCE_REVIEW_ISSUE);
}

/** Pure, locale-independent selection. The full candidate pool stays in workbook order. */
export function selectRankedDrivers(
  candidatePool: EsgDriver[],
  assessedAt = new Date().toISOString(),
  assessmentVersion: DriverRelevanceAssessmentVersion = RELEVANCE_ASSESSMENT_VERSION,
): { drivers: EsgDriver[]; selection: DriverSelection } {
  const excluded = new Map<string, DriverSelection['excluded'][number]>();
  const eligible = candidatePool.filter((driver) => {
    const reason = driver.generationStatus !== 'verified' ? 'unavailable'
      : relevanceIssues(driver, assessmentVersion).length ? 'unscored'
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

type SelectionCandidate = {
  driver: EsgDriver;
  category: EsgDriverSection;
  key: string;
};

function compareEligibleDrivers(left: EsgDriver, right: EsgDriver): number {
  return (right.relevance?.score ?? -Infinity) - (left.relevance?.score ?? -Infinity)
    || (left.workbookRow ?? Number.MAX_SAFE_INTEGER) - (right.workbookRow ?? Number.MAX_SAFE_INTEGER)
    || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

function eligibilityReason(
  driver: EsgDriver,
  assessmentVersion: DriverRelevanceAssessmentVersion,
): 'unavailable' | 'unscored' | 'below-threshold' | null {
  return driver.generationStatus !== 'verified' ? 'unavailable'
    : relevanceIssues(driver, assessmentVersion).length ? 'unscored'
      : driver.relevance!.score < MIN_RELEVANCE_SCORE ? 'below-threshold' : null;
}

/** Small deterministic min-cost flow used to reserve duplicate aliases across categories. */
interface FlowEdge {
  to: number;
  rev: number;
  capacity: number;
  cost: number;
  candidateId?: string;
}

function addFlowEdge(graph: FlowEdge[][], from: number, to: number, capacity: number, cost: number, candidateId?: string): FlowEdge {
  const forward: FlowEdge = { to, rev: graph[to].length, capacity, cost, ...(candidateId ? { candidateId } : {}) };
  const reverse: FlowEdge = { to: from, rev: graph[from].length, capacity: 0, cost: -cost };
  graph[from].push(forward);
  graph[to].push(reverse);
  return forward;
}

function selectCategoryCandidates(candidates: SelectionCandidate[]): Set<string> {
  const keySet = Array.from(new Set(candidates.map((candidate) => candidate.key))).sort();
  const categoryCount = DRIVER_REPORT_CATEGORIES.length;
  const source = 0;
  const categoryStart = 1;
  const keyStart = categoryStart + categoryCount;
  const sink = keyStart + keySet.length;
  const graph: FlowEdge[][] = Array.from({ length: sink + 1 }, () => []);
  const keyNodes = new Map(keySet.map((key, index) => [key, keyStart + index]));
  const categoryNodes = new Map(DRIVER_REPORT_CATEGORIES.map((category, index) => [category, categoryStart + index]));

  for (const category of DRIVER_REPORT_CATEGORIES) {
    addFlowEdge(graph, source, categoryNodes.get(category)!, CATEGORY_QUOTA, 0);
  }
  Array.from(keyNodes.values()).forEach((node) => addFlowEdge(graph, node, sink, 1, 0));

  const edgeRefs: FlowEdge[] = [];
  const ordered = [...candidates].sort((left, right) => compareEligibleDrivers(left.driver, right.driver));
  ordered.forEach((candidate, rank) => {
    const from = categoryNodes.get(candidate.category);
    const to = keyNodes.get(candidate.key);
    if (from === undefined || to === undefined) return;
    // A score point dominates deterministic workbook-order tie breaking. The
    // scale also tolerates a future decimal score without changing the policy.
    const cost = -Math.round((candidate.driver.relevance?.score ?? 0) * 1_000_000) + rank;
    edgeRefs.push(addFlowEdge(graph, from, to, 1, cost, candidate.driver.id));
  });

  // Successive shortest augmenting paths yield a maximum-cardinality matching;
  // its costs then maximize relevance score and finally preserve stable order.
  while (true) {
    const distance = Array<number>(graph.length).fill(Number.POSITIVE_INFINITY);
    const previousNode = Array<number>(graph.length).fill(-1);
    const previousEdge = Array<number>(graph.length).fill(-1);
    const inQueue = Array<boolean>(graph.length).fill(false);
    const queue: number[] = [source];
    distance[source] = 0;
    inQueue[source] = true;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const node = queue[cursor];
      inQueue[node] = false;
      graph[node].forEach((edge, edgeIndex) => {
        if (edge.capacity <= 0 || !Number.isFinite(distance[node])) return;
        const nextDistance = distance[node] + edge.cost;
        if (nextDistance >= distance[edge.to]) return;
        distance[edge.to] = nextDistance;
        previousNode[edge.to] = node;
        previousEdge[edge.to] = edgeIndex;
        if (!inQueue[edge.to]) {
          inQueue[edge.to] = true;
          queue.push(edge.to);
        }
      });
    }
    if (!Number.isFinite(distance[sink])) break;
    let node = sink;
    while (node !== source) {
      const from = previousNode[node];
      const edge = graph[from][previousEdge[node]];
      edge.capacity -= 1;
      graph[node][edge.rev].capacity += 1;
      node = from;
    }
  }

  return new Set(edgeRefs.filter((edge) => edge.capacity === 0).map((edge) => edge.candidateId!));
}

/**
 * Select exactly three supported, relevance-qualified rows per report category
 * where the workbook supplies them. Shortages stay explicit; rows from another
 * category are never used to fill a gap.
 */
export function selectCategoryBalancedDrivers(
  candidatePool: EsgDriver[],
  assessedAt = new Date().toISOString(),
  assessmentVersion: DriverRelevanceAssessmentVersion = RELEVANCE_ASSESSMENT_VERSION,
): { drivers: EsgDriver[]; selection: DriverSelection } {
  const excluded = new Map<string, DriverSelection['excluded'][number]>();
  const categories = new Map<string, EsgDriverSection>();
  const categoryCandidates = new Map<EsgDriverSection, EsgDriver[]>();
  const eligible: SelectionCandidate[] = [];

  for (const driver of candidatePool) {
    const category = driverReportCategory(driver);
    if (category) {
      categories.set(driver.id, category);
      const rows = categoryCandidates.get(category) ?? [];
      rows.push(driver);
      categoryCandidates.set(category, rows);
    }
    const reason = eligibilityReason(driver, assessmentVersion);
    if (reason) {
      excluded.set(driver.id, { driverId: driver.id, reason });
    } else if (!category) {
      excluded.set(driver.id, { driverId: driver.id, reason: 'unmapped-category' });
    } else {
      eligible.push({ driver, category, key: canonicalDriverKey(driver.driverTitle) });
    }
  }

  // Keep only the strongest alias within a category. Cross-category aliases are
  // retained until matching so a scarce category can reserve the shared key.
  const bestByCategoryKey = new Map<string, SelectionCandidate>();
  for (const candidate of [...eligible].sort((left, right) => compareEligibleDrivers(left.driver, right.driver))) {
    const mapKey = `${candidate.category}\u0000${candidate.key}`;
    const previous = bestByCategoryKey.get(mapKey);
    if (previous) {
      excluded.set(candidate.driver.id, { driverId: candidate.driver.id, reason: 'duplicate', duplicateOf: previous.driver.id });
    } else {
      bestByCategoryKey.set(mapKey, candidate);
    }
  }
  const distinctEligible = Array.from(bestByCategoryKey.values());
  const selectedIds = selectCategoryCandidates(distinctEligible);
  const selectedByKey = new Map<string, string>();
  for (const candidate of distinctEligible) {
    if (selectedIds.has(candidate.driver.id)) selectedByKey.set(candidate.key, candidate.driver.id);
  }

  for (const candidate of distinctEligible) {
    if (selectedIds.has(candidate.driver.id)) continue;
    const winner = selectedByKey.get(candidate.key);
    if (winner && winner !== candidate.driver.id) {
      excluded.set(candidate.driver.id, { driverId: candidate.driver.id, reason: 'duplicate', duplicateOf: winner });
    } else {
      excluded.set(candidate.driver.id, { driverId: candidate.driver.id, reason: 'category-quota' });
    }
  }

  const drivers = DRIVER_REPORT_CATEGORIES.flatMap((category) => distinctEligible
    .filter((candidate) => candidate.category === category && selectedIds.has(candidate.driver.id))
    .sort((left, right) => compareEligibleDrivers(left.driver, right.driver))
    .map((candidate) => candidate.driver));
  const categoryQuotas = DRIVER_REPORT_CATEGORIES.map((category) => {
    const all = categoryCandidates.get(category) ?? [];
    const categoryEligible = distinctEligible.filter((candidate) => candidate.category === category);
    const publishedDriverIds = drivers.filter((driver) => categories.get(driver.id) === category).map((driver) => driver.id);
    return {
      category,
      requestedCount: CATEGORY_QUOTA,
      candidateCount: all.length,
      eligibleCandidateCount: categoryEligible.length,
      publishedDriverIds,
      gap: Math.max(0, CATEGORY_QUOTA - publishedDriverIds.length),
    };
  });

  return {
    drivers,
    selection: {
      policyVersion: CATEGORY_SELECTION_POLICY,
      requestedCount: MAX_PUBLISHED_DRIVERS,
      minimumScore: MIN_RELEVANCE_SCORE,
      candidateCount: candidatePool.length,
      supportedCandidateCount: candidatePool.filter((driver) => driver.generationStatus === 'verified').length,
      // Report the number of distinct named drivers globally; the per-category
      // values below use distinct (category, key) pairs so an alias shared by
      // two categories cannot be counted as two globally eligible drivers.
      eligibleCandidateCount: new Set(distinctEligible.map((candidate) => candidate.key)).size,
      publishedDriverIds: drivers.map((driver) => driver.id),
      excluded: candidatePool.flatMap((driver) => excluded.has(driver.id) ? [excluded.get(driver.id)!] : []),
      categoryQuotas,
      assessedAt,
    },
  };
}

/** Dispatch a persisted selection policy without silently falling back. */
export function selectDriversForPolicy(
  candidatePool: EsgDriver[],
  policy: DriverSelectionPolicy | string,
  assessedAt = new Date().toISOString(),
  assessmentVersion: DriverRelevanceAssessmentVersion = RELEVANCE_ASSESSMENT_VERSION,
): { drivers: EsgDriver[]; selection: DriverSelection } {
  if (policy === DRIVER_SELECTION_POLICY) return selectRankedDrivers(candidatePool, assessedAt, assessmentVersion);
  if (policy === CATEGORY_SELECTION_POLICY) return selectCategoryBalancedDrivers(candidatePool, assessedAt, assessmentVersion);
  throw new Error(`Unsupported driver selection policy: ${String(policy)}`);
}
