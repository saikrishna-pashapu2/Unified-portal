import { describe, expect, it, vi } from 'vitest';
import type { PdfPageLayout, PdfPageTranslation } from '../schemas';
import type { PdfxV2OpenAiRequester } from '../openai';
import { extractPageWithOpenAi, translatePageWithOpenAi } from '../openai';

function sourcePage(): PdfPageLayout {
  return {
    pageNumber: 5,
    width: 1000,
    height: 1000,
    orientation: 'portrait',
    sourceLanguage: 'Uzbek',
    sourceScript: 'Cyrillic',
    warnings: [],
    elements: [{
      id: 'e001', kind: 'paragraph', order: 0, level: 0, translate: true,
      text: 'Ушбу қарор 2026 йилда кучга киради.', bbox: [50, 50, 950, 200],
      columnCount: 0, rowCount: 0, rows: [],
    }],
  };
}

const context = {
  sourceLanguage: 'Uzbek', targetLanguage: 'Russian', documentType: 'Resolution',
  summary: 'Legal resolution', preserveTerms: [], terminology: [],
};

function provider<T>(value: T, model: string) {
  return { value, model, inputTokens: 10, outputTokens: 20, responseId: `${model}-response` };
}

function requester(overrides: Partial<PdfxV2OpenAiRequester>): PdfxV2OpenAiRequester {
  return {
    extract: vi.fn(async () => provider(sourcePage(), 'extract')),
    context: vi.fn(async () => provider(context, 'context')),
    translate: vi.fn(async () => provider({ pageNumber: 5, elements: [], warnings: [] }, 'translate')),
    validate: vi.fn(async () => provider({
      pageNumber: 5,
      complete: true,
      meaningPreserved: true,
      targetLanguageSatisfied: true,
      tableStructurePreserved: true,
      failures: [],
      warnings: [],
    }, 'review')),
    ...overrides,
  };
}

