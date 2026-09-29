import { isTranslatableElement } from './serialize';
import type { PdfElement, PdfPageLayout, PdfPageTranslation, StoredPdfPageLayout } from './schemas';

/**
 * Running headers, footers and repeated headings print the same source text on
 * many pages. Translated page by page they came out differently each time and
 * each page spent its request budget re-litigating the same wording. They are
 * translated once for the document (with the normal translate + review cycle)
 * and the accepted rendering is pinned on every page.
 */

/** The shared pass is budgeted and checkpointed like a page but never stored,
 * rendered or counted as one; no real document reaches this page number. */
export const SHARED_BLOCKS_PAGE_NUMBER = 1_000_000;

const MIN_BLOCK_CHARACTERS = 12;
const MAX_SHARED_BLOCKS = 40;
const MAX_SHARED_CHARACTERS = 8_000;
// Lists keep per-item markers the page validator checks; tables are cell grids.
const ELIGIBLE_KINDS = new Set<PdfElement['kind']>(['header', 'footer', 'heading', 'paragraph']);

export type TranslationMemory = {
  version: 'shared-blocks-v1';
  /** Normalized source text of every block that repeats across pages. */
  keys: string[];
  /** Accepted target text by normalized source text. */
  entries: Record<string, string>;
  failure?: string;
};

export type PinnedTranslations = Record<string, string>;

export function memoryKey(text: string): string {
  // OCR occasionally reads Cyrillic к as the Latin kra (ĸ) on some pages only.
  // Case is kept: an ALL-CAPS heading and a sentence-case copy render differently.
  return text.normalize('NFKC').replace(/ĸ/g, 'к').replace(/\s+/g, ' ').trim();
}

function eligible(element: PdfElement): boolean {
  if (!ELIGIBLE_KINDS.has(element.kind) || !isTranslatableElement(element)) return false;
  const text = element.text.trim();
  return text.length >= MIN_BLOCK_CHARACTERS &&
    (text.match(/[A-Za-zÀ-ɏЀ-ӿ]/g)?.length ?? 0) >= 3;
}

export function recurringBlocks(layouts: readonly PdfPageLayout[]): { key: string; text: string }[] {
  const found = new Map<string, { text: string; pages: Set<number> }>();
  for (const layout of layouts) {
    for (const element of layout.elements) {
      if (!eligible(element)) continue;
      const key = memoryKey(element.text);
      const entry = found.get(key) ?? { text: element.text.trim(), pages: new Set<number>() };
      entry.pages.add(layout.pageNumber);
      found.set(key, entry);
    }
  }
  const blocks: { key: string; text: string }[] = [];
  let characters = 0;
  for (const [key, entry] of Array.from(found.entries())) {
    if (entry.pages.size < 2 || blocks.length >= MAX_SHARED_BLOCKS) continue;
    if (characters + entry.text.length > MAX_SHARED_CHARACTERS) continue;
    characters += entry.text.length;
    blocks.push({ key, text: entry.text });
  }
  return blocks;
}

/** One stacked paragraph per repeated block, in first-seen order. */
export function sharedBlocksLayout(
  blocks: readonly { text: string }[],
  template: PdfPageLayout,
): StoredPdfPageLayout {
  return {
    pageNumber: SHARED_BLOCKS_PAGE_NUMBER,
    width: 1000,
    height: 1000,
    orientation: 'portrait',
    sourceLanguage: template.sourceLanguage,
    sourceScript: template.sourceScript,
    warnings: [],
    elements: blocks.map((block, index) => ({
      id: `s${String(index + 1).padStart(3, '0')}`,
      kind: 'paragraph',
      order: index,
      level: 0,
      translate: true,
      text: block.text,
      bbox: [20, 20 + index * 24, 980, 40 + index * 24],
      columnCount: 0,
      rowCount: 0,
      rows: [],
    })),
  };
}

export function memoryEntries(
  blocks: readonly { key: string }[],
  translation: PdfPageTranslation,
): Record<string, string> {
  const byId = new Map(translation.elements.map((element) => [element.id, element.text.trim()]));
  const entries: Record<string, string> = {};
  blocks.forEach((block, index) => {
    const text = byId.get(`s${String(index + 1).padStart(3, '0')}`);
    if (text) entries[block.key] = text;
  });
  return entries;
}

export function parseTranslationMemory(value: unknown): TranslationMemory | null {
  if (!value || typeof value !== 'object') return null;
  const memory = value as Partial<TranslationMemory>;
  if (memory.version !== 'shared-blocks-v1' || !Array.isArray(memory.keys) ||
      !memory.entries || typeof memory.entries !== 'object') return null;
  const entries: Record<string, string> = {};
  for (const [key, text] of Object.entries(memory.entries)) if (typeof text === 'string' && text.trim()) entries[key] = text;
  return {
    version: 'shared-blocks-v1',
    keys: memory.keys.filter((key): key is string => typeof key === 'string'),
    entries,
    ...(typeof memory.failure === 'string' ? { failure: memory.failure } : {}),
  };
}

export function parsePinnedTranslations(value: unknown): PinnedTranslations | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const pins: PinnedTranslations = {};
  for (const [id, text] of Object.entries(value)) {
    if (typeof text !== 'string' || !text.trim()) return null;
    pins[id] = text;
  }
  return Object.keys(pins).length ? pins : null;
}

export function pinnedTranslations(source: PdfPageLayout, memory: TranslationMemory | null): PinnedTranslations {
  const pins: PinnedTranslations = {};
  if (!memory) return pins;
  for (const element of source.elements) {
    if (!eligible(element)) continue;
    const text = memory.entries[memoryKey(element.text)];
    if (text) pins[element.id] = text;
  }
  return pins;
}

export function withoutPinned<T extends PdfPageLayout>(source: T, pins: PinnedTranslations): T {
  return { ...source, elements: source.elements.filter((element) => !(element.id in pins)) };
}

/** Full-page translation in the validator's element order. A block the model
 * did not return stays empty so page validation rejects it. */
export function combineTranslation(
  source: PdfPageLayout,
  pins: PinnedTranslations,
  partial: PdfPageTranslation | null,
): PdfPageTranslation {
  const translated = new Map((partial?.elements ?? []).map((element) => [element.id, element]));
  return {
    pageNumber: source.pageNumber,
    warnings: partial?.warnings ?? [],
    elements: source.elements.filter(isTranslatableElement).map((element) =>
      pins[element.id] !== undefined
        ? { id: element.id, text: pins[element.id], cells: [] }
        : translated.get(element.id) ?? { id: element.id, text: '', cells: [] }),
  };
}

/** Adopt a reviewed page's rendering of repeated blocks the shared pass could
 * not provide, so later pages still reuse one consistent translation. */
export function harvestTranslationMemory(
  memory: TranslationMemory,
  source: PdfPageLayout,
  translation: PdfPageTranslation,
): boolean {
  const keys = new Set(memory.keys);
  const translated = new Map(translation.elements.map((element) => [element.id, element.text.trim()]));
  let changed = false;
  for (const element of source.elements) {
    if (!eligible(element)) continue;
    const key = memoryKey(element.text);
    if (!keys.has(key) || memory.entries[key]) continue;
    const text = translated.get(element.id);
    if (!text) continue;
    memory.entries[key] = text;
    changed = true;
  }
  return changed;
}
