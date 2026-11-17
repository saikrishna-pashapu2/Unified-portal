import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  CATEGORY_SELECTION_POLICY,
  DRIVER_REPORT_CATEGORIES,
  computeRelevanceScore,
  driverReportCategory,
  relevanceBand,
  selectDriversForPolicy,
  selectRankedDrivers,
} from '../ranking-policy';
import { relevanceEvidenceFingerprint } from '../relevance-evidence';
import { rankedWorkbookResultFixture } from './workbook-result.fixture';
import type { EsgDriver } from '../types';

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

  it('binds the v3 score to the verified evidence status while preserving the v2 byte shape', () => {
    const { result } = rankedWorkbookResultFixture(1);
    const driver = result.candidatePool![0];
    const v3 = relevanceEvidenceFingerprint(driver, result, 'driver-specific-v3');
    driver.evidenceStatus = 'status-unresolved';
    expect(relevanceEvidenceFingerprint(driver, result, 'driver-specific-v3')).not.toBe(v3);
    const v2 = relevanceEvidenceFingerprint(driver, result, 'driver-specific-v2');
    driver.evidenceStatus = 'historical';
    expect(relevanceEvidenceFingerprint(driver, result, 'driver-specific-v2')).toBe(v2);
    const legacyCitations = (driver.citations || []).map(({ sourceId, passageId, quote }) => ({ sourceId, passageId, quote }))
      .sort((left, right) => left.passageId < right.passageId ? -1 : left.passageId > right.passageId ? 1 : 0);
    expect(v2).toBe(createHash('sha256').update(JSON.stringify({
      country: result.country, sector: result.sector, driverId: driver.id, name: driver.driverTitle,
      section: driver.driverSection, type: driver.driverType, citations: legacyCitations,
    })).digest('hex'));
  });
});

