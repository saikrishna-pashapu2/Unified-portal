import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
vi.mock('server-only', () => ({}));
import { parseDriverCatalogUpload } from '../catalog-import';
import { ESG_DRIVER_WORKBOOK } from '../workbook';
import { buildWorkbookOptions, compareDriverCatalogs } from '../catalog-utils';

const headers = ['Driver Section/Country', 'Driver Type', 'Driver Name', 'Driver Logic', 'Evidence/KPI', 'Key Sources', 'Link'];
function fixture(mutator?: (sheet: XLSX.WorkSheet) => void) {
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([headers,
    ['Global Drivers', 'General', 'Global framework', 'Original logic', 'Original KPI', 'Example', 'https://example.org/global?a=1'],
    ['Germany', 'Country-related', 'Local requirement', 'Local logic', '', 'Source label', 'Link'],
    ['', '', 'Second requirement', 'Another logic', '', 'Example', 'https://example.org/local#section'],
  ]);
  sheet.G3.l = { Target: 'https://example.org/local?edition=2026#clause' };
  mutator?.(sheet);
  XLSX.utils.book_append_sheet(book, sheet, 'Aviation');
  return Buffer.from(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }));
}

function rowsFixture(rows: string[][], mutator?: (sheet: XLSX.WorkSheet) => void) {
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  mutator?.(sheet);
  XLSX.utils.book_append_sheet(book, sheet, 'Aviation');
  return Buffer.from(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }));
}

