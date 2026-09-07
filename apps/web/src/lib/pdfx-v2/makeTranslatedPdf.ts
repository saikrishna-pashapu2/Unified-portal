import { PDFDocument, rgb, degrees, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import bidiFactory from 'bidi-js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PdfElement, PdfPageLayout } from './schemas';
import { listTextWithMarkers } from './serialize';
import { pageCanvasGeometry, diagramLines } from './diagram-geometry';
import type { SourcePageMapping, TranslatedPdfResult } from './types';
import { PdfxV2ValidationError, validateExtractedPage } from './validation';

const NORMALIZED_PAGE_SIZE = 1000;
const MIN_FONT_SIZE = 1.5;
const ARABIC_CHARACTER = /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff]/g;
const NUMERIC_TEXT = /^[\s\d.,:%/()+\-–—]+$/;
const VISUAL_KINDS = new Set<PdfElement['kind']>([
  'image',
  'stamp',
  'signature',
  'other',
]);
const bidi = bidiFactory();

type TextAlignment = 'left' | 'center' | 'right';
type PdfBox = { x: number; y: number; width: number; height: number };

export function normalizePdfText(input: string): string {
  return (input ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, ' ')
    .replace(/[\u2028\u2029]/g, '\n')
    .replace(/[\ufdd0-\ufdef\ufffe\uffff]/g, '')
    .replace(/[^\S\n\t]+$/gm, '')
    .normalize('NFC');
}

function isRtlLine(text: string): boolean {
  ARABIC_CHARACTER.lastIndex = 0;
  return ARABIC_CHARACTER.test(text);
}

/** Preorder mixed-direction text so Fontkit's RTL shaping keeps LTR numbers intact. */
export function prepareRtlLineForPdf(text: string): string {
  const embedding = bidi.getEmbeddingLevels(text, 'rtl');
  const characters = text.split('');
  bidi.getMirroredCharactersMap(text, embedding).forEach((replacement, index) => {
    characters[index] = replacement;
  });
  for (const [start, end] of bidi.getReorderSegments(text, embedding)) {
    for (let left = start, right = end; left < right; left += 1, right -= 1) {
      const character = characters[left];
      characters[left] = characters[right];
      characters[right] = character;
    }
  }
  return Array.from(characters.join('')).reverse().join('');
}

function wrapLogicalLine(
  logicalLine: string,
  maxWidth: number,
  font: PDFFont,
  fontSize: number,
): string[] {
  if (!logicalLine.trim()) return [''];
  const output: string[] = [];
  const words = logicalLine.trim().split(/\s+/g);
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) output.push(line);
    if (font.widthOfTextAtSize(word, fontSize) <= maxWidth) {
      line = word;
      continue;
    }
    let fragment = '';
    for (const character of Array.from(word)) {
      const candidateFragment = fragment + character;
      if (fragment && font.widthOfTextAtSize(candidateFragment, fontSize) > maxWidth) {
        output.push(fragment);
        fragment = character;
      } else {
        fragment = candidateFragment;
      }
    }
    line = fragment;
  }
  if (line) output.push(line);
  return output;
}

export function wrapLines(
  text: string,
  maxWidth: number,
  font: PDFFont,
  fontSize: number,
): string[] {
  return normalizePdfText(text)
    .split('\n')
    .flatMap((line) => wrapLogicalLine(line, maxWidth, font, fontSize));
}

function boxFromNormalized(page: PDFPage, bbox: readonly number[]): PdfBox {
  const size = page.getSize();
  const left = Math.max(0, Math.min(NORMALIZED_PAGE_SIZE, bbox[0] ?? 0));
  const top = Math.max(0, Math.min(NORMALIZED_PAGE_SIZE, bbox[1] ?? 0));
  const right = Math.max(left, Math.min(NORMALIZED_PAGE_SIZE, bbox[2] ?? left));
  const bottom = Math.max(top, Math.min(NORMALIZED_PAGE_SIZE, bbox[3] ?? top));
  return {
    x: (left / NORMALIZED_PAGE_SIZE) * size.width,
    y: size.height - (bottom / NORMALIZED_PAGE_SIZE) * size.height,
    width: ((right - left) / NORMALIZED_PAGE_SIZE) * size.width,
    height: ((bottom - top) / NORMALIZED_PAGE_SIZE) * size.height,
  };
}

function insetBox(box: PdfBox, horizontal: number, vertical = horizontal): PdfBox {
  const safeHorizontal = Math.max(0, Math.min(horizontal, box.width / 3));
  const safeVertical = Math.max(0, Math.min(vertical, box.height / 3));
  return {
    x: box.x + safeHorizontal,
    y: box.y + safeVertical,
    width: Math.max(0, box.width - safeHorizontal * 2),
    height: Math.max(0, box.height - safeVertical * 2),
  };
}

