import { describe, expect, it } from 'vitest';
import { normalizeTableIndexes } from '../table-indexes';
import type { PdfPageLayout } from '../schemas';

function fixture(rowOffset = 1, columnOffset = 1): PdfPageLayout {
  return { pageNumber: 6, width: 1000, height: 1000, orientation: 'portrait', sourceLanguage: 'Uzbek', sourceScript: 'Cyrillic', warnings: [], elements: [{
    id: 'e012', kind: 'table', order: 0, level: 0, translate: true, text: '', bbox: [0,0,1000,1000], columnCount: 7, rowCount: 3,
    rows: [0,1,2].map((row) => ({ rowIndex: row + rowOffset, cells: Array.from({ length: row === 1 ? 1 : 7 }, (_, col) => ({
      id: `r${row}-c${col}`, rowIndex: row + rowOffset, columnIndex: col + columnOffset, rowSpan: 1, columnSpan: row === 1 ? 7 : 1,
      isHeader: row === 0, translate: false, text: `${row}:${col}`, bbox: [0,0,10,10],
    })) })),
  }] };
}
describe('lossless table-index correction', () => {
  it.each([[1,1], [0,1], [1,0]])('repairs independent index bases %i/%i only with complete topology', (r, c) => {
    const before = fixture(r, c);
    const after = normalizeTableIndexes(before);
    expect(after).toEqual(fixture(0,0));
    expect(before.elements[0].rows[0].rowIndex).toBe(r);
  });
  it('does not fill missing cells, change spans or enlarge the grid', () => {
    const page = fixture();
    page.elements[0].rows[2].cells.pop();
    expect(normalizeTableIndexes(page)).toEqual(page);
  });
  it('rejects overlapping spans rather than pretending they form a valid grid', () => {
    const page = fixture();
    page.elements[0].rows[0].cells[0].columnSpan = 2;
    expect(normalizeTableIndexes(page)).toEqual(page);
  });
  it('leaves already-zero-based indexes intact', () => {
    const page = fixture(0,0);
    expect(normalizeTableIndexes(page).elements[0]).toBe(page.elements[0]);
  });
});
