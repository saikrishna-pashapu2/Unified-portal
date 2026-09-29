import { describe, expect, it, vi } from 'vitest';
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import { nativeTextRotation } from '../native-geometry';
import { extractPageWithOpenAi, type PdfxV2OpenAiRequester } from '../openai';
import type { PdfPageLayout } from '../schemas';

async function textPage(options: { pageRotate?: number; textRotate?: number; text?: string } = {}): Promise<Buffer> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([842, 595]);
  const text = options.text ?? 'Disclosure schedule for the reporting period and the related targets';
  for (let line = 0; line < 6; line += 1) {
    page.drawText(text, {
      x: options.textRotate === 180 ? 800 : 40,
      y: options.textRotate === 180 ? 80 + line * 30 : 500 - line * 30,
      size: 11, font, rotate: degrees(options.textRotate ?? 0),
    });
  }
  if (options.pageRotate) page.setRotation(degrees(options.pageRotate));
  return Buffer.from(await document.save());
}

describe('text-layer orientation', () => {
  it('reads an upright digital page as upright', async () => {
    expect(await nativeTextRotation(await textPage())).toBe(0);
  });

  it('detects text drawn upside down and pages carrying a /Rotate', async () => {
    expect(await nativeTextRotation(await textPage({ textRotate: 180 }))).toBe(180);
    expect(await nativeTextRotation(await textPage({ pageRotate: 180 }))).toBe(180);
    expect(await nativeTextRotation(await textPage({ pageRotate: 90 }))).toBe(90);
  });

  it('declines to decide without a substantial text layer', async () => {
    const blank = await PDFDocument.create();
    blank.addPage([842, 595]);
    expect(await nativeTextRotation(Buffer.from(await blank.save()))).toBeUndefined();
    expect(await nativeTextRotation(await textPage({ text: 'p. 1' }))).toBeUndefined();
  });
});

describe('extraction orientation', () => {
  const layout: PdfPageLayout = {
    pageNumber: 1, width: 1000, height: 1000, orientation: 'landscape', rotation: 0,
    sourceLanguage: 'Uzbek', sourceScript: 'Cyrillic', warnings: [],
    elements: [{ id: 'e001', kind: 'paragraph', order: 0, level: 0, translate: true, text: 'Ҳисобот даври учун маълумот',
      bbox: [100, 100, 900, 200], rowCount: 0, columnCount: 0, rows: [] }],
  };
  const provider = (overrides: Partial<PdfxV2OpenAiRequester>) =>
    ({ extract: vi.fn(), context: vi.fn(), translate: vi.fn(), validate: vi.fn(), ...overrides }) as PdfxV2OpenAiRequester;

  it('trusts a digital text layer and never asks the model to guess', async () => {
    const orientation = vi.fn(async () => ({ value: { rotation: 180 as const }, model: 'm', inputTokens: 1, outputTokens: 1, responseId: 'r' }));
    const extract = vi.fn(async (args: { sourceRotation?: number }) => {
      expect(args.sourceRotation).toBe(0);
      return { value: layout, model: 'm', inputTokens: 1, outputTokens: 1, responseId: 'r' };
    });
    const result = await extractPageWithOpenAi(Buffer.from('fixture'), 1, 'Russian', provider({
      orientation, extract, nativeTextRotation: vi.fn(async () => 0 as const),
    }));
    expect(orientation).not.toHaveBeenCalled();
    expect(result.layout.elements[0].text).toBe('Ҳисобот даври учун маълумот');
  });

  it('falls back to the model when there is no reliable text layer', async () => {
    const orientation = vi.fn(async () => ({ value: { rotation: 0 as const }, model: 'm', inputTokens: 1, outputTokens: 1, responseId: 'r' }));
    const extract = vi.fn(async () => ({ value: layout, model: 'm', inputTokens: 1, outputTokens: 1, responseId: 'r' }));
    await extractPageWithOpenAi(Buffer.from('fixture'), 1, 'Russian', provider({
      orientation, extract, nativeTextRotation: vi.fn(async () => undefined),
    }));
    expect(orientation).toHaveBeenCalledTimes(1);
  });
});
