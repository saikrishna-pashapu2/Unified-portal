import type { PdfElement, PdfPageLayout } from './schemas';

function completeGrid(table: PdfElement, rowOffset: number, columnOffset: number): boolean {
  if (!table.rowCount || !table.columnCount || table.rowCount > 2000 || table.columnCount > 200) return false;
  const occupied = new Uint8Array(table.rowCount * table.columnCount);
  const rows = new Set<number>();
  for (const row of table.rows) {
    const rowIndex = row.rowIndex - rowOffset;
    if (rowIndex < 0 || rowIndex >= table.rowCount || rows.has(rowIndex)) return false;
    rows.add(rowIndex);
    for (const cell of row.cells) {
      const r = cell.rowIndex - rowOffset;
      const c = cell.columnIndex - columnOffset;
      if (r !== rowIndex || r < 0 || c < 0 || r + cell.rowSpan > table.rowCount || c + cell.columnSpan > table.columnCount) return false;
      for (let y = r; y < r + cell.rowSpan; y++) {
        for (let x = c; x < c + cell.columnSpan; x++) {
          const index = y * table.columnCount + x;
          if (occupied[index]) return false;
          occupied[index] = 1;
        }
      }
    }
  }
  return occupied.every(Boolean);
}

/** Correct indexing, never invent cells, enlarge grids or change OCR content.
 * An offset is accepted only when it proves complete, nonoverlapping coverage. */
export function normalizeTableIndexes(layout: PdfPageLayout): PdfPageLayout {
  return { ...layout, elements: layout.elements.map((table) => {
    if (table.kind !== 'table' || completeGrid(table, 0, 0)) return table;
    const candidates = [[1, 1], [0, 1], [1, 0]].filter(([r, c]) => completeGrid(table, r, c));
    if (candidates.length !== 1) return table;
    const [r, c] = candidates[0];
    return { ...table, rows: table.rows.map((row) => ({
      ...row, rowIndex: row.rowIndex - r,
      cells: row.cells.map((cell) => ({ ...cell, rowIndex: cell.rowIndex - r, columnIndex: cell.columnIndex - c })),
    })) };
  }) };
}
