import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export type FlaggedPage = { stage: 'extraction' | 'translation'; error: string };

/**
 * Interleaves rendered translated pages with the original pages that were
 * flagged and skipped. A flagged page keeps its untranslated source content
 * under a prominent banner so a partial draft can never pass as a finished
 * translation. Page numbers are 1-based source numbers.
 */
export async function assembleDraftPdf(args: {
  renderedTranslatedPdf: Buffer;
  originalPdf: Buffer;
  translatedPageNumbers: readonly number[];
  flaggedPages: ReadonlyMap<number, FlaggedPage>;
  totalPages: number;
}): Promise<Buffer> {
  const rendered = await PDFDocument.load(args.renderedTranslatedPdf, { updateMetadata: false });
  const original = await PDFDocument.load(args.originalPdf, { updateMetadata: false });
  const output = await PDFDocument.create();
  output.setTitle('DRAFT translation — flagged pages are not translated');
  output.setSubject(`${args.flaggedPages.size} of ${args.totalPages} pages flagged for review`);
  const font = await output.embedFont(StandardFonts.HelveticaBold);
  const ranks = new Map(args.translatedPageNumbers.map((pageNumber, index) => [pageNumber, index] as const));

  for (let pageNumber = 1; pageNumber <= args.totalPages; pageNumber += 1) {
    const rank = ranks.get(pageNumber);
    if (rank !== undefined) {
      const [copied] = await output.copyPages(rendered, [rank]);
      output.addPage(copied);
      continue;
    }
    const [copied] = await output.copyPages(original, [pageNumber - 1]);
    const page = output.addPage(copied);
    const { width, height } = page.getSize();
    const stage = args.flaggedPages.get(pageNumber)?.stage;
    const label = `NOT TRANSLATED - PAGE ${pageNumber} NEEDS ${stage === 'extraction' ? 'OCR' : 'TRANSLATION'} RERUN`;
    const bannerHeight = 26;
    page.drawRectangle({ x: 0, y: height - bannerHeight, width, height: bannerHeight, color: rgb(0.82, 0.1, 0.1), opacity: 0.92 });
    const size = 11;
    const textWidth = font.widthOfTextAtSize(label, size);
    page.drawText(label, {
      x: Math.max(8, (width - textWidth) / 2),
      y: height - bannerHeight + 8,
      size,
      font,
      color: rgb(1, 1, 1),
    });
  }
  return Buffer.from(await output.save({ useObjectStreams: false }));
}
