import { describe, expect, it } from 'vitest';
import { ESG_DRIVER_WORKBOOK, selectWorkbookDrivers, createWorkbookCheckpoint } from '../workbook';
import { normalizeWorkbookUrl } from '../workbook-types';
import { workbookDriverCount } from '../coverage';

describe('September workbook fidelity', () => {
  const countries = ['Kazakhstan', 'Uzbekistan', 'UAE', 'Saudi Arabia'];
  const counts = { Banking: [53, 49, 52, 56], Energy: [59, 40, 49, 51], 'Oil & Gas': [46, 53, 60, 54], 'Mining & Metals': [59, 52, 50, 50], 'Real Estate': [63, 56, 47, 46] };
  it('imports all 685 driver rows and the new workbook identity', () => {
    expect(ESG_DRIVER_WORKBOOK.workbook).toBe('ESG_Drivers_September.xlsx');
    expect(ESG_DRIVER_WORKBOOK.sheets.reduce((n, s) => n + s.drivers.length, 0)).toBe(685);
  });
  for (const [sector, expectedCounts] of Object.entries(counts)) for (const [i, country] of Array.from(countries.entries())) {
    it(`${country} / ${sector} retains all ${expectedCounts[i]} exact rows`, () => {
      const result = selectWorkbookDrivers({ country, sector, language: 'English' });
      expect(result.drivers).toHaveLength(expectedCounts[i]);
      expect(workbookDriverCount(country, sector)).toBe(expectedCounts[i]);
      const sheet = ESG_DRIVER_WORKBOOK.sheets.find((s) => s.name === sector)!;
      expect(result.drivers).toEqual(sheet.drivers.filter((d) => /^global drivers?$/i.test(d.section.trim()) || d.section.trim() === country));
      expect(result.drivers.map((d) => d.row)).toEqual(result.drivers.map((d) => d.row).sort((a, b) => a - b));
    });
  }
  it('reads real hyperlink targets, not their display labels', () => {
    const sheet = ESG_DRIVER_WORKBOOK.sheets.find((s) => s.name === 'Oil & Gas')!;
    const source = sheet.sources.find((s) => s.cells.includes('G2'))!;
    expect(source.url).toMatch(/^https?:\/\//); expect(source.label).toBe('Paris Agreement');
    expect(sheet.drivers[0].sourceUrls).toContain(source.url);
    for (const sheet of ESG_DRIVER_WORKBOOK.sheets) for (const source of sheet.sources) expect(() => normalizeWorkbookUrl(source.url)).not.toThrow();
  });
  it('pins an isolated copy of the selection and exact allowlist for retry', () => {
    const checkpoint = createWorkbookCheckpoint({ country: 'UAE', sector: 'Banking', language: 'Arabic' });
    checkpoint.definitions[0].name = 'mutated'; checkpoint.allowedSources.pop();
    expect(ESG_DRIVER_WORKBOOK.sheets[0].drivers[0].name).toBe('Paris Agreement');
    expect(checkpoint.allowedSources.length).toBeLessThan(ESG_DRIVER_WORKBOOK.sheets[0].sources.length);
  });
});
