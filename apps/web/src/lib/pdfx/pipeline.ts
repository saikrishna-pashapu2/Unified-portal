import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { esgPrisma } from '@esgcredit/db-esg';
import { JobStore } from './store';
import { extractAllPages, ocrPageToText } from './extract';
import { translatePage } from './translate';
import { buildTranslatedPdf } from './buildPdf';
import { JobState, PageRecord } from './types';

export async function startPdfJob(
  params: {
    jobId: string;
    userId: number;
    filename: string;
    storedFilename: string;
    inputPath: string;
    targetLang: string;
    baseDir: string; // .pdfx_store
  }
) {
  const {
    jobId, userId, filename, storedFilename, inputPath, targetLang, baseDir,
  } = params;

  const uploadsDir = path.join(baseDir, 'uploads');
  const outputsDir = path.join(baseDir, 'outputs');
  await fs.mkdir(outputsDir, { recursive: true });

  const job: JobState = {
    id: jobId,
    userId,
    filename,
    storedFilename,
    inputPath,
    targetLang,
    status: 'processing',
    message: 'Queued',
    progress: 0,
    totalPages: 0,
    currentPage: 0,
    pages: [],
    createdAt: Date.now(),
  };

  JobStore.set(job);

  // persist initial row (created_at/updated_at handled by Prisma defaults)
  await esgPrisma.pdf_translation_jobs.create({
    data: {
      id: jobId,
      user_id: userId,
      filename,
      stored_filename: storedFilename,
      input_path: inputPath,
      target_lang: targetLang,
      status: 'processing',
      message: 'Queued',
      progress: 0,
      total_pages: 0,
      current_page: 0,
      pages: [],
      translated_pages: [],
    },
  });

  // run in background (don't await here in route)
  (async () => {
    try {
      console.log(`[PDF Job ${jobId}] Starting job for file: ${filename}`);
      JobStore.update(jobId, { message: 'Analyzing PDF…', progress: 5 });

      // 1) Extract all pages (initial text + OCR flags)
      console.log(`[PDF Job ${jobId}] Extracting pages from: ${inputPath}`);
      let pages = await extractAllPages(inputPath);
      console.log(`[PDF Job ${jobId}] Extracted ${pages.length} pages`);
      JobStore.update(jobId, {
        totalPages: pages.length,
        pages,
        message: `Extracting ${pages.length} pages…`,
        progress: 10,
      });
      await esgPrisma.pdf_translation_jobs.update({
        where: { id: jobId },
        data: {
          total_pages: pages.length,
          pages,
          current_page: 0,
          progress: 10,
        },
      });

      // 2) For pages flagged needsOcr, run OCR page-wise
      const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdfx-'));
      console.log(`[PDF Job ${jobId}] OCR work directory: ${workDir}`);
      for (let i = 0; i < pages.length; i++) {
        const p = pages[i];
        if (JobStore.get(jobId)?.stopRequested) throw new Error('Job stopped');

        JobStore.update(jobId, {
          currentPage: p.pageNumber,
          message: `Extracting page ${p.pageNumber}/${pages.length}…`,
          progress: 10 + Math.round((i / Math.max(1, pages.length)) * 25),
        });

        if (p.needsOcr || !p.originalText?.trim()) {
          console.log(`[PDF Job ${jobId}] Running OCR on page ${p.pageNumber}...`);
          const txt = await ocrPageToText(inputPath, p.pageNumber, workDir);
          p.originalText = txt || p.originalText || '';
          console.log(`[PDF Job ${jobId}] OCR completed for page ${p.pageNumber}, text length: ${txt.length}`);
        }
        p.status = 'extracted';
        JobStore.update(jobId, { pages: [...pages] });
      }

      await esgPrisma.pdf_translation_jobs.update({
        where: { id: jobId },
        data: { pages },
      });

      // 3) Translate each page
      console.log(`[PDF Job ${jobId}] Starting translation to ${targetLang}...`);
      for (let i = 0; i < pages.length; i++) {
        const p = pages[i];
        if (JobStore.get(jobId)?.stopRequested) throw new Error('Job stopped');

        JobStore.update(jobId, {
          currentPage: p.pageNumber,
          message: `Translating page ${p.pageNumber}/${pages.length}…`,
          progress: 35 + Math.round((i / Math.max(1, pages.length)) * 55),
        });

        const safeSource = p.originalText || '';
        console.log(`[PDF Job ${jobId}] Translating page ${p.pageNumber}, source length: ${safeSource.length}`);
        const translated = await translatePage(safeSource, targetLang);
        p.translatedText = translated;
        p.status = 'translated';
        console.log(`[PDF Job ${jobId}] Translation completed for page ${p.pageNumber}, length: ${translated.length}`);

        JobStore.update(jobId, { pages: [...pages] });

        // flush periodically to DB to keep payloads live
        if (i % 3 === 0 || i === pages.length - 1) {
          await esgPrisma.pdf_translation_jobs.update({
            where: { id: jobId },
            data: { translated_pages: pages },
          });
        }
      }

      // 4) Build translated PDF
      console.log(`[PDF Job ${jobId}] Building translated PDF...`);
      JobStore.update(jobId, { message: 'Building translated PDF…', progress: 95 });
      const outPath = path.join(outputsDir, `${jobId}_translated.pdf`);
      await buildTranslatedPdf(pages, outPath);
      console.log(`[PDF Job ${jobId}] PDF built successfully: ${outPath}`);

      // Read the PDF file and store it in database
      const pdfBuffer = await fs.readFile(outPath);
      console.log(`[PDF Job ${jobId}] PDF file size: ${pdfBuffer.length} bytes`);

      JobStore.update(jobId, {
        status: 'completed',
        message: `Done. ${pages.length} pages processed.`,
        progress: 100,
        outputPath: outPath,
      });

      await esgPrisma.pdf_translation_jobs.update({
        where: { id: jobId },
        data: {
          status: 'completed',
          message: `Done. ${pages.length} pages processed.`,
          progress: 100,
          output_path: outPath,
          output_pdf: pdfBuffer,
          translated_pages: pages,
          completed_at: new Date(),
        },
      });
    } catch (err: any) {
      const msg = err?.message || 'Translation failed';
      console.error(`[PDF Job ${jobId}] ERROR:`, err);
      console.error(`[PDF Job ${jobId}] Stack trace:`, err?.stack);
      JobStore.update(jobId, {
        status: 'error',
        message: msg,
        progress: 100,
      });
      await esgPrisma.pdf_translation_jobs.update({
        where: { id: jobId },
        data: { status: 'error', message: msg, progress: 100 },
      });
    }
  })();
  
  console.log(`[PDF Job ${jobId}] Background job initiated`);
}