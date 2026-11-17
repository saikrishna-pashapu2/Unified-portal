import type { PdfElement, PdfPageLayout } from './schemas';
import {
  containsBox, joinNativeText, nativeTableRegions, rebuildNativeTable, unionBoxes,
  type NativeGeometry, type NativeText,
} from './native-geometry';
import { validateExtractedPage } from './validation';
import { detectCellLanguage, isIdentifierText } from '@/lib/xlsx-translator/language';

/** Recover only invalid, digitally complete table pages. The PDF text/rules,
 * not the failed model's cell topology or coordinates, define every block.
 * Scans, partially supported text layers, ambiguous regions, and incomplete
 * grids retain the existing bounded OCR path. */
export function reconstructNativePage(
  source: PdfPageLayout,
  native: NativeGeometry,
): PdfPageLayout | null {
  if (native.canReconstruct !== true || native.images.length ||
      !native.texts.length || native.texts.length > 2500 ||
      native.texts.some(item => !item.text.trim() || /\uFFFD/.test(item.text) ||
        item.bbox.some(v => !Number.isFinite(v) || v < 0 || v > 1000) ||
        item.bbox[2] <= item.bbox[0] || item.bbox[3] <= item.bbox[1])) return null;
  if (validateExtractedPage(source, source.pageNumber, { extraction: true }).valid) return null;
  if (source.elements.some(e => ['image', 'diagram', 'other'].includes(e.kind))) return null;

  const regions = nativeTableRegions(native).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  if (!regions.length || regions.length > 30) return null;
  const intersects = (a: readonly number[], b: readonly number[]) =>
    Math.min(a[2], b[2]) > Math.max(a[0], b[0]) &&
    Math.min(a[3], b[3]) > Math.max(a[1], b[1]);
  if (regions.some((box, i) => regions.slice(i + 1).some(other => intersects(box, other)))) return null;
  const consumed = new Set<number>();
  const elements: PdfElement[] = [];
  for (let i = 0; i < regions.length; i++) {
    const region = regions[i]!;
    const table = rebuildNativeTable({
      id: `native-recovered-table-${i}`, kind: 'table', order: i, level: 0,
      text: '', bbox: region, translate: true, rowCount: 0, columnCount: 0, rows: [],
    }, native);
    if (!table) return null;
    for (let j = 0; j < native.texts.length; j++) {
      const item = native.texts[j]!;
      if (!intersects(region, item.bbox)) continue;
      if (!containsBox(region, item.bbox, 0.5) || consumed.has(j)) return null;
      consumed.add(j);
    }
    for (const row of table.rows) for (const cell of row.cells) {
      // Retain numbers, identifiers and English locally. Target-language
      // protection is applied by the existing extraction caller.
      cell.translate = !!cell.text.trim() && !isIdentifierText(cell.text) &&
        detectCellLanguage(cell.text) !== 'English';
    }
    table.translate = table.rows.some(row => row.cells.some(cell => cell.translate));
    elements.push(table);
  }

  // Merge native runs on the same line and contiguous lines of the same
  // paragraph. Never place remaining text inside a table or consume it twice.
  const remaining = native.texts.map((item, index) => ({ item, index }))
    .filter(({ index }) => !consumed.has(index))
    .sort((a, b) => a.item.bbox[1] - b.item.bbox[1] || a.item.bbox[0] - b.item.bbox[0]);
  const lines: NativeText[][] = [];
  for (const { item, index } of remaining) {
    const last = lines.at(-1);
    const first = last?.[0];
    const tolerance = first ? Math.min(first.bbox[3] - first.bbox[1], item.bbox[3] - item.bbox[1]) * 0.2 : 0;
    if (first && Math.abs(first.bbox[1] - item.bbox[1]) <= tolerance &&
        item.bbox[0] >= unionBoxes(last!.map(t => t.bbox))[2] - 0.5 &&
        item.bbox[0] - unionBoxes(last!.map(t => t.bbox))[2] <= 35) last!.push(item);
    else lines.push([item]);
    if (consumed.has(index)) return null;
    consumed.add(index);
  }
  const paragraphs: NativeText[][] = [];
  for (const line of lines) {
    const box = unionBoxes(line.map(t => t.bbox));
    const previous = paragraphs.at(-1);
    const previousBox = previous ? unionBoxes(previous.map(t => t.bbox)) : null;
    const combined = previousBox ? unionBoxes([previousBox, box]) : box;
    const height = Math.min(...line.map(t => t.bbox[3] - t.bbox[1]));
    if (previousBox && Math.abs(previousBox[0] - box[0]) <= 4 &&
        box[1] >= previousBox[3] - 0.5 && box[1] - previousBox[3] <= height * 0.65 &&
        !regions.some(region => intersects(region, combined))) previous!.push(...line);
    else paragraphs.push([...line]);
  }
  for (let i = 0; i < paragraphs.length; i++) {
    const runs = paragraphs[i]!;
    const text = joinNativeText(runs);
    elements.push({
      id: `native-recovered-text-${i}`, kind: 'paragraph', order: elements.length,
      level: 0, text, bbox: unionBoxes(runs.map(t => t.bbox)),
      translate: !isIdentifierText(text) && detectCellLanguage(text) !== 'English',
      rowCount: 0, columnCount: 0, rows: [],
    });
  }
  if (consumed.size !== native.texts.length) return null;
  const recovered: PdfPageLayout = {
    ...source,
    elements: elements.sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0])
      .map((element, order) => ({ ...element, order })),
    warnings: [...source.warnings, 'Layout recovered from the complete visible PDF text layer and closed table borders.'],
  };
  return validateExtractedPage(recovered, source.pageNumber, { extraction: true }).valid ? recovered : null;
}
