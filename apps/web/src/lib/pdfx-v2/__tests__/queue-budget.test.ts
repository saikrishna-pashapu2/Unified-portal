import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ClaimedBackgroundJob } from '@/lib/jobs/queue';

const mocks = vi.hoisted(() => ({ query: vi.fn(async (..._args: unknown[]) => [{ status: 'error' }]) }));
vi.mock('@esgcredit/db-esg', () => ({ esgPrisma: { $queryRaw: mocks.query } }));

describe('production PDF worker retry ceiling', () => {
  it('bounds an existing 1000-attempt job without changing generic queue defaults', async () => {
    const { failBackgroundJob } = await import('@/lib/jobs/queue');
    const job = { id: 'job', leaseOwner: 'worker', attempts: 3, maxAttempts: 1000 } as ClaimedBackgroundJob;
    await failBackgroundJob(job, 'Validation failed', { maximumAttempts: 3 });
    const args = mocks.query.mock.calls.at(-1)!;
    expect(args[1]).toBe(3);
    expect(args[2]).toBe(false);
  });
  it('stops an exhausted request budget even on the first worker attempt', async () => {
    const { failBackgroundJob } = await import('@/lib/jobs/queue');
    const job = { id: 'job', leaseOwner: 'worker', attempts: 1, maxAttempts: 1000 } as ClaimedBackgroundJob;
    await failBackgroundJob(job, 'Budget reached', { maximumAttempts: 3, forceTerminal: true });
    expect(mocks.query.mock.calls.at(-1)![2]).toBe(false);
  });
  it('wires the safeguard into the committed production worker, not only the local worker', () => {
    const worker = readFileSync(fileURLToPath(new URL('../../../esg-driver-worker.mts', import.meta.url)), 'utf8');
    expect(worker).toContain('maximumAttempts: PDF_TRANSLATION_MAX_ATTEMPTS');
    expect(worker).toContain('forceTerminal: isPdfxTerminalError(error)');
    expect(worker).not.toContain('forceTerminal: isPdfxBudgetError(error)');
    expect(worker).not.toContain('keepRetrying: true');
  });

  it('registers the native v5 queue fence for both enqueue and worker routing', async () => {
    const { BACKGROUND_JOB_TYPES } = await import('@/lib/jobs/queue');
    const {
      PDFX_V2_QUEUE_JOB_TYPE,
      isPdfxV2QueueJobType,
    } = await import('../constants');

    // v6 fences new jobs from pre-draft workers; v5_native drains as legacy.
    expect(PDFX_V2_QUEUE_JOB_TYPE).toBe('pdf_translation_v6');
    expect(isPdfxV2QueueJobType('pdf_translation_v5_native')).toBe(true);
    expect(BACKGROUND_JOB_TYPES).toContain(PDFX_V2_QUEUE_JOB_TYPE);
    expect(isPdfxV2QueueJobType(PDFX_V2_QUEUE_JOB_TYPE)).toBe(true);
  });

  it('logs the native queue, pipeline, and pinned model at worker readiness', () => {
    const worker = readFileSync(fileURLToPath(new URL('../../../esg-driver-worker.mts', import.meta.url)), 'utf8');
    expect(worker).toContain('PDFX_V2_QUEUE_JOB_TYPE');
    expect(worker).toContain('PDFX_V2_PIPELINE_VERSION');
    expect(worker).toContain('PDFX_V2_MODEL');
    expect(worker).toContain('PDF Translator ready');
  });
});
