import { describe, expect, it, vi } from 'vitest';
import { translatePageWithOpenAi, type PdfxV2OpenAiRequester, type TranslationRecovery } from '../openai';
import { budgetedRequester, emptyRequestLedger, PdfxRequestBudgetError, isPdfxTerminalError } from '../request-budget';
import type { PdfPageLayout } from '../schemas';
import { parsePdfStructuredResponse } from '../structured-response';
import { PdfPageTranslationSchema } from '../schemas';

const context = { sourceLanguage: 'Uzbek', targetLanguage: 'Russian', documentType: 'Policy', summary: 'Policy', preserveTerms: [], terminology: [] };
const uzbek = 'Ходимлар ушбу қарор билан таништирилсин.';
const russian = 'Ознакомить работников с настоящим постановлением.';
const provider = <T>(value: T) => ({ value, model: 'gpt-5.6-luna', responseId: 'mock', inputTokens: 100, outputTokens: 50 });
function sourcePage(): PdfPageLayout {
  return {
    pageNumber: 9, width: 1000, height: 1000, orientation: 'portrait', sourceLanguage: 'Uzbek', sourceScript: 'Cyrillic', warnings: [],
    elements: [
      { id: 'table', kind: 'table', order: 0, level: 0, translate: true, text: '', bbox: [0, 0, 1000, 300], rowCount: 12, columnCount: 7,
        rows: Array.from({ length: 12 }, (_, rowIndex) => ({ rowIndex, cells: Array.from({ length: 7 }, (_, columnIndex) => {
          const index = rowIndex * 7 + columnIndex;
          return { id: `cell-${index}`, rowIndex, columnIndex, rowSpan: 1, columnSpan: 1, isHeader: rowIndex === 0,
            translate: index < 19, text: index < 19 ? uzbek : String(index), bbox: [0, 0, 100, 100] as [number, number, number, number] };
        }) })) },
      ...Array.from({ length: 7 }, (_, index) => ({ id: `e${index}`, kind: 'paragraph' as const, order: index + 1, level: 0, translate: true,
        text: uzbek, bbox: [0, 400 + index * 60, 1000, 450 + index * 60] as [number, number, number, number], rowCount: 0, columnCount: 0, rows: [] })),
    ],
  };
}
function fakeRequester() {
  const translate = vi.fn(async ({ source }: Parameters<PdfxV2OpenAiRequester['translate']>[0]) => provider({
    pageNumber: source.pageNumber, warnings: [] as string[], elements: source.elements.filter(e => e.translate).map(e => ({
      id: e.id, text: e.text ? russian : '', cells: e.rows.flatMap(row => row.cells).map(c => ({ id: c.id, text: c.translate ? russian : c.text })),
    })),
  }));
  const validate = vi.fn(async ({ source }: Parameters<PdfxV2OpenAiRequester['validate']>[0]) => provider({
    pageNumber: source.pageNumber, complete: true, meaningPreserved: true, targetLanguageSatisfied: true,
    tableStructurePreserved: true, failures: [] as string[], warnings: [],
  }));
  const requester: PdfxV2OpenAiRequester = { extract: vi.fn(), context: vi.fn(), translate, validate };
  return { requester, translate, validate };
}
function rejectWholePageTwice(validate: ReturnType<typeof fakeRequester>['validate']) {
  const original = validate.getMockImplementation()!;
  let wholeReviews = 0;
  validate.mockImplementation(async args => {
    const result = await original(args);
    if (args.source.elements.length === 8 && wholeReviews++ < 2) {
      result.value.meaningPreserved = false;
      result.value.failures = ['Correct the legal meaning in the table.'];
    }
    return result;
  });
}

