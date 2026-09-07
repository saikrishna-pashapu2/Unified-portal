import { getPdfJsStandardFontDataUrl } from '@/lib/pdfjs-node';

const MAX_RASTER_DIMENSION = 2_600;

type RasterCanvas = {
  width: number;
  height: number;
  getContext(type: '2d'): {
    fillStyle: string;
    fillRect(x: number, y: number, width: number, height: number): void;
  };
  toBuffer(type: 'image/png'): Buffer;
};

async function createPdfJsCanvas(width: number, height: number): Promise<RasterCanvas> {
  // Keep the native runtime as a direct, server-external dependency so Next.js
  // never tries to rewrite createRequire calls or bundle platform bindings.
  // Load it lazily because ordinary uploads do not need the raster fallback.
  const { createCanvas } = await import('@napi-rs/canvas');
  return createCanvas(width, height) as unknown as RasterCanvas;
}

/**
 * Render a single-page PDF to PNG without depending on qpdf, Poppler, or a
 * system OCR package. The generic worker runs this only after an OpenAI PDF
 * input times out, giving the vision request a much smaller, deterministic
 * fallback payload.
 */
export async function rasterizePdfPage(pdf: Buffer, pageNumber: number, clockwiseRotation = 0): Promise<Buffer> {
  if (!Number.isSafeInteger(pageNumber) || pageNumber < 1) {
    throw new Error(`Invalid PDF page number: ${pageNumber}`);
  }
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(pdf),
    standardFontDataUrl: getPdfJsStandardFontDataUrl(),
    useSystemFonts: true,
    verbosity: pdfjs.VerbosityLevel.ERRORS,
  });
  const document = await loadingTask.promise;

  try {
    if (pageNumber > document.numPages) {
      throw new Error(`PDF page ${pageNumber} does not exist; document has ${document.numPages} pages`);
    }
    const page = await document.getPage(pageNumber);
    const rotation = (page.rotate + clockwiseRotation) % 360;
    const baseViewport = page.getViewport({ scale: 1, rotation });
    const scale = Math.max(
      1,
      Math.min(3, MAX_RASTER_DIMENSION / Math.max(baseViewport.width, baseViewport.height)),
    );
    const viewport = page.getViewport({ scale, rotation });
    const canvas = await createPdfJsCanvas(
      Math.ceil(viewport.width),
      Math.ceil(viewport.height),
    );
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({
      canvasContext: context as never,
      viewport,
      background: '#ffffff',
    }).promise;
    page.cleanup();
    return canvas.toBuffer('image/png');
  } finally {
    await document.destroy();
  }
}

export async function rasterizeSinglePagePdf(pagePdf: Buffer, clockwiseRotation = 0): Promise<Buffer> {
  return rasterizePdfPage(pagePdf, 1, clockwiseRotation);
}

/** Overlapping horizontal detail strips retain legible small spreadsheet text.
 * They are extra views in ONE request, not per-cell validation API calls. */
export async function rasterDetailStrips(png: Buffer): Promise<{ png: Buffer; top: number; bottom: number }[]> {
  const { createCanvas, loadImage } = await import('@napi-rs/canvas');
  const source = await loadImage(png);
  return [0, 0.3, 0.6].map((fraction) => {
    const top = Math.floor(fraction * source.height);
    const bottom = Math.min(source.height, Math.ceil((fraction + 0.4) * source.height));
    const canvas = createCanvas(source.width, bottom - top);
    canvas.getContext('2d').drawImage(source, 0, top, source.width, bottom - top, 0, 0, source.width, bottom - top);
    return { png: canvas.toBuffer('image/png'), top: top / source.height * 1000, bottom: bottom / source.height * 1000 };
  });
}
