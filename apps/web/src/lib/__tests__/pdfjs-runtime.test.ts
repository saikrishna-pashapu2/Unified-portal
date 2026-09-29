import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { createCanvas, DOMMatrix, ImageData, loadImage, Path2D } from '@napi-rs/canvas';
import { getPdfJsStandardFontDataUrl, loadNodePdfJs } from '../pdfjs-node';
import { extractExcelPdfDocument } from '../esg-drivers/excel-extraction';
import { fetchCatalogEvidence } from '../esg-drivers/research';
import { readNativeGeometry } from '../pdfx-v2/native-geometry';
import { rasterizeSinglePagePdf } from '../pdfx-v2/page-raster';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/config/env', () => ({ env: {} }));

const text = 'Shared worker PDF graphics: disclosure and emissions targets for 2026.';
const url = 'https://example.org/graphics-test.pdf';

async function sourcePdf(): Promise<Buffer> {
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  // Embed glyph outlines: this exercises paintChar/Path2D without depending on
  // whether the Windows/Linux host happens to have Helvetica installed.
  const font = await document.embedFont(await readFile(join(getPdfJsStandardFontDataUrl(), 'LiberationSans-Regular.ttf')), { subset: true });
  document.addPage([600, 200]).drawText(text, { x: 20, y: 100, size: 12, font });
  return Buffer.from(await document.save());
}

function installLegacyPlaceholders(): void {
  vi.stubGlobal('Path2D', class {});
  vi.stubGlobal('DOMMatrix', class {});
  vi.stubGlobal('ImageData', class {});
}

function expectNativeGraphics(): void {
  expect(globalThis.Path2D).toBe(Path2D);
  expect(globalThis.DOMMatrix).toBe(DOMMatrix);
  expect(globalThis.ImageData).toBe(ImageData);
  // This is the exact native operation that rejected the empty Path2D shim.
  const context = createCanvas(10, 10).getContext('2d');
  const path = new globalThis.Path2D('M1 1H9V9H1Z');
  context.fill(path as unknown as Path2D);
  expect(context.getImageData(4, 4, 1, 1).data[3]).toBe(255);
}

async function expectRenderedText(pdf: Buffer): Promise<void> {
  const png = await rasterizeSinglePagePdf(pdf);
  expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const image = await loadImage(png);
  const context = createCanvas(image.width, image.height).getContext('2d');
  context.drawImage(image, 0, 0);
  const { data } = context.getImageData(0, 0, image.width, image.height);
  let ink = 0;
  for (let offset = 0; offset < data.length; offset += 4) {
    if (data[offset + 3] && data[offset] < 128 && data[offset + 1] < 128 && data[offset + 2] < 128) ink += 1;
  }
  expect(ink).toBeGreaterThan(100);
}

afterEach(() => vi.unstubAllGlobals());

describe('shared Node PDF graphics runtime', () => {
  it('installs native constructors when graphics globals are absent', async () => {
    for (const name of ['Path2D', 'DOMMatrix', 'ImageData']) vi.stubGlobal(name, undefined);
    await loadNodePdfJs();
    expectNativeGraphics();
  });

  it('repairs placeholders even when PDF.js was already imported', async () => {
    await loadNodePdfJs();
    installLegacyPlaceholders();
    await Promise.all([loadNodePdfJs(), loadNodePdfJs()]);
    expectNativeGraphics();
  });

  it.each([false, true])('renders after the ESG PDF reader (searchableText=%s) in the same process', async (searchableText) => {
    installLegacyPlaceholders();
    const pdf = await sourcePdf();
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array(pdf).buffer, {
      headers: { 'content-type': 'application/pdf' },
    }));
    const lookupImpl = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]);
    const result = await fetchCatalogEvidence(url, { allowedUrls: [url], searchableText }, { fetchImpl, lookupImpl });
    expect(result.contentSnippet).toContain(text);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expectNativeGraphics();
    await expectRenderedText(pdf);
  });

  it('keeps native graphics when rendering runs before ESG extraction', async () => {
    installLegacyPlaceholders();
    const pdf = await sourcePdf();
    await expectRenderedText(pdf);
    expect((await extractExcelPdfDocument(pdf)).text).toContain(text);
    expectNativeGraphics();
    await expectRenderedText(pdf);
  });

  it('initializes graphics for native geometry extraction as well', async () => {
    installLegacyPlaceholders();
    const pdf = await sourcePdf();
    const geometry = await readNativeGeometry(pdf);
    expect(geometry.texts.map(item => item.text).join(' ')).toContain(text);
    expectNativeGraphics();
    await expectRenderedText(pdf);
  });

  it('rejects browser use before mutating graphics globals', async () => {
    vi.stubGlobal('window', {});
    await expect(loadNodePdfJs()).rejects.toThrow('cannot be loaded in a browser');
  });
});
