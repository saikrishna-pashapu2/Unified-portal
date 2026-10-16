import type { PdfCell, PdfElement } from './schemas';
import { canonicalText, containsBox, matchNativeBox, nativeTableRegions, rebuildNativeTable,
  unionBoxes, type NativeGeometry } from './native-geometry';

const identity = (text: string) => canonicalText(text).toLowerCase();
const area = (box: readonly number[]) => Math.max(0, box[2] - box[0]) * Math.max(0, box[3] - box[1]);
const overlap = (a: readonly number[], b: readonly number[]) =>
  Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) *
  Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));

/** Split an OCR cell only at source-proven native cell boundaries. Keep its
 * original spelling, case and numeric tokens; whitespace between cells is the
 * only discarded material. This is not fuzzy text matching. */
function splitOriginalText(text: string, cells: PdfCell[]): string[] | null {
  if (identity(text) !== cells.map(cell => identity(cell.text)).join('')) return null;
  if (cells.length === 1) return [text];
  const offsets: { start: number; end: number }[] = [];
  let offset = 0;
  for (const char of text) {
    const normalized = identity(char);
    for (let i = 0; i < normalized.length; i++) offsets.push({ start: offset, end: offset + char.length });
    offset += char.length;
  }
  let cursor = 0;
  const parts: string[] = [];
  for (const cell of cells) {
    const length = identity(cell.text).length;
    const first = offsets[cursor], last = offsets[cursor + length - 1];
    if (!first || !last || (cursor > 0 && first.start < offsets[cursor - 1].end)) return null;
    parts.push(text.slice(first.start, last.end));
    cursor += length;
  }
  return parts;
}

/** A closed digital table can corroborate a different number of header tiers
 * than OCR. Rebuild only when every nonempty OCR cell maps, without reuse, to
 * one native cell or a contiguous run on ONE native row. This also handles an
 * OCR subtotal cell that mistakenly combined its label and amount. Scans,
 * missing text, numeric changes, ambiguous matches and open borders still fail.
 */