describe('bounded, durable PDF translation recovery', () => {
  it('finishes an 84-cell table and seven text blocks inside the existing 12-request cap', async () => {
    const fake = fakeRequester();
    rejectWholePageTwice(fake.validate);
    const ledger = emptyRequestLedger();
    let saved: TranslationRecovery | undefined;
    const result = await translatePageWithOpenAi(sourcePage(), context, 'Russian', budgetedRequester(fake.requester, ledger, async () => {}), {
      save: async state => { saved = structuredClone(state); },
    });
    expect(ledger.counts['translate:9']).toBe(8); // 2 whole pairs + 3 locally checked drafts + final review
    expect(fake.translate.mock.calls.map(([args]) => args.source.elements.length)).toEqual([8, 8, 1, 4, 3]);
    for (const [args] of fake.translate.mock.calls.slice(2)) {
      expect(args.previousTranslation?.elements.map(e => e.id)).toEqual(args.source.elements.map(e => e.id));
      expect(args.previousTranslation?.elements.every(e => !e.text || e.text === russian)).toBe(true);
      expect(args.validationFailure).toContain('Correct the legal meaning');
    }
    expect(result.translation.elements).toHaveLength(8);
    expect(result.translation.elements[0].cells).toHaveLength(84);
    expect(result.translation.elements[0].cells[83].text).toBe('83');
    expect(result.validation.valid).toBe(true);
    expect(saved?.version).toBe('page-translation-v1');
    expect(JSON.stringify(saved)).toContain('Correct the legal meaning');
    expect(fake.translate.mock.calls.every(([args]) => args.model === 'gpt-5.6-luna')).toBe(true);
  });

  it('reuses locally checked fragments after interruption without resetting the ledger', async () => {
    const fake = fakeRequester();
    rejectWholePageTwice(fake.validate);
    const ledger = emptyRequestLedger();
    let saved: TranslationRecovery | undefined;
    const interruption = Object.assign(new Error('lease changed'), { name: 'JobLeaseLostError' });
    await expect(translatePageWithOpenAi(sourcePage(), context, 'Russian', budgetedRequester(fake.requester, ledger, async () => {}), {
      save: async state => {
        saved = structuredClone(state);
        if (state.version === 'page-translation-v1' && state.passes['fragment:0']?.localDraft) throw interruption;
      },
    })).rejects.toBe(interruption);
    expect(ledger.counts['translate:9']).toBe(5);
    const result = await translatePageWithOpenAi(sourcePage(), context, 'Russian', budgetedRequester(fake.requester, ledger, async () => {}), {
      resume: saved, save: async state => { saved = structuredClone(state); },
    });
    expect(result.validation.valid).toBe(true);
    expect(ledger.counts['translate:9']).toBe(8);
    expect(fake.translate.mock.calls.filter(([args]) => args.source.elements[0]?.id === 'table' && args.source.elements.length === 1)).toHaveLength(1);
  });

  it('reviews a retained draft after a worker interruption without retranslating it', async () => {
    const fake = fakeRequester();
    const ledger = emptyRequestLedger();
    let saved: TranslationRecovery | undefined;
    const interruption = Object.assign(new Error('lease changed'), { name: 'JobLeaseLostError' });
    await expect(translatePageWithOpenAi(sourcePage(), context, 'Russian', budgetedRequester(fake.requester, ledger, async () => {}), {
      save: async state => {
        saved = structuredClone(state);
        if (state.version === 'page-translation-v1' && state.passes.whole?.pendingReview) throw interruption;
      },
    })).rejects.toBe(interruption);
    const result = await translatePageWithOpenAi(sourcePage(), context, 'Russian', budgetedRequester(fake.requester, ledger, async () => {}), { resume: saved });
    expect(result.validation.valid).toBe(true);
    expect(fake.translate).toHaveBeenCalledTimes(1);
    expect(fake.validate).toHaveBeenCalledTimes(1);
    expect(ledger.counts['translate:9']).toBe(2);
  });

  it('retries a review transport error using the same translation', async () => {
    const fake = fakeRequester();
    fake.validate.mockRejectedValueOnce(new SyntaxError('Unexpected end of JSON input'));
    const result = await translatePageWithOpenAi(sourcePage(), context, 'Russian', fake.requester);
    expect(result.validation.valid).toBe(true);
    expect(fake.translate).toHaveBeenCalledTimes(1);
    expect(fake.validate).toHaveBeenCalledTimes(2);
  });

  it('does not buy another translation when both reviews fail to return usable output', async () => {
    const fake = fakeRequester();
    fake.validate.mockRejectedValue(new SyntaxError('Unexpected end of JSON input'));
    let saved: TranslationRecovery | undefined;
    const run = () => translatePageWithOpenAi(sourcePage(), context, 'Russian', fake.requester, {
      resume: saved, save: async state => { saved = structuredClone(state); },
    });
    await expect(run()).rejects.toSatisfy(isPdfxTerminalError);
    await expect(run()).rejects.toSatisfy(isPdfxTerminalError);
    expect(fake.translate).toHaveBeenCalledTimes(1);
    expect(fake.validate).toHaveBeenCalledTimes(2);
  });

  it('bubbles budget stops directly without attempting fragments or a final full-page replay', async () => {
    const fake = fakeRequester();
    const stopped = new PdfxRequestBudgetError('page allowance used');
    fake.translate.mockRejectedValue(stopped);
    await expect(translatePageWithOpenAi(sourcePage(), context, 'Russian', fake.requester)).rejects.toBe(stopped);
    expect(fake.translate).toHaveBeenCalledTimes(1);
    expect(fake.validate).not.toHaveBeenCalled();
  });

  it('does not reuse a completed checkpoint for changed source text', async () => {
    const fake = fakeRequester();
    let saved: TranslationRecovery | undefined;
    await translatePageWithOpenAi(sourcePage(), context, 'Russian', fake.requester, { save: async state => { saved = structuredClone(state); } });
    const changed = sourcePage();
    changed.elements[1].text += ' Ходимлар.';
    await expect(translatePageWithOpenAi(changed, context, 'Russian', fake.requester, { resume: saved })).rejects.toThrow(/different source\/context/);
    expect(fake.translate).toHaveBeenCalledTimes(1);
  });

  it('rejects a malformed matching-source checkpoint before further spending', async () => {
    const fake = fakeRequester();
    let saved: TranslationRecovery | undefined;
    await translatePageWithOpenAi(sourcePage(), context, 'Russian', fake.requester, { save: async state => { saved = structuredClone(state); } });
    if (saved?.version !== 'page-translation-v1') throw new Error('Expected page recovery');
    const malformed = { ...saved, passes: { whole: { attempts: 'not-a-number' } } };
    await expect(translatePageWithOpenAi(sourcePage(), context, 'Russian', fake.requester, { resume: malformed })).rejects.toThrow(/recovery.*invalid/);
    expect(fake.translate).toHaveBeenCalledTimes(1);
  });

  it('rechecks retained translations against source numbers before accepting them', async () => {
    const fake = fakeRequester();
    let saved: TranslationRecovery | undefined;
    await translatePageWithOpenAi(sourcePage(), context, 'Russian', fake.requester, { save: async state => { saved = structuredClone(state); } });
    if (saved?.version !== 'page-translation-v1') throw new Error('Expected page recovery');
    saved.passes.whole.accepted!.translation.elements[0].cells[83].text = '999';
    await expect(translatePageWithOpenAi(sourcePage(), context, 'Russian', fake.requester, { resume: saved })).rejects.toThrow(/checkpoint.*failed validation/);
    expect(fake.translate).toHaveBeenCalledTimes(1);
  });

  it('does not regenerate a completed recovery when all 12 request slots are used', async () => {
    const fake = fakeRequester();
    rejectWholePageTwice(fake.validate);
    const ledger = emptyRequestLedger();
    let saved: TranslationRecovery | undefined;
    await translatePageWithOpenAi(sourcePage(), context, 'Russian', budgetedRequester(fake.requester, ledger, async () => {}), { save: async state => { saved = structuredClone(state); } });
    ledger.counts['translate:9'] = 12;
    const calls = fake.translate.mock.calls.length + fake.validate.mock.calls.length;
    const result = await translatePageWithOpenAi(sourcePage(), context, 'Russian', budgetedRequester(fake.requester, ledger, async () => {}), { resume: saved });
    expect(result.validation.valid).toBe(true);
    expect(fake.translate.mock.calls.length + fake.validate.mock.calls.length).toBe(calls);
  });

  it('stops an assembled semantic rejection before sending an unreviewable corrective draft', async () => {
    const fake = fakeRequester();
    const original = fake.validate.getMockImplementation()!;
    fake.validate.mockImplementation(async args => {
      const result = await original(args);
      if (args.source.elements.length === 8) {
        result.value.meaningPreserved = false;
        result.value.failures = ['The assembled legal meaning is incorrect.'];
      }
      return result;
    });
    const ledger = emptyRequestLedger();
    let saved: TranslationRecovery | undefined;
    const run = () => translatePageWithOpenAi(sourcePage(), context, 'Russian', budgetedRequester(fake.requester, ledger, async () => {}), {
      resume: saved, save: async state => { saved = structuredClone(state); },
    });
    ledger.counts['translate:9'] = 3; // prior attempts leave no room for a final corrective pair
    await expect(run()).rejects.toThrow(/only 1 request/);
    const calls = fake.translate.mock.calls.length + fake.validate.mock.calls.length;
    await expect(run()).rejects.toThrow(/only 1 remain/);
    expect(fake.translate.mock.calls.length + fake.validate.mock.calls.length).toBe(calls);
    expect(ledger.counts['translate:9']).toBe(11);
    expect(JSON.stringify(saved)).toContain('assembled legal meaning is incorrect');
  });

  it('uses one reviewed final correction when the remaining page allowance covers it', async () => {
    const fake = fakeRequester();
    const source = sourcePage();
    source.elements = source.elements.slice(0, 5); // table + four prose blocks => two fragments
    const original = fake.validate.getMockImplementation()!;
    let fullReviews = 0;
    fake.validate.mockImplementation(async args => {
      const result = await original(args);
      if (args.source.elements.length === 5 && fullReviews++ < 3) {
        result.value.meaningPreserved = false;
        result.value.failures = ['Correct the connection between the table and the prose.'];
      }
      return result;
    });
    const ledger = emptyRequestLedger();
    const result = await translatePageWithOpenAi(source, context, 'Russian', budgetedRequester(fake.requester, ledger, async () => {}));
    expect(result.validation.valid).toBe(true);
    expect(ledger.counts['translate:9']).toBe(9);
    expect(fake.translate.mock.calls.at(-1)?.[0].previousTranslation).toBeDefined();
    expect(fake.translate.mock.calls.at(-1)?.[0].validationFailure).toContain('connection between the table and the prose');
    expect(fake.validate).toHaveBeenCalledTimes(4);
  });

  it('does not replay paid work when JSONB changes object key order on restart', async () => {
    const fake = fakeRequester();
    let saved: TranslationRecovery | undefined;
    const source = sourcePage();
    await translatePageWithOpenAi(source, context, 'Russian', fake.requester, { save: async state => { saved = structuredClone(state); } });
    const jsonb = <T>(value: T): T => JSON.parse(JSON.stringify(value, (_key, item) =>
      item && typeof item === 'object' && !Array.isArray(item)
        ? Object.fromEntries(Object.keys(item).reverse().map(key => [key, item[key]])) : item));
    await translatePageWithOpenAi(jsonb(source), jsonb(context), 'Russian', fake.requester, { resume: jsonb(saved) });
    expect(fake.translate).toHaveBeenCalledTimes(1);
    expect(fake.validate).toHaveBeenCalledTimes(1);
  });

  it('resumes a second final issue with one targeted correction and full review inside the same cap', async () => {
    const fake = fakeRequester();
    const originalReview = fake.validate.getMockImplementation()!;
    const originalTranslate = fake.translate.getMockImplementation()!;
    let reviews = 0;
    fake.validate.mockImplementation(async args => {
      const result = await originalReview(args);
      const failure = ['Correct the legal meaning.', 'Correct the legal meaning.', 'e4: Fix currency wording.', 'e6: Fix the energy unit.'][reviews++];
      if (failure) { result.value.meaningPreserved = false; result.value.failures = [failure]; }
      return result;
    });
    fake.translate.mockImplementation(async args => {
      const result = await originalTranslate(args);
      if (args.source.elements.length === 1 && args.source.elements[0].id === 'e4') result.value.elements[0].text = 'Работники ознакомлены с настоящим постановлением.';
      if (args.source.elements.length === 1 && args.source.elements[0].id === 'e6') result.value.elements[0].text = 'Сотрудники ознакомлены с настоящим постановлением.';
      return result;
    });
    const ledger = emptyRequestLedger();
    let saved: TranslationRecovery | undefined;
    const interruption = Object.assign(new Error('worker stopped'), { name: 'JobLeaseLostError' });
    await expect(translatePageWithOpenAi(sourcePage(), context, 'Russian', budgetedRequester(fake.requester, ledger, async () => {}), {
      save: async state => {
        saved = structuredClone(state);
        if (state.version === 'page-translation-v1' && !state.passes.assemblyReview?.pendingReview && state.passes.assemblyReview?.validationFailure === 'e6: Fix the energy unit.') throw interruption;
      },
    })).rejects.toBe(interruption);
    expect(ledger.counts['translate:9']).toBe(10);
    if (saved?.version !== 'page-translation-v1') throw new Error('Expected retained page recovery');
    const retained = structuredClone(saved.passes.assemblyReview.candidate!);
    // Old persisted jobs did not save the separate failure list.
    delete saved.passes.assemblyReview.reviewFailures;
    const translateCount = fake.translate.mock.calls.length;
    const reviewCount = fake.validate.mock.calls.length;
    const result = await translatePageWithOpenAi(sourcePage(), context, 'Russian', budgetedRequester(fake.requester, ledger, async () => {}), {
      resume: saved, save: async state => { saved = structuredClone(state); },
    });
    expect(ledger.counts['translate:9']).toBe(12);
    expect(fake.translate).toHaveBeenCalledTimes(translateCount + 1);
    expect(fake.validate).toHaveBeenCalledTimes(reviewCount + 1);
    expect(fake.translate.mock.calls.at(-1)?.[0].source.elements.map(e => e.id)).toEqual(['e6']);
    expect(fake.translate.mock.calls.at(-1)?.[0].validationFailure).toContain('Fix currency wording');
    expect(fake.validate.mock.calls.at(-1)?.[0].source.elements).toHaveLength(8);
    expect(result.translation.elements.filter(e => e.id !== 'e6')).toEqual(retained.elements.filter(e => e.id !== 'e6'));
    expect(result.validation.valid).toBe(true);
    await translatePageWithOpenAi(sourcePage(), context, 'Russian', budgetedRequester(fake.requester, ledger, async () => {}), { resume: saved });
    expect(ledger.counts['translate:9']).toBe(12);
  });

  it('reserves the final review before optional fragment corrections consume its last slot', async () => {
    const fake = fakeRequester();
    rejectWholePageTwice(fake.validate);
    const original = fake.translate.getMockImplementation()!;
    fake.translate.mockImplementation(async args => {
      const result = await original(args);
      if (args.source.elements.length === 1) result.value.elements[0].cells[0].text += ' 999';
      return result;
    });
    const ledger = emptyRequestLedger();
    ledger.counts['translate:9'] = 4;
    await expect(translatePageWithOpenAi(sourcePage(), context, 'Russian', budgetedRequester(fake.requester, ledger, async () => {}))).rejects.toThrow(/reserved remaining work/);
    expect(ledger.counts['translate:9']).toBe(9); // stop with 3 reserved calls, not 12 exhausted
  });

  it('does not offer an unreviewed assembly as complete or requeue exhausted passes', async () => {
    const fake = fakeRequester();
    const original = fake.validate.getMockImplementation()!;
    fake.validate.mockImplementation(async args => {
      const result = await original(args);
      result.value.meaningPreserved = false;
      result.value.failures = ['Meaning changed.'];
      return result;
    });
    const ledger = emptyRequestLedger();
    let saved: TranslationRecovery | undefined;
    const run = () => translatePageWithOpenAi(sourcePage(), context, 'Russian', budgetedRequester(fake.requester, ledger, async () => {}), {
      resume: saved, save: async state => { saved = structuredClone(state); },
    });
    await expect(run()).rejects.toSatisfy(isPdfxTerminalError);
    const count = ledger.counts['translate:9'];
    await expect(run()).rejects.toSatisfy(isPdfxTerminalError);
    expect(ledger.counts['translate:9']).toBe(count);
  });

  it('treats a provider refusal as terminal without corrective or fragment requests', async () => {
    const fake = fakeRequester();
    fake.translate.mockImplementation(async () => parsePdfStructuredResponse({
      status: 'completed', id: 'test', model: 'gpt-5.6-luna',
      usage: { input_tokens: 100, output_tokens: 15 },
      output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'declined' }] }],
    }, PdfPageTranslationSchema, 'translation'));
    const ledger = emptyRequestLedger();
    await expect(translatePageWithOpenAi(sourcePage(), context, 'Russian', budgetedRequester(fake.requester, ledger, async () => {}))).rejects.toSatisfy(isPdfxTerminalError);
    expect(fake.translate).toHaveBeenCalledTimes(1);
    expect(fake.validate).not.toHaveBeenCalled();
    expect(ledger.outputTokens).toBe(15);
  });

  it('fails closed on old insertion-order fingerprints rather than silently resetting attempts', async () => {
    const fake = fakeRequester();
    let saved: TranslationRecovery | undefined;
    await translatePageWithOpenAi(sourcePage(), context, 'Russian', fake.requester, { save: async state => { saved = structuredClone(state); } });
    if (!saved) throw new Error('Missing checkpoint');
    saved.fingerprint = 'legacy-order-sensitive-fingerprint';
    await expect(translatePageWithOpenAi(sourcePage(), context, 'Russian', fake.requester, { resume: saved })).rejects.toSatisfy(isPdfxTerminalError);
    expect(fake.translate).toHaveBeenCalledTimes(1);
  });

  it('normalizes only matched shared date-range years before independent semantic review', async () => {
    const fake = fakeRequester();
    const source = sourcePage();
    source.elements = [{ ...source.elements[1], text: '1. 2025-yil 11-avgustdan 15-avgust kuniga qadar xodimlar bilan uchrashuv.' }];
    fake.translate.mockResolvedValue(provider({ pageNumber: 9, warnings: [], elements: [{ id: source.elements[0].id, text: '1. С 11 августа 2025 года по 15 августа 2025 года встреча с работниками.', cells: [] }] }));
    const result = await translatePageWithOpenAi(source, context, 'Russian', fake.requester);
    expect(result.translation.elements[0].text).toBe('1. С 11 августа по 15 августа 2025 года встреча с работниками.');
    expect(fake.translate).toHaveBeenCalledTimes(1);
    expect(fake.validate).toHaveBeenCalledTimes(1);
    expect(fake.validate.mock.calls[0][0].translation).toEqual(result.translation);
  });
});
