import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  findJob: vi.fn(),
  transaction: vi.fn(),
  queueUpdate: vi.fn(),
  pageUpdate: vi.fn(),
  domainUpdate: vi.fn(),
}));

vi.mock('@/lib/pdfx-v2/auth', () => ({ requirePdfxUser: mocks.auth }));
vi.mock('@esgcredit/db-esg', () => ({
  esgPrisma: {
    pdf_translation_v2_jobs: { findFirst: mocks.findJob },
    $transaction: mocks.transaction,
  },
}));

import { POST } from './route';

const jobId = '11111111-1111-4111-8111-111111111111';

function request(pageNumber = 4) {
  return new Request(`http://localhost/api/pdfx-v2/jobs/${jobId}/rerun-page`, {
    method: 'POST',
    body: JSON.stringify({ pageNumber }),
    headers: { 'content-type': 'application/json' },
  });
}

function context() {
  return { params: Promise.resolve({ jobId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ userId: 7 });
  mocks.findJob.mockResolvedValue({
    status: 'completed',
    metrics: {
      pipelineVersion: 'luna-layout-v5-native-2026-09-14',
      model: 'gpt-5.6-luna',
      requestLedger: { counts: { 'translate:4': 12 }, inputTokens: 10, outputTokens: 20, cachedInputTokens: 0, responses: 1, unreportedRequests: 0 },
    },
    pages: [{
      status: 'translation_error',
      validation: {
        translationRecovery: {
          version: 'page-translation-v1', fingerprint: 'page-4', passes: { whole: { attempts: 3 } },
        },
        pinnedFromMemory: { e001: 'saved heading' },
      },
    }],
  });
  mocks.queueUpdate.mockResolvedValue({ count: 1 });
  mocks.pageUpdate.mockResolvedValue({ count: 1 });
  mocks.domainUpdate.mockResolvedValue({ count: 1 });
  mocks.transaction.mockImplementation(async (callback: (transaction: unknown) => Promise<unknown>) => callback({
    background_jobs: { updateMany: mocks.queueUpdate },
    pdf_translation_v2_pages: { updateMany: mocks.pageUpdate },
    pdf_translation_v2_jobs: { updateMany: mocks.domainUpdate },
  }));
});

describe('PDF page rerun route', () => {
  it('resets only the selected page and records an explicit rerun marker', async () => {
    const response = await POST(request(), context());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true, pageNumber: 4, stage: 'translation' });

    expect(mocks.pageUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { job_id: jobId, page_number: 4, status: 'translation_error' },
      data: expect.objectContaining({
        status: 'extracted',
        validation: expect.objectContaining({
          translationRecovery: expect.objectContaining({ retryRequested: true }),
        }),
      }),
    }));
    expect(mocks.domainUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        metrics: expect.objectContaining({ pageRerun: { pageNumber: 4, stage: 'translation' } }),
      }),
    }));
  });

  it('refuses an older checkpoint without changing queue or page state', async () => {
    mocks.findJob.mockResolvedValueOnce({
      status: 'completed',
      metrics: { pipelineVersion: 'legacy', model: 'old-model' },
      pages: [{ status: 'translation_error', validation: {} }],
    });
    const response = await POST(request(), context());
    expect(response.status).toBe(409);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.pageUpdate).not.toHaveBeenCalled();
  });
});
