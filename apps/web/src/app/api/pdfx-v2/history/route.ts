import { NextResponse } from 'next/server';
import { esgPrisma } from '@esgcredit/db-esg';
import { requirePdfxUser } from '@/lib/pdfx-v2/auth';
import { parsePdfxV2Pagination } from '@/lib/pdfx-v2/pagination';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await requirePdfxUser();
  if (auth.response) return auth.response;
  const pagination = parsePdfxV2Pagination(new URL(request.url).searchParams);
  if (!pagination) return NextResponse.json({ error: 'Invalid pagination' }, { status: 400 });
  const [items, total] = await Promise.all([
    esgPrisma.pdf_translation_v2_jobs.findMany({
      where: { user_id: auth.userId },
      orderBy: { created_at: 'desc' },
      skip: pagination.skip,
      take: pagination.pageSize,
      select: {
        id: true,
        filename: true,
        target_lang: true,
        status: true,
        stage: true,
        message: true,
        progress: true,
        total_pages: true,
        created_at: true,
        _count: {
          select: {
            pages: { where: { status: { in: ['extraction_error', 'translation_error'] } } },
          },
        },
      },
    }),
    esgPrisma.pdf_translation_v2_jobs.count({ where: { user_id: auth.userId } }),
  ]);
  const response = NextResponse.json({
    items: items.map(({ _count, ...item }) => ({
      ...item,
      flaggedPages: ['completed', 'error'].includes(item.status) ? _count.pages : 0,
      message: item.status === 'error'
        ? 'Translation could not continue automatically. Please contact support.'
        : item.message,
      canDownload: item.status === 'completed',
    })),
    total,
    page: pagination.page,
    size: pagination.pageSize,
  });
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
