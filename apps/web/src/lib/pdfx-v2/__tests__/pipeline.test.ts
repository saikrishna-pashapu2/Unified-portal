import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import type { PdfPageLayout } from '../schemas';

const mocks = vi.hoisted(() => {
  const domainOperation = { operation: 'create-v2-domain' };
  const queueOperation = { operation: 'create-v2-queue' };
  return {
    createDomain: vi.fn((_args: unknown) => domainOperation),
    createQueue: vi.fn((_args: unknown) => queueOperation),
    transaction: vi.fn(async (operations: unknown) => operations),
    findJob: vi.fn(),
    updateJob: vi.fn(async () => ({ count: 1 })),
    upsertPage: vi.fn(),
    deletePages: vi.fn((_args: unknown) => ({ operation: 'delete-stale-pages' })),
    findPage: vi.fn(),
    updatePage: vi.fn(),
    aggregate: vi.fn(async () => ({ _sum: { input_tokens: 123, output_tokens: 45 } })),
    complete: vi.fn(async () => undefined),
    progress: vi.fn(async () => undefined),
    cancellation: vi.fn(async () => undefined),
    extract: vi.fn(),
    context: vi.fn(),
    translate: vi.fn(),
    render: vi.fn(async (_pages: unknown, outputPath: string, _sourcePdf: Buffer) => {
      const fs = await import('node:fs/promises');
      await fs.writeFile(outputPath, Buffer.from('%PDF-output'));
    }),
    domainOperation,
    queueOperation,
  };
});

vi.mock('@esgcredit/db-esg', () => ({
  esgPrisma: {
    pdf_translation_v2_jobs: {
      create: mocks.createDomain,
      findFirst: mocks.findJob,
      updateMany: mocks.updateJob,
    },
    pdf_translation_v2_pages: {
      upsert: mocks.upsertPage,
      deleteMany: mocks.deletePages,
      findUnique: mocks.findPage,
      update: mocks.updatePage,
      aggregate: mocks.aggregate,
    },
    background_jobs: { create: mocks.createQueue },
    $transaction: mocks.transaction,
  },
}));
vi.mock('@/lib/jobs/queue', async () => {
  const actual = await vi.importActual<typeof import('@/lib/jobs/queue')>('@/lib/jobs/queue');
  return {
    ...actual,
    completePdfTranslationV2Job: mocks.complete,
    updateBackgroundJobProgress: mocks.progress,
    throwIfJobCancelled: mocks.cancellation,
  };
});
vi.mock('../openai', () => ({
  defaultPdfxV2Requester: {},
  extractPageWithOpenAi: mocks.extract,
  buildDocumentContext: mocks.context,
  translatePageWithOpenAi: mocks.translate,
}));
vi.mock('../render', () => ({ renderPdfxV2Document: mocks.render }));

function layout(pageNumber: number, text: string): PdfPageLayout {
  return {
    pageNumber, width: 1000, height: 1000, orientation: 'portrait',
    sourceLanguage: 'Uzbek', sourceScript: 'Cyrillic', warnings: [],
    elements: [{
      id: 'e001', kind: 'paragraph', order: 0, level: 0, translate: true, text,
      bbox: [50, 50, 950, 250], columnCount: 0, rowCount: 0, rows: [],
    }],
  };
}

async function twoPagePdf(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  pdf.addPage();
  return Buffer.from(await pdf.save());
}

async function onePagePdf(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  return Buffer.from(await pdf.save());
}

beforeEach(() => vi.clearAllMocks());

