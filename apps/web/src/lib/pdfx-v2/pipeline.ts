import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { esgPrisma } from '@esgcredit/db-esg';
import type { ClaimedBackgroundJob } from '@/lib/jobs/queue';
import {
  completePdfTranslationV2Job,
  createBackgroundJobData,
  rethrowBackgroundJobEnqueueError,
  throwIfJobCancelled,
  updateBackgroundJobProgress,
} from '@/lib/jobs/queue';
import {
  DocumentContextSchema,
  parseStoredPdfPageLayout,
  type DocumentContext,
  type PdfPageLayout,
  type StoredPdfPageLayout,
} from './schemas';
import {
  buildDocumentContext,
  extractPageWithOpenAi,
  translatePageWithOpenAi,
  defaultPdfxV2Requester,
} from './openai';
import { budgetedRequester, emptyRequestLedger, type RequestLedger } from './request-budget';
import { renderPdfxV2Document } from './render';
import { mergePageTranslation, pageLayoutToPlainText } from './serialize';
import type { PdfxV2JobPayload, PdfxV2Stage } from './types';
import {
  isPdfxV2QueueJobType,
  PDFX_V2_MODEL,
  PDFX_V2_PIPELINE_VERSION,
  PDFX_V2_QUEUE_JOB_TYPE,
  PDFX_V2_RENDERER_VERSION,
} from './constants';

type StoredMetrics = {
  requestLedger?: RequestLedger;
  requiredPipelineVersion?: string;
  requiredModel?: string;
  pipelineVersion?: string;
  model?: string;
  rendererVersion?: string;
  contextInputTokens?: number;
  contextOutputTokens?: number;
  contextModel?: string;
  contextResponseId?: string;
};

// Worker replays cannot extend the durable per-page API allowance.
export const PDF_TRANSLATION_MAX_ATTEMPTS = 3;

