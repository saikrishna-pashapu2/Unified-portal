import type { PdfxV2OpenAiRequester } from './openai';
import { isPdfxProviderRefusalError } from './structured-response';

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
export class PdfxWorkerVersionError extends Error {
  constructor(message: string, options?: ErrorOptions) { super(message, options); this.name = 'PdfxWorkerVersionError'; }
}
export class PdfxTranslationStopError extends Error {
  constructor(message: string, options?: ErrorOptions) { super(message, options); this.name = 'PdfxTranslationStopError'; }
}
export function isPdfxWorkerControlFlowError(error: unknown): boolean {
  return error instanceof Error &&
    (error.name === 'JobCancelledError' || error.name === 'JobLeaseLostError');
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

export function isPdfxTerminalError(error:unknown):boolean {
  if(isPdfxBudgetError(error)) return true;
  const seen=new Set<unknown>();
  while(error instanceof Error && !seen.has(error)) {
    if (isPdfxProviderRefusalError(error)) return true;
    if(error.name==='PdfxExtractionStopError' || error.name==='PdfxWorkerVersionError' || error.name==='PdfxTranslationStopError') return true;
    seen.add(error);error=error.cause;
  }
  return false;
}

/** A user-initiated page rerun is the only way to grant a flagged page a fresh
 * request allowance. An extraction rerun clears both stages because a new
 * layout invalidates the old translation; a translation rerun keeps the paid
 * extraction budget untouched. */
export function resetPageLedger(ledger: RequestLedger, page: number, stage: 'extraction' | 'translation'): RequestLedger {
  const counts = { ...ledger.counts };
  if (stage === 'extraction') delete counts[`extract:${page}`];
  delete counts[`translate:${page}`];
  const reservedOutputTokens = { ...(ledger.reservedOutputTokens ?? {}) };
  delete reservedOutputTokens[`page:${page}`];
  return { ...ledger, counts, reservedOutputTokens };
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
    const group = stage === 'validate' ? 'translate' : stage === 'orientation' || stage === 'repair' ? 'extract' : stage;
    const key = `${group}:${page}`;
    const cap = group === 'extract' ? 4 : group === 'context' ? 2 : 12;
    const tokenKey = `page:${page}`;
    ledger.reservedOutputTokens ??= {};
    const available = (page === 0 ? 4000 : 60000) - (ledger.reservedOutputTokens[tokenKey] ?? 0);
    // Reasoning tokens share the output cap on the Responses API; 1500 for
    // validate truncated dense-page reviews into terminal failures.
    const requestMaximum = stage === 'orientation' ? 1000 : stage === 'repair' ? 12000 : stage === 'context' ? 2000 : stage === 'validate' ? 6000 : stage === 'translate' ? 20000 : 40000;
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
      catch (error) {
        if (isPdfxWorkerControlFlowError(error)) throw error;
        throw new PdfxRequestBudgetError('Could not persist API request accounting; stopped before further spending.', { cause: error });
      }
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

    function record(usage: { inputTokens: number; outputTokens: number; cachedInputTokens?: number; usageKnown?: boolean }) {
      // Missing provider usage is not a free request. Keep its reservation and
      // unreported flag, even when a response ID or empty payload was received.
      if (usage.usageKnown === false) { ledger.responses += 1; return; }
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
  return { remainingTranslationRequests: (pageNumber) => Math.max(0, 12 - (ledger.counts[`translate:${pageNumber}`] ?? 0)), ...(requester.nativeGeometry ? {nativeGeometry:requester.nativeGeometry} : {}), ...(requester.repair ? {repair:wrap('repair')} : {}), ...(requester.orientation ? { orientation: wrap('orientation') } : {}), extract: wrap('extract'), context: wrap('context'), translate: wrap('translate'), validate: wrap('validate') };
}
