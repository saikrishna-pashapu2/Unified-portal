import type { PdfxV2OpenAiRequester } from './openai';

export type RequestLedger = {
  counts: Record<string, number>;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  responses: number;
  unreportedRequests: number;
  reservedOutputTokens?: Record<string, number>;
};
export function emptyRequestLedger(): RequestLedger {
  return { counts: {}, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, responses: 0, unreportedRequests: 0 };
}
export class PdfxRequestBudgetError extends Error {
  constructor(message: string, options?: ErrorOptions) { super(message, options); this.name = 'PdfxRequestBudgetError'; }
}
export function isPdfxBudgetError(error: unknown): boolean {
  const seen = new Set<unknown>();
  while (error instanceof Error && !seen.has(error)) {
    if (error.name === 'PdfxRequestBudgetError') return true;
    seen.add(error);
    error = error.cause;
  }
  return false;
}

/** Durable per-job/page safety ceiling, NOT a daily/user quota. Reserve before
 * sending so timeouts and worker restarts cannot reset the spending allowance. */
export function budgetedRequester(
  requester: PdfxV2OpenAiRequester,
  ledger: RequestLedger,
  persist: (ledger: RequestLedger, response?: { page: number; stage: string; inputTokens: number; outputTokens: number }) => Promise<void>,
): PdfxV2OpenAiRequester {
  const wrap = (stage: keyof PdfxV2OpenAiRequester) => async (args: any) => {
    const page = args.pageNumber ?? args.source?.pageNumber ?? 0;
    const group = stage === 'validate' ? 'translate' : stage === 'orientation' ? 'extract' : stage;
    const key = `${group}:${page}`;
    const cap = group === 'extract' ? 4 : group === 'context' ? 2 : 12;
    const tokenKey = `page:${page}`;
    ledger.reservedOutputTokens ??= {};
    const available = (page === 0 ? 4000 : 60000) - (ledger.reservedOutputTokens[tokenKey] ?? 0);
    const requestMaximum = stage === 'orientation' ? 200 : stage === 'context' ? 2000 : stage === 'validate' ? 1500 : stage === 'translate' ? 20000 : 40000;
    const maxOutputTokens = Math.min(requestMaximum, available);
    if (maxOutputTokens < Math.min(1000, requestMaximum)) {
      throw new PdfxRequestBudgetError(`Automatic output-token budget reached for page ${page}; no further API requests were sent.`);
    }
    if ((ledger.counts[key] ?? 0) >= cap) {
      throw new PdfxRequestBudgetError(`Automatic ${group} request budget reached for page ${page}; retained checkpoints require a targeted retry, not a full-job replay.`);
    }
    ledger.counts[key] = (ledger.counts[key] ?? 0) + 1;
    ledger.reservedOutputTokens[tokenKey] = (ledger.reservedOutputTokens[tokenKey] ?? 0) + maxOutputTokens;
    ledger.unreportedRequests += 1;
    let observed: { page: number; stage: string; inputTokens: number; outputTokens: number } | undefined;
    const save = async () => {
      try { await persist(ledger, observed); }
      catch (error) { throw new PdfxRequestBudgetError('Could not persist API request accounting; stopped before further spending.', { cause: error }); }
    };
    await save();
    let result;
    try { result = await (requester[stage] as (args: any) => Promise<any>)({ ...args, maxOutputTokens }); }
    catch (error) {
      const known = (error as { providerUsage?: any } | null)?.providerUsage;
      if (known) { record(known); await save(); }
      throw error;
    }
    record(result);
    await save();
    return result;

    function record(usage: { inputTokens: number; outputTokens: number; cachedInputTokens?: number }) {
      observed = { page, stage, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens };
      ledger.inputTokens += usage.inputTokens;
      ledger.outputTokens += usage.outputTokens;
      ledger.cachedInputTokens += usage.cachedInputTokens ?? 0;
      ledger.responses += 1;
      ledger.unreportedRequests -= 1;
      // A timed-out request retains its entire reservation because billing is
      // unknown. Only a received usage report releases unused output capacity.
      ledger.reservedOutputTokens![tokenKey] -= Math.max(0, maxOutputTokens - usage.outputTokens);
    }
  };
  return { ...(requester.orientation ? { orientation: wrap('orientation') } : {}), extract: wrap('extract'), context: wrap('context'), translate: wrap('translate'), validate: wrap('validate') };
}
