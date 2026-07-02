import { NextResponse } from 'next/server';
import { esgPrisma } from '@esgcredit/db-esg';
import { ensureUserId } from '@/lib/auth-db';
import fs from 'node:fs/promises';

export const runtime = 'nodejs';

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const userId = await ensureUserId();
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { jobId } = await params;
    const job = await esgPrisma.pdf_translation_jobs.findUnique({
      where: { id: jobId }
    });

    if (!job || job.user_id !== userId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // Attempt to remove files (best-effort)
    const toDelete = [job.input_path, job.output_path].filter(Boolean) as string[];
    await Promise.allSettled(
      toDelete.map(async (filePath) => {
        try {
          await fs.unlink(filePath);
        } catch (error) {
          console.warn(`Failed to delete file ${filePath}:`, error);
        }
      })
    );

    // Delete the database record
    await esgPrisma.pdf_translation_jobs.delete({ where: { id: job.id } });
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting PDF job:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
