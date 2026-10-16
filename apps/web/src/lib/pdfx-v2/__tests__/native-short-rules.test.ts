import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { joinNativeText, nativeTableRegions, readNativeGeometry, rebuildNativeTable, type NativeText } from '../native-geometry';
import type { PdfElement } from '../schemas';

async function shortGridPdf() {
  const document = await PDFDocument.create();
  const page = document.addPage([600, 800]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const xs = [60, 81, 102, 123];
  const ys = [500, 521, 542, 563];
  const ink = rgb(0, 0, 0);
  // Each border segment is 1x21 points (aspect 21), below the global
  // aspect-ratio threshold.  The connected repeated grid is the only reason
  // these short filled rectangles should be promoted to native rules.
  for (const y of ys.slice(0, -1)) {
    for (const x of xs) page.drawRectangle({ x: x - 0.5, y, width: 1, height: 21, color: ink });
  }
  for (const y of ys) {
    for (const x of xs.slice(0, -1)) page.drawRectangle({ x, y: y - 0.5, width: 21, height: 1, color: ink });
  }
  for (let row = 0; row < ys.length - 1; row++) {
    for (let column = 0; column < xs.length - 1; column++) {
      page.drawText(`${row}${column}`, { x: xs[column] + 3, y: ys[row] + 7, size: 5, font });
    }
  }
  return Buffer.from(await document.save());
}

async function isolatedShortRectanglePdf() {
  const document = await PDFDocument.create();
  const page = document.addPage([600, 800]);
  page.drawRectangle({ x: 60, y: 500, width: 1, height: 21, color: rgb(0, 0, 0) });
  return Buffer.from(await document.save());
}

describe('bounded native short filled rules', () => {
  it('accepts source-ink short rectangles only when they form a repeated closed grid', async () => {
    const geometry = await readNativeGeometry(await shortGridPdf());
    expect(geometry.canReconstruct).toBe(true);
    expect(geometry.rules.length).toBeGreaterThanOrEqual(24);
    expect(nativeTableRegions(geometry)).toEqual([
      expect.arrayContaining([expect.any(Number), expect.any(Number), expect.any(Number), expect.any(Number)]),
    ]);
    expect(nativeTableRegions(geometry)).toHaveLength(1);

    const region = nativeTableRegions(geometry)[0]!;
    const table: PdfElement = {
      id: 'short-grid', kind: 'table', text: '', order: 0, level: 0, translate: true,
      bbox: region, rowCount: 3, columnCount: 3, rows: [],
    };
    const rebuilt = rebuildNativeTable(table, geometry);
    expect(rebuilt?.rows.flatMap(row => row.cells.map(cell => cell.text))).toEqual([
      '20', '21', '22', '10', '11', '12', '00', '01', '02',
    ]);
  }, 20_000);

  it('rejects an isolated short filled rectangle', async () => {
    const geometry = await readNativeGeometry(await isolatedShortRectanglePdf());
    expect(geometry.rules).toEqual([]);
    expect(nativeTableRegions(geometry)).toEqual([]);
  }, 20_000);

  it('joins touching and overlapping runs, adding a space only for a measured word gap', () => {
    const items: NativeText[] = [
      { text: 'A', bbox: [10, 10, 20, 20] },
      { text: 'B', bbox: [20.2, 10, 30, 20] },
      { text: 'C', bbox: [30.2, 10, 40, 20] },
      { text: 'next', bbox: [10, 25, 30, 35] },
    ];
    expect(joinNativeText(items)).toBe('ABC\nnext');

    const separated: NativeText[] = [
      { text: 'left', bbox: [10, 10, 20, 20] },
      { text: 'right', bbox: [24, 10, 34, 20] },
    ];
    expect(joinNativeText(separated)).toBe('left right');
  });
});
