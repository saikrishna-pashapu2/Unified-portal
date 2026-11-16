import { describe, expect, it } from 'vitest';
import type { EsgDriver, EsgDriverSource } from '../types';
import { driverSourceDateLines, orderDriversForDisplay, sourceDateLabel } from '../presentation';

describe('driver display order and source dates', () => {
  it('offers stable A–Z without changing saved order, identities, or relevance scores', () => {
    const drivers = [
      { id: 'z', driverTitle: 'Zulu', relevance: { score: 95 } },
      { id: 'b', driverTitle: 'alpha', relevance: { score: 65 } },
      { id: 'a', driverTitle: 'Alpha', relevance: { score: 80 } },
    ] as EsgDriver[];
    const before = structuredClone(drivers);
    expect(orderDriversForDisplay(drivers, 'alphabetical').map((d) => d.id)).toEqual(['a', 'b', 'z']);
    expect(drivers).toEqual(before);
    expect(orderDriversForDisplay(drivers, 'report')).toEqual(before);
    expect(orderDriversForDisplay(drivers, 'report')).not.toBe(drivers);
  });

  it('keeps document precision and labels missing dates without substituting metadata', () => {
    const source = { sourceDate: { kind: 'version-issued', value: '2024-11', evidence: 'November 2024', location: 'Cover' } } as EsgDriverSource;
    expect(sourceDateLabel(source)).toBe('Version issued: 2024-11');
    expect(sourceDateLabel({ sourceDate: { ...source.sourceDate!, kind: 'published', value: '2024' } })).toBe('Published: 2024');
    expect(sourceDateLabel({ sourceDate: { ...source.sourceDate!, kind: 'updated', value: '2024-11-02' } })).toBe('Updated: 2024-11-02');
    const undated = { publishedDate: '2024-11-02', lastModified: '2026-01-01', retrievedAt: '2026-11-16' } as EsgDriverSource;
    expect(sourceDateLabel(undated)).toBe('Date not provided');
    expect(sourceDateLabel(undefined)).toBe('Date not provided');
  });

  it('associates every source date with its exact cited URL, including missing source records', () => {
    const driver = { sourceRefs: ['b', 'a', 'missing'], sourceLinks: ['https://example.org/b', 'https://example.org/a', 'https://example.org/missing'] } as EsgDriver;
    const evidence = [
      { id: 'a', url: driver.sourceLinks[1], sourceDate: { kind: 'published', value: '2024-01', evidence: 'January 2024', location: 'Cover' } },
      { id: 'b', url: driver.sourceLinks[0], retrievedAt: '2026-11-16' },
    ] as EsgDriverSource[];
    expect(driverSourceDateLines(driver, evidence)).toEqual([
      'https://example.org/b — Date not provided',
      'https://example.org/a — Published: 2024-01',
      'https://example.org/missing — Date not provided',
    ]);
  });
});
