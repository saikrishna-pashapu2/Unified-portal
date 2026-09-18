import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { rasterizePdfPage, rasterizeSinglePagePdf } from '../page-raster';

describe('PDF Translator page raster fallback', () => {
  it('renders a single PDF page to a PNG for vision retry', async () => {
    const document = await PDFDocument.create();
    const page = document.addPage([300, 200]);
    const font = await document.embedFont(StandardFonts.Helvetica);
    page.drawText('Raster retry 2026', { x: 30, y: 100, size: 18, font });

    const png = await rasterizeSinglePagePdf(Buffer.from(await document.save()));

    expect(png.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect(png.length).toBeGreaterThan(1_000);
  });

  it('renders a requested page directly from a multi-page source PDF', async () => {
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    document.addPage([300, 200]).drawText('First page', { x: 30, y: 100, size: 18, font });
    document.addPage([500, 300]).drawText('Second page', { x: 30, y: 100, size: 18, font });

    const png = await rasterizePdfPage(Buffer.from(await document.save()), 2);

    expect(png.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect(png.length).toBeGreaterThan(1_000);
  });
});

describe('textLineDirection', () => {
  async function stripedPng(direction: 'horizontal' | 'vertical'): Promise<Buffer> {
    const { createCanvas } = await import('@napi-rs/canvas');
    const canvas = createCanvas(400, 560);
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, 400, 560);
    context.fillStyle = '#111111';
    // Text-line-like stripes: ink bands with gaps, covering most of the page.
    if (direction === 'horizontal') {
      for (let y = 40; y < 520; y += 14) context.fillRect(30, y, 340, 7);
    } else {
      for (let x = 30; x < 370; x += 14) context.fillRect(x, 40, 7, 480);
    }
    return canvas.toBuffer('image/png');
  }

  it('recognizes horizontal text lines and their quarter-turned counterpart', async () => {
    const { textLineDirection } = await import('../page-raster');
    expect(await textLineDirection(await stripedPng('horizontal'))).toBe('horizontal');
    expect(await textLineDirection(await stripedPng('vertical'))).toBe('vertical');
  });

  it('returns unclear for a blank page instead of guessing', async () => {
    const { textLineDirection } = await import('../page-raster');
    const { createCanvas } = await import('@napi-rs/canvas');
    const canvas = createCanvas(200, 200);
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, 200, 200);
    expect(await textLineDirection(canvas.toBuffer('image/png'))).toBe('unclear');
  });
});
