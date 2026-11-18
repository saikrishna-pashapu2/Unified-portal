import { NextResponse } from 'next/server';
import { esgPrisma } from '@esgcredit/db-esg';
import { requirePdfxUser } from '@/lib/pdfx-v2/auth';
import { isUuid } from '@/lib/jobs/queue';
import {
  buildPdfContentDisposition,
  buildTranslatedPdfFilename,
  PDFX_V2_RENDERER_VERSION,
} from '@/lib/pdfx-v2/constants';
import { makeTranslatedPdfBytes } from '@/lib/pdfx-v2/makeTranslatedPdf';
import { parseStoredPdfPageLayout } from '@/lib/pdfx-v2/schemas';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const auth = await requirePdfxUser();
  if (auth.response) return auth.response;
  const jobId = new URL(request.url).searchParams.get('jobId') ?? '';
  if (!isUuid(jobId)) return NextResponse.json({ error: 'Invalid jobId' }, { status: 400 });
  const row = await esgPrisma.pdf_translation_v2_jobs.findFirst({
    where: { id: jobId, user_id: auth.userId },
    select: {
      filename: true,
      status: true,
      total_pages: true,
      output_pdf: true,
      metrics: true,
    },
  });
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (row.status !== 'completed' || !row.output_pdf) {
    return NextResponse.json({ error: 'Translation is not complete' }, { status: 409 });
  }
  const storedMetrics = row.metrics && typeof row.metrics === 'object' && !Array.isArray(row.metrics)
    ? row.metrics as Record<string, unknown>
    : {};
  let buffer: Buffer = Buffer.from(row.output_pdf);
  if (storedMetrics.rendererVersion !== PDFX_V2_RENDERER_VERSION) {
    const renderSource = await esgPrisma.pdf_translation_v2_jobs.findFirst({
      where: { id: jobId, user_id: auth.userId, status: 'completed' },
      select: {
        input_pdf: true,
        pages: {
          orderBy: { page_number: 'asc' },
          select: { translated_layout: true },
        },
      },
    });
    const layouts = renderSource?.pages
      .map((page) => parseStoredPdfPageLayout(page.translated_layout))
      .filter((layout) => layout !== null) ?? [];
    if (renderSource && row.total_pages > 0 && layouts.length === row.total_pages) {
      try {
        const rendered = await makeTranslatedPdfBytes(
          layouts,
          Buffer.from(renderSource.input_pdf),
          'PDF Translator',
        );
        buffer = rendered.bytes;
        const metrics = {
          ...storedMetrics,
          rendererVersion: PDFX_V2_RENDERER_VERSION,
        };
        await esgPrisma.pdf_translation_v2_jobs.updateMany({
          where: { id: jobId, user_id: auth.userId, status: 'completed' },
          data: {
            output_pdf: buffer,
            metrics: JSON.parse(JSON.stringify(metrics)),
          },
        });
      } catch (error) {
        console.error(`[pdfx-v2/download] Could not refresh ${jobId} with clean layout`, error);
      }
    }
  }
  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(buffer.length),
      'Content-Disposition': buildPdfContentDisposition(
        'attachment',
        buildTranslatedPdfFilename(row.filename),
      ),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