describe('uploaded driver catalog validation', () => {
  it('imports the complete existing workbook without changing names, source cells or URLs', async () => {
    const bytes = readFileSync(resolve('data/esg-drivers/ESG_Drivers_September.xlsx'));
    const { catalog } = await parseDriverCatalogUpload(bytes, ESG_DRIVER_WORKBOOK.workbook);
    expect(catalog).toEqual(ESG_DRIVER_WORKBOOK);
  }, 30_000);

  it('preserves embedded hyperlinks, query strings and blank category continuations for new coverage', async () => {
    const { catalog } = await parseDriverCatalogUpload(fixture(), 'Updated drivers.xlsx');
    expect(catalog.sheets[0].drivers[1].sourceUrls).toEqual(['https://example.org/local?edition=2026#clause']);
    expect(catalog.sheets[0].drivers[2]).toMatchObject({ section: 'Germany', type: 'Country-related' });
    expect(buildWorkbookOptions(catalog)).toMatchObject({ countries: ['Germany'], sectors: ['Aviation'], counts: { Aviation: { Germany: 3 } } });
  });

  it.each([Buffer.alloc(0), Buffer.from([0x50]), Buffer.from([0x50, 0x4b, 3]), Buffer.from('not-an-xlsx')])('rejects malformed short files as validation errors', async (bytes) => {
    await expect(parseDriverCatalogUpload(bytes, 'bad.xlsx')).rejects.toMatchObject({ name: 'DriverCatalogValidationError', status: 400 });
  });

  it('reports a missing required header at its worksheet/cell', async () => {
    await expect(parseDriverCatalogUpload(fixture((sheet) => { sheet.C1.v = 'Renamed'; }), 'updated.xlsx')).rejects.toMatchObject({
      issues: expect.arrayContaining([expect.objectContaining({ sheet: 'Aviation', cell: 'C1' })]),
    });
  });

  it('rejects formulas and oversized declared sheet dimensions', async () => {
    await expect(parseDriverCatalogUpload(fixture((sheet) => { sheet.D2.f = '1+1'; }), 'formula.xlsx')).rejects.toThrow(/formulas/);
    await expect(parseDriverCatalogUpload(fixture((sheet) => { sheet.A2001 = { t: 's', v: 'outside limit' }; sheet['!ref'] = 'A1:G2001'; }), 'large.xlsx')).rejects.toThrow(/2,000 rows/);
  });

  it('rejects credentialed, local and non-HTTP embedded source hyperlinks', async () => {
    for (const url of ['https://user:password@example.org', 'http://127.0.0.1/private', 'file:///etc/passwd']) {
      await expect(parseDriverCatalogUpload(fixture((sheet) => { sheet.G3.l = { Target: url }; }), 'unsafe.xlsx')).rejects.toMatchObject({
        issues: expect.arrayContaining([expect.objectContaining({ sheet: 'Aviation', cell: 'G3' })]),
      });
    }
  });

  it('bounds text expanded by merged cells before returning it to the web process', async () => {
    const bytes = fixture((sheet) => {
      sheet.D2.v = 'x'.repeat(20_000);
      sheet.G250 = { t: 's', v: '' };
      sheet['!ref'] = 'A1:G250';
      sheet['!merges'] = [{ s: { r: 1, c: 3 }, e: { r: 249, c: 3 } }];
    });
    await expect(parseDriverCatalogUpload(bytes, 'merged.xlsx')).rejects.toThrow(/too much text after resolving merged cells/);
  });

  it('reports unlinked source labels without inventing or fetching a URL', async () => {
    const { catalog, warnings } = await parseDriverCatalogUpload(fixture((sheet) => { delete sheet.G3.l; }), 'labels.xlsx');
    expect(warnings).toContainEqual(expect.objectContaining({ sheet: 'Aviation', cell: 'G3', message: expect.stringContaining('label without a URL') }));
    expect(catalog.sheets[0].drivers[1].sourceUrls).toEqual([]);
  });

  it('skips October-style notes, repeated headers and detailed duplicate summaries without losing context safety', async () => {
    const bytes = rowsFixture([
      ['Global Drivers', 'General', 'Global framework', 'Global logic', '', '', 'https://example.org/global'],
      ['Germany', 'Country-related', 'Detailed driver', 'Detailed logic', '', '', 'https://example.org/detailed'],
      ['Real Estate'],
      ['Driver Section/Country', 'Driver Type', 'Driver Name'],
      ['Germany', 'Country-related', 'Detailed driver'],
      ['Germany', 'Country-related', 'New compact driver'],
    ]);
    const { catalog, warnings } = await parseDriverCatalogUpload(bytes, 'october-style.xlsx');
    expect(catalog.sheets[0].drivers.map((driver) => driver.name)).toEqual([
      'Global framework', 'Detailed driver', 'New compact driver',
    ]);
    expect(catalog.sheets[0].sources.map((source) => source.url)).toEqual([
      'https://example.org/global', 'https://example.org/detailed',
    ]);
    expect(warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ cell: 'A4', message: expect.stringMatching(/Skipped a standalone note or heading/) }),
      expect.objectContaining({ cell: 'A5', message: expect.stringMatching(/Skipped repeated column headers/) }),
      expect.objectContaining({ cell: 'C6', message: expect.stringMatching(/duplicate summary.*row 3/i) }),
      expect.objectContaining({ cell: 'G7', message: expect.stringMatching(/no row-specific source link/) }),
    ]));
  });

  it('rejects repeated headers with unexpected content instead of creating a Driver Name row', async () => {
    await expect(parseDriverCatalogUpload(rowsFixture([
      ['Germany', 'Country-related', 'Detailed driver', 'Detailed logic', '', '', 'https://example.org/detailed'],
      ['Driver Section/Country', 'Driver Type', 'Driver Name', 'Unexpected detail'],
    ]), 'bad-repeated-header.xlsx')).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({ sheet: 'Aviation', cell: 'D3', message: expect.stringMatching(/unexpected content/) }),
      ]),
    });
  });

  it('rejects missing names when source text or hyperlink metadata is the only row content', async () => {
    await expect(parseDriverCatalogUpload(rowsFixture([
      ['', '', '', '', '', 'Source label'],
    ]), 'missing-name-source.xlsx')).rejects.toMatchObject({
      issues: expect.arrayContaining([expect.objectContaining({ sheet: 'Aviation', cell: 'C2', message: expect.stringMatching(/must have a Driver Name/) })]),
    });
    await expect(parseDriverCatalogUpload(rowsFixture([
      ['', '', '', '', '', '', 'https://example.org/source'],
    ]), 'missing-name-literal-source.xlsx')).rejects.toMatchObject({
      issues: expect.arrayContaining([expect.objectContaining({ sheet: 'Aviation', cell: 'C2', message: expect.stringMatching(/must have a Driver Name/) })]),
    });
    await expect(parseDriverCatalogUpload(rowsFixture([
      ['', '', ''],
    ], (sheet) => { sheet.G2 = { t: 's', v: '', l: { Target: 'https://example.org/hyperlink-only' } }; }), 'missing-name-hyperlink.xlsx')).rejects.toMatchObject({
      issues: expect.arrayContaining([expect.objectContaining({ sheet: 'Aviation', cell: 'C2', message: expect.stringMatching(/must have a Driver Name/) })]),
    });
  });

  it('rejects a blank-category driver after an A-only heading because the heading resets context', async () => {
    await expect(parseDriverCatalogUpload(rowsFixture([
      ['Germany', 'Country-related', 'Detailed driver', 'Detailed logic', '', '', 'https://example.org/detailed'],
      ['Real Estate'],
      ['', '', 'After heading', 'New logic'],
    ]), 'stale-context-heading.xlsx')).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({ sheet: 'Aviation', cell: 'A4', message: expect.stringMatching(/section\/country/) }),
        expect.objectContaining({ sheet: 'Aviation', cell: 'B4', message: expect.stringMatching(/driver type/) }),
      ]),
    });
  });

  it('rejects a blank-category driver after a repeated header because the header resets context', async () => {
    await expect(parseDriverCatalogUpload(rowsFixture([
      ['Germany', 'Country-related', 'Detailed driver', 'Detailed logic', '', '', 'https://example.org/detailed'],
      ['Driver Section/Country', 'Driver Type', 'Driver Name'],
      ['', '', 'After repeated header', 'New logic'],
    ]), 'stale-context-header.xlsx')).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({ sheet: 'Aviation', cell: 'A4', message: expect.stringMatching(/section\/country/) }),
        expect.objectContaining({ sheet: 'Aviation', cell: 'B4', message: expect.stringMatching(/driver type/) }),
      ]),
    });
  });

  it('retains compact rows for distinct countries, types and exact names', async () => {
    const { catalog } = await parseDriverCatalogUpload(rowsFixture([
      ['Germany', 'Country-related', 'Shared driver', 'Detailed logic', '', '', 'https://example.org/shared'],
      ['France', 'Country-related', 'Shared driver'],
      ['Germany', 'Sector-related', 'Shared driver'],
      ['Germany', 'Country-related', ' shared driver '],
    ]), 'distinct-compact-rows.xlsx');
    expect(catalog.sheets[0].drivers.map((driver) => [driver.section, driver.type, driver.name])).toEqual([
      ['Germany', 'Country-related', 'Shared driver'],
      ['France', 'Country-related', 'Shared driver'],
      ['Germany', 'Sector-related', 'Shared driver'],
      ['Germany', 'Country-related', ' shared driver '],
    ]);
  });

  it('retains conflicting detailed duplicates and rejects hyperlink metadata on compact duplicates', async () => {
    const { catalog } = await parseDriverCatalogUpload(rowsFixture([
      ['Germany', 'Country-related', 'Shared driver', 'Original logic', '', '', 'https://example.org/shared'],
      ['Germany', 'Country-related', 'Shared driver', 'Conflicting logic'],
    ]), 'conflicting-detail.xlsx');
    expect(catalog.sheets[0].drivers.map((driver) => driver.logic)).toEqual(['Original logic', 'Conflicting logic']);

    await expect(parseDriverCatalogUpload(rowsFixture([
      ['Germany', 'Country-related', 'Shared driver', 'Original logic', '', '', 'https://example.org/shared'],
      ['Germany', 'Country-related', 'Shared driver'],
    ], (sheet) => { sheet.C3.l = { Target: 'https://example.org/compact-metadata' }; }), 'compact-hyperlink.xlsx')).rejects.toMatchObject({
      issues: expect.arrayContaining([expect.objectContaining({ sheet: 'Aviation', cell: 'C3', message: expect.stringMatching(/Hyperlink metadata/) })]),
    });
  });

  it('does not skip structural rows carrying hyperlink metadata', async () => {
    await expect(parseDriverCatalogUpload(rowsFixture([
      ['Real Estate'],
      ['Germany', 'Country-related', 'Named driver', 'Logic', '', '', 'https://example.org/source'],
    ], (sheet) => { sheet.A2.l = { Target: 'https://example.org/note' }; }), 'heading-hyperlink.xlsx')).rejects.toMatchObject({
      issues: expect.arrayContaining([expect.objectContaining({ sheet: 'Aviation', cell: 'A2', message: expect.stringMatching(/hyperlink metadata/) })]),
    });
    await expect(parseDriverCatalogUpload(rowsFixture([
      ['Germany', 'Country-related', 'Named driver', 'Logic', '', '', 'https://example.org/source'],
      ['Driver Section/Country', 'Driver Type', 'Driver Name'],
    ], (sheet) => { sheet.G3 = { t: 's', v: '', l: { Target: 'https://example.org/header' } }; }), 'header-hyperlink.xlsx')).rejects.toMatchObject({
      issues: expect.arrayContaining([expect.objectContaining({ sheet: 'Aviation', cell: 'G3', message: expect.stringMatching(/hyperlink metadata/) })]),
    });
  });

  it('rejects VBA archives even when renamed to .xlsx and rejects excessive ZIP expansion', async () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([headers]), 'Aviation');
    book.vbaraw = Buffer.from('untrusted macro bytes');
    await expect(parseDriverCatalogUpload(Buffer.from(XLSX.write(book, { type: 'buffer', bookType: 'xlsm' })), 'renamed.xlsx')).rejects.toThrow(/Macros/);
    const bytes = fixture();
    const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    bytes.writeUInt32LE(9 * 1024 * 1024, central + 24);
    await expect(parseDriverCatalogUpload(bytes, 'bomb.xlsx')).rejects.toThrow(/oversized/);
  });

  it('bounds the research work selected by a single country and sector', async () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([headers, ...Array.from({ length: 151 }, (_, i) => ['Germany', 'General', `Driver ${i}`, '', '', '', 'https://example.org/source'])]), 'Aviation');
    await expect(parseDriverCatalogUpload(Buffer.from(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' })), 'too-many.xlsx')).rejects.toThrow(/150 drivers/);
  });

  it.each([['B2', 160], ['C2', 160], ['D2', 2000], ['E2', 2000], ['F2', 4096]] as const)('bounds canonical prompt and progress fields at %s', async (cell, limit) => {
    await expect(parseDriverCatalogUpload(fixture((sheet) => { sheet[cell].v = 'x'.repeat(limit + 1); }), 'long-field.xlsx')).rejects.toMatchObject({
      issues: expect.arrayContaining([expect.objectContaining({ sheet: 'Aviation', cell, message: expect.stringContaining('characters') })]),
    });
  });

  it('bounds sources per worksheet before a research job can be created', async () => {
    await expect(parseDriverCatalogUpload(fixture((sheet) => { sheet.G2.v = Array.from({ length: 251 }, (_, i) => `https://example.org/${i}`).join(' '); }), 'too-many-links.xlsx')).rejects.toThrow(/250 distinct source URLs/);
  });
});

