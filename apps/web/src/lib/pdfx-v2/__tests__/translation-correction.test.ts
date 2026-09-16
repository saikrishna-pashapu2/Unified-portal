import { describe, expect, it } from 'vitest';
import type { PdfPageLayout, PdfPageTranslation } from '../schemas';
import { planTranslationCorrection } from '../translation-correction';

function proseSource(): PdfPageLayout {
  return {
    pageNumber: 7,
    width: 1000,
    height: 1000,
    orientation: 'portrait',
    sourceLanguage: 'Uzbek',
    sourceScript: 'Cyrillic',
    warnings: ['source checkpoint warning'],
    elements: [
      {
        id: 'e004', kind: 'paragraph', order: 0, level: 0, translate: true,
        text: 'Биринчи мажбурият.', bbox: [80, 80, 920, 150],
        columnCount: 0, rowCount: 0, rows: [],
      },
      {
        id: 'e009', kind: 'heading', order: 1, level: 1, translate: true,
        text: 'Иккинчи сарлавҳа.', bbox: [80, 180, 920, 240],
        columnCount: 0, rowCount: 0, rows: [],
      },
      {
        id: 'e011', kind: 'footer', order: 2, level: 0, translate: true,
        text: 'Учинчи матн.', bbox: [80, 900, 920, 950],
        columnCount: 0, rowCount: 0, rows: [],
      },
      {
        id: 'protected', kind: 'suppressed_text', order: 3, level: 0, translate: false,
        text: 'PROTECTED ENGLISH', bbox: [80, 260, 920, 300],
        columnCount: 0, rowCount: 0, rows: [],
      },
    ],
  };
}

function fullCandidate(source: PdfPageLayout): PdfPageTranslation {
  return {
    pageNumber: source.pageNumber,
    warnings: ['candidate warning'],
    elements: source.elements.filter((element) => element.translate).map((element) => ({
      id: element.id,
      text: `translated ${element.id}`,
      cells: [],
    })),
  };
}

function tableSource(): PdfPageLayout {
  const table = (id: string, order: number): PdfPageLayout['elements'][number] => ({
    id, kind: 'table', order, level: 0, translate: true, text: '',
    bbox: [40, 100 + order * 300, 960, 300 + order * 300],
    rowCount: 1, columnCount: 6,
    rows: [{
      rowIndex: 0,
      cells: [0, 1, 2, 3, 4, 5].map((columnIndex) => ({
        id: `${id}-r000-c00${columnIndex}`,
        rowIndex: 0,
        columnIndex,
        rowSpan: 1,
        columnSpan: 1,
        isHeader: false,
        translate: true,
        text: `Источник ${id} ${columnIndex}`,
        bbox: [40 + columnIndex * 150, 100 + order * 300, 190 + columnIndex * 150, 300 + order * 300],
      })),
    }],
  });
  return {
    pageNumber: 7,
    width: 1000,
    height: 1000,
    orientation: 'portrait',
    sourceLanguage: 'Uzbek',
    sourceScript: 'Cyrillic',
    warnings: [],
    elements: [table('e005', 0), table('e006', 1)],
  };
}

function tableCandidate(source: PdfPageLayout): PdfPageTranslation {
  return {
    pageNumber: source.pageNumber,
    warnings: [],
    elements: source.elements.map((element) => ({
      id: element.id,
      text: '',
      cells: element.rows.flatMap((row) => row.cells.map((cell) => ({
        id: cell.id,
        text: `Перевод ${cell.id}`,
      }))),
    })),
  };
}