describe('category-balanced15 selection', () => {
  function candidate(
    base: EsgDriver,
    id: string,
    category: string,
    score = 100,
  ) {
    const row = structuredClone(base);
    row.id = id;
    row.driverTitle = `${category} ${id}`;
    row.driverSection = category === 'Global Drivers' ? 'Global Drivers' : 'UAE';
    row.driverType = category === 'Global Drivers' ? 'International Agreements' : category;
    row.workbookRow = Number(id.replace(/\D/g, '')) || 1;
    const rating = score >= 90 ? 5 : score >= 70 ? 4 : score >= 50 ? 3 : 2;
    row.relevance!.dimensions = Object.fromEntries(
      Object.keys(row.relevance!.dimensions).map((key) => [key, { rating, reason: 'Direct evidence.', passageIds: ['passage'] }]),
    ) as NonNullable<EsgDriver['relevance']>['dimensions'];
    row.relevance!.score = computeRelevanceScore(row.relevance!.dimensions);
    row.relevance!.band = relevanceBand(row.relevance!.score);
    return row;
  }

  function pool() {
    const base = rankedWorkbookResultFixture(1).result.candidatePool![0];
    let index = 0;
    return DRIVER_REPORT_CATEGORIES.flatMap((category) => Array.from({ length: 3 }, () => candidate(base, `driver-${++index}`, category)));
  }

  it('publishes three per category in the contract order', () => {
    const selected = selectDriversForPolicy(pool(), CATEGORY_SELECTION_POLICY);
    expect(selected.drivers).toHaveLength(15);
    expect(selected.drivers.map((driver) => driverReportCategory(driver))).toEqual(
      DRIVER_REPORT_CATEGORIES.flatMap((category) => [category, category, category]),
    );
    expect(selected.selection.categoryQuotas?.map((quota) => quota.publishedDriverIds)).toEqual(
      DRIVER_REPORT_CATEGORIES.map((category) => selected.drivers.filter((driver) => driverReportCategory(driver) === category).map((driver) => driver.id)),
    );
    expect(selectDriversForPolicy([...pool()].reverse(), CATEGORY_SELECTION_POLICY).drivers.map((driver) => driver.id)).toEqual(selected.drivers.map((driver) => driver.id));
  });

  it('does not let a high-score category consume another category quota', () => {
    const base = rankedWorkbookResultFixture(1).result.candidatePool![0];
    const concentrated = [
      ...Array.from({ length: 12 }, (_, index) => candidate(base, `global-${index}`, 'Global Drivers', 100 - index)),
      ...DRIVER_REPORT_CATEGORIES.slice(1).flatMap((category) => Array.from({ length: 3 }, (_, index) => candidate(base, `${category}-${index}`, category, 50 + index))),
    ];
    const selected = selectDriversForPolicy(concentrated, CATEGORY_SELECTION_POLICY);
    expect(selected.drivers).toHaveLength(15);
    expect(selected.drivers.filter((driver) => driverReportCategory(driver) === 'Global Drivers')).toHaveLength(3);
    expect(selected.selection.excluded.filter((item) => item.reason === 'category-quota')).toHaveLength(9);
  });

  it('keeps shortages and unmapped rows explicit', () => {
    const base = rankedWorkbookResultFixture(1).result.candidatePool![0];
    const candidates = pool().filter((driver) => driverReportCategory(driver) !== 'Supply Chain').slice(0, 12);
    candidates.push(candidate(base, 'supply-1', 'Supply Chain'));
    candidates.push(candidate(base, 'supply-2', 'Supply Chain'));
    const unknown = candidate(base, 'unknown-1', 'Unknown');
    unknown.driverSection = 'UAE';
    unknown.driverType = 'Other';
    candidates.push(unknown);
    const selected = selectDriversForPolicy(candidates, CATEGORY_SELECTION_POLICY);
    expect(selected.drivers).toHaveLength(14);
    expect(selected.selection.categoryQuotas?.find((quota) => quota.category === 'Supply Chain')).toMatchObject({ candidateCount: 2, gap: 1 });
    expect(selected.selection.excluded).toContainEqual({ driverId: 'unknown-1', reason: 'unmapped-category' });
    expect(selected.selection.categoryQuotas?.find((quota) => quota.category === 'Supply Chain')?.publishedDriverIds).toHaveLength(2);
  });

  it('reserves a shared alias for the category that needs it', () => {
    const base = rankedWorkbookResultFixture(1).result.candidatePool![0];
    const candidates = pool();
    const global = candidates[0];
    const supply = candidates.find((driver) => driverReportCategory(driver) === 'Supply Chain')!;
    candidates.push(candidate(base, 'supply-extra', 'Supply Chain', 70));
    global.driverTitle = 'Net-Zero Banking Alliance';
    supply.driverTitle = 'Net-Zero Banking Alliance (legacy/reference)';
    const selected = selectDriversForPolicy(candidates, CATEGORY_SELECTION_POLICY);
    expect(selected.drivers).toHaveLength(15);
    expect(selected.selection.excluded.some((item) => item.reason === 'duplicate')).toBe(true);
    expect(new Set(selected.drivers.map((driver) => driver.driverTitle.replace(/\s*\(legacy\/reference\)$/i, ''))).size).toBe(15);
  });

  it('uses an alternate in an abundant category to preserve a scarce shared key', () => {
    const base = rankedWorkbookResultFixture(1).result.candidatePool![0];
    const candidates = pool();
    const globals = candidates.filter((driver) => driverReportCategory(driver) === 'Global Drivers');
    const supply = candidates.filter((driver) => driverReportCategory(driver) === 'Supply Chain');
    globals[0].driverTitle = 'Shared alias';
    supply[0].driverTitle = 'Shared alias (legacy/reference)';
    candidates.push(candidate(base, 'global-extra', 'Global Drivers', 70));
    const selected = selectDriversForPolicy(candidates, CATEGORY_SELECTION_POLICY);
    expect(selected.selection.categoryQuotas?.find((quota) => quota.category === 'Global Drivers')?.gap).toBe(0);
    expect(selected.selection.categoryQuotas?.find((quota) => quota.category === 'Supply Chain')?.gap).toBe(0);
    expect(selected.drivers.find((driver) => driver.driverTitle === 'Shared alias')).toBeUndefined();
    expect(selected.drivers.find((driver) => driver.driverTitle === 'Shared alias (legacy/reference)')).toBeDefined();
  });
});
