import { describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { readNativeGeometry, repairNativeHeaderRowSpans, repairNativeHeaderGrid, rebuildNativeTable, type NativeGeometry } from '../native-geometry';
import { repairExtractedLayout } from '../layout-repair';
import { validateExtractedPage } from '../validation';
import type { PdfCell, PdfElement, PdfPageLayout } from '../schemas';
import { extractPageWithOpenAi } from '../openai';
import type { ExtractionRecovery } from '../layout-repair';

function fixture() {
  const xs = [100, 200, 400, 600], ys = [100, 125, 150, 175, 300, 400];
  const cell = (row: number, col: number): PdfCell => ({ id: `r${row}c${col}`, rowIndex: row, columnIndex: col,
    rowSpan: 1, columnSpan: 1, isHeader: row < 4, translate: true, text: `Source ${row}-${col}`,
    bbox: [xs[col], ys[row], xs[col + 1], ys[row + 1]],
  });
  const table: PdfElement = { id: 'table', kind: 'table', order: 0, level: 0, text: '', translate: true,
    bbox: [100, 100, 600, 400], rowCount: 5, columnCount: 3,
    rows: Array.from({ length: 5 }, (_, rowIndex) => ({ rowIndex, cells: rowIndex === 0
      ? [0, 1].map(col => ({ ...cell(0, col), rowSpan: 3, bbox: [xs[col], 100, xs[col + 1], 400] as PdfCell['bbox'] })).concat(cell(0, 2))
      : rowIndex === 4 ? [0, 1, 2].map(col => cell(rowIndex, col)) : [cell(rowIndex, 2)] })),
  };
  const geometry: NativeGeometry = { canReconstruct: true, images: [],
    rules: [
      // Long body strokes continue beyond the captured table: they must NOT
      // justify rebuilding/closing that body, but prove the closed headers.
      ...xs.map(at => ({ axis: 'x' as const, at, from: 100, to: 500 })),
      ...ys.slice(0, -1).map(at => ({ axis: 'y' as const, at, from: at > 100 && at < 300 ? 400 : 100, to: 600 })),
    ],
    texts: table.rows.flatMap(row => row.cells).map(c => ({ text: c.text,
      bbox: c.rowIndex === 0 && c.columnIndex < 2
        ? [c.bbox[0] + 10, 220, c.bbox[2] - 10, 230]
        : [c.bbox[0] + 10, c.bbox[1] + 5, c.bbox[2] - 10, c.bbox[1] + 15],
    })),
  };
  const page: PdfPageLayout = { pageNumber: 9, width: 1000, height: 1000, orientation: 'landscape', sourceLanguage: 'Uzbek',
    sourceScript: 'Latin', warnings: [], elements: [table] };
  return { table, geometry, page };
}

describe('bounded native merged-header repair', () => {
  it('fixes only the two proved row spans without reconstructing an open table body', () => {
    const { table, geometry, page } = fixture();
    expect(validateExtractedPage(page, 9).failures).toContain('table table is missing 2 grid position(s)');
    const fixed = repairExtractedLayout(page, geometry);
    expect(validateExtractedPage(fixed, 9).failures).toEqual([]);
    const cells = fixed.elements[0].rows.flatMap(row => row.cells);
    expect(cells.slice(0, 2).map(c => ({ id: c.id, rowSpan: c.rowSpan, bbox: c.bbox }))).toEqual([
      { id: 'r0c0', rowSpan: 4, bbox: [100, 100, 200, 300] },
      { id: 'r0c1', rowSpan: 4, bbox: [200, 100, 400, 300] },
    ]);
    const original = table.rows.flatMap(row => row.cells);
    expect(cells.slice(2)).toEqual(original.slice(2));
    expect(cells.map(c => [c.id, c.text])).toEqual(original.map(c => [c.id, c.text]));
    expect(table.rows[0].cells[0].rowSpan).toBe(3);
  });

  it.each(['separator', 'missing-side', 'wrong-text', 'scan', 'hidden', 'body-hole'] as const)(
    'refuses unsupported %s evidence instead of inventing blank cells', reason => {
      const { table, geometry } = fixture();
      if (reason === 'separator') geometry.rules.push({ axis: 'y', at: 175, from: 100, to: 200 });
      if (reason === 'missing-side') geometry.rules = geometry.rules.filter(rule => !(rule.axis === 'x' && rule.at === 100));
      if (reason === 'wrong-text') geometry.texts[0].text = 'A different header';
      if (reason === 'scan') geometry.images = [[100, 100, 600, 400]];
      if (reason === 'hidden') geometry.canReconstruct = false;
      if (reason === 'body-hole') table.rows[4].cells.pop();
      expect(repairNativeHeaderRowSpans(table, geometry)).toBeNull();
    },
  );

  it('bounds native rule analysis before quadratic deduplication', async () => {
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([600, 800]);
    for (let index = 0; index < 8001; index++) {
      page.drawLine({ start: { x: 10, y: 10 + index / 20 }, end: { x: 590, y: 10 + index / 20 }, thickness: 0.5 });
    }
    const geometry = await readNativeGeometry(Buffer.from(await pdf.save()));
    expect(geometry.rules).toEqual([]);
    expect(geometry.canReconstruct).toBe(false);
  }, 20000);
});

function overlappingHeaderFixture() {
  const xs = [100, 200, 330, 460, 600], ys = [100, 125, 150, 175, 300, 400];
  const cell = (row: number, col: number): PdfCell => ({ id: `h${row}c${col}`, rowIndex: row, columnIndex: col,
    rowSpan: 1, columnSpan: 1, isHeader: row < 4, translate: true, text: `Source ${row}-${col}`,
    bbox: [xs[col], ys[row], xs[col + 1], ys[row + 1]],
  });
  const left = { ...cell(0, 0), rowSpan: 4, text: '', bbox: [100, 100, 200, 400] as PdfCell['bbox'] };
  const title = { ...cell(0, 1), rowSpan: 2, columnSpan: 3, bbox: [200, 100, 600, 150] as PdfCell['bbox'] };
  const table: PdfElement = { id: 'table', kind: 'table', order: 0, level: 0, text: '', translate: true,
    bbox: [100, 100, 600, 400], rowCount: 5, columnCount: 4,
    rows: Array.from({ length: 5 }, (_, rowIndex) => ({ rowIndex,
      cells: rowIndex === 0 ? [left, title] : (rowIndex === 4 ? [0, 1, 2, 3] : [1, 2, 3]).map(col => cell(rowIndex, col)),
    })),
  };
  const geometry: NativeGeometry = { canReconstruct: true, images: [], rules: [
    ...xs.map((at, index) => ({ axis: 'x' as const, at, from: index === 2 || index === 3 ? 125 : 100, to: 500 })),
    ...ys.slice(0, -1).map(at => ({ axis: 'y' as const, at, from: at > 100 && at < 300 ? 200 : 100, to: 600 })),
  ], texts: table.rows.flatMap(row => row.cells).map(c => ({ text: c.id === left.id ? 'Company name' : c.text,
    bbox: c.id === left.id ? [110, 220, 190, 230] : [c.bbox[0] + 10, c.bbox[1] + 5, c.bbox[2] - 10, c.bbox[1] + 15],
  })) };
  const page: PdfPageLayout = { pageNumber: 9, width: 1000, height: 1000, orientation: 'landscape', sourceLanguage: 'Uzbek',
    sourceScript: 'Latin', warnings: [], elements: [table] };
  return { table, geometry, page };
}

describe('closed native multi-row header reconstruction', () => {
  it('recovers the saved terminal extraction without model requests', async () => {
    const { page, geometry } = overlappingHeaderFixture();
    const saved: ExtractionRecovery = { version: 'v5-local-repair-1', attempts: 1, rotation: 0,
      candidate: page, terminal: true, failures: ['table table overlaps 3 grid position(s)'],
    };
    const noModel = vi.fn(async () => { throw new Error('A paid request must not be sent'); });
    const result = await extractPageWithOpenAi(Buffer.from('local-native-fixture'), 9, 'Russian', {
      nativeGeometry: async () => geometry, orientation: noModel, extract: noModel, repair: noModel,
      context: noModel, translate: noModel, validate: noModel,
    }, { resume: saved });
    expect(noModel).not.toHaveBeenCalled();
    expect(result.responseId).toBe('retained-layout-repair');
    expect(validateExtractedPage(result.layout, 9).valid).toBe(true);
    expect(result.layout.elements[0].rows[0].cells[0].text).toBe('Company name');
    expect(saved.candidate?.elements[0].rows[0].cells[0].text).toBe('');
  });

  it.each([true, false])('repairs header topology and omitted labels when overlap=%s, keeping body and IDs', overlap => {
    const { table, geometry, page } = overlappingHeaderFixture();
    if (!overlap) table.rows[0].cells[1].rowSpan = 1;
    const before = structuredClone(table);
    const fixed = repairExtractedLayout(page, geometry);
    expect(validateExtractedPage(fixed, 9).failures).toEqual([]);
    const result = fixed.elements[0];
    expect(result.rows[0].cells[0]).toMatchObject({ id: 'h0c0', text: 'Company name', rowSpan: 4, bbox: [100, 100, 200, 300] });
    expect(result.rows[0].cells[1]).toMatchObject({ id: 'h0c1', rowSpan: 1, columnSpan: 3, bbox: [200, 100, 600, 125] });
    expect(result.rows[4]).toEqual(before.rows[4]);
    expect(result.rows.flatMap(row => row.cells.map(c => c.id))).toEqual(before.rows.flatMap(row => row.cells.map(c => c.id)));
    expect(result.rows.flatMap(row => row.cells).filter(c => c.id !== 'h0c0').map(c => [c.id, c.text]))
      .toEqual(before.rows.flatMap(row => row.cells).filter(c => c.id !== 'h0c0').map(c => [c.id, c.text]));
    expect(table).toEqual(before);
    expect(rebuildNativeTable(table, geometry)).toBeNull(); // still cannot close the open body
  });

  it.each(['open-bottom', 'missing-side', 'crossing-text', 'wrong-text', 'hidden', 'scan', 'ambiguous-blank', 'extra-source-label'] as const)(
    'refuses %s rather than partially accepting an unsupported header', reason => {
      const { table, geometry } = overlappingHeaderFixture();
      if (reason === 'open-bottom') geometry.rules = geometry.rules.filter(r => !(r.axis === 'y' && r.at === 300));
      if (reason === 'missing-side') geometry.rules = geometry.rules.filter(r => !(r.axis === 'x' && r.at === 100));
      if (reason === 'crossing-text') geometry.texts[0].bbox[3] = 305;
      if (reason === 'wrong-text') table.rows[0].cells[1].text = 'An unrelated heading';
      if (reason === 'hidden') geometry.canReconstruct = false;
      if (reason === 'scan') geometry.images.push([100, 100, 600, 400]);
      if (reason === 'ambiguous-blank') table.rows[0].cells[0].bbox[0] = 150;
      if (reason === 'extra-source-label') geometry.texts.push({ text: 'Additional meaning', bbox: [215, 118, 350, 124] });
      expect(repairNativeHeaderGrid(table, geometry)).toBeNull();
    },
  );
});