function jsonValue(value: unknown): any {
  return JSON.parse(JSON.stringify(value));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseContext(value: unknown): DocumentContext | null {
  const parsed = DocumentContextSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

type SplitPdfPage = {
  pdf: Buffer;
  pageWidthPoints: number;
  pageHeightPoints: number;
};

async function splitPdfPages(input: Buffer): Promise<SplitPdfPage[]> {
  const source = await PDFDocument.load(input, { updateMetadata: false });
  const count = source.getPageCount();
  if (count < 1) {
    throw new Error('PDF must contain at least one page');
  }

  const pages: SplitPdfPage[] = [];
  for (let index = 0; index < count; index += 1) {
    const document = await PDFDocument.create();
    const [page] = await document.copyPages(source, [index]);
    document.addPage(page);
    const size = source.getPage(index).getSize();
    const sourceRotation = source.getPage(index).getRotation().angle;
    const sideways = Math.abs(sourceRotation % 180) === 90;
    pages.push({
      pdf: Buffer.from(await document.save({ useObjectStreams: false })),
      pageWidthPoints: sideways ? size.height : size.width,
      pageHeightPoints: sideways ? size.width : size.height,
    });
  }
  return pages;
}

function withPhysicalPageSize(
  layout: PdfPageLayout,
  page: SplitPdfPage,
): StoredPdfPageLayout {
  return {
    ...layout,
    pageWidthPoints: page.pageWidthPoints,
    pageHeightPoints: page.pageHeightPoints,
  };
}

export async function startPdfTranslationV2Job(params: {
  jobId?: string;
  userId: number;
  filename: string;
  targetLang: PdfxV2JobPayload['targetLang'];
  pageCount: number;
  inputBuffer: Buffer;
}): Promise<string> {
  const jobId = params.jobId ?? randomUUID();
  const payload: PdfxV2JobPayload = {
    filename: params.filename,
    targetLang: params.targetLang,
    pageCount: params.pageCount,
  };

  try {
    await esgPrisma.$transaction([
      esgPrisma.pdf_translation_v2_jobs.create({
        data: {
          id: jobId,
          user_id: params.userId,
          filename: params.filename,
          target_lang: params.targetLang,
          status: 'queued',
          stage: 'queued',
          message: 'Queued for OpenAI page analysis',
          progress: 0,
          total_pages: params.pageCount,
          current_page: 0,
          // Requirements are written by the web process. Actual pipeline/model
          // fields are stamped only by the worker that really processed the
          // job, so an old worker can never masquerade as the current build.
          metrics: {
            requiredPipelineVersion: PDFX_V2_PIPELINE_VERSION,
            requiredModel: PDFX_V2_MODEL,
          },
          input_pdf: params.inputBuffer,
        },
      }),
      esgPrisma.background_jobs.create({
        data: createBackgroundJobData({
          id: jobId,
          jobType: PDFX_V2_QUEUE_JOB_TYPE,
          userId: params.userId,
          payload,
          inputData: params.inputBuffer,
          maxAttempts: PDF_TRANSLATION_MAX_ATTEMPTS,
        }),
      }),
    ]);
  } catch (error) {
    rethrowBackgroundJobEnqueueError(error);
  }
  return jobId;
}

export async function processPdfTranslationV2Job(
  job: ClaimedBackgroundJob<PdfxV2JobPayload>,
): Promise<{ queueCompleted: true; result: Record<string, unknown> }> {
  if (!job.inputData) throw new Error('PDF Translator input is missing');
  if (!isPdfxV2QueueJobType(job.jobType)) {
    throw new Error(`Unsupported PDF Translator queue type: ${job.jobType}`);
  }

  const existing = await esgPrisma.pdf_translation_v2_jobs.findFirst({
    where: { id: job.id, user_id: job.userId },
    include: { pages: { orderBy: { page_number: 'asc' } } },
  });
  if (!existing) throw new Error('PDF Translator job record is missing');

  if (existing.status === 'completed' && existing.output_pdf) {
    const result = {
      pages: existing.total_pages,
      reused: true,
      translator: 'openai-structured-v2',
    };
    await completePdfTranslationV2Job(job.id, job.userId, job.leaseOwner, {
      jobType: job.jobType,
      outputPdf: Buffer.from(existing.output_pdf),
      metrics: existing.metrics,
      result,
      message: `Done. ${existing.total_pages} ${existing.total_pages === 1 ? 'page' : 'pages'} translated.`,
    });
    return { queueCompleted: true, result };
  }

  const priorMetrics = (existing.metrics && typeof existing.metrics === 'object'
    ? existing.metrics
    : {}) as StoredMetrics;
  const checkpointCompatible =
    priorMetrics.pipelineVersion === PDFX_V2_PIPELINE_VERSION &&
    priorMetrics.model === PDFX_V2_MODEL;
  let storedMetrics: StoredMetrics = {
    ...(checkpointCompatible ? priorMetrics : {}),
    requestLedger: priorMetrics.requestLedger ?? emptyRequestLedger(),
    requiredPipelineVersion: PDFX_V2_PIPELINE_VERSION,
    requiredModel: PDFX_V2_MODEL,
    pipelineVersion: PDFX_V2_PIPELINE_VERSION,
    model: PDFX_V2_MODEL,
  };

  const workDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfx-v2-'));
  const outputPath = path.join(workDirectory, `${job.id}-translated.pdf`);
  const requester = budgetedRequester(defaultPdfxV2Requester, storedMetrics.requestLedger!, async (ledger, response) => {
    await throwIfJobCancelled(job.id, job.leaseOwner);
    storedMetrics.requestLedger = ledger;
    if (response?.stage === 'context') {
      storedMetrics.contextInputTokens = (storedMetrics.contextInputTokens ?? 0) + response.inputTokens;
      storedMetrics.contextOutputTokens = (storedMetrics.contextOutputTokens ?? 0) + response.outputTokens;
    }
    const operations: any[] = [esgPrisma.pdf_translation_v2_jobs.updateMany({
      where: { id: job.id, user_id: job.userId, status: 'processing' },
      data: { metrics: jsonValue(storedMetrics) },
    })];
    if (response && response.page > 0) {
      operations.push(esgPrisma.pdf_translation_v2_pages.upsert({
        where: { job_id_page_number: { job_id: job.id, page_number: response.page } },
        create: { job_id: job.id, page_number: response.page, status: 'extracting', warnings: [],
          input_tokens: response.inputTokens, output_tokens: response.outputTokens },
        update: { input_tokens: { increment: response.inputTokens }, output_tokens: { increment: response.outputTokens } },
      }));
    }
    const [saved] = await esgPrisma.$transaction(operations);
    if ((saved as { count: number }).count !== 1) throw new Error('Translation is no longer active');
  });

  const reportProgress = async (
    progress: number,
    stage: PdfxV2Stage,
    message: string,
    currentPage = 0,
  ) => {
    await throwIfJobCancelled(job.id, job.leaseOwner);
    await updateBackgroundJobProgress(job.id, job.leaseOwner, progress, {
      stage,
      message,
      currentPage,
      totalPages: job.payload.pageCount,
    });
    const update = await esgPrisma.pdf_translation_v2_jobs.updateMany({
      where: {
        id: job.id,
        user_id: job.userId,
        status: { in: ['queued', 'processing'] },
      },
      data: {
        status: 'processing',
        stage,
        message,
        progress,
        current_page: currentPage,
      },
    });
    if (update.count !== 1) {
      await throwIfJobCancelled(job.id, job.leaseOwner);
      throw new Error('PDF Translator job is no longer active');
    }
  };

  try {
    await reportProgress(3, 'extracting', 'Preparing PDF pages…');
    if (!checkpointCompatible) {
      // Never combine pages extracted by an older geometry contract or a
      // different model with the current Luna-only output. This runs only for
      // active jobs; completed historical translations remain untouched.
      await esgPrisma.$transaction([
        esgPrisma.pdf_translation_v2_pages.deleteMany({
          where: { job_id: job.id },
        }),
        esgPrisma.pdf_translation_v2_jobs.updateMany({
          where: { id: job.id, user_id: job.userId, status: 'processing' },
          data: {
            // Store an invalid/empty context sentinel. Prisma JSON fields use
            // a special database-null type; parseContext deliberately rejects
            // this value and rebuilds it on the next attempt if needed.
            document_context: jsonValue({}),
            metrics: jsonValue(storedMetrics),
          },
        }),
      ]);
    }
    const pagePdfs = await splitPdfPages(job.inputData);
    if (pagePdfs.length !== job.payload.pageCount) {
      throw new Error('Uploaded PDF page count changed during processing');
    }

    const persistedPages = new Map(
      (checkpointCompatible ? existing.pages : []).map((page) => [page.page_number, page]),
    );
    const sourceLayouts: StoredPdfPageLayout[] = [];

    for (let index = 0; index < pagePdfs.length; index += 1) {
      const pageNumber = index + 1;
      const prior = persistedPages.get(pageNumber);
      const storedLayout = parseStoredPdfPageLayout(prior?.source_layout);
      if (storedLayout) {
        sourceLayouts.push(withPhysicalPageSize(storedLayout, pagePdfs[index]));
        continue;
      }

      await reportProgress(
        5 + Math.round((index / Math.max(1, pagePdfs.length)) * 40),
        'extracting',
        `OpenAI is reading source page ${pageNumber}/${pagePdfs.length}…`,
        pageNumber,
      );
      let extracted: Awaited<ReturnType<typeof extractPageWithOpenAi>>;
      try {
        extracted = await extractPageWithOpenAi(
          pagePdfs[index].pdf,
          pageNumber,
          job.payload.targetLang,
          requester,
        );
      } catch (error) {
        await esgPrisma.pdf_translation_v2_pages.upsert({
          where: { job_id_page_number: { job_id: job.id, page_number: pageNumber } },
          create: {
            job_id: job.id,
            page_number: pageNumber,
            status: 'extraction_error',
            error_message: errorMessage(error),
            warnings: [],
          },
          update: {
            status: 'extraction_error',
            error_message: errorMessage(error),
          },
        });
        throw error;
      }
      await throwIfJobCancelled(job.id, job.leaseOwner);
      const extractedLayout = withPhysicalPageSize(extracted.layout, pagePdfs[index]);
      sourceLayouts.push(extractedLayout);
      await esgPrisma.pdf_translation_v2_pages.upsert({
        where: { job_id_page_number: { job_id: job.id, page_number: pageNumber } },
        create: {
          job_id: job.id,
          page_number: pageNumber,
          status: 'extracted',
          source_layout: jsonValue(extractedLayout),
          source_text: pageLayoutToPlainText(extractedLayout),
          extraction_model: extracted.model,
          extraction_attempts: extracted.attempts,
          warnings: jsonValue(extractedLayout.warnings),
        },
        update: {
          status: 'extracted',
          source_layout: jsonValue(extractedLayout),
          source_text: pageLayoutToPlainText(extractedLayout),
          extraction_model: extracted.model,
          extraction_attempts: extracted.attempts,
          warnings: jsonValue(extractedLayout.warnings),
          error_message: null,
        },
      });
    }

    let context = checkpointCompatible ? parseContext(existing.document_context) : null;
    if (!context) {
      await reportProgress(47, 'context', 'Building document terminology context…');
      const contextResult = await buildDocumentContext(
        sourceLayouts,
        job.payload.targetLang,
        requester,
      );
      context = contextResult.context;
      storedMetrics = {
        ...storedMetrics,
        contextInputTokens: storedMetrics.contextInputTokens ?? contextResult.inputTokens,
        contextOutputTokens: storedMetrics.contextOutputTokens ?? contextResult.outputTokens,
        contextModel: contextResult.model,
        contextResponseId: contextResult.responseId,
      };
      await throwIfJobCancelled(job.id, job.leaseOwner);
      await esgPrisma.pdf_translation_v2_jobs.updateMany({
        where: { id: job.id, user_id: job.userId, status: 'processing' },
        data: {
          document_context: jsonValue(context),
          metrics: jsonValue(storedMetrics),
        },
      });
    }

    const translatedLayouts: StoredPdfPageLayout[] = [];
    for (let index = 0; index < sourceLayouts.length; index += 1) {
      const source = sourceLayouts[index];
      const pageNumber = source.pageNumber;
      const current = await esgPrisma.pdf_translation_v2_pages.findUnique({
        where: { job_id_page_number: { job_id: job.id, page_number: pageNumber } },
      });
      const storedTranslation = parseStoredPdfPageLayout(current?.translated_layout);
      if (current?.status === 'translated' && storedTranslation) {
        translatedLayouts.push(withPhysicalPageSize(storedTranslation, pagePdfs[index]));
        continue;
      }

      await reportProgress(
        50 + Math.round((index / Math.max(1, sourceLayouts.length)) * 42),
        'translating',
        `Translating and validating page ${pageNumber}/${sourceLayouts.length}…`,
        pageNumber,
      );
      let translated: Awaited<ReturnType<typeof translatePageWithOpenAi>>;
      try {
        translated = await translatePageWithOpenAi(
          source,
          context,
          job.payload.targetLang,
          requester,
        );
      } catch (error) {
        await esgPrisma.pdf_translation_v2_pages.update({
          where: { job_id_page_number: { job_id: job.id, page_number: pageNumber } },
          data: {
            status: 'translation_error',
            error_message: errorMessage(error),
          },
        });
        throw error;
      }
      await throwIfJobCancelled(job.id, job.leaseOwner);
      const merged = mergePageTranslation(source, translated.translation) as StoredPdfPageLayout;
      translatedLayouts.push(merged);
      await esgPrisma.pdf_translation_v2_pages.update({
        where: { job_id_page_number: { job_id: job.id, page_number: pageNumber } },
        data: {
          status: 'translated',
          translated_layout: jsonValue(merged),
          translated_text: pageLayoutToPlainText(merged),
          translation_model: translated.model,
          translation_attempts: translated.attempts,
          validation: jsonValue(translated.validation),
          warnings: jsonValue(merged.warnings),
          error_message: null,
        },
      });
    }

    await reportProgress(94, 'rendering', 'Rendering translated tables and text…');
    await renderPdfxV2Document(translatedLayouts, outputPath, job.inputData);
    const outputPdf = await fs.readFile(outputPath);

    const usage = await esgPrisma.pdf_translation_v2_pages.aggregate({
      where: { job_id: job.id },
      _sum: { input_tokens: true, output_tokens: true },
    });
    const metrics = {
      ...storedMetrics,
      pageInputTokens: usage._sum.input_tokens ?? 0,
      pageOutputTokens: usage._sum.output_tokens ?? 0,
      sourcePages: sourceLayouts.length,
      translator: 'openai-structured-v2',
      pipelineVersion: PDFX_V2_PIPELINE_VERSION,
      model: PDFX_V2_MODEL,
      rendererVersion: PDFX_V2_RENDERER_VERSION,
    };
    const result = {
      pages: sourceLayouts.length,
      translator: 'openai-structured-v2',
      targetLanguage: job.payload.targetLang,
      pipelineVersion: PDFX_V2_PIPELINE_VERSION,
      model: PDFX_V2_MODEL,
      rendererVersion: PDFX_V2_RENDERER_VERSION,
    };
    await throwIfJobCancelled(job.id, job.leaseOwner);
    await completePdfTranslationV2Job(job.id, job.userId, job.leaseOwner, {
      jobType: job.jobType,
      outputPdf,
      metrics,
      result,
      message: `Done. ${sourceLayouts.length} ${sourceLayouts.length === 1 ? 'page' : 'pages'} translated and validated.`,
    });
    return { queueCompleted: true, result };
  } finally {
    await fs.rm(workDirectory, { recursive: true, force: true });
  }
}
