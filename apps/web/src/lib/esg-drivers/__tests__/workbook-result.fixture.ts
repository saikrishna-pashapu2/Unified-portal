import { createWorkbookCheckpoint } from '../workbook';
import { ESG_EVIDENCE_CONTRACT } from '../result-integrity';
import { ESG_DRIVER_QUALITY_POLICY } from '../quality-policy';
import type { EsgDriver, EsgDriverResult, EsgDriverSource } from '../types';
import { DRIVER_SELECTION_POLICY, computeRelevanceScore, relevanceBand, selectRankedDrivers } from '../ranking-policy';
import { relevanceEvidenceFingerprint } from '../relevance-evidence';

export function workbookResultFixture(count = 2, unavailable = false) {
  const input = { country: 'UAE', sector: 'Banking', language: 'English' };
  const checkpoint = createWorkbookCheckpoint(input);
  // Existing full-workbook fixtures intentionally exercise backward compatibility.
  delete checkpoint.selectionPolicy;
  checkpoint.definitions = checkpoint.definitions.slice(0, count);
  const url = checkpoint.allowedSources[0].url;
  const source: EsgDriverSource = {
    id: 'source', url, finalUrl: url, title: 'Permitted workbook page', domain: new URL(url).hostname,
    snippet: 'Supported fact.', contentSnippet: 'Supported fact.', retrievalStatus: 'retrieved',
    evidenceProvenance: 'retrieved-page', isContextualFallback: false, retrievalError: null,
    publishedDate: null, updatedDate: null, lastModified: null, retrievedAt: '2026-09-10T00:00:00Z',
    authorityScore: 0, freshnessScore: 0, relevanceScore: 0, sourceScore: 0,
    passages: [{ id: 'passage', text: 'Supported fact.', location: 'paragraph 1' }],
  };
  const drivers: EsgDriver[] = checkpoint.definitions.map((d) => ({
    id: d.id, driverTitle: d.name, driverType: d.type, driverSection: d.section, workbookRow: d.row, workbookSheet: d.sheet, driverLogic: d.logic,
    driverText: unavailable ? 'No verified update.' : 'Supported fact.', countrySectorRelevance: 'This may affect banking.', evidenceKpi: unavailable ? 'Unavailable.' : 'Qualitative evidence.',
    keySources: unavailable ? [] : [source.title], sourceRefs: unavailable ? [] : [source.id], sourceLinks: unavailable ? [] : [url],
    confidence: 0, lastChecked: '2026-09-10T00:00:00Z', generationStatus: unavailable ? 'unavailable' : 'verified', statusReason: unavailable ? 'Source is unavailable.' : '',
    ...(unavailable ? {} : { evidenceStatus: 'framework-reference' as const, evidenceDate: null, evidenceLimitation: '' }),
    baseline: { logic: d.logic, evidenceKpi: d.evidenceKpi, keySources: d.keySources },
    citations: unavailable ? [] : [{ sourceId: source.id, passageId: 'passage', quote: 'Supported fact.', location: 'paragraph 1' }],
    ...(unavailable ? {} : { verification: {
      contract: ESG_EVIDENCE_CONTRACT, writer: { model: 'gpt-5.6-luna', responseId: 'writer' }, reviewer: { model: 'gpt-5.6-luna', responseId: 'reviewer' },
      reviewedAt: '2026-09-10T00:00:00Z', citedPassagesOnly: true as const,
      checks: { supported: true, directDriverEvidence: true, sameDriver: true, correctLanguage: true, allClaimsSupported: true, metricsMatchScopeUnitAndPeriod: true, usesLatestSupportedInformation: true },
      editorial: { policyVersion: ESG_DRIVER_QUALITY_POLICY, reviewer: { model: 'gpt-5.6-luna', responseId: 'editorial' }, consideredPassageIds: ['passage'], checks: { factualEvidenceKpi: true, latestRelevantEvidenceUsed: true, countrySectorGrounded: true, coherentDriver: true, evidenceStatusAccurate: true } },
    } }),
  }));
  checkpoint.slots = drivers.map((driver) => ({ driver: structuredClone(driver), sources: unavailable ? [] : [source] }));
  const result: EsgDriverResult = {
    ...input, workflow: 'excel-sources', workbook: checkpoint.workbook, catalogVersion: checkpoint.catalogVersion,
    generatedAt: '2026-09-10T00:00:00Z', drivers, evidence: unavailable ? [] : [source], warnings: unavailable ? ['Unavailable updates.'] : [],
    expectedDriverCount: count, verifiedDriverCount: unavailable ? 0 : count, completion: unavailable ? 'partial' : 'complete',
    provenance: { contract: ESG_EVIDENCE_CONTRACT, configuredModel: 'gpt-5.6-luna', actualModels: unavailable ? [] : ['gpt-5.6-luna'] },
  };
  return { checkpoint, result, source };
}

export function rankedWorkbookResultFixture(count = 52, unavailable = false) {
  const fixture = workbookResultFixture(count, unavailable);
  fixture.checkpoint.selectionPolicy = DRIVER_SELECTION_POLICY;
  const candidates = fixture.result.drivers;
  for (const driver of candidates.filter((d) => d.generationStatus === 'verified')) {
    const dimension = { rating: 4, reason: 'The cited framework supports this assessment.', passageIds: ['passage'] };
    const dimensions = { country: { ...dimension }, sector: { ...dimension }, businessImpact: { ...dimension }, urgency: { ...dimension } };
    const score = computeRelevanceScore(dimensions);
    driver.relevance = {
      assessmentVersion: 'driver-specific-v2',
      review: { reviewer: { model: 'gpt-5.6-luna', responseId: 'relevance-reviewer' }, checks: { exactDriverSupport: true, noBorrowedObligations: true, urgencySupported: true, ratingsProportionate: true } },
      policyVersion: DRIVER_SELECTION_POLICY, score, band: relevanceBand(score), dimensions,
      rationale: 'Relevant to the selected country and sector.', assessedAt: fixture.result.generatedAt,
      evidenceFingerprint: relevanceEvidenceFingerprint(driver, fixture.checkpoint.input),
      assessor: { model: 'gpt-5.6-luna', responseId: 'relevance-assessor' },
    };
  }
  const ranked = selectRankedDrivers(candidates, fixture.result.generatedAt);
  fixture.result = { ...fixture.result, ...ranked, candidatePool: candidates, expectedDriverCount: 15, verifiedDriverCount: ranked.drivers.length, completion: ranked.drivers.length === 15 ? 'complete' : 'partial' };
  fixture.checkpoint.slots = candidates.map((driver) => ({ driver: structuredClone(driver), sources: unavailable ? [] : [fixture.source] }));
  return fixture;
}