describe('PDF Translator OpenAI retry ladder', () => {
  it('recovers a retained oversized box only when every character matches the native PDF lines, with zero paid calls', async () => {
    const source = sourcePage();
    const lines = Array.from({length: 8}, (_, i) => 'Ҳужжатнинг ушбу қисмида ишларни бажариш тартиби баён этилган: ' + (i + 1));
    Object.assign(source.elements[0], { text: lines.join('\n'), bbox: [1,1,999,999] });
    const mock = requester({ nativeGeometry: async () => ({
      texts: lines.map((text, i) => ({ text, bbox: [30, 60 + i * 40, 800, 80 + i * 40] as [number, number, number, number] })),
      rules: [], images: [],
    }) });
    const retry = () => extractPageWithOpenAi(Buffer.from('%PDF'), 5, 'Russian', mock, { resume: {
      version: 'v5-local-repair-1', terminal: true, attempts: 3, failures: ['oversized box'], candidate: source,
    } });
    const result = await retry();
    expect(result.layout.elements.map(el => el.text).join('')).toBe(source.elements[0].text);
    expect(result.layout.elements).toHaveLength(lines.length);
    source.elements[0].text += ' Не из источника.';
    await expect(retry()).rejects.toThrow();
    expect(mock.extract).not.toHaveBeenCalled();
  });

  it('retains the raw failed candidate if native placement introduces an unrelated overlap', async () => {
    const source = sourcePage();
    source.pageNumber = 6; // Independent failure that neither proposal repairs.
    source.elements[0].bbox = [20,20,200,46];
    source.elements.push({ ...source.elements[0], id: 'e002', order: 1, text: 'Қарор имзоланди.', bbox: [20,47,200,75] });
    const attempt = extractPageWithOpenAi(Buffer.from('%PDF'), 5, 'Russian', requester({
      extract: async () => provider(source, 'model'),
      nativeGeometry: async () => ({ texts: [
        { text: source.elements[0].text, bbox: [25,33,190,60] },
        { text: source.elements[1].text, bbox: [25,40,190,70] },
      ], images: [], rules: [] }),
    }));
    await expect(attempt).rejects.toMatchObject({ recovery: { candidate: {
      elements: [{ bbox: [20,20,200,46] }, { bbox: [20,47,200,75] }],
    } } });
  });

  it('uses Luna for every extraction attempt, including escalated retries', async () => {
    const extract = vi.fn()
      .mockResolvedValueOnce(provider({ ...sourcePage(), pageNumber: 3 }, 'primary'))
      .mockResolvedValueOnce(provider({ ...sourcePage(), pageNumber: 4 }, 'primary'))
      .mockResolvedValueOnce(provider(sourcePage(), 'primary'));

    const result = await extractPageWithOpenAi(
      Buffer.from('%PDF'),
      5,
      'Russian',
      requester({ extract }),
    );

    expect(result.attempts).toBe(3);
    expect(extract.mock.calls.map(([request]) => request.model)).toEqual([
      'gpt-5.6-luna',
      'gpt-5.6-luna',
      'gpt-5.6-luna',
    ]);
  });

  it('alternates the PDF text layer with a rasterized scan fallback', async () => {
    const extract = vi.fn()
      .mockRejectedValueOnce(new Error('Request timed out.'))
      .mockResolvedValueOnce(provider(sourcePage(), 'gpt-5.6-luna'));

    const result = await extractPageWithOpenAi(
      Buffer.from('%PDF'),
      5,
      'Russian',
      requester({ extract }),
    );

    expect(result.attempts).toBe(2);
    expect(extract.mock.calls[0][0].inputMode).toBe('pdf');
    expect(extract.mock.calls[1][0].inputMode).toBe('image');
  });

  it('re-prompts after an incomplete extraction and accepts the corrected page', async () => {
    const extract = vi.fn()
      .mockResolvedValueOnce(provider({ ...sourcePage(), pageNumber: 4 }, 'primary'))
      .mockResolvedValueOnce(provider(sourcePage(), 'primary'));
    const result = await extractPageWithOpenAi(
      Buffer.from('%PDF'),
      5,
      'Russian',
      requester({ extract }),
    );
    expect(result.attempts).toBe(2);
    expect(extract).toHaveBeenCalledTimes(2);
    expect(extract.mock.calls[0][0].targetLanguage).toBe('Russian');
    expect(extract.mock.calls[1][0].validationFailure).toMatch(/page 4/i);
  });

  it('does not repair a raw extraction that already validates', async () => {
    const candidate = sourcePage();
    const extract = vi.fn().mockResolvedValue(provider(candidate, 'primary'));
    const nativeGeometry = vi.fn(async () => ({
      canReconstruct: true,
      images: [],
      rules: [],
      // This is a plausible but deliberately different native box. A valid
      // raw model layout must remain authoritative until a repair is needed.
      texts: [{ text: candidate.elements[0].text, bbox: [120, 80, 840, 180] as [number, number, number, number] }],
    }));

    const result = await extractPageWithOpenAi(
      Buffer.from('%PDF'),
      5,
      'Russian',
      requester({ extract, nativeGeometry }),
    );

    expect(result.layout.elements[0].bbox).toEqual(candidate.elements[0].bbox);
    expect(extract).toHaveBeenCalledTimes(1);
  });

  it('retries a page that remains in Uzbek instead of accepting it as Russian', async () => {
    const source = sourcePage();
    const untranslated: PdfPageTranslation = {
      pageNumber: 5,
      warnings: [],
      elements: [{ id: 'e001', text: source.elements[0].text, cells: [] }],
    };
    const translated: PdfPageTranslation = {
      pageNumber: 5,
      warnings: [],
      elements: [{ id: 'e001', text: 'Настоящее постановление вступает в силу в 2026 году.', cells: [] }],
    };
    const translate = vi.fn()
      .mockResolvedValueOnce(provider(untranslated, 'primary'))
      .mockResolvedValueOnce(provider(translated, 'primary'));
    const result = await translatePageWithOpenAi(source, context, 'Russian', requester({ translate }));
    expect(result.attempts).toBe(2);
    expect(result.translation.elements[0].text).toContain('постановление');
    expect(translate.mock.calls[1][0].validationFailure).toBeTruthy();
    expect(translate.mock.calls[1][0].previousTranslation).toEqual(untranslated);
  });

  it('recovers a repeatedly unchanged page by translating its elements separately', async () => {
    const source = sourcePage();
    source.elements.push({
      id: 'e002', kind: 'paragraph', order: 1, level: 0, translate: true,
      text: 'Ходимлар ушбу қарор билан таништирилсин.',
      bbox: [50, 220, 950, 360], columnCount: 0, rowCount: 0, rows: [],
    });
    const translate = vi.fn(async (args: { source: PdfPageLayout }) => {
      const fullPage = args.source.elements.length > 1;
      return provider({
        pageNumber: 5,
        warnings: [],
        elements: args.source.elements.map((element) => ({
          id: element.id,
          text: fullPage
            ? element.text
            : element.id === 'e001'
              ? 'Настоящее постановление вступает в силу в 2026 году.'
              : 'Ознакомить работников с настоящим постановлением.',
          cells: [],
        })),
      }, 'gpt-5.6-luna');
    });

    const result = await translatePageWithOpenAi(
      source,
      context,
      'Russian',
      requester({ translate }),
    );

    expect(result.translation.elements.map((element) => element.text)).toEqual([
      'Настоящее постановление вступает в силу в 2026 году.',
      'Ознакомить работников с настоящим постановлением.',
    ]);
    expect(result.validation.warnings.join(' ')).toMatch(/fragments/i);
    expect(translate).toHaveBeenCalledTimes(4);
  });

  it('stops after one permanent provider error instead of multiplying calls', async () => {
    const failure = Object.assign(new Error('Model access denied'), { status: 403 });
    const extract = vi.fn().mockRejectedValue(failure);
    await expect(extractPageWithOpenAi(
      Buffer.from('%PDF'),
      5,
      'Russian',
      requester({ extract }),
    ))
      .rejects.toThrow(/could not extract/i);
    expect(extract).toHaveBeenCalledTimes(1);
  });

  it('does not call translation or review for an English-only page', async () => {
    const source = sourcePage();
    source.sourceLanguage = 'English';
    source.sourceScript = 'Latin';
    source.elements[0] = {
      ...source.elements[0],
      kind: 'paragraph',
      translate: false,
      text: 'This English policy text must remain exactly unchanged.',
    };
    const translate = vi.fn();
    const validate = vi.fn();

    const result = await translatePageWithOpenAi(
      source,
      context,
      'Russian',
      requester({ translate, validate }),
    );

    expect(result.translation.elements).toEqual([]);
    expect(result.model).toBe('gpt-5.6-luna');
    expect(result.attempts).toBe(0);
    expect(translate).not.toHaveBeenCalled();
    expect(validate).not.toHaveBeenCalled();
  });

  it('retries when the independent semantic reviewer rejects a fluent but incorrect page', async () => {
    const source = sourcePage();
    const first = {
      pageNumber: 5,
      warnings: [],
      elements: [{ id: 'e001', text: 'Постановление отменено в 2026 году.', cells: [] }],
    };
    const corrected = {
      pageNumber: 5,
      warnings: [],
      elements: [{ id: 'e001', text: 'Настоящее постановление вступает в силу в 2026 году.', cells: [] }],
    };
    const translate = vi.fn()
      .mockResolvedValueOnce(provider(first, 'primary'))
      .mockResolvedValueOnce(provider(corrected, 'primary'));
    const validate = vi.fn()
      .mockResolvedValueOnce(provider({
        pageNumber: 5, complete: true, meaningPreserved: false,
        targetLanguageSatisfied: true, tableStructurePreserved: true,
        failures: ['The legal effect was reversed.'], warnings: [],
      }, 'review'))
      .mockResolvedValueOnce(provider({
        pageNumber: 5, complete: true, meaningPreserved: true,
        targetLanguageSatisfied: true, tableStructurePreserved: true,
        failures: [], warnings: [],
      }, 'review'));
    const result = await translatePageWithOpenAi(
      source, context, 'Russian', requester({ translate, validate }),
    );
    expect(result.attempts).toBe(2);
    expect(translate.mock.calls[1][0].validationFailure).toMatch(/legal effect was reversed/i);
    expect(validate).toHaveBeenCalledTimes(2);
  });
});