describe('driver workbook change preview', () => {
  it('shows content and exact source changes without counting a row insertion as every row changed', async () => {
    const { catalog: before } = await parseDriverCatalogUpload(fixture(), 'before.xlsx');
    const after = structuredClone(before);
    after.sheets[0].drivers.forEach((driver) => { driver.row++; driver.id += '-moved'; });
    after.sheets[0].drivers[0].logic = 'Updated source-supported logic';
    after.sheets[0].drivers.push({ ...after.sheets[0].drivers[0], name: 'Added driver', row: 6, id: 'new' });
    after.sheets[0].sources.push({ url: 'https://example.org/new', label: 'New', cells: ['G6'] });
    const diff = compareDriverCatalogs(before, after);
    expect(diff).toMatchObject({ addedDrivers: 1, removedDrivers: 0, changedDrivers: 1, addedSources: 1, removedSources: 0 });
    expect(diff.changes.find((change) => change.kind === 'changed')?.fields).toEqual(['logic']);
  });

  it('shows row reordering and source allowlist changes separately for each sector', async () => {
    const { catalog: before } = await parseDriverCatalogUpload(fixture(), 'before.xlsx');
    const after = structuredClone(before);
    after.sheets[0].drivers.reverse();
    after.sheets.push({ ...structuredClone(after.sheets[0]), name: 'New sector' });
    const diff = compareDriverCatalogs(before, after);
    expect(diff.reorderedSheets).toEqual(['Aviation']);
    expect(diff.sourceChanges).toContainEqual({ sheet: 'New sector', url: 'https://example.org/local?edition=2026', kind: 'added' });
  });

  it('bounds preview field excerpts while retaining the complete catalog data', async () => {
    const { catalog: before } = await parseDriverCatalogUpload(fixture(), 'before.xlsx');
    const after = structuredClone(before);
    after.sheets[0].drivers[0].logic = 'x'.repeat(20_000);
    const diff = compareDriverCatalogs(before, after);
    expect(diff.changes[0].after?.logic.length).toBe(240);
    expect(diff.changes[0].detailsTruncated).toBe(true);
    expect(after.sheets[0].drivers[0].logic.length).toBe(20_000);
  });
});
