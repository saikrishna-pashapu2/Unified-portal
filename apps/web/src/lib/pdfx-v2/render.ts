import { makeTranslatedPdf } from './makeTranslatedPdf';
import type { PdfPageLayout } from './schemas';

/** Render the same clean, geometry-preserving layout shown in the UI. */
export async function renderPdfxV2Document(
  translatedPages: readonly PdfPageLayout[],
  outputPath: string,
  sourcePdf: Buffer,
) {
  return makeTranslatedPdf(
    translatedPages,
    sourcePdf,
    outputPath,
    'PDF Translator',
  );
}
