import { NextResponse } from 'next/server';
import { esgPrisma } from '@esgcredit/db-esg';
import { requirePdfxUser } from '@/lib/pdfx-v2/auth';
import { isUuid } from '@/lib/jobs/queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await requirePdfxUser();
  if (auth.response) return auth.response;
  const searchParams = new URL(request.url).searchParams;
  const jobId = searchParams.get('jobId') ?? '';
  const pageParam = searchParams.get('page') ?? '';
  if (!isUuid(jobId)) return NextResponse.json({ error: 'Invalid jobId' }, { status: 400 });
  if (!/^[1-9]\d*$/.test(pageParam)) {
    return NextResponse.json({ error: 'Invalid page' }, { status: 400 });
  }
  const selectedPage = Number(pageParam);

  const job = await esgPrisma.pdf_translation_v2_jobs.findFirst({
    where: { id: jobId, user_id: auth.userId },
    select: {
      status: true,
      total_pages: true,
      pages: {
        where: { page_number: selectedPage },
        orderBy: { page_number: 'asc' },
        take: 1,
        select: {
          page_number: true,
          status: true,
          source_text: true,
          translated_text: true,
          source_layout: true,
          translated_layout: true,
          warnings: true,
          validation: true,
        },
      },
    },
  });
  if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (selectedPage > job.total_pages) {
    return NextResponse.json({ error: 'Page not found' }, { status: 404 });
  }
  const response = NextResponse.json({
    success: true,
    status: job.status,
    totalPages: job.total_pages,
    pages: job.pages.map((page) => ({
      pageNumber: page.page_number,
      status: page.status,
      originalText: page.source_text ?? '',
      translatedText: page.translated_text ?? '',
      sourceLayout: page.source_layout,
      translatedLayout: page.translated_layout,
      warnings: page.warnings,
      // Recovery candidates are unvalidated private worker state, not a page
      // preview or an approved layout. Never publish them through this API.
      validation: page.validation && typeof page.validation==='object' && ('extractionRecovery' in page.validation || 'denseTranslation' in page.validation || 'translationRecovery' in page.validation)
        ? null : page.validation,
    })),
  });
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
