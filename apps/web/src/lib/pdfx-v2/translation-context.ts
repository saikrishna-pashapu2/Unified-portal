import type { PdfPageLayout, PdfPageTranslation } from './schemas';
import { isTranslatableElement } from './serialize';

export const MAX_TRANSLATION_CONTEXT_CHARACTERS = 8_000;
const MAX_CONTEXT_BLOCKS = 16;

export type TranslationReadOnlyContext = {
  pageNumber: number;
  readOnly: true;
  omittedTextBlocks: number;
  blocks: Array<{ id: string; kind: string; order: number; sourceText: string; retainedTranslation?: string }>;
};

/** Neighbors explain fragments without granting permission to replace them.
 * Whole blocks only: never send a clipped sentence or duplicate a huge table. */
export function translationReadOnlyContext(
  fullPage: PdfPageLayout,
  requestPage: PdfPageLayout,
  retained?: PdfPageTranslation,
): TranslationReadOnlyContext | undefined {
  if (fullPage.pageNumber !== requestPage.pageNumber) return undefined;
  const selected = new Set(requestPage.elements.filter(isTranslatableElement).map(e => e.id));
  const elements = [...fullPage.elements].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const distances = elements.map(() => Infinity);
  let nearest = -Infinity;
  for (let i = 0; i < elements.length; i += 1) {
    if (selected.has(elements[i].id)) nearest = i;
    distances[i] = i - nearest;
  }
  nearest = Infinity;
  for (let i = elements.length - 1; i >= 0; i -= 1) {
    if (selected.has(elements[i].id)) nearest = i;
    distances[i] = Math.min(distances[i], nearest - i);
  }
  const translations = new Map(retained?.pageNumber === fullPage.pageNumber ? retained.elements.map(e => [e.id, e.text]) : []);
  const candidates = elements.map((element, index) => ({ element, index }))
    .filter(({ element }) => !selected.has(element.id) && element.kind !== 'table' && element.text.trim())
    .sort((a, b) => distances[a.index] - distances[b.index] || a.index - b.index);
  const result: TranslationReadOnlyContext = { pageNumber: fullPage.pageNumber, readOnly: true, omittedTextBlocks: candidates.length, blocks: [] };
  for (const { element } of candidates) {
    if (result.blocks.length >= MAX_CONTEXT_BLOCKS) break;
    const text = translations.get(element.id);
    const block = { id: element.id, kind: element.kind, order: element.order, sourceText: element.text,
      ...(text?.trim() ? { retainedTranslation: text } : {}),
    };
    const proposed = { ...result, blocks: [...result.blocks, block], omittedTextBlocks: result.omittedTextBlocks - 1 };
    if (JSON.stringify(proposed).length > MAX_TRANSLATION_CONTEXT_CHARACTERS) continue;
    result.blocks.push(block);
    result.omittedTextBlocks -= 1;
  }
  result.blocks.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  return result.blocks.length ? result : undefined;
}
