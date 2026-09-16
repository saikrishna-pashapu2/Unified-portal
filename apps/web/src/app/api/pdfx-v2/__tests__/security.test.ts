import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findOwnedJob: vi.fn(),
  updateJob: vi.fn(),
  cancelQueueJob: vi.fn(),
  deleteJob: vi.fn(),
}));

vi.mock('@esgcredit/db-esg', () => ({
  esgPrisma: {
    $queryRaw: mocks.deleteJob,
    pdf_translation_v2_jobs: {
      findFirst: mocks.findOwnedJob,
      updateMany: mocks.updateJob,
    },
  },
}));
vi.mock('@/lib/pdfx-v2/auth', () => ({
  requirePdfxUser: vi.fn(async () => ({ userId: 7, response: null })),
}));
vi.mock('@/lib/pdfx-v2/page-raster', () => ({
  rasterizePdfPage: vi.fn(async () => Buffer.from('png')),
  rasterizeSinglePagePdf: vi.fn(async () => Buffer.from('png')),
}));
vi.mock('@/lib/jobs/queue', async () => {
  const actual = await vi.importActual<typeof import('@/lib/jobs/queue')>('@/lib/jobs/queue');
  return { ...actual, requestBackgroundJobCancellation: mocks.cancelQueueJob };
});

beforeEach(() => vi.clearAllMocks());

describe('PDF Translator API ownership', () => {
  it.each(['extractionRecovery','denseTranslation','translationRecovery'])('does not publish private %s recovery data as a validated layout',async(key)=> {
    mocks.findOwnedJob.mockResolvedValue({status:'error',total_pages:1,pages:[{
      page_number:1,status:'extraction_error',source_text:null,translated_text:null,
      source_layout:null,translated_layout:null,warnings:[],validation:{[key]:{candidate:{text:'Unvalidated candidate'}}},
    }]});
    const { GET }=await import('../pages/route');
    const response=await GET(new Request('http://localhost/api/pdfx-v2/pages?jobId=11111111-1111-4111-8111-111111111111&page=1'));
    const payload=await response.json();
    expect(payload.pages[0]).toMatchObject({validation:null,sourceLayout:null,translatedLayout:null});
    expect(JSON.stringify(payload)).not.toContain('Unvalidated candidate');
  });
  it('returns owned positioned layouts for the selectable page reconstruction UI', async () => {
    const sourceLayout = { pageNumber: 1, elements: [] };
    const translatedLayout = { pageNumber: 1, elements: [] };
    mocks.findOwnedJob.mockResolvedValue({
      status: 'completed',
      total_pages: 1,
      pages: [{
        page_number: 1,
        status: 'translated',
        source_text: 'Original source wording',
        translated_text: 'Переведенный текст',
        source_layout: sourceLayout,
        translated_layout: translatedLayout,
        warnings: [],
        validation: { valid: true },
      }],
    });
    const { GET } = await import('../pages/route');
    const response = await GET(new Request(
      'http://localhost/api/pdfx-v2/pages?jobId=11111111-1111-4111-8111-111111111111&page=1',
    ));
    const payload = await response.json() as { pages: Array<Record<string, unknown>> };

    expect(response.status).toBe(200);
    expect(payload.pages[0]).toEqual({
      pageNumber: 1,
      status: 'translated',
      originalText: 'Original source wording',
      translatedText: 'Переведенный текст',
      sourceLayout,
      translatedLayout,
      warnings: [],
      validation: { valid: true },
    });
    expect(mocks.findOwnedJob).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: '11111111-1111-4111-8111-111111111111', user_id: 7 },
      select: expect.objectContaining({
        pages: expect.objectContaining({
          where: { page_number: 1 },
          take: 1,
          select: expect.objectContaining({
            source_text: true,
            translated_text: true,
            source_layout: true,
            translated_layout: true,
          }),
        }),
      }),
    }));
  });

  it('does not cancel another feature job when no owned translator row exists', async () => {
    mocks.findOwnedJob.mockResolvedValue(null);
    const { POST } = await import('../cancel/route');
    const response = await POST(new Request('http://localhost/api/pdfx-v2/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId: '11111111-1111-4111-8111-111111111111' }),
    }));
    expect(response.status).toBe(404);
    expect(mocks.findOwnedJob).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: '11111111-1111-4111-8111-111111111111', user_id: 7 },
    }));
    expect(mocks.cancelQueueJob).not.toHaveBeenCalled();
  });

  it('does not render a page preview for a translation owned by another user', async () => {
    mocks.findOwnedJob.mockResolvedValue(null);
    const { GET } = await import('../preview/route');
    const response = await GET(new Request(
      'http://localhost/api/pdfx-v2/preview?jobId=11111111-1111-4111-8111-111111111111&page=1&document=source',
    ));
    expect(response.status).toBe(404);
    expect(mocks.findOwnedJob).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: '11111111-1111-4111-8111-111111111111', user_id: 7 },
    }));
  });

  it('does not delete a translation that is not owned by the signed-in user', async () => {
    mocks.deleteJob.mockResolvedValue([{
      owned_status: null,
      queue_active: false,
      deleted: false,
    }]);
    const { DELETE } = await import('../jobs/[jobId]/route');
    const response = await DELETE(
      new Request('http://localhost/api/pdfx-v2/jobs/11111111-1111-4111-8111-111111111111', {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ jobId: '11111111-1111-4111-8111-111111111111' }) },
    );

    expect(response.status).toBe(404);
  });

  it('refuses to delete an active translation', async () => {
    mocks.deleteJob.mockResolvedValue([{
      owned_status: 'processing',
      queue_active: true,
      deleted: false,
    }]);
    const { DELETE } = await import('../jobs/[jobId]/route');
    const response = await DELETE(
      new Request('http://localhost/api/pdfx-v2/jobs/11111111-1111-4111-8111-111111111111', {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ jobId: '11111111-1111-4111-8111-111111111111' }) },
    );

    expect(response.status).toBe(409);
  });

  it('deletes an owned terminal translation', async () => {
    mocks.deleteJob.mockResolvedValue([{
      owned_status: 'completed',
      queue_active: false,
      deleted: true,
    }]);
    const { DELETE } = await import('../jobs/[jobId]/route');
    const response = await DELETE(
      new Request('http://localhost/api/pdfx-v2/jobs/11111111-1111-4111-8111-111111111111', {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ jobId: '11111111-1111-4111-8111-111111111111' }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true });
  });
});
