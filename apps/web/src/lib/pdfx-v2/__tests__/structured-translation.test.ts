import { describe, expect, it } from 'vitest';
import type { PdfPageLayout, PdfPageTranslation } from '../schemas';
import {
  isTranslatableElement,
  listTextWithMarkers,
  mergePageTranslation,
  pageLayoutForTranslation,
  pageLayoutToPlainText,
  preserveSourceCellsInProposal,
} from '../serialize';
import { validateExtractedPage, validateTranslatedPage } from '../validation';

function wideTable(): PdfPageLayout {
  return {
    pageNumber: 16,
    width: 1000,
    height: 1000,
    orientation: 'landscape',
    sourceLanguage: 'Uzbek',
    sourceScript: 'Cyrillic',
    warnings: [],
    elements: [{
      id: 'e001',
      kind: 'table',
      order: 0,
      level: 0,
      translate: true,
      text: '',
      bbox: [10, 20, 990, 220],
      columnCount: 14,
      rowCount: 2,
      rows: Array.from({ length: 2 }, (_, rowIndex) => ({
        rowIndex,
        cells: Array.from({ length: 14 }, (_, columnIndex) => ({
          id: `e001-r${rowIndex}-c${columnIndex}`,
          rowIndex,
          columnIndex,
          rowSpan: 1,
          columnSpan: 1,
          isHeader: rowIndex === 0,
          translate: true,
          text: rowIndex === 0 ? `Устун ${columnIndex + 1}` : String(columnIndex + 100),
          bbox: [
            10 + columnIndex * 70,
            20 + rowIndex * 100,
            10 + (columnIndex + 1) * 70,
            20 + (rowIndex + 1) * 100,
          ],
        })),
      })),
    }],
  };
}

function translatedTable(source: PdfPageLayout): PdfPageTranslation {
  const table = source.elements[0];
  return {
    pageNumber: source.pageNumber,
    warnings: [],
    elements: [{
      id: table.id,
      text: '',
      cells: table.rows.flatMap((row) => row.cells.map((cell) => ({
        id: cell.id,
        text: cell.rowIndex === 0 ? `Колонка ${cell.columnIndex + 1}` : cell.text,
      }))),
    }],
  };
}