describe('PDF Translator pipeline', () => {
  it('atomically starts an isolated v2 job with durable recovery attempts', async () => {
    const { startPdfTranslationV2Job } = await import('../pipeline');
    const jobId = '11111111-1111-4111-8111-111111111111';
    const inputBuffer = Buffer.from('%PDF-source');
    await startPdfTranslationV2Job({
      jobId, userId: 7, filename: 'legal.pdf', targetLang: 'Russian', pageCount: 17, inputBuffer,
    });
    expect(mocks.transaction).toHaveBeenCalledWith([mocks.domainOperation, mocks.queueOperation]);
    const queueArgs = mocks.createQueue.mock.calls[0]?.[0] as
      | { data: Record<string, unknown> }
      | undefined;
    expect(queueArgs?.data).toEqual(expect.objectContaining({
      id: jobId,
      job_type: 'pdf_translation_v5',
      max_attempts: 3,
      input_data: inputBuffer,
    }));
    const domainArgs = mocks.createDomain.mock.calls[0]?.[0] as
      | { data: Record<string, unknown> }
      | undefined;
    expect(domainArgs?.data.metrics).toEqual({
      requiredPipelineVersion: 'luna-layout-v5-2026-08-25',
      requiredModel: 'gpt-5.6-luna',
    });
  });

  it('discards stale non-Luna checkpoints before resuming an active job', async () => {
    const source = layout(1, 'Биринчи саҳифа 100');
    const documentContext = {
      sourceLanguage: 'Uzbek', targetLanguage: 'Russian', documentType: 'Resolution',
      summary: 'Legal', preserveTerms: [], terminology: [],
    };
    mocks.findJob.mockResolvedValue({
      status: 'queued', output_pdf: null, total_pages: 1,
      document_context: documentContext,
      metrics: { pipelineVersion: 'legacy-layout', model: 'non-luna-model' },
      pages: [{
        page_number: 1, status: 'translated', source_layout: source,
        translated_layout: layout(1, 'Старый перевод 100'),
      }],
    });
    mocks.extract.mockResolvedValue({
      layout: source, attempts: 1, model: 'gpt-5.6-luna',
      responseId: 'extract-1', inputTokens: 20, outputTokens: 10,
    });
    mocks.context.mockResolvedValue({
      context: documentContext, model: 'gpt-5.6-luna',
      responseId: 'context-1', inputTokens: 20, outputTokens: 10,
    });
    mocks.findPage.mockResolvedValue({ status: 'extracted', translated_layout: null });
    mocks.translate.mockResolvedValue({
      translation: {
        pageNumber: 1, warnings: [],
        elements: [{ id: 'e001', text: 'Первая страница 100', cells: [] }],
      },
      layout: source, attempts: 1, validation: { valid: true, failures: [], warnings: [] },
      model: 'gpt-5.6-luna', responseId: 'translation-1', inputTokens: 30, outputTokens: 15,
    });

    const { processPdfTranslationV2Job } = await import('../pipeline');
    await processPdfTranslationV2Job({
      id: '11111111-1111-4111-8111-111111111111',
      jobType: 'pdf_translation_v5', userId: 7,
      payload: { filename: 'legal.pdf', targetLang: 'Russian', pageCount: 1 },
      inputData: await onePagePdf(), outputData: null, result: null,
      status: 'processing', progress: 10, attempts: 2, maxAttempts: 1_000,
      progressData: null, lastError: null,
      leaseOwner: 'worker-1', cancelRequested: false,
      availableAt: new Date(), leaseExpiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(), updatedAt: new Date(), completedAt: null,
    });

    expect(mocks.deletePages).toHaveBeenCalledWith({
      where: { job_id: '11111111-1111-4111-8111-111111111111' },
    });
    expect(mocks.extract).toHaveBeenCalledTimes(1);
    expect(mocks.context).toHaveBeenCalledTimes(1);
    expect(mocks.translate).toHaveBeenCalledTimes(1);
  });

  it('resumes completed page checkpoints and translates only the unfinished page', async () => {
    const source1 = layout(1, 'Биринчи саҳифа 100');
    const source2 = layout(2, 'Иккинчи саҳифа 200');
    const translated1 = layout(1, 'Первая страница 100');
    const translated2 = layout(2, 'Вторая страница 200');
    const documentContext = {
      sourceLanguage: 'Uzbek', targetLanguage: 'Russian', documentType: 'Resolution',
      summary: 'Legal', preserveTerms: [], terminology: [],
    };
    mocks.findJob.mockResolvedValue({
      status: 'queued', output_pdf: null, total_pages: 2,
      document_context: documentContext,
      metrics: {
        pipelineVersion: 'luna-layout-v5-2026-08-25',
        model: 'gpt-5.6-luna',
      },
      pages: [
        { page_number: 1, status: 'translated', source_layout: source1, translated_layout: translated1 },
        { page_number: 2, status: 'extracted', source_layout: source2, translated_layout: null },
      ],
    });
    mocks.findPage
      .mockResolvedValueOnce({ status: 'translated', translated_layout: translated1 })
      .mockResolvedValueOnce({ status: 'extracted', translated_layout: null });
    mocks.translate.mockResolvedValue({
      translation: { pageNumber: 2, warnings: [], elements: [{ id: 'e001', text: 'Вторая страница 200', cells: [] }] },
      layout: source2, attempts: 1, validation: { valid: true, failures: [], warnings: [] },
      model: 'gpt-5.6-luna', responseId: 'translation-2', inputTokens: 30, outputTokens: 15,
    });

    const { processPdfTranslationV2Job } = await import('../pipeline');
    await processPdfTranslationV2Job({
      id: '11111111-1111-4111-8111-111111111111',
      jobType: 'pdf_translation_v5', userId: 7,
      payload: { filename: 'legal.pdf', targetLang: 'Russian', pageCount: 2 },
      inputData: await twoPagePdf(), outputData: null, result: null,
      status: 'processing', progress: 10, attempts: 2, maxAttempts: 3,
      progressData: null, lastError: null,
      leaseOwner: 'worker-1', cancelRequested: false,
      availableAt: new Date(), leaseExpiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(), updatedAt: new Date(), completedAt: null,
    });

    expect(mocks.extract).not.toHaveBeenCalled();
    expect(mocks.context).not.toHaveBeenCalled();
    expect(mocks.translate).toHaveBeenCalledTimes(1);
    expect(mocks.translate).toHaveBeenCalledWith(
      expect.objectContaining({
        ...source2,
        pageWidthPoints: expect.any(Number),
        pageHeightPoints: expect.any(Number),
      }),
      documentContext,
      'Russian',
      expect.objectContaining({ extract: expect.any(Function), translate: expect.any(Function) }),
    );
    expect(mocks.render.mock.calls[0][0]).toEqual([
      expect.objectContaining({
        ...translated1,
        pageWidthPoints: expect.any(Number),
        pageHeightPoints: expect.any(Number),
      }),
      expect.objectContaining({
        ...translated2,
        pageWidthPoints: expect.any(Number),
        pageHeightPoints: expect.any(Number),
      }),
    ]);
    expect(mocks.render.mock.calls[0][2]).toBeInstanceOf(Buffer);
    expect(mocks.complete).toHaveBeenCalledTimes(1);
    expect(mocks.complete).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      7,
      'worker-1',
      expect.objectContaining({ jobType: 'pdf_translation_v5' }),
    );
  });
});