function alignedX(
  line: string,
  box: PdfBox,
  font: PDFFont,
  fontSize: number,
  alignment: TextAlignment,
): number {
  const rendered = isRtlLine(line) ? prepareRtlLineForPdf(line) : line;
  const width = font.widthOfTextAtSize(rendered, fontSize);
  if (isRtlLine(line) || alignment === 'right') return Math.max(box.x, box.x + box.width - width);
  if (alignment === 'center') return Math.max(box.x, box.x + (box.width - width) / 2);
  return box.x;
}

function drawLine(
  page: PDFPage,
  line: string,
  box: PdfBox,
  y: number,
  font: PDFFont,
  fontSize: number,
  alignment: TextAlignment,
): void {
  if (!line) return;
  const rendered = isRtlLine(line) ? prepareRtlLineForPdf(line) : line;
  page.drawText(rendered, {
    x: alignedX(line, box, font, fontSize, alignment),
    y,
    size: fontSize,
    font,
    color: rgb(0.06, 0.06, 0.06),
  });
}

function fitText(
  text: string,
  box: PdfBox,
  font: PDFFont,
  maximumFontSize: number,
  minimumFontSize = MIN_FONT_SIZE,
  lineHeightMultiplier = 1.18,
): { fontSize: number; lineHeight: number; lines: string[] } {
  const maximum = Math.max(minimumFontSize, Math.min(maximumFontSize, box.height * 0.82));
  for (let fontSize = maximum; fontSize >= minimumFontSize; fontSize -= 0.25) {
    const lines = wrapLines(text, Math.max(1, box.width), font, fontSize);
    const lineHeight = fontSize * lineHeightMultiplier;
    if (lines.length * lineHeight <= box.height + 0.1) {
      return { fontSize, lineHeight, lines };
    }
  }
  const lines = wrapLines(text, Math.max(1, box.width), font, minimumFontSize);
  return { fontSize: minimumFontSize, lineHeight: minimumFontSize * lineHeightMultiplier, lines };
}

function drawTextInBox(args: {
  page: PDFPage;
  text: string;
  box: PdfBox;
  font: PDFFont;
  maximumFontSize: number;
  minimumFontSize?: number;
  padding: number;
  alignment?: TextAlignment;
  verticallyCentered?: boolean;
  lineHeightMultiplier?: number;
}): void {
  const contentBox = insetBox(args.box, args.padding, Math.min(args.padding, 0.15));
  const text = normalizePdfText(args.text);
  if (!text || contentBox.width <= 0 || contentBox.height <= 0) return;
  const fitted = fitText(
    text,
    contentBox,
    args.font,
    args.maximumFontSize,
    args.minimumFontSize,
    args.lineHeightMultiplier,
  );
  const visibleLineCount = Math.max(0, Math.floor(contentBox.height / fitted.lineHeight));
  const lines = fitted.lines.slice(0, visibleLineCount);
  const renderedHeight = lines.length * fitted.lineHeight;
  const topOffset = args.verticallyCentered
    ? Math.max(0, (contentBox.height - renderedHeight) / 2)
    : 0;
  let y = contentBox.y + contentBox.height - topOffset - fitted.fontSize;
  for (const line of lines) {
    drawLine(
      args.page,
      line,
      contentBox,
      y,
      args.font,
      fitted.fontSize,
      args.alignment ?? 'left',
    );
    y -= fitted.lineHeight;
  }
}

function elementFontSize(element: PdfElement): number {
  if (element.kind === 'heading') return element.level <= 1 ? 18 : 14;
  if (element.kind === 'header' || element.kind === 'footer') return 9.5;
  return 11;
}

function drawTable(page: PDFPage, element: PdfElement, font: PDFFont): void {
  for (const row of [...element.rows].sort((left, right) => left.rowIndex - right.rowIndex)) {
    for (const cell of [...row.cells].sort(
      (left, right) => left.columnIndex - right.columnIndex,
    )) {
      const cellBox = boxFromNormalized(page, cell.bbox);
      page.drawRectangle({
        x: cellBox.x,
        y: cellBox.y,
        width: cellBox.width,
        height: cellBox.height,
        color: cell.isHeader ? rgb(0.945, 0.961, 0.976) : rgb(1, 1, 1),
        borderColor: rgb(0.392, 0.455, 0.545),
        borderWidth: 0.55,
      });
      const alignment: TextAlignment = cell.isHeader
        ? 'center'
        : NUMERIC_TEXT.test(cell.text)
          ? 'right'
          : 'left';
      drawTextInBox({
        page,
        text: cell.text,
        box: cellBox,
        font,
        maximumFontSize: cell.isHeader ? 8.5 : 9,
        minimumFontSize: 1.4,
        padding: Math.min(0.8, cellBox.width * 0.04),
        alignment,
        verticallyCentered: cell.isHeader,
        lineHeightMultiplier: 1.12,
      });
    }
  }
}