export function repairNativeClosedTable(
  table: PdfElement,
  native: NativeGeometry,
  siblings: readonly PdfElement[],
  diagnostics?: string[],
): PdfElement | null {
  const reject = (reason: string): null => { diagnostics?.push(reason); return null; };
  if (table.kind !== 'table' || native.canReconstruct === false) return null;
  const originals = table.rows.flatMap(row => row.cells).filter(cell => cell.text.trim());
  if (!originals.length || originals.length > 1000) return null;
  const regions = nativeTableRegions(native).filter(box =>
    overlap(box, table.bbox) / Math.max(1, area(box) + area(table.bbox) - overlap(box, table.bbox)) > 0.55);
  if (regions.length !== 1) return null;
  // First prove the complete native table, without asking the source parser to
  // accept mismatched OCR topology. All native spans must be assigned once.
  let rebuilt = rebuildNativeTable({ ...table, bbox: regions[0], rows: [] }, native);
  if (!rebuilt) return reject('closed native grid could not be reconstructed');

  // A full-width trailing band may already be a separate OCR paragraph (e.g.
  // payment in words). Remove that native row only with an exact unique sibling
  // match, and only if no original table text would thereby be discarded.
  while (rebuilt.rows.length > 2) {
    const last = rebuilt.rows.at(-1)!;
    if (last.cells.length !== 1) break;
    const cell = last.cells[0];
    if (cell.rowSpan !== 1 || cell.columnIndex !== 0 || cell.columnSpan !== rebuilt.columnCount || !cell.text.trim()) break;
    const matching = siblings.filter(sibling => sibling.id !== table.id &&
      ['paragraph', 'footer', 'suppressed_text'].includes(sibling.kind) && identity(sibling.text) === identity(cell.text))
      .filter(sibling => {
        const box = matchNativeBox(sibling.text, sibling.bbox, native);
        return box && containsBox(cell.bbox, box, 0.5);
      });
    if (matching.length !== 1) break;
    if (originals.some(original => identity(cell.text).includes(identity(original.text)) &&
      overlap(original.bbox, cell.bbox) > 0)) return null;
    const rows = rebuilt.rows.slice(0, -1);
    if (rows.some(row => row.cells.some(c => c.rowIndex + c.rowSpan > rows.length))) return null;
    rebuilt = { ...rebuilt, rows, rowCount: rows.length, bbox: unionBoxes(rows.flatMap(row => row.cells.map(c => c.bbox))) };
  }

  const cells = rebuilt.rows.flatMap(row => row.cells);
  const replacements = new Map<PdfCell, { text: string; translate: boolean; id: string; isHeader: boolean }>();
  let previousRow = -1;
  for (const originalRow of [...table.rows].sort((a, b) => a.rowIndex - b.rowIndex)) {
    const sourceCells = originalRow.cells.filter(cell => cell.text.trim()).sort((a, b) => a.columnIndex - b.columnIndex);
    if (!sourceCells.length) continue;
    const rowMatches: { rowIndex: number; score: number; matches: { original: PdfCell; cells: PdfCell[] }[] }[] = [];
    for (const row of rebuilt.rows) {
      if (row.rowIndex <= previousRow) continue;
      // Corroborate an entire OCR row, in column order, against one native row.
      // An amount often repeats in both the body and totals. Matching individual
      // cells by proximity could consume the subtotal before reaching its label.
      let nextColumn = 0, score = 0;
      const mapped: { original: PdfCell; cells: PdfCell[] }[] = [];
      for (const original of sourceCells) {
        const wanted = identity(original.text);
        const matches: { cells: PdfCell[]; score: number; end: number }[] = [];
        for (let start = nextColumn; start < row.cells.length; start++) {
          let joined = '';
          const parts: PdfCell[] = [];
          const first = row.cells[start];
          if (Math.abs((first.bbox[1] + first.bbox[3] - original.bbox[1] - original.bbox[3]) / 2) > 45) continue;
          for (let end = start; end < Math.min(row.cells.length, start + 8); end++) {
            const cell = row.cells[end];
            if (!cell.text.trim()) break;
            parts.push(cell);
            joined += identity(cell.text);
            if (!wanted.startsWith(joined)) break;
            if (joined !== wanted) continue;
            const box = unionBoxes(parts.map(c => c.bbox));
            const dy = Math.abs((box[1] + box[3] - original.bbox[1] - original.bbox[3]) / 2);
            if (dy > 45 || Math.min(box[2], original.bbox[2]) <= Math.max(box[0], original.bbox[0]) - 25) break;
            const dx = (box[0] + box[2] - original.bbox[0] - original.bbox[2]) / 2;
            matches.push({ cells: [...parts], score: dy * dy + dx * dx, end });
            break;
          }
        }
        matches.sort((a, b) => a.score - b.score);
        if (!matches.length || (matches.length > 1 && matches[1].score - matches[0].score < 25)) break;
        const selected = matches[0];
        nextColumn = selected.end + 1;
        score += selected.score;
        mapped.push({ original, cells: selected.cells });
      }
      if (mapped.length === sourceCells.length) rowMatches.push({ rowIndex: row.rowIndex, score, matches: mapped });
    }
    rowMatches.sort((a, b) => a.score - b.score);
    if (!rowMatches.length) return reject(`no native row match for ${table.id} row ${originalRow.rowIndex}`);
    if (rowMatches.length > 1 && rowMatches[1].score - rowMatches[0].score < 25) return reject(`ambiguous native row for ${table.id} row ${originalRow.rowIndex}`);
    const selected = rowMatches[0];
    previousRow = selected.rowIndex;
    for (const match of selected.matches) {
      const parts = splitOriginalText(match.original.text, match.cells);
      if (!parts) return null;
      match.cells.forEach((cell, index) => {
        replacements.set(cell, { text: parts[index], translate: match.original.translate,
          id: index === 0 ? match.original.id : cell.id, isHeader: match.original.isHeader });
      });
    }
  }
  const lastHeaderRow = Math.max(-1, ...Array.from(replacements).filter(([, value]) => value.isHeader).map(([cell]) => cell.rowIndex));
  const rows = rebuilt.rows.map(row => ({ ...row, cells: row.cells.map(cell => ({ ...cell,
    isHeader: cell.rowIndex <= lastHeaderRow, ...replacements.get(cell) })) }));
  if (new Set(rows.flatMap(row => row.cells.map(cell => cell.id))).size !== cells.length) return reject('duplicate mapped cell IDs');
  return { ...rebuilt, rows, translate: rows.some(row => row.cells.some(cell => cell.translate && cell.text.trim())) };
}
