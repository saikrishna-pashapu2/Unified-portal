import { describe, expect, it } from 'vitest';
import { buildWorkbookOptions } from '../catalog-utils';
import type { DriverWorkbook, WorkbookDriver } from '../workbook-types';

function driver(sheet: string, section: string, row: number): WorkbookDriver {
  return { id: `${sheet}-${row}`, sheet, section, row, type: 'General', name: `Driver ${row}`, logic: '', evidenceKpi: '', keySources: '', sourceUrls: [] };
}

describe('uploaded workbook option counts', () => {
  it('adds global rows only to countries represented in the same worksheet', () => {
    const catalog: DriverWorkbook = { workbook: 'Example.xlsx', version: 'test', sha256: 'test', sheets: [
      { name: 'Banking', sources: [], drivers: [driver('Banking', 'Global Drivers', 2), driver('Banking', ' UAE ', 3), driver('Banking', 'UAE', 4)] },
      { name: 'Energy', sources: [], drivers: [driver('Energy', 'Saudi Arabia', 2)] },
    ] };
    expect(buildWorkbookOptions(catalog)).toMatchObject({
      countries: ['UAE', 'Saudi Arabia'], sectors: ['Banking', 'Energy'],
      counts: { Banking: { UAE: 3 }, Energy: { 'Saudi Arabia': 1 } },
    });
    expect(Object.keys(buildWorkbookOptions(catalog).counts.Banking)).toEqual(['UAE']);
  });

  it('keeps a maximum-size catalog sparse and reads each driver section a bounded number of times', () => {
    let sectionReads = 0;
    const catalog: DriverWorkbook = { workbook: 'Large.xlsx', version: 'test', sha256: 'test', sheets: Array.from({ length: 20 }, (_, sheetIndex) => {
      const name = `Sector ${sheetIndex}`;
      return { name, sources: [], drivers: Array.from({ length: 500 }, (_, row) => ({
        ...driver(name, '', row + 2),
        get section() { sectionReads++; return row === 0 ? 'Global Drivers' : `Country ${sheetIndex}-${row}`; },
      })) };
    }) };
    const options = buildWorkbookOptions(catalog);
    expect(options.countries).toHaveLength(9_980);
    expect(Object.values(options.counts).reduce((sum, counts) => sum + Object.keys(counts).length, 0)).toBe(9_980);
    expect(options.counts['Sector 0']['Country 0-1']).toBe(2);
    expect(options.counts['Sector 0']['Country 1-1']).toBeUndefined();
    expect(sectionReads).toBeLessThanOrEqual(20_000);
  });
});
