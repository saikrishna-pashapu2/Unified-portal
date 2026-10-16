import { describe, expect, it } from 'vitest';
import { repairNativeClosedTable } from '../native-closed-table-repair';
import { canonicalText, type NativeGeometry } from '../native-geometry';
import { validateExtractedPage } from '../validation';
import type { PdfCell, PdfElement, PdfPageLayout } from '../schemas';

function fixture(separatePayment = false) {
  const xs = [100, 200, 500, 600, 700, 900], ys = [100, 140, 180, 220, 300, 370, 440];
  const cell = (r: number, c: number, text: string, rs = 1, cs = 1): PdfCell => ({
    id: `old-${r}-${c}`, rowIndex: r, columnIndex: c, rowSpan: rs, columnSpan: cs,
    isHeader: r < 3, translate: true, text, bbox: [xs[c], ys[r], xs[c + cs], ys[r + rs]],
  });
  const source = [
    cell(0, 0, 'No', 2), cell(0, 1, 'Description', 2), cell(0, 2, 'Value', 2), cell(0, 3, 'Tax', 1, 2),
    cell(1, 3, 'Rate'), cell(1, 4, 'Amount'),
    ...['x', '1', '2', '3', '4'].map((t, c) => cell(2, c, t)),
    ...['1', 'SOURCE note', '100.00', '12', '12.00'].map((t, c) => cell(3, c, t)),
    cell(4, 0, 'Total:', 1, 2), cell(4, 2, '100.00'), cell(4, 3, 'x'), cell(4, 4, '12.00'),
    cell(5, 0, 'Payment in words', 1, 5),
  ];
  const native: NativeGeometry = { canReconstruct: true, images: [], rules: source.flatMap(c => [
    { axis: 'x' as const, at: c.bbox[0], from: c.bbox[1], to: c.bbox[3] },
    { axis: 'x' as const, at: c.bbox[2], from: c.bbox[1], to: c.bbox[3] },
    { axis: 'y' as const, at: c.bbox[1], from: c.bbox[0], to: c.bbox[2] },
    { axis: 'y' as const, at: c.bbox[3], from: c.bbox[0], to: c.bbox[2] },
  ]), texts: source.map(c => ({ text: c.text,
    bbox: [c.bbox[0] + 8, c.bbox[1] + 8, Math.min(c.bbox[2] - 8, c.bbox[0] + 90), c.bbox[1] + 20],
  })) };
  const originals = source.filter(c => c.rowIndex !== 1 && (c.rowIndex !== 5 || !separatePayment)).map(c => ({
    ...c, rowIndex: c.rowIndex > 1 ? c.rowIndex - 1 : c.rowIndex,
    rowSpan: c.rowSpan === 2 ? 1 : c.rowSpan,
    text: c.text === 'SOURCE note' ? 'Source note' : c.text,
    bbox: c.bbox.map((n, index) => n + (index % 2 ? 15 : 0)),
  }));
  // OCR combined the total label and the adjacent numeric cell.
  const total = originals.find(c => c.id === 'old-4-0')!;
  total.text = 'Total:\n100.00'; total.columnSpan = 3; total.bbox[2] = 600;
  const cells = originals.filter(c => c.id !== 'old-4-2');
  const table: PdfElement = { id: 'invoice', kind: 'table', text: '', level: 0, order: 0, translate: true,
    rowCount: separatePayment ? 4 : 5, columnCount: 5, bbox: [100, 115, 900, 455],
    rows: Array.from({ length: separatePayment ? 4 : 5 }, (_, rowIndex) => ({ rowIndex, cells: cells.filter(c => c.rowIndex === rowIndex) })),
  };
  const payment: PdfElement = { id: 'payment', kind: 'paragraph', text: 'Payment in words', level: 0, order: 1,
    translate: true, rows: [], rowCount: 0, columnCount: 0, bbox: [100, 370, 900, 440] };
  return { table, native, payment };
}

function page(table: PdfElement): PdfPageLayout {
  return { pageNumber: 1, width: 1000, height: 1000, orientation: 'landscape',
    sourceLanguage: 'Uzbek', sourceScript: 'Latin', elements: [table], warnings: [] };
}

