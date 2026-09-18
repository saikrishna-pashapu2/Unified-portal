import { NextResponse } from 'next/server';
import { esgPrisma } from '@esgcredit/db-esg';
import { requirePdfxUser } from '@/lib/pdfx-v2/auth';
import { isUuid } from '@/lib/jobs/queue';
import { resetPageLedger, type RequestLedger } from '@/lib/pdfx-v2/request-budget';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RerunParams = { jobId: string };

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
          select: { status: true },
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

    const metrics = (job.metrics && typeof job.metrics === 'object' ? job.metrics : {}) as {
      requestLedger?: RequestLedger;
    } & Record<string, unknown>;
    if (metrics.requestLedger) {
      metrics.requestLedger = resetPageLedger(metrics.requestLedger, pageNumber, stage);
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
      await transaction.pdf_translation_v2_pages.updateMany({
        where: { job_id: jobId, page_number: pageNumber, status: pageStatus },
        data: stage === 'extraction'
          ? {
              status: 'pending',
              error_message: null,
              validation: {},
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
              validation: {},
              translated_layout: null as never,
              translated_text: null,
              translation_attempts: 0,
            },
      });
      await transaction.pdf_translation_v2_jobs.updateMany({
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
    console.error(`[pdfx-v2] Failed to rerun page ${pageNumber} of ${jobId}`, error);
    return NextResponse.json({ error: 'Unable to rerun this page right now.' }, { status: 500 });
  }
}
