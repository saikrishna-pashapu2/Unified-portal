import { describe, expect, it } from 'vitest';
import { validateTranslationResult } from '../language-validation';
import { validateTranslatedPage } from '../validation';
import type { PdfPageLayout, PdfPageTranslation } from '../schemas';
import { allCells, isTranslatableElement } from '../serialize';

function russianCompanyPage(extraText = ''): { source: PdfPageLayout; translation: PdfPageTranslation } {
  const { source } = wrappedCellPage();
  source.sourceLanguage = 'Russian';
  const table = source.elements[0]!;
  const texts = [
    ['Наименование участника', 'Сумма предложения', 'Балл участника'],
    ['EXAMPLE FINANCIAL CONSULTANCIES DMCC', '1000 UZS', '10'],
    ['ООО EXAMPLE VALUATION AND CONSULTING', '1000 UZS', '10'],
    ['EXAMPLEAUDIT АУДИТ.ОРГ', '1000 UZS', '10'],
  ];
  table.rowCount = texts.length;
  table.rows = texts.map((cells, rowIndex) => ({ rowIndex, cells: cells.map((text, columnIndex) => ({
    id: `table-r${rowIndex}-c${columnIndex}`, rowIndex, columnIndex, rowSpan: 1, columnSpan: 1,
    isHeader: rowIndex === 0, translate: true, text,
    bbox: [10 + columnIndex * 326, 10 + rowIndex * 40, 336 + columnIndex * 326, 50 + rowIndex * 40],
  })) }));
  source.elements.push({
    id: 'russian-context', kind: 'paragraph', order: 1, level: 0, translate: true,
    text: `Цены предложения рассчитаны по курсу Центрального банка. ${extraText}`.trim(),
    bbox: [10, 250, 990, 300], rowCount: 0, columnCount: 0, rows: [],
  });
  return { source, translation: { pageNumber: source.pageNumber, warnings: [],
    elements: source.elements.filter(isTranslatableElement).map(element => ({
      id: element.id, text: element.text, cells: allCells(element).map(cell => ({ id: cell.id, text: cell.text })),
    })),
  } };
}

function wrappedCellPage(): { source: PdfPageLayout; translation: PdfPageTranslation } {
  const source: PdfPageLayout = {
    pageNumber: 1,
    width: 1000,
    height: 1000,
    orientation: 'portrait',
    sourceLanguage: 'Uzbek',
    sourceScript: 'Cyrillic',
    warnings: [],
    elements: [{
      id: 'table',
      kind: 'table',
      order: 0,
      level: 0,
      text: '',
      bbox: [10, 10, 990, 200],
      translate: true,
      rowCount: 1,
      columnCount: 3,
      rows: [{
        rowIndex: 0,
        cells: [0, 1, 2].map((columnIndex) => ({
          id: `table-r0-c${columnIndex}`,
          rowIndex: 0,
          columnIndex,
          rowSpan: 1,
          columnSpan: 1,
          isHeader: false,
          translate: true,
          text: ['Олма\nсўз', 'баҳо', 'йўл'][columnIndex],
          bbox: [10 + columnIndex * 326, 10, 10 + (columnIndex + 1) * 326, 200] as [number, number, number, number],
        })),
      }],
    }],
  };
  return {
    source,
    translation: {
      pageNumber: 1,
      warnings: [],
      elements: [{
        id: 'table',
        text: '',
        cells: [
          { id: 'table-r0-c0', text: 'Яблоко слово' },
          { id: 'table-r0-c1', text: 'оценка' },
          { id: 'table-r0-c2', text: 'путь' },
        ],
      }],
    },
  };
}

