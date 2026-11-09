import { describe, expect, it } from 'vitest';
import { validateTranslationResult } from '../language-validation';
import { validateTranslatedPage } from '../validation';
import type { PdfPageLayout, PdfPageTranslation } from '../schemas';

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
