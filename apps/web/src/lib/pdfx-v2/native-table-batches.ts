import { createHash } from 'node:crypto';
import type { PdfPageLayout } from './schemas';
import { allCells } from './serialize';

// Five translation/review pairs plus one corrective pair fit the existing
// twelve-request page ceiling. These are not additional request allowances.
export const MAX_NATIVE_TABLE_BATCHES = 5;
export const MAX_NATIVE_BATCH_VALUES = 160;
export const MAX_NATIVE_BATCH_CHARACTERS = 6_000;

export type NativeCellValue = { text: string; ids: string[] };
export type NativeCellBatch = Array<[string, NativeCellValue]>;

/** One translation per exact value, table, column and header/body role. */
export function planNativeTableBatches(source: PdfPageLayout) {
  const entries = new Map<string, NativeCellValue>();
  for (const element of source.elements) {
    for (const cell of allCells(element)) {
      if (!cell.translate || !cell.text.trim()) continue;
      const key = createHash('sha256')
        .update(JSON.stringify([element.id, cell.columnIndex, cell.isHeader, cell.text]))
        .digest('hex').slice(0, 24);
      const entry = entries.get(key) ?? { text: cell.text, ids: [] };
      entry.ids.push(cell.id);
      entries.set(key, entry);
    }
  }

  const batches: NativeCellBatch[] = [];
  let batch: NativeCellBatch = [];
  let characters = 0;
  for (const entry of Array.from(entries)) {
    if (batch.length && (batch.length >= MAX_NATIVE_BATCH_VALUES ||
      characters + entry[1].text.length > MAX_NATIVE_BATCH_CHARACTERS)) {
      batches.push(batch);
      batch = [];
      characters = 0;
    }
    batch.push(entry);
    characters += entry[1].text.length;
  }
  if (batch.length) batches.push(batch);
  return {
    entries,
    batches,
    fitsBudget: batches.length <= MAX_NATIVE_TABLE_BATCHES &&
      Array.from(entries.values()).every(entry => entry.text.length <= MAX_NATIVE_BATCH_CHARACTERS),
  };
}
