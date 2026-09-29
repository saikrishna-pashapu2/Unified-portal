import { describe, expect, it, vi } from 'vitest';
import { repairExtractedLayout, EXTRACTION_RECOVERY_VERSION } from '../layout-repair';
import { validateExtractedPage } from '../validation';
import { extractPageWithOpenAi, type PdfxV2OpenAiRequester } from '../openai';
import type { PdfCell, PdfElement, PdfPageLayout } from '../schemas';

// A 4x4 grid on [100,100,500,500]; each row/column is 100 units.
function gridTable(skip: (r: number, c: number) => boolean = () => false): PdfElement {
  const rows = Array.from({ length: 4 }, (_, r) => ({
    rowIndex: r,
    cells: Array.from({ length: 4 }, (_, c) => c).filter((c) => !skip(r, c)).map((c): PdfCell => ({
      id: `e010-r${r}-c${c}`, rowIndex: r, columnIndex: c, rowSpan: 1, columnSpan: 1, isHeader: r === 0,
      translate: true, text: `ячейка ${r}-${c}`, bbox: [100 + c * 100, 100 + r * 100, 200 + c * 100, 200 + r * 100],
    })),
  }));
  return { id: 'e010', kind: 'table', text: '', order: 1, level: 0, bbox: [100, 100, 500, 500], translate: true, rowCount: 4, columnCount: 4, rows };
}

function page(elements: PdfElement[], warnings: string[] = []): PdfPageLayout {
  return { pageNumber: 1, width: 1000, height: 1000, orientation: 'portrait', sourceLanguage: 'Uzbek', sourceScript: 'Cyrillic', warnings, elements };
}

function header(bbox: PdfElement['bbox']): PdfElement {
  return { id: 'e001', kind: 'header', text: '221-сон 04.05.2026. Барқарор ривожланиш', order: 0, level: 0, bbox, translate: true, rowCount: 0, columnCount: 0, rows: [] };
}

const allText = (layout: PdfPageLayout) => layout.elements
  .flatMap((element) => [element.text, ...element.rows.flatMap((row) => row.cells.map((cell) => cell.text))])
  .filter((text) => text.trim()).sort();

describe('table grid repair', () => {
  it('trims an empty merged cell whose span runs over the next cell origin (page 10 shape)', () => {
    const table = gridTable();
    // Column 3: an empty cell claims all four rows while a real cell starts at row 2.
    table.rows[0].cells[3] = { ...table.rows[0].cells[3], text: '', translate: false, rowSpan: 4, bbox: [400, 100, 500, 500] };
    table.rows[1].cells = table.rows[1].cells.filter((cell) => cell.columnIndex !== 3);
    table.rows[3].cells = table.rows[3].cells.filter((cell) => cell.columnIndex !== 3);
    table.rows[2].cells[3] = { ...table.rows[2].cells[3], rowSpan: 2, bbox: [400, 300, 500, 500] };
    const source = page([table]);
    expect(validateExtractedPage(source, 1).failures).toContain('table e010 overlaps 2 grid position(s)');

    const fixed = repairExtractedLayout(source);
    expect(validateExtractedPage(fixed, 1).failures).toEqual([]);
    const trimmed = fixed.elements[0].rows[0].cells.find((cell) => cell.columnIndex === 3)!;
    expect(trimmed).toMatchObject({ rowSpan: 2, bbox: [400, 100, 500, 300] });
    expect(allText(fixed)).toEqual(allText(source));
    expect(repairExtractedLayout(fixed)).toEqual(fixed);
  });

  it('folds a repeated cell origin into one cell without dropping its text', () => {
    const table = gridTable();
    table.rows[1].cells.push({ ...table.rows[1].cells[1], id: 'e010-dup', text: 'продолжение' });
    const fixed = repairExtractedLayout(page([table]));
    expect(validateExtractedPage(fixed, 1).failures).toEqual([]);
    expect(fixed.elements[0].rows[1].cells.find((cell) => cell.columnIndex === 1)!.text).toBe('ячейка 1-1 продолжение');
  });

  it('never fills grid holes during normal extraction, so a skipped printed cell is re-read', () => {
    const fixed = repairExtractedLayout(page([gridTable((r, c) => r === 2 && c < 2)]));
    expect(validateExtractedPage(fixed, 1).failures).toContain('table e010 is missing 2 grid position(s)');
  });

  it('fills a few holes only as a last-resort salvage, with a page warning (page 9 shape)', () => {
    const fixed = repairExtractedLayout(page([gridTable((r, c) => r === 2 && c < 2)]), undefined, { fillTableHoles: true });
    expect(validateExtractedPage(fixed, 1).failures).toEqual([]);
    const filled = fixed.elements[0].rows[2].cells.filter((cell) => cell.columnIndex < 2);
    expect(filled.map((cell) => ({ text: cell.text, translate: cell.translate, bbox: cell.bbox }))).toEqual([
      { text: '', translate: false, bbox: [100, 300, 200, 400] },
      { text: '', translate: false, bbox: [200, 300, 300, 400] },
    ]);
    expect(fixed.warnings.at(-1)).toMatch(/^Grid repair: 2 blank grid position\(s\)/);
  });

  it('does not fold a repeated origin that probably belongs in a neighbouring hole', () => {
    // (1,3) is missing and a second cell was given origin (1,2): folding would shift a value.
    const table = gridTable((r, c) => r === 1 && c === 3);
    table.rows[1].cells.push({ ...table.rows[1].cells[2], id: 'e010-shifted', text: '0' });
    const fixed = repairExtractedLayout(page([table]), undefined, { fillTableHoles: true });
    expect(fixed.elements[0].rows[1].cells.map((cell) => cell.text)).toEqual(['ячейка 1-0', 'ячейка 1-1', 'ячейка 1-2', '0']);
    expect(validateExtractedPage(fixed, 1).valid).toBe(false);
  });

  it('never blank-fills a whole missing row, even as a salvage', () => {
    const fixed = repairExtractedLayout(page([gridTable((r) => r === 3)]), undefined, { fillTableHoles: true });
    expect(validateExtractedPage(fixed, 1).failures).toContain('table e010 is missing 4 grid position(s)');
  });

  it('does not salvage a grid with many holes, where cells were probably not read', () => {
    const fixed = repairExtractedLayout(page([gridTable((r) => r >= 2)]), undefined, { fillTableHoles: true });
    expect(validateExtractedPage(fixed, 1).failures).toContain('table e010 is missing 8 grid position(s)');
  });

  it('pulls a running header back from a table edge it bleeds into', () => {
    // Header [15..447 x 90..105] bleeds 5 units into the table top at y=100.
    const source = page([header([100, 90, 447, 105]), gridTable()]);
    expect(validateExtractedPage(source, 1).failures).toContain('elements e001 and e010 have overlapping text regions that would overwrite each other');
    const fixed = repairExtractedLayout(source);
    expect(fixed.elements[0].bbox).toEqual([100, 90, 447, 100]);
    expect(validateExtractedPage(fixed, 1).failures).toEqual([]);
  });

  it('keeps a text block that genuinely sits inside a table as a failure', () => {
    const source = page([header([150, 150, 450, 350]), gridTable()]);
    const fixed = repairExtractedLayout(source);
    expect(fixed.elements[0].bbox).toEqual([150, 150, 450, 350]);
    expect(validateExtractedPage(fixed, 1).failures).toContain('elements e001 and e010 have overlapping text regions that would overwrite each other');
  });
});

