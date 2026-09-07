import { z } from 'zod/v3';

// OpenAI Structured Outputs supports homogeneous array `items`, but not the
// tuple form emitted by `z.tuple()` (`items: [{...}, {...}]`). Keep the exact
// four-coordinate contract through minItems/maxItems instead.
export const BBoxSchema = z.array(z.number()).length(4);

export const PdfCellSchema = z.object({
  id: z.string(),
  rowIndex: z.number().int().nonnegative(),
  columnIndex: z.number().int().nonnegative(),
  rowSpan: z.number().int().positive(),
  columnSpan: z.number().int().positive(),
  isHeader: z.boolean(),
  // False means that this source text must be copied verbatim, never sent
  // through translation. English and already-target-language cells use this.
  translate: z.boolean(),
  text: z.string(),
  bbox: BBoxSchema,
});

export const PdfTableRowSchema = z.object({
  rowIndex: z.number().int().nonnegative(),
  cells: z.array(PdfCellSchema),
});

export const PdfElementSchema = z.object({
  id: z.string(),
  kind: z.enum([
    'heading',
    'paragraph',
    'list',
    'table',
    'header',
    'footer',
    'page_number',
    'image',
    'stamp',
    'signature',
    'suppressed_text',
    'other',
  ]),
  order: z.number().int().nonnegative(),
  level: z.number().int().nonnegative(),
  // Extraction is also responsible for language routing. Keeping this flag in
  // the stored layout makes "never translate English" deterministic in later
  // retries, rendering, and resumed jobs.
  translate: z.boolean(),
  text: z.string(),
  bbox: BBoxSchema,
  columnCount: z.number().int().nonnegative(),
  rowCount: z.number().int().nonnegative(),
  rows: z.array(PdfTableRowSchema),
});

export const PdfPageLayoutSchema = z.object({
  pageNumber: z.number().int().positive(),
  // Geometry is always expressed on this normalized square canvas. The worker
  // records the source page's physical dimensions separately for rendering.
  width: z.literal(1000),
  height: z.literal(1000),
  orientation: z.enum(['portrait', 'landscape']),
  sourceLanguage: z.string(),
  sourceScript: z.string(),
  elements: z.array(PdfElementSchema),
  warnings: z.array(z.string()),
  // Canonical upright coordinates, rotated clockwise to match the source.
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional(),
  graphics: z.array(z.object({
    kind: z.enum(['rect', 'polyline']),
    bbox: BBoxSchema,
    points: z.array(z.object({ x: z.number(), y: z.number() })),
    arrowEnd: z.boolean(),
    dashed: z.boolean(),
  })).optional(),
});

// Required on new model responses; optional only for historical v5 checkpoints.
export const PdfPageExtractionSchema = PdfPageLayoutSchema.extend({
  rotation: PdfPageLayoutSchema.shape.rotation.unwrap(),
  graphics: PdfPageLayoutSchema.shape.graphics.unwrap(),
});

export const DocumentContextSchema = z.object({
  sourceLanguage: z.string(),
  targetLanguage: z.string(),
  documentType: z.string(),
  summary: z.string(),
  preserveTerms: z.array(z.string()),
  terminology: z.array(z.object({
    source: z.string(),
    target: z.string(),
    note: z.string(),
  })),
});

export const TranslatedCellSchema = z.object({
  id: z.string(),
  text: z.string(),
});

export const TranslatedElementSchema = z.object({
  id: z.string(),
  text: z.string(),
  cells: z.array(TranslatedCellSchema),
});

export const PdfPageTranslationSchema = z.object({
  pageNumber: z.number().int().positive(),
  elements: z.array(TranslatedElementSchema),
  warnings: z.array(z.string()),
});

export const PdfPageReviewSchema = z.object({
  pageNumber: z.number().int().positive(),
  complete: z.boolean(),
  meaningPreserved: z.boolean(),
  targetLanguageSatisfied: z.boolean(),
  tableStructurePreserved: z.boolean(),
  failures: z.array(z.string()),
  warnings: z.array(z.string()),
});

export type PdfPageLayout = z.infer<typeof PdfPageLayoutSchema>;
export type StoredPdfPageLayout = PdfPageLayout & {
  // Added by the worker from the source PDF, never guessed by the model.
  // Bounding boxes remain normalized to 0..1000 on each axis.
  pageWidthPoints?: number;
  pageHeightPoints?: number;
};

export function parseStoredPdfPageLayout(value: unknown): StoredPdfPageLayout | null {
  const parsed = PdfPageLayoutSchema.safeParse(value);
  if (!parsed.success) return null;
  const stored = value && typeof value === 'object'
    ? value as { pageWidthPoints?: unknown; pageHeightPoints?: unknown }
    : {};
  const pageWidthPoints = Number(stored.pageWidthPoints);
  const pageHeightPoints = Number(stored.pageHeightPoints);
  return {
    ...parsed.data,
    ...(Number.isFinite(pageWidthPoints) && pageWidthPoints > 0 ? { pageWidthPoints } : {}),
    ...(Number.isFinite(pageHeightPoints) && pageHeightPoints > 0 ? { pageHeightPoints } : {}),
  };
}
export type PdfElement = z.infer<typeof PdfElementSchema>;
export type PdfCell = z.infer<typeof PdfCellSchema>;
export type DocumentContext = z.infer<typeof DocumentContextSchema>;
export type PdfPageTranslation = z.infer<typeof PdfPageTranslationSchema>;
export type PdfPageReview = z.infer<typeof PdfPageReviewSchema>;
