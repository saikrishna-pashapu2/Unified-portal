import { NextResponse } from 'next/server';
import { esgPrisma } from '@esgcredit/db-esg';
import { requirePdfxUser } from '@/lib/pdfx-v2/auth';
import { isUuid } from '@/lib/jobs/queue';
import { PDFX_V2_QUEUE_JOB_TYPES } from '@/lib/pdfx-v2/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await requirePdfxUser();
  if (auth.response) return auth.response;
  const jobId = new URL(request.url).searchParams.get('jobId') ?? '';
  if (!isUuid(jobId)) {
    return NextResponse.json({ error: 'Invalid jobId' }, { status: 400 });
  }

  const [row, queue] = await Promise.all([
    esgPrisma.pdf_translation_v2_jobs.findFirst({
      where: { id: jobId, user_id: auth.userId },
      select: {
        id: true,
        filename: true,
        target_lang: true,
        status: true,
        stage: true,
        message: true,
        progress: true,
        total_pages: true,
        current_page: true,
        created_at: true,
        completed_at: true,
        _count: {
          select: {
            pages: { where: { status: 'translated' } },
          },
        },
      },
    }),
    esgPrisma.background_jobs.findFirst({
      where: {
        id: jobId,
        user_id: auth.userId,
        job_type: { in: [...PDFX_V2_QUEUE_JOB_TYPES] },
      },
      select: { status: true, progress: true, attempts: true, max_attempts: true, last_error: true },
    }),
  ]);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const active = ['queued', 'processing', 'cancelling'].includes(row.status);
  let status = row.status;
  let message = row.message;
  let progress = row.progress;
  if (row.status === 'error') {
    message = 'Translation could not continue automatically. Please contact support.';
  } else if (active && queue?.status === 'error') {
    status = 'error';
    progress = 100;
    message = 'Translation could not continue automatically. Please contact support.';
  } else if (active && queue?.status === 'cancelled') {
    status = 'cancelled';
    progress = 100;
    message = 'Cancelled';
  } else if (active && queue?.status === 'processing') {
    status = 'processing';
    progress = Math.max(progress, queue.progress);
  } else if (active && queue?.status === 'done') {
    status = 'error';
    progress = 100;
    message = 'Translation output is unavailable';
  }

  const response = NextResponse.json({
    success: true,
    job: {
      id: row.id,
      filename: row.filename,
      targetLang: row.target_lang,
      status,
      stage: row.stage,
      message,
      progress,
      totalPages: row.total_pages,
      currentPage: row.current_page,
      completedPages: row._count.pages,
      attempts: queue?.attempts ?? 0,
      maxAttempts: queue?.max_attempts ?? 0,
      createdAt: row.created_at,
      completedAt: row.completed_at,
    },
  });
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
