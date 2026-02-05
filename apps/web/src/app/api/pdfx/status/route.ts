import { NextResponse } from 'next/server';
import { esgPrisma } from '@esgcredit/db-esg';
import { JobStore } from '@/lib/pdfx/store';
import { ensureUserId } from '@/lib/auth-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const userId = await ensureUserId();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get('jobId') || '';

    const mem = JobStore.get(jobId);
    if (mem) {
      // Verify the job belongs to the current user
      if (mem.userId !== userId) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      
      const { pages, ...rest } = mem;
      // don't send heavy text here
      return NextResponse.json({
        success: true,
        job: { ...rest, totalPages: mem.totalPages, currentPage: mem.currentPage },
      });
    }

    // fallback to DB
    const row = await esgPrisma.pdf_translation_jobs.findUnique({ where: { id: jobId } });
    if (!row || row.user_id !== userId) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      job: {
        id: row.id,
        userId: row.user_id,
        filename: row.filename,
        storedFilename: row.stored_filename,
        inputPath: row.input_path,
        targetLang: row.target_lang,
        status: row.status,
        message: row.message,
        progress: row.progress,
        totalPages: row.total_pages,
        currentPage: row.current_page,
        outputPath: row.output_path,
      },
    });
  } catch (error) {
    console.error('Error fetching PDF status:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}