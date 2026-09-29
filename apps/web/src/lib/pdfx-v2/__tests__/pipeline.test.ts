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
vi.mock('../lease-checkpoint', () => ({
  withPdfTranslationLease: vi.fn(async (_id, _lease, write) => write({
    pdf_translation_v2_jobs: { updateMany: mocks.updateJob },
    pdf_translation_v2_pages: { update: mocks.updatePage, upsert: mocks.upsertPage },
  })),
}));

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
      job_type: 'pdf_translation_v6',
      max_attempts: 3,
      input_data: inputBuffer,
    }));
    const domainArgs = mocks.createDomain.mock.calls[0]?.[0] as
      | { data: Record<string, unknown> }
      | undefined;
    expect(domainArgs?.data.metrics).toEqual({
      requiredPipelineVersion: 'luna-layout-v5-native-2026-09-14',
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
      metrics: {
        requiredPipelineVersion: 'luna-layout-v5-native-2026-09-14',
        requiredModel: 'gpt-5.6-luna',
        pipelineVersion: 'legacy-layout',
        model: 'non-luna-model',
      },
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
      jobType: 'pdf_translation_v5_native', userId: 7,
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
    const retainedRecovery = { version: 'page-translation-v1', fingerprint: 'matching-source', passes: {} };
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
        requiredPipelineVersion: 'luna-layout-v5-native-2026-09-14',
        requiredModel: 'gpt-5.6-luna',
        pipelineVersion: 'luna-layout-v5-native-2026-09-14',
        model: 'gpt-5.6-luna',
      },
      pages: [
        { page_number: 1, status: 'translated', source_layout: source1, translated_layout: translated1 },
        { page_number: 2, status: 'extracted', source_layout: source2, translated_layout: null },
      ],
    });
    mocks.findPage
      .mockResolvedValueOnce({ status: 'translated', translated_layout: translated1 })
      .mockResolvedValueOnce({ status: 'extracted', translated_layout: null, validation: { translationRecovery: retainedRecovery } });
    mocks.translate.mockResolvedValue({
      translation: { pageNumber: 2, warnings: [], elements: [{ id: 'e001', text: 'Вторая страница 200', cells: [] }] },
      layout: source2, attempts: 1, validation: { valid: true, failures: [], warnings: [] },
      model: 'gpt-5.6-luna', responseId: 'translation-2', inputTokens: 30, outputTokens: 15,
    });

    const { processPdfTranslationV2Job } = await import('../pipeline');
    await processPdfTranslationV2Job({
      id: '11111111-1111-4111-8111-111111111111',
      jobType: 'pdf_translation_v5_native', userId: 7,
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
      expect.objectContaining({save:expect.any(Function), resume: retainedRecovery}),
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
      expect.objectContaining({ jobType: 'pdf_translation_v5_native' }),
    );
  });

  it('rejects a native queue job created for another worker build before any model request', async () => {
    mocks.findJob.mockResolvedValue({
      status: 'queued', output_pdf: null, total_pages: 1,
      document_context: null,
      metrics: {
        requiredPipelineVersion: 'future-pipeline',
        requiredModel: 'gpt-5.6-luna',
      },
      pages: [],
    });

    const { processPdfTranslationV2Job } = await import('../pipeline');
    await expect(processPdfTranslationV2Job({
      id: '11111111-1111-4111-8111-111111111111',
      jobType: 'pdf_translation_v5_native', userId: 7,
      payload: { filename: 'legal.pdf', targetLang: 'Russian', pageCount: 1 },
      inputData: await onePagePdf(), outputData: null, result: null,
      status: 'processing', progress: 0, attempts: 1, maxAttempts: 3,
      progressData: null, lastError: null,
      leaseOwner: 'worker-1', cancelRequested: false,
      availableAt: new Date(), leaseExpiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(), updatedAt: new Date(), completedAt: null,
    })).rejects.toThrow(/requires pipeline future-pipeline/);

    expect(mocks.extract).not.toHaveBeenCalled();
    expect(mocks.context).not.toHaveBeenCalled();
    expect(mocks.translate).not.toHaveBeenCalled();
  });

  it('flags a terminally failed page, delivers a banner draft, and completes the job', async () => {
    const { PdfxTranslationStopError } = await import('../request-budget');
    const source1 = layout(1, 'Биринчи саҳифа 100');
    const source2 = layout(2, 'Иккинчи саҳифа 200');
    const documentContext = {
      sourceLanguage: 'Uzbek', targetLanguage: 'Russian', documentType: 'Resolution',
      summary: 'Legal', preserveTerms: [], terminology: [],
    };
    mocks.findJob.mockResolvedValue({
      status: 'queued', output_pdf: null, total_pages: 2,
      document_context: documentContext,
      metrics: {
        requiredPipelineVersion: 'luna-layout-v5-native-2026-09-14',
        requiredModel: 'gpt-5.6-luna',
        pipelineVersion: 'luna-layout-v5-native-2026-09-14',
        model: 'gpt-5.6-luna',
      },
      pages: [
        { page_number: 1, status: 'extracted', source_layout: source1, translated_layout: null },
        { page_number: 2, status: 'extracted', source_layout: source2, translated_layout: null },
      ],
    });
    mocks.findPage
      .mockResolvedValueOnce({ status: 'extracted', translated_layout: null, validation: {} })
      .mockResolvedValueOnce({ status: 'extracted', translated_layout: null, validation: {} });
    mocks.translate.mockImplementation(async (source: PdfPageLayout) => {
      if (source.pageNumber === 1) {
        throw new PdfxTranslationStopError('OpenAI could not translate source page 1 safely: unresolved review failure.');
      }
      return {
        translation: { pageNumber: 2, warnings: [], elements: [{ id: 'e001', text: 'Вторая страница 200', cells: [] }] },
        layout: source2, attempts: 1, validation: { valid: true, failures: [], warnings: [] },
        model: 'gpt-5.6-luna', responseId: 'translation-2', inputTokens: 30, outputTokens: 15,
      };
    });
    mocks.render.mockImplementationOnce(async (_pages: unknown, outputPath: string) => {
      const fs = await import('node:fs/promises');
      await fs.writeFile(outputPath, await onePagePdf());
    });

    const { processPdfTranslationV2Job } = await import('../pipeline');
    await processPdfTranslationV2Job({
      id: '11111111-1111-4111-8111-111111111111',
      jobType: 'pdf_translation_v5_native', userId: 7,
      payload: { filename: 'legal.pdf', targetLang: 'Russian', pageCount: 2 },
      inputData: await twoPagePdf(), outputData: null, result: null,
      status: 'processing' as const, progress: 10, attempts: 1, maxAttempts: 3,
      progressData: null, lastError: null,
      leaseOwner: 'worker-1', cancelRequested: false,
      availableAt: new Date(), leaseExpiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(), updatedAt: new Date(), completedAt: null,
    });

    expect(mocks.updatePage).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'translation_error' }),
    }));
    expect(mocks.complete).toHaveBeenCalledTimes(1);
    const completion = (mocks.complete.mock.calls[0] as unknown[])[3] as {
      outputPdf: Buffer; message: string; result: { flaggedPages: number };
    };
    expect(completion.message).toContain('1 page needs review');
    expect(completion.result.flaggedPages).toBe(1);
    const draft = await PDFDocument.load(completion.outputPdf);
    expect(draft.getPageCount()).toBe(2);
    expect(draft.getTitle()).toContain('DRAFT');
  });

  it('still fails the whole job on a transient provider error so the queue retries it', async () => {
    const source1 = layout(1, 'Биринчи саҳифа 100');
    const documentContext = {
      sourceLanguage: 'Uzbek', targetLanguage: 'Russian', documentType: 'Resolution',
      summary: 'Legal', preserveTerms: [], terminology: [],
    };
    mocks.findJob.mockResolvedValue({
      status: 'queued', output_pdf: null, total_pages: 1,
      document_context: documentContext,
      metrics: {
        requiredPipelineVersion: 'luna-layout-v5-native-2026-09-14',
        requiredModel: 'gpt-5.6-luna',
        pipelineVersion: 'luna-layout-v5-native-2026-09-14',
        model: 'gpt-5.6-luna',
      },
      pages: [
        { page_number: 1, status: 'extracted', source_layout: source1, translated_layout: null },
      ],
    });
    mocks.findPage.mockResolvedValueOnce({ status: 'extracted', translated_layout: null, validation: {} });
    mocks.translate.mockRejectedValue(new Error('fetch failed: ETIMEDOUT'));

    const { processPdfTranslationV2Job } = await import('../pipeline');
    await expect(processPdfTranslationV2Job({
      id: '11111111-1111-4111-8111-111111111111',
      jobType: 'pdf_translation_v5_native', userId: 7,
      payload: { filename: 'legal.pdf', targetLang: 'Russian', pageCount: 1 },
      inputData: await onePagePdf(), outputData: null, result: null,
      status: 'processing' as const, progress: 10, attempts: 1, maxAttempts: 3,
      progressData: null, lastError: null,
      leaseOwner: 'worker-1', cancelRequested: false,
      availableAt: new Date(), leaseExpiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(), updatedAt: new Date(), completedAt: null,
    })).rejects.toThrow(/ETIMEDOUT/);
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  describe('document translation memory for repeated headers', () => {
    const HEADER = '221-сон 04.05.2026. Барқарор ривожланиш ва корпоратив бошқарув тамойиллари';
    const HEADER_RU = '№ 221 от 04.05.2026. Принципы устойчивого развития и корпоративного управления';
    const documentContext = {
      sourceLanguage: 'Uzbek', targetLanguage: 'Russian', documentType: 'Resolution',
      summary: 'Legal', preserveTerms: [], terminology: [],
    };
    const withHeader = (pageNumber: number, body: string): PdfPageLayout => ({
      ...layout(pageNumber, body),
      elements: [
        { id: 'e001', kind: 'header', order: 0, level: 0, translate: true, text: HEADER,
          bbox: [15, 21, 447, 31], columnCount: 0, rowCount: 0, rows: [] },
        { ...layout(pageNumber, body).elements[0], id: 'e002', order: 1, bbox: [50, 100, 950, 300] },
      ],
    });
    const source1 = withHeader(1, 'Биринчи саҳифа 100');
    const source2 = withHeader(2, 'Иккинчи саҳифа 200');
    const bodyRu: Record<number, string> = { 1: 'Первая страница 100', 2: 'Вторая страница 200' };
    const job = async () => ({
      id: '11111111-1111-4111-8111-111111111111',
      jobType: 'pdf_translation_v6' as const, userId: 7,
      payload: { filename: 'legal.pdf', targetLang: 'Russian' as const, pageCount: 2 },
      inputData: await twoPagePdf(), outputData: null, result: null,
      status: 'processing' as const, progress: 10, attempts: 1, maxAttempts: 3,
      progressData: null, lastError: null,
      leaseOwner: 'worker-1', cancelRequested: false,
      availableAt: new Date(), leaseExpiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(), updatedAt: new Date(), completedAt: null,
    });
    const extractedJob = (metrics: Record<string, unknown> = {}) => ({
      status: 'queued', output_pdf: null, total_pages: 2, document_context: documentContext,
      metrics: {
        requiredPipelineVersion: 'luna-layout-v5-native-2026-09-14', requiredModel: 'gpt-5.6-luna',
        pipelineVersion: 'luna-layout-v5-native-2026-09-14', model: 'gpt-5.6-luna', ...metrics,
      },
      pages: [
        { page_number: 1, status: 'extracted', source_layout: source1, translated_layout: null },
        { page_number: 2, status: 'extracted', source_layout: source2, translated_layout: null },
      ],
    });
    const ok = (source: PdfPageLayout, elements: { id: string; text: string; cells: never[] }[]) => ({
      translation: { pageNumber: source.pageNumber, warnings: [], elements },
      layout: source, attempts: 1, validation: { valid: true, failures: [], warnings: [] },
      model: 'gpt-5.6-luna', responseId: 'r', inputTokens: 10, outputTokens: 5,
    });
    const savedMemory = () => (mocks.updateJob.mock.calls as unknown as [{ data: { metrics?: { translationMemory?: unknown } } }][])
      .map(([args]) => args.data.metrics?.translationMemory)
      .filter(Boolean)
      .at(-1) as { entries: Record<string, string>; failure?: string } | undefined;

    it('translates the header once, then pins it on every page and translates only page bodies', async () => {
      mocks.findJob.mockResolvedValue(extractedJob());
      mocks.findPage.mockResolvedValue({ status: 'extracted', translated_layout: null, validation: {} });
      mocks.translate.mockImplementation(async (source: PdfPageLayout) => source.pageNumber === 1_000_000
        ? ok(source, [{ id: 's001', text: HEADER_RU, cells: [] }])
        : ok(source, source.elements.map((element) => ({ id: element.id, text: bodyRu[source.pageNumber], cells: [] }))));

      const { processPdfTranslationV2Job } = await import('../pipeline');
      await processPdfTranslationV2Job(await job());

      expect(mocks.translate).toHaveBeenCalledTimes(3);
      const calls = mocks.translate.mock.calls as unknown as [PdfPageLayout][];
      expect(calls[0][0].pageNumber).toBe(1_000_000);
      expect(calls.slice(1).map(([source]) => source.elements.map((element) => element.id))).toEqual([['e002'], ['e002']]);
      const rendered = mocks.render.mock.calls[0][0] as unknown as PdfPageLayout[];
      expect(rendered.map((page) => page.elements.map((element) => element.text))).toEqual([
        [HEADER_RU, 'Первая страница 100'],
        [HEADER_RU, 'Вторая страница 200'],
      ]);
      expect(Object.values(savedMemory()?.entries ?? {})).toEqual([HEADER_RU]);
      expect((mocks.complete.mock.calls[0] as unknown[])[3]).toMatchObject({ message: 'Done. 2 pages translated and validated.' });
    });

    it('keeps translating whole pages when the shared pass fails, adopting the first reviewed header', async () => {
      const { PdfxTranslationStopError } = await import('../request-budget');
      mocks.findJob.mockResolvedValue(extractedJob());
      mocks.findPage.mockResolvedValue({ status: 'extracted', translated_layout: null, validation: {} });
      mocks.translate.mockImplementation(async (source: PdfPageLayout) => {
        if (source.pageNumber === 1_000_000) throw new PdfxTranslationStopError('shared header rejected twice');
        return ok(source, source.elements.map((element) => ({
          id: element.id, text: element.id === 'e001' ? HEADER_RU : bodyRu[source.pageNumber], cells: [],
        })));
      });

      const { processPdfTranslationV2Job } = await import('../pipeline');
      await processPdfTranslationV2Job(await job());

      const calls = mocks.translate.mock.calls as unknown as [PdfPageLayout][];
      // Page 1 translates its own header; page 2 reuses the harvested rendering.
      expect(calls.slice(1).map(([source]) => source.elements.map((element) => element.id))).toEqual([['e001', 'e002'], ['e002']]);
      const memory = savedMemory();
      expect(memory?.failure).toBe('shared header rejected twice');
      expect(Object.values(memory?.entries ?? {})).toEqual([HEADER_RU]);
      expect(mocks.complete).toHaveBeenCalledTimes(1);
    });

    it('resumes a page with exactly the pins its saved checkpoint was computed from', async () => {
      const retained = { version: 'page-translation-v1', fingerprint: 'reduced-layout', passes: {} };
      mocks.findJob.mockResolvedValue(extractedJob({
        translationMemory: { version: 'shared-blocks-v1', keys: [], entries: {} },
      }));
      mocks.findPage
        .mockResolvedValueOnce({ status: 'extracted', translated_layout: null, validation: { translationRecovery: retained, pinnedFromMemory: { e001: HEADER_RU } } })
        .mockResolvedValueOnce({ status: 'extracted', translated_layout: null, validation: {} });
      mocks.translate.mockImplementation(async (source: PdfPageLayout) =>
        ok(source, source.elements.map((element) => ({ id: element.id, text: element.id === 'e001' ? HEADER_RU : bodyRu[source.pageNumber], cells: [] }))));

      const { processPdfTranslationV2Job } = await import('../pipeline');
      await processPdfTranslationV2Job(await job());

      const calls = mocks.translate.mock.calls as unknown as [PdfPageLayout, unknown, unknown, unknown, { resume?: unknown }][];
      // Memory is empty, but page 1 had pinned the header when it was checkpointed.
      expect(calls[0][0].elements.map((element) => element.id)).toEqual(['e002']);
      expect(calls[0][4].resume).toEqual(retained);
      expect(calls[1][0].elements.map((element) => element.id)).toEqual(['e001', 'e002']);
    });
  });
});
