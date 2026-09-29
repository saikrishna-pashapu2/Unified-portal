import { describe, expect, it } from 'vitest';
import {
  combineTranslation,
  harvestTranslationMemory,
  memoryEntries,
  memoryKey,
  parsePinnedTranslations,
  parseTranslationMemory,
  pinnedTranslations,
  recurringBlocks,
  SHARED_BLOCKS_PAGE_NUMBER,
  sharedBlocksLayout,
  withoutPinned,
  type TranslationMemory,
} from '../translation-memory';
import { PdfPageLayoutSchema, type PdfElement, type PdfPageLayout } from '../schemas';
import { validateTranslatedPage } from '../validation';

const HEADER = '221-сон 04.05.2026. Барқарор ривожланиш ва атроф-муҳит, ижтимоий ҳамда корпоратив бошқарув (ESG) тамойилларини жорий этиш чора-тадбирлари тўғрисида';
const HEADER_RU = '№ 221 от 04.05.2026. О мерах по внедрению принципов устойчивого развития, охраны окружающей среды, социальной ответственности и корпоративного управления (ESG)';

function element(id: string, kind: PdfElement['kind'], text: string, order = 0): PdfElement {
  return { id, kind, text, order, level: 0, translate: true, bbox: [50, 20 + order * 100, 950, 80 + order * 100], rowCount: 0, columnCount: 0, rows: [] };
}

function page(pageNumber: number, elements: PdfElement[]): PdfPageLayout {
  return { pageNumber, width: 1000, height: 1000, orientation: 'portrait', sourceLanguage: 'Uzbek', sourceScript: 'Cyrillic', warnings: [], elements };
}

const pages = [
  page(1, [element('e001', 'header', HEADER), element('e002', 'paragraph', 'Биринчи саҳифа матни 100', 1)]),
  page(2, [element('e001', 'header', HEADER.replace('корпоратив', 'ĸорпоратив')), element('e002', 'paragraph', 'Иккинчи саҳифа матни 200', 1)]),
  page(3, [element('e001', 'header', HEADER), element('e002', 'heading', 'Учинчи саҳифа сарлавҳаси', 1), element('e003', 'page_number', '3', 2)]),
];

describe('recurring block detection', () => {
  it('finds a running header across pages, tolerating an OCR homoglyph', () => {
    expect(recurringBlocks(pages)).toEqual([{ key: memoryKey(HEADER), text: HEADER }]);
  });

  it('ignores single-page, short and non-prose blocks', () => {
    const short = [page(1, [element('e001', 'header', 'Бет 1')]), page(2, [element('e001', 'header', 'Бет 1')])];
    const list = [page(1, [element('e001', 'list', '• Биринчи банд матни')]), page(2, [element('e001', 'list', '• Биринчи банд матни')])];
    expect(recurringBlocks(short)).toEqual([]);
    expect(recurringBlocks(list)).toEqual([]);
    expect(recurringBlocks([pages[0]])).toEqual([]);
  });

  it('builds a schema-valid shared page that no real page can collide with', () => {
    const shared = sharedBlocksLayout(recurringBlocks(pages), pages[0]);
    expect(PdfPageLayoutSchema.safeParse(shared).success).toBe(true);
    expect(shared.pageNumber).toBe(SHARED_BLOCKS_PAGE_NUMBER);
    expect(shared.elements.map((e) => [e.id, e.text])).toEqual([['s001', HEADER]]);
  });
});

describe('pinning memory translations on a page', () => {
  const blocks = recurringBlocks(pages);
  const memory: TranslationMemory = {
    version: 'shared-blocks-v1',
    keys: blocks.map((block) => block.key),
    entries: memoryEntries(blocks, { pageNumber: SHARED_BLOCKS_PAGE_NUMBER, warnings: [], elements: [{ id: 's001', text: HEADER_RU, cells: [] }] }),
  };

  it('pins the header, leaves the body for the model, and passes whole-page validation', () => {
    const source = pages[1];
    const pins = pinnedTranslations(source, memory);
    expect(pins).toEqual({ e001: HEADER_RU });
    const remaining = withoutPinned(source, pins);
    expect(remaining.elements.map((e) => e.id)).toEqual(['e002']);
    const combined = combineTranslation(source, pins, {
      pageNumber: 2, warnings: [], elements: [{ id: 'e002', text: 'Текст второй страницы 200', cells: [] }],
    });
    expect(combined.elements.map((e) => [e.id, e.text])).toEqual([['e001', HEADER_RU], ['e002', 'Текст второй страницы 200']]);
    expect(validateTranslatedPage(source, combined, 'Russian').failures).toEqual([]);
  });

  it('leaves an unreturned block empty so validation rejects the combination', () => {
    const source = pages[0];
    const combined = combineTranslation(source, pinnedTranslations(source, memory), null);
    expect(validateTranslatedPage(source, combined, 'Russian').valid).toBe(false);
  });

  it('harvests a reviewed page rendering only for repeated blocks still missing', () => {
    const empty: TranslationMemory = { ...memory, entries: {} };
    const changed = harvestTranslationMemory(empty, pages[0], {
      pageNumber: 1, warnings: [], elements: [{ id: 'e001', text: HEADER_RU, cells: [] }, { id: 'e002', text: 'Первая страница 100', cells: [] }],
    });
    expect(changed).toBe(true);
    expect(empty.entries).toEqual({ [memoryKey(HEADER)]: HEADER_RU });
    expect(harvestTranslationMemory(empty, pages[0], { pageNumber: 1, warnings: [], elements: [{ id: 'e001', text: 'иной вариант', cells: [] }] })).toBe(false);
    expect(empty.entries[memoryKey(HEADER)]).toBe(HEADER_RU);
  });

  it('round-trips persisted memory and pins, rejecting malformed values', () => {
    expect(parseTranslationMemory(JSON.parse(JSON.stringify(memory)))).toEqual(memory);
    expect(parseTranslationMemory({ version: 'other', keys: [], entries: {} })).toBeNull();
    expect(parsePinnedTranslations({ e001: HEADER_RU })).toEqual({ e001: HEADER_RU });
    expect(parsePinnedTranslations({ e001: '' })).toBeNull();
    expect(parsePinnedTranslations([HEADER_RU])).toBeNull();
  });
});