describe('incomplete-content detection', () => {
  it('rejects at extraction a model admission that only recoverable rows were transcribed', () => {
    const layout = page([gridTable()], ['The page contains a large continuation table; only the clearly recoverable upper table rows are represented.']);
    expect(validateExtractedPage(layout, 1, { extraction: true }).failures).toContain(
      'OCR reported incomplete printed content; re-read the detailed page views instead of accepting missing text',
    );
    // Rendering re-validates accepted pages; the new phrasing must not fail them retroactively.
    expect(validateExtractedPage(layout, 1).failures).toEqual([]);
  });

  it('accepts text cut off at the page boundary, which continues on the next page', () => {
    const layout = page([gridTable()], [
      'The final table row continues beyond the visible bottom edge of the source page; only visible text has been transcribed.',
      'The final paragraph continues beyond the visible bottom edge and is transcribed only through the last visibly printed words.',
    ]);
    expect(validateExtractedPage(layout, 1).failures).toEqual([]);
  });
});

describe('last-resort extraction salvage', () => {
  const provider = (overrides: Partial<PdfxV2OpenAiRequester>) =>
    ({ extract: vi.fn(), context: vi.fn(), translate: vi.fn(), validate: vi.fn(), ...overrides }) as PdfxV2OpenAiRequester;

  it('salvages a retained terminal candidate with two blank holes without another paid request', async () => {
    const extract = vi.fn();
    const result = await extractPageWithOpenAi(
      Buffer.from('fixture'), 1, 'Russian',
      provider({ extract, nativeGeometry: vi.fn(async () => ({ images: [], texts: [], rules: [] })) }),
      { resume: {
        version: EXTRACTION_RECOVERY_VERSION, attempts: 3, rotation: 0,
        candidate: page([gridTable((r, c) => r === 2 && c < 2)]),
        failures: ['table e010 is missing 2 grid position(s)'], terminal: true,
      } },
    );
    expect(result.responseId).toBe('retained-layout-salvage');
    expect(validateExtractedPage(result.layout, 1).failures).toEqual([]);
    expect(result.layout.warnings.at(-1)).toMatch(/^Grid repair: 2 blank/);
    expect(extract).not.toHaveBeenCalled();
  });

  it('still stops when the retained candidate cannot be salvaged', async () => {
    await expect(extractPageWithOpenAi(
      Buffer.from('fixture'), 1, 'Russian',
      provider({ nativeGeometry: vi.fn(async () => ({ images: [], texts: [], rules: [] })) }),
      { resume: {
        version: EXTRACTION_RECOVERY_VERSION, attempts: 3, rotation: 0,
        candidate: page([gridTable((r) => r >= 2)]),
        failures: ['table e010 is missing 8 grid position(s)'], terminal: true,
      } },
    )).rejects.toThrow(/could not extract source page 1 safely/);
  });
});
