import { describe, expect, it } from 'vitest';
import { PDFDocument, degrees } from 'pdf-lib';
import { createCanvas } from '@napi-rs/canvas';
import { pageCanvasGeometry, diagramLines } from '../diagram-geometry';
import { detectScanRules, alignDiagramLabels } from '../scan-rules';
import { makeTranslatedPdfBytes } from '../makeTranslatedPdf';
import { parseStoredPdfPageLayout, type PdfPageLayout } from '../schemas';

function layout(): PdfPageLayout {
  return { pageNumber: 1, width: 1000, height: 1000, orientation: 'landscape', sourceLanguage: 'Uzbek', sourceScript: 'Latin', warnings: [], rotation: 270,
    elements: [{ id: 'e1', kind: 'paragraph', order: 0, level: 0, translate: true, text: 'Kuzatuv kengashi', bbox: [95,95,305,205], rowCount: 0, columnCount: 0, rows: [] }],
    graphics: [{ kind: 'rect', bbox: [100,100,300,200], points: [], arrowEnd: false, dashed: false }] };
}
describe('chart geometry shared by browser and PDF', () => {
  it.each([0,90,180,270])('preserves physical dimensions and original page rotation %i', async (rotation) => {
    const source = await PDFDocument.create();
    source.addPage([600,840]);
    const value = { ...layout(), rotation: rotation as PdfPageLayout['rotation'] };
    const rendered = await makeTranslatedPdfBytes([value], Buffer.from(await source.save()));
    const output = (await PDFDocument.load(rendered.bytes)).getPage(0);
    const canvas = pageCanvasGeometry(600,840,rotation);
    expect(output.getSize()).toEqual({ width: canvas.width, height: canvas.height });
    expect(output.getRotation().angle).toBe(rotation);
    expect(parseStoredPdfPageLayout(value)?.graphics).toEqual(value.graphics);
  });
  it('respects source PDF /Rotate metadata in addition to scanned text rotation', async () => {
    const source = await PDFDocument.create();
    source.addPage([600,840]).setRotation(degrees(90));
    const rendered = await makeTranslatedPdfBytes([{ ...layout(), rotation: 0 }], Buffer.from(await source.save()));
    expect((await PDFDocument.load(rendered.bytes)).getPage(0).getSize()).toEqual({ width: 840, height: 600 });
  });
  it('creates identical line/arrow primitives for both renderers', () => {
    const lines = diagramLines([{ kind: 'polyline', bbox: [0,0,1000,0], points: [{ x: 0,y: 0 },{ x: 1000,y: 0 }], arrowEnd: true, dashed: true }], 600,840);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toEqual({ x1: 0,y1: 0,x2: 600,y2: 0,dashed: true });
  });
  it('detects printed rules locally and fits a unique label inside its real box', async () => {
    const canvas = createCanvas(1000,1000);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white'; ctx.fillRect(0,0,1000,1000);
    ctx.strokeStyle = 'black'; ctx.lineWidth = 2; ctx.strokeRect(100,100,200,100);
    const graphics = await detectScanRules(canvas.toBuffer('image/png'));
    expect(graphics.length).toBeGreaterThanOrEqual(4);
    const aligned = alignDiagramLabels({ ...layout(), graphics });
    const [l,t,r,b] = aligned.elements[0].bbox;
    expect(l).toBeGreaterThanOrEqual(99); expect(t).toBeGreaterThanOrEqual(99);
    expect(r).toBeLessThanOrEqual(301); expect(b).toBeLessThanOrEqual(201);
  });
});
