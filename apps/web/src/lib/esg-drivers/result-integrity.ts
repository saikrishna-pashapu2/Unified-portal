import type { AnyEsgDriverCheckpoint, EsgDriverResult, EsgWorkbookCheckpoint } from './types';
import { normalizeWorkbookUrl } from './workbook-types';
import { ESG_DRIVER_QUALITY_POLICY, EVIDENCE_STATUS_LABELS, hasSuggestedEvidenceKpi } from './quality-policy';
import { DRIVER_SELECTION_POLICY, MAX_PUBLISHED_DRIVERS, relevanceIssues, relevanceFailureIssues, selectRankedDrivers } from './ranking-policy';
import { relevanceEvidenceFingerprint } from './relevance-evidence';
import { isPlausibleSourceDate } from './excel-source-metadata';

export const ESG_EVIDENCE_CONTRACT = 'excel-evidence-v3' as const;
export const ESG_DRIVER_QUEUE_TYPE = 'esg_driver_excel_v4' as const;
export const isEsgDriverJobType = (type: string) => type === ESG_DRIVER_QUEUE_TYPE || type === 'esg_driver_excel_v3' || type === 'esg_driver';

// JSONB reorders object keys; compare values canonically across the DB boundary.
const canonicalJson = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item);

export class EsgDriverQualityGateError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Driver pack failed its workbook quality checks: ${issues.join(' ')}`);
    this.name = 'EsgDriverQualityGateError';
  }
}

/** Validate against the job's immutable selection, never the worker's current catalog. */
export function workbookResultIssues(result: EsgDriverResult, checkpoint: EsgWorkbookCheckpoint): string[] {
  const issues: string[] = [];
  const issue = (message: string) => { if (!issues.includes(message)) issues.push(message); };
  const allowed = new Set(checkpoint.allowedSources.map((s) => normalizeWorkbookUrl(s.url)));
  const allowedUrl = (url: string) => { try { return allowed.has(normalizeWorkbookUrl(url)); } catch { return false; } };
  if (result.workflow !== 'excel-sources' || result.catalogVersion !== checkpoint.catalogVersion || result.workbook !== checkpoint.workbook) issue('The result was produced by a different workbook workflow.');
  if (['country', 'sector', 'language'].some((key) => result[key as keyof typeof checkpoint.input] !== checkpoint.input[key as keyof typeof checkpoint.input])) issue('The result does not match the requested country, sector and language.');
  const ranked = checkpoint.selectionPolicy === DRIVER_SELECTION_POLICY;
  if (checkpoint.selectionPolicy && !ranked) issue('Unsupported driver selection policy.');
  if (!ranked && (result.selection || result.candidatePool)) issue('Ranked output does not match the saved selection policy.');
  const published = Array.isArray(result.drivers) ? result.drivers : [];
  const drivers = ranked ? (Array.isArray(result.candidatePool) ? result.candidatePool : []) : published;
  const evidence = Array.isArray(result.evidence) ? result.evidence : [];
  if (drivers.length !== checkpoint.definitions.length || (!ranked && result.expectedDriverCount !== checkpoint.definitions.length)) issue(`Expected all ${checkpoint.definitions.length} workbook drivers in Excel order.`);
  if (new Set(drivers.map((d) => d.id)).size !== drivers.length) issue('Duplicate driver identifiers.');
  if (new Set(evidence.map((s) => s.id)).size !== evidence.length) issue('Duplicate source identifiers.');
  const sources = new Map(evidence.map((s) => [s.id, s]));
  // The generator merges passages but takes document metadata from the last
  // persisted occurrence of each source. Verify that same provenance on reads.
  const savedSources = new Map(checkpoint.slots.flatMap((slot) => slot.sources.map((source) => [source.id, source] as const)));
  for (const source of evidence) {
    if (!allowedUrl(source.url) || !source.finalUrl || !allowedUrl(source.finalUrl)) issue('A source or redirect is outside the workbook URL allowlist.');
    if (source.retrievalStatus !== 'retrieved' || source.evidenceProvenance !== 'retrieved-page' || source.isContextualFallback) issue('A source was not retrieved from a permitted page.');
    if (source.sourceDate && (!['published', 'updated', 'version-issued'].includes(source.sourceDate.kind) || !source.sourceDate.value?.trim() || !source.sourceDate.evidence?.trim() || !source.sourceDate.location?.trim())) issue('A document date is missing its source provenance.');
    if (source.sourceDate && !isPlausibleSourceDate(source.sourceDate.value)) issue('A document date is invalid or in the future.');
    const savedSource = savedSources.get(source.id);
    if (ranked && (!savedSource || savedSource.url !== source.url || (['sourceDate', 'publishedDate', 'updatedDate', 'lastModified'] as const).some((key) => canonicalJson(savedSource[key] ?? null) !== canonicalJson(source[key] ?? null)))) issue('A document date does not match its durably retrieved source metadata.');
    if (ranked && [source.publishedDate, source.updatedDate].some((value) => value && !isPlausibleSourceDate(value))) issue('A document date is invalid or in the future.');
  }
  for (let i = 0; i < drivers.length; i++) {
    const driver = drivers[i];
    const definition = checkpoint.definitions[i];
    if (!definition || driver.id !== definition.id || driver.driverTitle !== definition.name || driver.driverType !== definition.type || driver.driverSection !== definition.section || driver.workbookRow !== definition.row || driver.workbookSheet !== definition.sheet) issue('Driver names, categories, rows or order differ from the workbook.');
    if (ranked && definition && (driver.baseline?.logic !== definition.logic || driver.baseline?.evidenceKpi !== definition.evidenceKpi || driver.baseline?.keySources !== definition.keySources || driver.driverLogic !== definition.logic)) issue('A ranked candidate changed the original workbook baseline.');
    if (!['verified', 'unavailable'].includes(driver.generationStatus || '')) issue('Every workbook row must have an explicit evidence status.');
    if (driver.generationStatus === 'unavailable') {
      if (!driver.statusReason?.trim()) issue('An unavailable driver is missing its evidence limitation.');
      if (driver.citations?.length || driver.sourceRefs?.length || driver.sourceLinks?.length) issue('An unavailable update cannot carry verified citations.');
      continue;
    }
    if (!driver.driverText?.trim() || !driver.countrySectorRelevance?.trim() || !driver.evidenceKpi?.trim() || !driver.citations?.length) issue('A verified update is incomplete or has no citations.');
    const citedIds = new Set(driver.citations?.map((c) => c.sourceId));
    if (!driver.sourceRefs?.length || driver.sourceRefs.length !== driver.sourceLinks?.length || new Set(driver.sourceRefs).size !== driver.sourceRefs.length || citedIds.size !== driver.sourceRefs.length || driver.sourceRefs.some((id, index) => !citedIds.has(id) || sources.get(id)?.url !== driver.sourceLinks[index])) issue('Source references, links and citations do not resolve to the same evidence.');
    for (const citation of driver.citations || []) {
      const passage = sources.get(citation.sourceId)?.passages?.find((p) => p.id === citation.passageId);
      if (!citation.quote?.trim() || !passage || passage.text !== citation.quote || passage.location !== citation.location) issue('A cited quotation or location does not match its saved source passage.');
    }
    if (checkpoint.evidenceContract === ESG_EVIDENCE_CONTRACT) {
      const verification = driver.verification;
      if (!verification || verification.contract !== ESG_EVIDENCE_CONTRACT || !verification.writer?.model || !verification.reviewer?.model || !verification.reviewedAt || !verification.citedPassagesOnly || !verification.checks || (['supported', 'directDriverEvidence', 'sameDriver', 'correctLanguage', 'allClaimsSupported', 'metricsMatchScopeUnitAndPeriod', 'usesLatestSupportedInformation'] as const).some((key) => verification.checks[key] !== true)) issue('A verified update is missing its model and evidence review record.');
    }
    if (checkpoint.qualityPolicy === ESG_DRIVER_QUALITY_POLICY) {
      const editorial = driver.verification?.editorial;
      if (!editorial || editorial.policyVersion !== ESG_DRIVER_QUALITY_POLICY || !editorial.reviewer?.model || !editorial.consideredPassageIds?.length || ['factualEvidenceKpi', 'latestRelevantEvidenceUsed', 'countrySectorGrounded', 'coherentDriver', 'evidenceStatusAccurate'].some((key) => editorial.checks?.[key as keyof typeof editorial.checks] !== true)) issue('A verified update is missing the current editorial review.');
      if (!driver.evidenceStatus || !(driver.evidenceStatus in EVIDENCE_STATUS_LABELS)) issue('A verified update is missing its evidence age/status classification.');
      if (hasSuggestedEvidenceKpi(driver.evidenceKpi)) issue('Suggested monitoring measures cannot be presented in the evidence field.');
    }
    if (ranked) {
      for (const problem of driver.relevanceFailure ? relevanceFailureIssues(driver) : relevanceIssues(driver)) issue(problem);
      const assessment = driver.relevance || driver.relevanceFailure?.assessment;
      if (assessment?.evidenceFingerprint !== relevanceEvidenceFingerprint(driver, checkpoint.input)) issue('Relevance assessment does not match the candidate evidence and scope.');
    }
  }
  const verified = drivers.filter((d) => d.generationStatus === 'verified').length;
  if (ranked) {
    const selection = result.selection;
    if (!selection || selection.policyVersion !== DRIVER_SELECTION_POLICY || !Number.isFinite(Date.parse(selection.assessedAt))) issue('A ranked result is missing its selection record.');
    const expected = selectRankedDrivers(drivers, selection?.assessedAt || result.generatedAt);
    if (canonicalJson(selection) !== canonicalJson(expected.selection) || canonicalJson(published) !== canonicalJson(expected.drivers)) issue('Published drivers or ranking differ from the saved rubric and candidate assessment.');
    if (result.expectedDriverCount !== MAX_PUBLISHED_DRIVERS || result.verifiedDriverCount !== published.length || result.completion !== (published.length === MAX_PUBLISHED_DRIVERS ? 'complete' : 'partial')) issue('The ranked completion label or driver count is incorrect.');
    if ((verified < drivers.length || expected.selection.excluded.some((item) => item.reason === 'unscored')) && !result.warnings?.length) issue('Unverified candidate coverage gaps must remain visible.');
  } else if (result.verifiedDriverCount !== verified || result.completion !== (verified === checkpoint.definitions.length ? 'complete' : 'partial')) issue('The completion label or verified count is incorrect.');
  if (checkpoint.evidenceContract === ESG_EVIDENCE_CONTRACT && result.provenance?.contract !== ESG_EVIDENCE_CONTRACT) issue('The worker did not use the required evidence contract.');
  return issues;
}

export function assertWorkbookResult(result: EsgDriverResult, checkpoint: AnyEsgDriverCheckpoint | null | undefined, requireSavedSlots = false): void {
  if (checkpoint?.version !== 2) throw new EsgDriverQualityGateError(['A pinned workbook checkpoint is required. Start a new workbook run.']);
  const issues = workbookResultIssues(result, checkpoint);
  const candidates = checkpoint.selectionPolicy === DRIVER_SELECTION_POLICY ? result.candidatePool || [] : result.drivers;
  if (requireSavedSlots && (checkpoint.slots.length !== checkpoint.definitions.length || candidates.some((driver) => canonicalJson(checkpoint.slots.find((s) => s.driver.id === driver.id)?.driver) !== canonicalJson(driver)))) issues.push('The result does not match the durably reviewed checkpoint rows.');
  if (issues.length) throw new EsgDriverQualityGateError(issues);
}

/** Legacy history remains readable; a workbook job must never masquerade as legacy output. */
export function savedResultError(result: EsgDriverResult, checkpoint: AnyEsgDriverCheckpoint | null | undefined): string | null {
  if (checkpoint?.version !== 2 && result.workflow !== 'excel-sources') return null;
  try { assertWorkbookResult(result, checkpoint, checkpoint?.version === 2 && checkpoint.selectionPolicy === DRIVER_SELECTION_POLICY); return null; }
  catch { return 'This saved result failed workbook verification and cannot be used or exported. Start a new run to assess the workbook drivers from permitted sources.'; }
}