function drawTranslatedElement(page: PDFPage, element: PdfElement, font: PDFFont): void {
  if (element.kind === 'table') {
    drawTable(page, element, font);
    return;
  }
  if (VISUAL_KINDS.has(element.kind)) return;
  const text = element.kind === 'list' ? listTextWithMarkers(element.text) : element.text;
  drawTextInBox({
    page,
    text,
    box: boxFromNormalized(page, element.bbox),
    font,
    maximumFontSize: elementFontSize(element),
    minimumFontSize: 1.5,
    padding: 0.8,
    alignment: element.kind === 'heading' ? 'center' : 'left',
    verticallyCentered: element.kind === 'heading',
  });
}

async function resolveFontPath(): Promise<string> {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(process.cwd(), 'public', 'fonts', 'DejaVuSans.ttf'),
    path.resolve(process.cwd(), 'apps', 'web', 'public', 'fonts', 'DejaVuSans.ttf'),
    path.resolve(moduleDirectory, '../../../public/fonts/DejaVuSans.ttf'),
  ];
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Continue to the next known application layout.
    }
  }
  throw new Error('PDF translation font DejaVuSans.ttf is missing');
}

export type TranslatedPdfBytesResult = {
  bytes: Buffer;
  pageMap: SourcePageMapping[];
};

/** Build translated PDF bytes on clean pages, matching PdfLayoutCanvas. */
export async function makeTranslatedPdfBytes(
  pages: readonly PdfPageLayout[],
  sourcePdf: Buffer,
  title = 'Translated Document',
): Promise<TranslatedPdfBytesResult> {
  const source = await PDFDocument.load(sourcePdf, { updateMetadata: false });
  const highestPage = pages.reduce((maximum, page) => Math.max(maximum, page.pageNumber), 0);
  if (highestPage > source.getPageCount()) {
    throw new Error('Translated page layout references a source page that does not exist');
  }
  const output = await PDFDocument.create();
  output.registerFontkit(fontkit);
  output.setTitle(title);
  output.setSubject('Clean geometry-preserving translated text layout');
  const fontBytes = await fs.readFile(await resolveFontPath());
  const font = await output.embedFont(fontBytes, { subset: true });
  const pageMap: SourcePageMapping[] = [];

  for (const layout of [...pages].sort((left, right) => left.pageNumber - right.pageNumber)) {
    const validation = validateExtractedPage(layout, layout.pageNumber);
    if (!validation.valid) {
      throw new PdfxV2ValidationError(
        `Refusing to render unsafe page ${layout.pageNumber} geometry: ${validation.failures.join('; ')}`,
      );
    }
    const sourceSize = source.getPage(layout.pageNumber - 1).getSize();
    if (Math.abs(source.getPage(layout.pageNumber - 1).getRotation().angle % 180) === 90) {
      [sourceSize.width, sourceSize.height] = [sourceSize.height, sourceSize.width];
    }
    const canvas = pageCanvasGeometry(sourceSize.width, sourceSize.height, layout.rotation);
    const page = output.addPage([canvas.width, canvas.height]);
    page.setRotation(degrees(layout.rotation ?? 0));
    page.drawRectangle({
      x: 0,
      y: 0,
      width: canvas.width,
      height: canvas.height,
      color: rgb(1, 1, 1),
    });
    for (const line of diagramLines(layout.graphics, canvas.width, canvas.height)) {
      page.drawLine({ start: { x: line.x1, y: canvas.height - line.y1 }, end: { x: line.x2, y: canvas.height - line.y2 },
        color: rgb(0.063, 0.094, 0.153), thickness: 0.65, dashArray: line.dashed ? [3, 2] : undefined });
    }
    for (const element of [...layout.elements].sort(
      (left, right) => left.order - right.order || left.id.localeCompare(right.id),
    )) {
      drawTranslatedElement(page, element, font);
    }
    pageMap.push({
      sourcePageNumber: layout.pageNumber,
      outputPageNumbers: [output.getPageCount()],
    });
  }

  const bytes = Buffer.from(await output.save());
  return { bytes, pageMap };
}

/** Render the translated layout onto clean pages, matching PdfLayoutCanvas. */
export async function makeTranslatedPdf(
  pages: readonly PdfPageLayout[],
  sourcePdf: Buffer,
  outPath: string,
  title = 'Translated Document',
): Promise<TranslatedPdfResult> {
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  const { bytes, pageMap } = await makeTranslatedPdfBytes(pages, sourcePdf, title);
  await fs.writeFile(outPath, bytes);
  return { outputPath: outPath, pageMap };
}