describe('source-proven closed table repair', () => {
  it('recovers missing header tiers and splits a combined total without losing original text', () => {
    const { table, native } = fixture();
    const fixed = repairNativeClosedTable(table, native, [table]);
    expect(fixed).not.toBeNull();
    expect(validateExtractedPage(page(fixed!), 1).failures).toEqual([]);
    const cells = fixed!.rows.flatMap(row => row.cells);
    expect(fixed!.rowCount).toBe(6);
    expect(cells.map(c => c.text)).toEqual(expect.arrayContaining(['Rate', 'Amount', 'Source note', 'Total:', '100.00', 'Payment in words']));
    for (const old of table.rows.flatMap(row => row.cells)) {
      expect(canonicalText(cells.map(c => c.text).join(''))).toContain(canonicalText(old.text));
    }
    expect(cells.find(c => c.id === 'old-3-1')?.text).toBe('Source note');
    expect(table.rowCount).toBe(5);
  });

  it('keeps a separately extracted payment paragraph outside the rebuilt table', () => {
    const { table, native, payment } = fixture(true);
    const fixed = repairNativeClosedTable(table, native, [table, payment]);
    expect(fixed?.rowCount).toBe(5);
    expect(fixed?.bbox).toEqual([100, 100, 900, 370]);
    expect(fixed?.rows.flatMap(r => r.cells.map(c => c.text))).not.toContain(payment.text);
    expect(payment.text).toBe('Payment in words');
  });

  it('matches complete rows when a displaced body amount is closer to the identical subtotal', () => {
    const { table, native } = fixture();
    const y = (n: number) => 200 + n * 0.4;
    for (const rule of native.rules) {
      if (rule.axis === 'y') rule.at = y(rule.at);
      else { rule.from = y(rule.from); rule.to = y(rule.to); }
    }
    for (const text of native.texts) { text.bbox[1] = y(text.bbox[1]); text.bbox[3] = y(text.bbox[3]); }
    for (const cell of table.rows.flatMap(row => row.cells)) {
      cell.bbox[1] = y(cell.bbox[1]) + 15;
      cell.bbox[3] = y(cell.bbox[3]) + 15;
    }
    table.bbox[1] = y(table.bbox[1]) + 15;
    table.bbox[3] = y(table.bbox[3]) + 15;
    const fixed = repairNativeClosedTable(table, native, [table]);
    expect(fixed).not.toBeNull();
    expect(validateExtractedPage(page(fixed!), 1).failures).toEqual([]);
    const cells = fixed!.rows.flatMap(row => row.cells);
    expect(cells.find(c => c.id === 'old-3-2')).toMatchObject({ text: '100.00', rowIndex: 3, columnIndex: 2 });
    expect(fixed!.rows[4].cells.map(c => c.text)).toEqual(['Total:', '100.00', 'x', '12.00']);
    expect(cells.filter(c => c.text === '100.00')).toHaveLength(2);
  });

  it('refuses to borrow missing text from another row', () => {
    const { table, native } = fixture();
    table.rows[2].cells[1].text = 'Total:';
    expect(repairNativeClosedTable(table, native, [table])).toBeNull();
  });

  it('refuses reordered column contents instead of silently moving them', () => {
    const { table, native } = fixture();
    [table.rows[2].cells[1].text, table.rows[2].cells[2].text] = [table.rows[2].cells[2].text, table.rows[2].cells[1].text];
    expect(repairNativeClosedTable(table, native, [table])).toBeNull();
  });

  it.each(['changed-number', 'missing-text', 'hidden', 'scan', 'open-border'])(
    'refuses unsupported %s instead of removing content', reason => {
      const { table, native } = fixture();
      if (reason === 'changed-number') table.rows[2].cells[2].text = '999.00';
      if (reason === 'missing-text') native.texts = native.texts.filter(t => t.text !== 'SOURCE note');
      if (reason === 'hidden') native.canReconstruct = false;
      if (reason === 'scan') native.images = [[100, 100, 900, 440]];
      if (reason === 'open-border') native.rules = native.rules.filter(r => !(r.axis === 'x' && r.at === 100));
      expect(repairNativeClosedTable(table, native, [table])).toBeNull();
    },
  );
});
