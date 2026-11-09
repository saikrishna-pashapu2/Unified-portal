import { NextResponse } from 'next/server';
import { esgPrisma } from '@esgcredit/db-esg';
import { requirePdfxUser } from '@/lib/pdfx-v2/auth';
import { isUuid } from '@/lib/jobs/queue';
import { resetPageLedger, type RequestLedger } from '@/lib/pdfx-v2/request-budget';
import { preparePageRerunRecovery } from '@/lib/pdfx-v2/rerun-recovery';
import { PDFX_V2_MODEL, PDFX_V2_PIPELINE_VERSION } from '@/lib/pdfx-v2/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RerunParams = { jobId: string };

class RerunRaceError extends Error {
  constructor() {
    super('The PDF page rerun became stale while it was being queued.');
    this.name = 'RerunRaceError';
  }
}

function cloneMetrics(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  try {
    const clone = JSON.parse(JSON.stringify(value)) as unknown;
    return clone && typeof clone === 'object' && !Array.isArray(clone)
      ? clone as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

/**
 * Re-runs a single flagged page of a finished translation job. An
 * extraction-stage failure reruns OCR and then translation for that page; a
 * translation-stage failure keeps the paid extraction and reruns only
 * translation. The user's click grants that page one fresh bounded request
 * budget; every other page keeps its saved checkpoints and is not re-billed.
 */
export async function POST(
  request: Request,
  context: { params: Promise<RerunParams> },
) {
  const auth = await requirePdfxUser();
  if (auth.response) return auth.response;

  const { jobId } = await context.params;
  if (!isUuid(jobId)) {
    return NextResponse.json({ error: 'Invalid jobId' }, { status: 400 });
  }
  let pageNumber = 0;
  try {
    const body = await request.json();
    pageNumber = Number(body?.pageNumber);
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > 10_000) {
    return NextResponse.json({ error: 'Invalid pageNumber' }, { status: 400 });
  }

  try {
    const job = await esgPrisma.pdf_translation_v2_jobs.findFirst({
      where: { id: jobId, user_id: auth.userId },
      select: {
        status: true,
        metrics: true,
        pages: {
          where: { page_number: pageNumber },
          take: 1,
          select: { status: true, validation: true },
        },
      },
    });
    if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!['completed', 'error'].includes(job.status)) {
      return NextResponse.json(
        { error: 'This translation is still active. Wait for it to finish before rerunning a page.' },
        { status: 409 },
      );
    }
    const pageStatus = job.pages[0]?.status;
    if (pageStatus !== 'extraction_error' && pageStatus !== 'translation_error') {
      return NextResponse.json(
        { error: 'Only a flagged page can be rerun.' },
        { status: 409 },
      );
    }
    const stage = pageStatus === 'extraction_error' ? 'extraction' : 'translation';

    const metrics = cloneMetrics(job.metrics) as {
      requestLedger?: RequestLedger;
      pageRerun?: { pageNumber: number; stage: 'extraction' | 'translation' };
    } & Record<string, unknown>;
    if (metrics.pipelineVersion !== PDFX_V2_PIPELINE_VERSION || metrics.model !== PDFX_V2_MODEL) {
      return NextResponse.json({
        error: 'This job uses an older translation checkpoint format. A page-only rerun cannot safely reuse it; no pages or request budgets were changed.',
      }, { status: 409 });
    }

    const outcome = await esgPrisma.$transaction(async (transaction) => {
      const queue = await transaction.background_jobs.updateMany({
        where: {
          id: jobId,
          user_id: auth.userId,
          status: { in: ['done', 'error'] },
        },
        data: {
          status: 'queued',
          attempts: 0,
          last_error: null,
          completed_at: null,
          lease_owner: null,
          lease_expires_at: null,
          cancel_requested: false,
          available_at: new Date(),
          updated_at: new Date(),
        },
      });
      if (queue.count !== 1) return { requeued: false };

      // Only prepare durable state after the queue compare-and-set succeeds.
      // A concurrent rerun therefore cannot mutate the caller's metrics
      // snapshot or accidentally commit a second page reset.
      const rerunRecovery = preparePageRerunRecovery(job.pages[0]?.validation, stage);
      if (rerunRecovery.reason) {
        console.warn(`[pdfx-v2] ${rerunRecovery.reason} Page ${pageNumber} of ${jobId}.`);
      }
      if (metrics.requestLedger) {
        metrics.requestLedger = resetPageLedger(metrics.requestLedger, pageNumber, stage);
      }
      // Scope the worker's terminal-page skip to this explicit user action.
      // This marker is written only after the queue CAS succeeds, so an
      // ordinary queue retry cannot silently inherit a rerun-only scope.
      metrics.pageRerun = { pageNumber, stage };

      const page = await transaction.pdf_translation_v2_pages.updateMany({
        where: { job_id: jobId, page_number: pageNumber, status: pageStatus },
        data: stage === 'extraction'
          ? {
              status: 'pending',
              error_message: null,
              validation: rerunRecovery.validation as never,
              source_layout: null as never,
              source_text: null,
              translated_layout: null as never,
              translated_text: null,
              extraction_attempts: 0,
              translation_attempts: 0,
            }
          : {
              status: 'extracted',
              error_message: null,
              validation: rerunRecovery.validation as never,
              translated_layout: null as never,
              translated_text: null,
              translation_attempts: 0,
            },
      });
      if (page.count !== 1) throw new RerunRaceError();

      const domain = await transaction.pdf_translation_v2_jobs.updateMany({
        where: { id: jobId, user_id: auth.userId, status: { in: ['completed', 'error'] } },
        data: {
          status: 'queued',
          stage: 'queued',
          message: `Re-running ${stage === 'extraction' ? 'OCR and translation' : 'translation'} for page ${pageNumber}…`,
          progress: 0,
          completed_at: null,
          metrics: JSON.parse(JSON.stringify(metrics)),
        },
      });
      if (domain.count !== 1) throw new RerunRaceError();
      return { requeued: true };
    });

    if (!outcome.requeued) {
      return NextResponse.json(
        { error: 'This job changed while queuing the rerun. Refresh and try again.' },
        { status: 409 },
      );
    }
    return NextResponse.json({ success: true, jobId, pageNumber, stage });
  } catch (error) {
    if (error instanceof RerunRaceError) {
      return NextResponse.json(
        { error: 'This job changed while queuing the rerun. Refresh and try again.' },
        { status: 409 },
      );
    }
    console.error(`[pdfx-v2] Failed to rerun page ${pageNumber} of ${jobId}`, error);
    return NextResponse.json({ error: 'Unable to rerun this page right now.' }, { status: 500 });
  }
}
