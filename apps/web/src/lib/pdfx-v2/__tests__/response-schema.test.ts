import { describe, expect, it } from 'vitest';
import { zodTextFormat } from 'openai/helpers/zod';
import {
  DocumentContextSchema,
  PdfPageExtractionSchema as PdfPageLayoutSchema,
  PdfPageReviewSchema,
  PdfPageTranslationSchema,
} from '../schemas';

function arrayValuedItems(value: unknown, path = '$'): string[] {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => arrayValuedItems(item, `${path}[${index}]`));
  }
  const record = value as Record<string, unknown>;
  const failures = Array.isArray(record.items) ? [`${path}.items`] : [];
  return failures.concat(
    Object.entries(record).flatMap(([key, child]) =>
      arrayValuedItems(child, `${path}.${key}`),
    ),
  );
}

describe('PDF Translator OpenAI response schemas', () => {
  it('uses only homogeneous array items, never unsupported JSON Schema tuples', () => {
    const formats = [
      zodTextFormat(PdfPageLayoutSchema, 'pdfx_v2_page_layout'),
      zodTextFormat(DocumentContextSchema, 'pdfx_v2_document_context'),
      zodTextFormat(PdfPageTranslationSchema, 'pdfx_v2_page_translation'),
      zodTextFormat(PdfPageReviewSchema, 'pdfx_v2_page_review'),
    ];
    for (const format of formats) {
      expect(arrayValuedItems(format.schema)).toEqual([]);
    }
  });

  it('emits bounding boxes as exactly four homogeneous numbers', () => {
    const format = zodTextFormat(PdfPageLayoutSchema, 'pdfx_v2_page_layout');
    const schema = format.schema as Record<string, any>;
    const resolveRef = (value: Record<string, any>) => {
      if (typeof value.$ref !== 'string' || !value.$ref.startsWith('#/')) return value;
      return value.$ref.slice(2).split('/').reduce(
        (current: Record<string, any>, segment: string) => current[segment],
        schema,
      );
    };
    const elementBBox = resolveRef(schema.properties.elements.items.properties.bbox);
    const cellBBox = resolveRef(schema.properties.elements.items.properties.rows.items
      .properties.cells.items.properties.bbox);
    for (const bbox of [elementBBox, cellBBox]) {
      expect(bbox).toMatchObject({
        type: 'array',
        minItems: 4,
        maxItems: 4,
      });
      expect(resolveRef(bbox.items)).toEqual({ type: 'number' });
    }
  });
});
