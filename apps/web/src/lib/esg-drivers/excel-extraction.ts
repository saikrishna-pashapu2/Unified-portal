import * as cheerio from 'cheerio';
import { getPdfJsStandardFontDataUrl } from '@/lib/pdfjs-node';

export const MAX_EXCEL_SOURCE_CHARS = 500_000;
const MAX_PDF_PAGES = 500;

/** Preserve headings, complete tables, and paragraphs before ranking passages. */
export function extractExcelHtml(html: string): string {
  const $ = cheerio.load(html);
  $('script, style, noscript, svg, nav, footer, header, form').remove();
  $('table').each((_, table) => {
    const lines: string[] = [];
    $(table).find('tr').each((__, tr) => {
      lines.push($(tr).find('th, td').map((___, td) => $(td).text().replace(/\s+/g, ' ').trim()).get().join(' | '));
    });
    $(table).replaceWith($('<p>').text(`Table:\n${lines.join('\n')}`));
  });
  $('br').replaceWith('\n');
  $('p, li, h1, h2, h3, h4, section, div').append('\n');
  const root = $('main').length ? $('main') : $('article').length ? $('article') : $('body');
  const text = root.text().replace(/[\t\r ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (text.length > MAX_EXCEL_SOURCE_CHARS) throw new Error('Source exceeds the searchable text limit (500,000 characters).');
  return text;
}

export async function extractExcelPdf(buffer: Buffer): Promise<string> {
  return (await extractExcelPdfDocument(buffer)).text;
}

export async function extractExcelPdfDocument(buffer: Buffer): Promise<{ text: string; title?: string }> {
  const globals = globalThis as typeof globalThis & { DOMMatrix?: unknown; Path2D?: unknown };
  globals.DOMMatrix ||= class {} as unknown as typeof DOMMatrix;
  globals.Path2D ||= class {} as unknown as typeof Path2D;
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(buffer), useWorkerFetch: false, isEvalSupported: false, disableFontFace: true, standardFontDataUrl: getPdfJsStandardFontDataUrl(), verbosity: pdfjs.VerbosityLevel.ERRORS });
  const document = await task.promise;
  try {
    if (document.numPages > MAX_PDF_PAGES) throw new Error('PDF exceeds the searchable page limit (500 pages).');
    let text = '';
    for (let n = 1; n <= document.numPages; n++) {
      const page = await document.getPage(n);
      const content = await page.getTextContent();
      text += `\n\nPage ${n}:\n` + content.items.map((item) => 'str' in item ? `${item.str}${item.hasEOL ? '\n' : ' '}` : '').join('');
      page.cleanup();
      if (text.length > MAX_EXCEL_SOURCE_CHARS) throw new Error('PDF exceeds the searchable text limit (500,000 characters).');
    }
    const metadata = await document.getMetadata().catch(() => null);
    const title = (metadata?.info as { Title?: unknown } | undefined)?.Title;
    return { text: text.trim(), ...(typeof title === 'string' ? { title } : {}) };
  } finally { await document.destroy(); }
}
