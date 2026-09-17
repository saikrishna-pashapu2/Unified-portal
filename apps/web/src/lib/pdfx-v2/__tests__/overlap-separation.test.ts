import { describe, expect, it } from 'vitest';
import { repairExtractedLayout } from '../layout-repair';
import { validateExtractedPage } from '../validation';
import { numberPlaceholderFailure } from '../number-placeholders';
import type { PdfElement, PdfPageLayout } from '../schemas';

function paragraph(id: string, text: string, bbox: [number, number, number, number], order = 0): PdfElement {
  return { id, kind: 'paragraph', text, order, level: 0, bbox, translate: true, rowCount: 0, columnCount: 0, rows: [] };
}

function page(elements: PdfElement[]): PdfPageLayout {
  return { pageNumber: 1, width: 1000, height: 1000, orientation: 'portrait', sourceLanguage: 'Uzbek', sourceScript: 'Cyrillic', warnings: [], elements };
}

describe('scanned-page overlap separation', () => {
  it('separates moderately overlapping prose boxes on scans with no native geometry', () => {
    const source = page([
      paragraph('e007', 'Биринчи хатбоши матни', [100, 100, 500, 230]),
      paragraph('e008', 'Иккинчи хатбоши матни', [100, 180, 500, 300], 1),
    ]);
    expect(validateExtractedPage(source, 1).failures).toContain(
      'elements e007 and e008 have overlapping text regions that would overwrite each other',
    );
    const fixed = repairExtractedLayout(source);
    expect(validateExtractedPage(fixed, 1).failures).toEqual([]);
    expect(fixed.elements.map((element) => element.text)).toEqual(source.elements.map((element) => element.text));
    // Idempotent: a repaired page passes through unchanged.
    expect(repairExtractedLayout(fixed)).toEqual(fixed);
  });

  it('leaves heavily overlapping boxes failing so duplicated extractions are re-requested', () => {
    const source = page([
      paragraph('e001', 'Асосий матн', [100, 100, 500, 300]),
      paragraph('e002', 'Такрорланган матн', [110, 110, 490, 290], 1),
    ]);
    const fixed = repairExtractedLayout(source);
    expect(validateExtractedPage(fixed, 1).failures).toContain(
      'elements e001 and e002 have overlapping text regions that would overwrite each other',
    );
  });
});

describe('blank document-number guard', () => {
  const source = '2025 йил «23» июлдаги ____-сонли баённомаси';
  it('accepts an underscore blank kept directly before a year', () => {
    expect(numberPlaceholderFailure(source, 'протокол № ___ 2025 года от «23» июля', 'Russian')).toBeUndefined();
  });
  it('accepts a dash blank and an extra blank marker', () => {
    expect(numberPlaceholderFailure(source, 'протокол № — от «23» июля, № ___', 'Russian')).toBeUndefined();
  });
  it('still rejects a filled or omitted blank', () => {
    expect(numberPlaceholderFailure(source, 'протокол № 07-25 от «23» июля 2025 года', 'Russian')).toBeTruthy();
    expect(numberPlaceholderFailure(source, 'протокол от «23» июля 2025 года', 'Russian')).toBeTruthy();
  });
});