describe('bounded targeted PDF translation correction', () => {
  it('repairs one cited prose element and preserves every other candidate element', () => {
    const source = proseSource();
    const candidate = fullCandidate(source);
    const sourceBefore = structuredClone(source);
    const candidateBefore = structuredClone(candidate);
    const plan = planTranslationCorrection(source, candidate, ['Element e004 has the wrong legal meaning.']);

    expect(plan).not.toBeNull();
    expect(plan?.source.elements.map((element) => element.id)).toEqual(['e004']);
    expect(plan?.previousTranslation.elements.map((element) => element.id)).toEqual(['e004']);

    const patch: PdfPageTranslation = {
      pageNumber: 7,
      warnings: [],
      elements: [{ id: 'e004', text: 'Исправленное обязательство.', cells: [] }],
    };
    const merged = plan!.merge(patch);
    expect(merged.elements.find((element) => element.id === 'e004')?.text)
      .toBe('Исправленное обязательство.');
    expect(merged.elements.find((element) => element.id === 'e009'))
      .toEqual(candidate.elements.find((element) => element.id === 'e009'));
    expect(merged.elements.find((element) => element.id === 'e011'))
      .toEqual(candidate.elements.find((element) => element.id === 'e011'));
    expect(source).toEqual(sourceBefore);
    expect(candidate).toEqual(candidateBefore);
  });

  it('fails closed for incomplete, duplicate, or out-of-scope patches', () => {
    const source = proseSource();
    const candidate = fullCandidate(source);
    const plan = planTranslationCorrection(source, candidate, ['e004 needs correction']);
    expect(plan).not.toBeNull();

    expect(() => plan!.merge({
      pageNumber: 7, warnings: [], elements: [],
    })).toThrow(/exactly the requested/i);
    expect(() => plan!.merge({
      pageNumber: 7, warnings: [],
      elements: [
        { id: 'e004', text: 'first', cells: [] },
        { id: 'e004', text: 'duplicate', cells: [] },
      ],
    })).toThrow(/exactly the requested/i);
    expect(() => plan!.merge({
      pageNumber: 7, warnings: [],
      elements: [{ id: 'e009', text: 'uncited', cells: [] }],
    })).toThrow(/exactly the requested/i);
  });

  it('selects the parent table and all of its cells for a cited cell failure', () => {
    const source = tableSource();
    const candidate = tableCandidate(source);
    const plan = planTranslationCorrection(source, candidate, [
      'Table cell e005-r000-c005 has the wrong unit.',
    ]);

    expect(plan).not.toBeNull();
    expect(plan?.source.elements.map((element) => element.id)).toEqual(['e005']);
    expect(plan?.source.elements[0]?.rows[0]?.cells.map((cell) => cell.id)).toEqual([
      'e005-r000-c000', 'e005-r000-c001', 'e005-r000-c002',
      'e005-r000-c003', 'e005-r000-c004', 'e005-r000-c005',
    ]);
    expect(plan?.previousTranslation.elements[0]?.cells.map((cell) => cell.id)).toEqual([
      'e005-r000-c000', 'e005-r000-c001', 'e005-r000-c002',
      'e005-r000-c003', 'e005-r000-c004', 'e005-r000-c005',
    ]);

    const otherTable = structuredClone(candidate.elements[1]);
    const merged = plan!.merge({
      pageNumber: 7,
      warnings: [],
      elements: [{
        id: 'e005',
        text: '',
        cells: candidate.elements[0].cells.map((cell) => ({
          id: cell.id,
          text: cell.id.endsWith('c005') ? 'Исправленная единица' : cell.text,
        })),
      }],
    });
    expect(merged.elements[1]).toEqual(otherTable);
    expect(merged.elements[0]?.cells.find((cell) => cell.id.endsWith('c005'))?.text)
      .toBe('Исправленная единица');
    expect(source.elements[0]?.bbox).toEqual([40, 100, 960, 300]);
  });

  it('uses full-page fallback for uncited or unknown failures', () => {
    const source = proseSource();
    const candidate = fullCandidate(source);
    expect(planTranslationCorrection(source, candidate, ['The translation is not faithful.']))
      .toBeNull();
    expect(planTranslationCorrection(source, candidate, ['Element e999 has the wrong meaning.']))
      .toBeNull();
  });

  it('rejects a protected-text citation and a page-mismatched candidate', () => {
    const source = proseSource();
    const candidate = fullCandidate(source);
    expect(planTranslationCorrection(source, candidate, ['Protected element protected changed.']))
      .toBeNull();

    const wrongPage = { ...candidate, pageNumber: 8 };
    expect(planTranslationCorrection(source, wrongPage, ['e004 needs correction']))
      .toBeNull();
  });
});
