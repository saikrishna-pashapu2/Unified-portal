import { describe, expect, it } from 'vitest';
import { computeRelevanceScore, relevanceBand, selectRankedDrivers } from '../ranking-policy';
import { relevanceEvidenceFingerprint } from '../relevance-evidence';
import { rankedWorkbookResultFixture } from './workbook-result.fixture';

describe('evidence-based top15 selection', () => {
  it('computes the agreed weighted points instead of accepting a generated percentage', () => {
    const { result } = rankedWorkbookResultFixture(1);
    const dimensions = result.candidatePool![0].relevance!.dimensions;
    dimensions.country.rating = 5;
    dimensions.sector.rating = 4;
    dimensions.businessImpact.rating = 3;
    dimensions.urgency.rating = 2;
    expect(computeRelevanceScore(dimensions)).toBe(75);
    dimensions.country.rating = 4.5;
    expect(() => computeRelevanceScore(dimensions)).toThrow('rating');
    dimensions.country.rating = 6;
    expect(() => computeRelevanceScore(dimensions)).toThrow('rating');
  });

  it('selects15 and preserves full original identities, with deterministic tied scores', () => {
    const { result } = rankedWorkbookResultFixture();
    expect(result.drivers).toHaveLength(15);
    expect(result.candidatePool).toHaveLength(52);
    const selected = selectRankedDrivers([...result.candidatePool!].reverse(), result.generatedAt);
    expect(selected.drivers.map((d) => d.id)).toEqual(result.drivers.map((d) => d.id));
    expect(result.selection!.excluded.some((e) => e.reason === 'below-cutoff')).toBe(true);
  });

  it('does not fill places with unsupported or weak candidates', () => {
    const { result } = rankedWorkbookResultFixture(3);
    const candidates = result.candidatePool!;
    candidates[0].generationStatus = 'unavailable';
    for (const dimension of Object.values(candidates[1].relevance!.dimensions)) dimension.rating = 2;
    candidates[1].relevance!.score = 40;
    candidates[1].relevance!.band = relevanceBand(40);
    const selected = selectRankedDrivers(candidates);
    expect(selected.drivers.map((d) => d.id)).toEqual([candidates[2].id]);
    expect(selected.selection.excluded.map((e) => e.reason)).toEqual(['unavailable', 'below-threshold']);
  });

  it('suppresses duplicate NZBA labels while preserving related distinct frameworks', () => {
    const { result } = rankedWorkbookResultFixture();
    const selected = selectRankedDrivers(result.candidatePool!);
    expect(selected.selection.excluded).toContainEqual({ driverId: 'banking-r32', reason: 'duplicate', duplicateOf: 'banking-r17' });
    expect(selected.selection.excluded.find((e) => e.driverId === 'banking-r18')?.reason).not.toBe('duplicate');
  });

  it('binds relevance to canonical scope and evidence independently of translation', () => {
    const { result } = rankedWorkbookResultFixture(1);
    const driver = result.drivers[0];
    const original = relevanceEvidenceFingerprint(driver, result);
    driver.driverText = 'نص مترجم';
    driver.countrySectorRelevance = 'Объяснение актуальности';
    const translatedResult = { ...result, language: 'Arabic' };
    expect(relevanceEvidenceFingerprint(driver, translatedResult)).toBe(original);
    expect(relevanceEvidenceFingerprint(driver, { country: 'Kazakhstan', sector: 'Banking' })).not.toBe(original);
    driver.citations![0].quote += 'Changed source.';
    expect(relevanceEvidenceFingerprint(driver, result)).not.toBe(original);
  });
});
