import { NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import { esgPrisma } from '@esgcredit/db-esg';
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

    if (!jobId) {
      return NextResponse.json({ error: 'Missing jobId' }, { status: 400 });
    }

    const row = await esgPrisma.pdf_translation_jobs.findUnique({ where: { id: jobId } });
    if (!row || row.user_id !== userId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    
    if (!row.output_pdf && !row.output_path) {
      return NextResponse.json({ error: 'No output file yet' }, { status: 409 });
    }

    let buf: Buffer;
    
    // Try to get PDF from database first, fallback to file system
    if (row.output_pdf) {
      buf = Buffer.from(row.output_pdf);
      console.log(`Serving PDF from database for job ${jobId}, size: ${buf.length} bytes`);
    } else if (row.output_path) {
      // Fallback to file system (for old translations)
      try {
        buf = await fs.readFile(row.output_path);
        console.log(`Serving PDF from file system for job ${jobId}, size: ${buf.length} bytes`);
      } catch (fileError) {
        console.error(`Failed to read PDF from file system: ${row.output_path}`, fileError);
        return NextResponse.json({ error: 'File not found on disk' }, { status: 404 });
      }
    } else {
      return NextResponse.json({ error: 'No output file available' }, { status: 404 });
    }

    const filename = `translated_${row.filename.replace(/\.[^.]+$/, '')}.pdf`;

    return new NextResponse(buf as any, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('Error downloading PDF:', error);
    return NextResponse.json({ error: 'File not found on disk' }, { status: 404 });
  }
}