describe('PDF translator tabular text validation', () => {
  it('accepts unchanged Russian tables with legal business names and currency identifiers', () => {
    const { source, translation } = russianCompanyPage();
    const before = JSON.stringify(source);
    expect(validateTranslatedPage(source, translation, 'Russian')).toMatchObject({ valid: true, failures: [] });
    expect(JSON.stringify(source)).toBe(before);
  });

  it.each(['TOPSHIRISH', 'BAJARISH', 'tarjima', 'MAZKUR DAVLAT', 'Ушбу ҳужжат учун'])
    ('rejects unchanged mixed prose even beside company names: %s', text => {
      const { source, translation } = russianCompanyPage(`План работ: ${text}.`);
      expect(validateTranslatedPage(source, translation, 'Russian').valid).toBe(false);
    });

  it('does not allow Latin prose simply because it has a legal marker outside a name column', () => {
    const { source, translation } = russianCompanyPage('ООО TOPSHIRISH: План работ.');
    expect(validateTranslatedPage(source, translation, 'Russian').valid).toBe(false);
  });

  it('still rejects altered amounts on already-Russian pages', () => {
    const { source, translation } = russianCompanyPage();
    translation.elements[0]!.cells.find(cell => cell.id === 'table-r1-c1')!.text = '2000 UZS';
    expect(validateTranslatedPage(source, translation, 'Russian').failures.join(' ')).toContain('numeric values');
  });

  it('accepts unchanged text when the source is already in target Russian', () => {
    const source: PdfPageLayout = {
      pageNumber: 10,
      width: 1000,
      height: 1000,
      orientation: 'portrait',
      sourceLanguage: 'Russian',
      sourceScript: 'Cyrillic',
      warnings: [],
      elements: [{
        id: 'russian-page', kind: 'paragraph', order: 0, level: 0, translate: true,
        text: 'Наименование товара. Цены предложения рассчитаны по курсу Центрального банка.',
        bbox: [10, 10, 990, 100], columnCount: 0, rowCount: 0, rows: [],
      }],
    };
    const translation: PdfPageTranslation = {
      pageNumber: 10,
      warnings: [],
      elements: [{ id: 'russian-page', text: source.elements[0]!.text, cells: [] }],
    };

    expect(validateTranslatedPage(source, translation, 'Russian').valid).toBe(true);
  });

  it('still rejects unchanged Uzbek text when Russian is requested', () => {
    const source: PdfPageLayout = {
      pageNumber: 1,
      width: 1000,
      height: 1000,
      orientation: 'portrait',
      sourceLanguage: 'Uzbek',
      sourceScript: 'Cyrillic',
      warnings: [],
      elements: [{
        id: 'uzbek-page', kind: 'paragraph', order: 0, level: 0, translate: true,
        text: 'Ушбу ҳужжат давлат органлари томонидан амалга оширилади.',
        bbox: [10, 10, 990, 100], columnCount: 0, rowCount: 0, rows: [],
      }],
    };
    const translation: PdfPageTranslation = {
      pageNumber: 1,
      warnings: [],
      elements: [{ id: 'uzbek-page', text: source.elements[0]!.text, cells: [] }],
    };

    const result = validateTranslatedPage(source, translation, 'Russian');
    expect(result.valid).toBe(false);
    expect(result.failures.join(' ')).toMatch(/effectively unchanged|leave Uzbek source text untranslated/i);
  });

  it('keeps the raw text API strict about TSV row boundaries', () => {
    const source = 'a\tb\tc\td\ne\tf\ng\th\ti';
    const translated = 'А\tБ\tВ\tГ\tД\nЕ\tЖ\tЗ';

    expect(validateTranslationResult(source, 'Russian', translated)).toContain(
      'translated table did not preserve its row count',
    );
  });

  it('normalizes only structured cell wrapping before strict row validation', () => {
    const { source, translation } = wrappedCellPage();

    expect(validateTranslatedPage(source, translation, 'Russian').valid).toBe(true);
  });

  it('still rejects collapsed rows even when their tab count happens to match', () => {
    const source = 'a\tb\tc\nd\te\tf';
    const translated = 'А\tБ\tВ\tГ\tД\tЕ';

    expect(validateTranslationResult(source, 'Russian', translated)).toContain(
      'translated table did not preserve its row count',
    );
  });

  it('still rejects a dropped row', () => {
    const source = 'a\tb\tc\nd\te\nf\tg\th';
    const translated = 'А\tБ\tВ\tГ\nД\tЕ';

    expect(validateTranslationResult(source, 'Russian', translated)).toContain(
      'translated table did not preserve its row count',
    );
  });

  it('still rejects a changed cell count when row count is unchanged', () => {
    const source = 'a\tb\tc\nd\te\tf';
    const translated = 'А\tБ\nВ\tГ\tД';

    expect(validateTranslationResult(source, 'Russian', translated)).toContain(
      'translated table row 1 did not preserve its cell count',
    );
  });
});
