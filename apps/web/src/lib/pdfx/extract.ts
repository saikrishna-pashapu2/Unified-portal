// Pure server-side text extractor (no canvas)
// DO NOT import pdfjs at top-level to keep the module cold on edge paths.

import fs from 'node:fs/promises';
import path from 'node:path';
import { execa } from 'execa';
import { PageRecord } from './types';

type PageText = { pageNumber: number; text: string };

function stubGraphicsIfNeeded() {
  // Avoid pdfjs trying to polyfill DOMMatrix/Path2D via node-canvas
  // These light stubs satisfy feature detection without rendering.
  const g: any = globalThis as any;
  if (!g.DOMMatrix) g.DOMMatrix = class {};
  if (!g.Path2D) g.Path2D = class {};
}

function normalize(text: string) {
  return (text || '').replace(/\n{3,}/g, '\n\n').trim();
}

function looksLikeScanned(text: string) {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  const words = clean ? clean.split(' ') : [];
  return words.length < 20; // heuristic => likely scanned
}

export async function extractPdfTextBuffer(fileBuf: Buffer): Promise<PageText[]> {
  console.log('[extractPdfTextBuffer] Starting extraction, buffer size:', fileBuf.length);
  stubGraphicsIfNeeded();

  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // Disable worker & font face for Node
  (pdfjs as any).GlobalWorkerOptions.workerSrc = undefined;

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(fileBuf),
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
  });

  const doc = await loadingTask.promise;
  const total = doc.numPages;
  console.log('[extractPdfTextBuffer] PDF loaded, total pages:', total);
  const pages: PageText[] = [];

  for (let i = 1; i <= total; i++) {
    const page = await doc.getPage(i);
    const textContent = await page.getTextContent();
    const text = textContent.items
      .map((it: any) => (typeof it.str === 'string' ? it.str : ''))
      .join('\n')
      .replace(/\s+\n/g, '\n')
      .trim();

    pages.push({ pageNumber: i, text });
  }

  await doc.cleanup();
  return pages;
}

export async function extractAllPages(inputPath: string): Promise<PageRecord[]> {
  console.log('[extractAllPages] Reading file:', inputPath);
  const data = await fs.readFile(inputPath);
  console.log('[extractAllPages] File read successfully, size:', data.length);
  const pageTexts = await extractPdfTextBuffer(data);
  console.log('[extractAllPages] Extracted text from', pageTexts.length, 'pages');
  
  return pageTexts.map(({ pageNumber, text }) => {
    const needsOcr = looksLikeScanned(text);
    console.log(`[extractAllPages] Page ${pageNumber}: text length=${text.length}, needsOcr=${needsOcr}`);
    return {
      pageNumber,
      originalText: normalize(text),
      translatedText: undefined,
      needsOcr,
      status: 'pending' as const,
    };
  });
}

/**
 * OCR a single page to text with `ocrmypdf`, writing a sidecar .txt
 * Supports 100+ languages through Tesseract OCR
 * 
 * Languages configured (can be customized):
 * - English, Arabic, Chinese (Simplified & Traditional)
 * - Russian, Spanish, French, German
 * - Japanese, Korean, Italian, Portuguese
 * - Turkish, Vietnamese, Hindi, Uzbek (Latin & Cyrillic)
 * 
 * To add more languages:
 * 1. Install language pack: sudo apt install tesseract-ocr-<lang>
 * 2. Add to languages array below
 * 
 * See: https://tesseract-ocr.github.io/tessdoc/Data-Files-in-different-versions.html
 */

// Extract a single page with OCR using ocrmypdf sidecar
export async function ocrPageToText(
  inputPath: string,
  pageNumber: number,
  workDir: string
): Promise<string> {
  // make a single-page PDF using qpdf (fast) if present, else ghostscript fallback
  const singlePdf = path.join(workDir, `page_${pageNumber}.pdf`);
  const sidecarTxt = path.join(workDir, `page_${pageNumber}.txt`);

  // Try qpdf split (optional). If missing, pdfcpu or pdftk also work; as a fallback we call ocrmypdf with --pages
  let splitOkay = true;
  try {
    await execa('qpdf', ['--empty', '--pages', inputPath, String(pageNumber), '--', singlePdf], {
      windowsHide: true,
    });
  } catch {
    splitOkay = false;
  }

  if (!splitOkay) {
    // fallback: let ocrmypdf process just one page into sidecar by copying whole file and using --pages
    // but sidecar will contain ALL processed text; to avoid mismatch we still pass a single-page file
    // try using pdfcpu if installed:
    try {
      await execa('pdfcpu', ['extract', '-pages', String(pageNumber), inputPath, workDir], {
        windowsHide: true,
      });
      // pdfcpu places a file, but different naming; if not available, we'll ask ocrmypdf to do page filter directly
    } catch {
      // last fallback: run ocrmypdf directly with page filter and the whole input
    }
  }

  try {
    // Prefer singlePdf if exists; otherwise point to original with --pages
    const src = splitOkay ? singlePdf : inputPath;

    // Use comprehensive language support for OCR
    // This covers most major languages used in business documents
    // You can customize this list based on your needs
    const languages = [
      'eng',        // English
      'ara',        // Arabic
      'chi_sim',    // Chinese Simplified
      'chi_tra',    // Chinese Traditional
      'rus',        // Russian
      'spa',        // Spanish
      'fra',        // French
      'deu',        // German
      'jpn',        // Japanese
      'kor',        // Korean
      'ita',        // Italian
      'por',        // Portuguese
      'tur',        // Turkish
      'vie',        // Vietnamese
      'hin',        // Hindi
      'uzb',        // Uzbek (Latin)
      'uzb_cyrl',   // Uzbek (Cyrillic)
    ].join('+');

    const args = [
      src,
      path.join(workDir, `ocr_${pageNumber}.pdf`),
      '--sidecar',
      sidecarTxt,
      '--jobs',
      '1',
      '-l',
      languages,
      '--rotate-pages',
      '--deskew',
    ];

    if (!splitOkay) {
      args.splice(1, 0, '--pages', String(pageNumber));
    }

    await execa('ocrmypdf', args, { windowsHide: true });
    const txt = await fs.readFile(sidecarTxt, 'utf8').catch(() => '');
    return (txt || '').trim();
  } catch (e) {
    // last resort: empty string
    return '';
  }
}
