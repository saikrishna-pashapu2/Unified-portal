import { describe, expect, it, vi } from 'vitest';
import { budgetedRequester, emptyRequestLedger, isPdfxBudgetError } from '../request-budget';
import type { PdfxV2OpenAiRequester } from '../openai';

const args = { pagePdf: Buffer.from('pdf'), pageNumber: 6, model: 'gpt-5.6-luna', targetLanguage: 'Russian' as const };
const result = { value: {}, inputTokens: 100, outputTokens: 50, cachedInputTokens: 20, responseId: 'x', model: 'gpt-5.6-luna' };
function provider(extract: any) { return { extract } as PdfxV2OpenAiRequester; }

describe('durable PDF request and spending safeguards', () => {
  it('reserves before sending and records rejected model responses before application validation', async () => {
    const ledger = emptyRequestLedger();
    const snapshots: any[] = [];
    const extract = vi.fn(async () => { expect(snapshots[0].counts['extract:6']).toBe(1); return result; });
    await budgetedRequester(provider(extract), ledger, async (state) => { snapshots.push(structuredClone(state)); }).extract(args);
    expect(ledger).toMatchObject({ inputTokens: 100, outputTokens: 50, cachedInputTokens: 20, responses: 1, unreportedRequests: 0 });
    expect(ledger.reservedOutputTokens?.['page:6']).toBe(50);
  });
  it('keeps the request ceiling across worker restarts', async () => {
    let saved = emptyRequestLedger();
    const extract = vi.fn(async () => result);
    for (let i = 0; i < 4; i++) {
      await budgetedRequester(provider(extract), structuredClone(saved), async (state) => { saved = structuredClone(state); }).extract(args);
    }
    await expect(budgetedRequester(provider(extract), saved, async () => {}).extract(args)).rejects.toThrow(/request budget/);
    expect(extract).toHaveBeenCalledTimes(4);
  });
  it('reserves the possible bill for timeouts and cannot exceed 60000 output tokens per page', async () => {
    const ledger = emptyRequestLedger();
    const extract = vi.fn(async () => { throw new Error('Request timed out'); });
    const requester = budgetedRequester(provider(extract), ledger, async () => {});
    await expect(requester.extract(args)).rejects.toThrow('timed out');
    await expect(requester.extract(args)).rejects.toThrow('timed out');
    await expect(requester.extract(args)).rejects.toThrow(/output-token budget/);
    expect(extract.mock.calls.map(([request]: any) => request.maxOutputTokens)).toEqual([40000, 20000]);
    expect(ledger.unreportedRequests).toBe(2);
  });
  it('does not send a request if durable accounting is unavailable', async () => {
    const extract = vi.fn(async () => result);
    await expect(budgetedRequester(provider(extract), emptyRequestLedger(), async () => { throw new Error('DB offline'); }).extract(args)).rejects.toThrow(/persist/);
    expect(extract).not.toHaveBeenCalled();
  });
  it('records usage even when a provider returned no parsed JSON', async () => {
    const ledger = emptyRequestLedger();
    const extract = vi.fn(async () => { throw Object.assign(new Error('No parsed output'), { providerUsage: result }); });
    await expect(budgetedRequester(provider(extract), ledger, async () => {}).extract(args)).rejects.toThrow('No parsed');
    expect(ledger.responses).toBe(1);
    expect(ledger.outputTokens).toBe(50);
    expect(ledger.unreportedRequests).toBe(0);
  });
  it('recognizes a spending stop through nested recovery errors', () => {
    const error = new Error('outer', { cause: Object.assign(new Error('budget'), { name: 'PdfxRequestBudgetError' }) });
    expect(isPdfxBudgetError(error)).toBe(true);
  });
});
