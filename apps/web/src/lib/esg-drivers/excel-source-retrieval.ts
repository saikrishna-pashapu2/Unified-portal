import 'server-only';
import { z } from 'zod';
import { env } from '@/lib/config/env';
import { fetchCatalogEvidence, resolveSafePublicUrl, type CatalogEvidenceFetchResult, type ResearchNetworkDependencies } from './research';
import { assertWorkbookUrlAllowed, normalizeWorkbookUrl } from './workbook-types';
import { MAX_EXCEL_SOURCE_CHARS } from './excel-extraction';
import { documentDates, extractSourceDate, sourceDocumentTitle } from './excel-source-metadata';

const extractionSchema = z.object({ results: z.array(z.object({ url: z.string().url(), raw_content: z.string(), title: z.string().nullish() })).max(1) });
const MAX_READER_BYTES = 3 * 1024 * 1024;

async function boundedJson(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('The source reader returned an empty response.');
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_READER_BYTES) throw new Error('The source reader response exceeded the size limit.');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { await reader.cancel().catch(() => undefined); }
}

/** Extraction only: one workbook URL, no search query, link discovery, crawl, or generated answer. */
export async function fetchExcelSource(
  url: string,
  options: Parameters<typeof fetchCatalogEvidence>[1] = {},
  dependencies: ResearchNetworkDependencies & { directFetch?: typeof fetchCatalogEvidence; apiKey?: string } = {},
): Promise<CatalogEvidenceFetchResult> {
  const allowedUrls = options.allowedUrls || [url];
  assertWorkbookUrlAllowed(url, allowedUrls);
  try { return await (dependencies.directFetch || fetchCatalogEvidence)(url, options, dependencies); }
  catch (error) {
    const reason = error instanceof Error ? error.message : 'Source retrieval failed.';
    // Policy violations and unlisted redirects must never be routed around through another reader.
    if (!/browser verification challenge|not contain enough usable|timed out|fetch failed(?: with status (?:403|408|429|5\d\d))?\.?$|valid PDF/i.test(reason)) throw error;
    const key = dependencies.apiKey ?? env.TAVILY_API_KEY;
    if (!key) throw new Error(`${reason} The optional exact-URL reader is not configured (TAVILY_API_KEY).`);
    await resolveSafePublicUrl(url, dependencies);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 50_000);
    try {
      const response = await (dependencies.fetchImpl || fetch)('https://api.tavily.com/extract', {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: [normalizeWorkbookUrl(url)], extract_depth: 'advanced', format: 'text', include_images: false, include_favicon: false, timeout: 40 }),
      });
      if (!response.ok) { await response.body?.cancel(); throw new Error(`Exact-URL reader returned HTTP ${response.status}.`); }
      const parsed = extractionSchema.parse(await boundedJson(response));
      const item = parsed.results[0];
      if (!item) throw new Error('Exact-URL reader could not extract this permitted source.');
      assertWorkbookUrlAllowed(item.url, allowedUrls);
      if (normalizeWorkbookUrl(item.url) !== normalizeWorkbookUrl(url)) throw new Error('Exact-URL reader returned a different source URL.');
      const text = item.raw_content.trim();
      if (text.length < 150 || text.length > MAX_EXCEL_SOURCE_CHARS) throw new Error('Exact-URL reader returned insufficient or oversized text.');
      if (/^(?:access denied|just a moment|verify (?:that )?you are human|enable javascript)/i.test(text) || /_Incapsula_Resource|\/cdn-cgi\/challenge-platform\//i.test(text)) throw new Error('Exact-URL reader returned a browser verification challenge.');
      return {
        contentSnippet: text,
        finalUrl: item.url,
        title: item.title || sourceDocumentTitle(text),
        documentDates: documentDates(text),
        sourceDate: extractSourceDate({ text, title: item.title }),
        publishedDate: null,
        updatedDate: null,
        lastModified: null,
        retrievalMethod: 'tavily-extract',
        directRetrievalError: reason,
      };
    } catch (fallbackError) {
      const detail = controller.signal.aborted ? 'Exact-URL reader timed out.' : fallbackError instanceof z.ZodError ? 'Exact-URL reader returned an invalid response.' : fallbackError instanceof Error ? fallbackError.message : 'Exact-URL reader failed.';
      throw new Error(`${reason} ${detail}`);
    } finally { clearTimeout(timeout); }
  }
}