describe('PDF Translator structured page contract', () => {
  it('retains every column of a 14-column page table as TSV', () => {
    const layout = wideTable();
    const lines = pageLayoutToPlainText(layout).split('\n');
    expect(lines[0].split('\t')).toHaveLength(14);
    expect(lines[1].split('\t')).toHaveLength(14);
    expect(validateExtractedPage(layout, 16)).toEqual({ valid: true, failures: [], warnings: [] });
  });

  it('sends stable element and cell IDs to translation', () => {
    const source = wideTable();
    const payload = pageLayoutForTranslation(source) as {
      pageNumber: number;
      elements: Array<{
        id: string;
        kind: string;
        cells: Array<Record<string, unknown>>;
      }>;
    };
    expect(payload.pageNumber).toBe(16);
    expect(payload.elements[0]).toMatchObject({ id: 'e001', kind: 'table' });
    expect(payload.elements[0].cells).toContainEqual(expect.objectContaining({
      id: 'e001-r1-c13', text: '113', rowIndex: 1, columnIndex: 13,
    }));
  });

  it('rejects a response that silently drops one table cell', () => {
    const source = wideTable();
    const translation = translatedTable(source);
    translation.elements[0].cells.pop();
    const result = validateTranslatedPage(source, translation, 'Russian');
    expect(result.valid).toBe(false);
    expect(result.failures.join(' ')).toMatch(/cell IDs|cell count/i);
  });

  it('reports the exact numeric token that must be restored or removed', () => {
    const source = wideTable();
    const translation = translatedTable(source);
    translation.elements[0].cells.at(-1)!.text = '114';
    const result = validateTranslatedPage(source, translation, 'Russian');
    expect(result.valid).toBe(false);
    expect(result.failures.join(' ')).toContain('restore exactly: 113');
    expect(result.failures.join(' ')).toContain('remove or correct: 114');
  });

  it('rejects an extracted table that omits a visual grid position', () => {
    const source = wideTable();
    source.elements[0].rows[1].cells.splice(6, 1);
    const result = validateExtractedPage(source, 16);
    expect(result.valid).toBe(false);
    expect(result.failures.join(' ')).toMatch(/missing 1 grid position/i);
  });

  it('rejects coordinates outside the normalized page instead of clamping them', () => {
    const source = wideTable();
    source.elements[0].rows[1].cells[13].bbox[2] = 1723;
    const result = validateExtractedPage(source, 16);
    expect(result.valid).toBe(false);
    expect(result.failures.join(' ')).toMatch(/invalid normalized bounding box/i);
  });

  it('rejects a whole bilingual page collapsed into one two-cell table row', () => {
    const source = wideTable();
    source.elements = [{
      id: 'e001', kind: 'table', order: 0, level: 0, translate: true, text: '',
      bbox: [30, 40, 970, 900], columnCount: 2, rowCount: 1,
      rows: [{
        rowIndex: 0,
        cells: [
          {
            id: 'e001-r0-c0', rowIndex: 0, columnIndex: 0, rowSpan: 1,
            columnSpan: 1, isHeader: false, translate: false, text: 'English policy text '.repeat(20),
            bbox: [30, 40, 500, 900],
          },
          {
            id: 'e001-r0-c1', rowIndex: 0, columnIndex: 1, rowSpan: 1,
            columnSpan: 1, isHeader: false, translate: true, text: 'Ўзбек сиёсати матни '.repeat(20),
            bbox: [500, 40, 970, 900],
          },
        ],
      }],
    }];
    const result = validateExtractedPage(source, 16);
    expect(result.valid).toBe(false);
    expect(result.failures.join(' ')).toMatch(/whole-page|bilingual columns/i);
  });

  it('requires an explicit suppressed region for declared bilingual pages', () => {
    const source = wideTable();
    source.sourceLanguage = 'English + Uzbek';
    const result = validateExtractedPage(source, 16);
    expect(result.valid).toBe(false);
    expect(result.failures.join(' ')).toMatch(/bilingual content.*routed safely|translate=false/i);
  });

  it('merges a valid translation without changing source table geometry', () => {
    const source = wideTable();
    const translation = translatedTable(source);
    const result = validateTranslatedPage(source, translation, 'Russian');
    expect(result.valid).toBe(true);
    const merged = mergePageTranslation(source, translation);
    expect(merged.elements[0].columnCount).toBe(14);
    expect(merged.elements[0].rows[1].cells[13]).toMatchObject({
      id: 'e001-r1-c13',
      text: '113',
      columnIndex: 13,
    });
  });

  it('excludes visual descriptions, signatures, and duplicate language tracks from translation', () => {
    const source = wideTable();
    source.elements.push(
      {
        id: 'e002', kind: 'image', order: 1, level: 0, translate: false, text: '',
        bbox: [20, 20, 120, 120], columnCount: 0, rowCount: 0, rows: [],
      },
      {
        id: 'e003', kind: 'signature', order: 2, level: 0, translate: false, text: '',
        bbox: [700, 600, 920, 680], columnCount: 0, rowCount: 0, rows: [],
      },
      {
        id: 'e004', kind: 'suppressed_text', order: 3, level: 0, translate: false, text: '',
        bbox: [510, 140, 980, 580], columnCount: 0, rowCount: 0, rows: [],
      },
    );
    source.elements.at(-1)!.text = 'Parallel English source wording';
    const payload = pageLayoutForTranslation(source) as { elements: Array<{ id: string }> };
    expect(payload.elements.map((element) => element.id)).toEqual(['e001']);
    expect(source.elements.filter(isTranslatableElement).map((element) => element.id)).toEqual(['e001']);
    expect(pageLayoutToPlainText(source)).not.toMatch(/logo|signature/i);
    expect(pageLayoutToPlainText(source)).toContain('Parallel English source wording');
  });

  it('retains suppressed source wording for positioned original-page reconstruction', () => {
    const source = wideTable();
    source.elements.push({
      id: 'e002', kind: 'suppressed_text', order: 1, level: 0, translate: false, text: '',
      bbox: [20, 250, 480, 500], columnCount: 0, rowCount: 0, rows: [],
    });
    const result = validateExtractedPage(source, 16);
    expect(result.valid).toBe(false);
    expect(result.failures.join(' ')).toMatch(/retain its verbatim source text/i);
  });

  it('preserves protected English text unchanged while translating Uzbek', () => {
    const source = wideTable();
    source.sourceLanguage = 'English + Uzbek';
    source.elements.push({
      id: 'e002', kind: 'suppressed_text', order: 1, level: 0,
      translate: false,
      text: 'GRIEVANCE HANDLING POLICY',
      bbox: [40, 250, 460, 310], columnCount: 0, rowCount: 0, rows: [],
    });
    const translation = translatedTable(source);

    const validation = validateTranslatedPage(source, translation, 'Russian');
    const merged = mergePageTranslation(source, translation);

    expect(validation.valid).toBe(true);
    expect(merged.elements.find((element) => element.id === 'e002')?.text)
      .toBe('GRIEVANCE HANDLING POLICY');
    expect((pageLayoutForTranslation(source) as { elements: Array<{ id: string }> })
      .elements.map((element) => element.id)).toEqual(['e001']);
  });

  it('rejects any change to a protected English table cell', () => {
    const source = wideTable();
    const protectedCell = source.elements[0].rows[0].cells[0];
    protectedCell.translate = false;
    protectedCell.text = 'Purpose';
    const translation = translatedTable(source);
    translation.elements[0].cells[0].text = 'Цель';

    const result = validateTranslatedPage(source, translation, 'Russian');

    expect(result.valid).toBe(false);
    expect(result.failures.join(' ')).toMatch(/protected English.*cell/i);
  });

  it('restores protected source cells at the fresh translation boundary', () => {
    const source = wideTable();
    const protectedCell = source.elements[0].rows[0].cells[0];
    protectedCell.translate = false;
    protectedCell.text = 'Purpose';
    const proposal = translatedTable(source);
    proposal.elements[0].cells[0].text = 'Цель';

    const preserved = preserveSourceCellsInProposal(source, proposal);

    expect(preserved.elements[0].cells[0].text).toBe('Purpose');
    expect(preserved.elements[0].cells[1].text).toBe('Колонка 2');
  });

  it('rejects visual styling descriptions instead of translating them literally', () => {
    const source = wideTable();
    source.elements.push({
      id: 'e002', kind: 'image', order: 1, level: 0, translate: false,
      text: 'Green logo featuring a leaf. Double horizontal line.',
      bbox: [20, 20, 120, 120], columnCount: 0, rowCount: 0, rows: [],
    });
    const result = validateExtractedPage(source, 16);
    expect(result.valid).toBe(false);
    expect(result.failures.join(' ')).toMatch(/visual-only|translatable description/i);
  });

  it('keeps list items as separate visible bullets', () => {
    expect(listTextWithMarkers('First requirement\nSecond requirement')).toBe(
      '• First requirement\n• Second requirement',
    );
    expect(listTextWithMarkers('1. First requirement\n2. Second requirement')).toBe(
      '1. First requirement\n2. Second requirement',
    );
  });
});
