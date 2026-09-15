import { describe, expect, it, vi } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/config/env', () => ({ env: {} }));
import { fetchCatalogEvidence } from '../research';
import { createExcelSourceSearch } from '../excel-source-search';
import { createWorkbookCheckpoint } from '../workbook';
import { normalizeWorkbookUrl } from '../workbook-types';
import { extractExcelHtml } from '../excel-extraction';

const url = 'https://example.org/listed';
const publicLookup = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]);
const html = '<html><head><meta property="article:published_time" content="2025-02-03"><meta property="article:modified_time" content="2026-08-01"></head><body><main><h1>Paris Agreement</h1><p>Climate disclosure and emissions targets concern the banking sector and countries around the world.</p><table><tr><th>Year</th><th>Countries</th></tr><tr><td>2026</td><td>140</td></tr></table></main></body></html>';

describe('exact worksheet URL boundary', () => {
  it('rejects an unlisted initial URL before DNS or HTTP', async () => {
    const fetchImpl = vi.fn(); publicLookup.mockClear();
    await expect(fetchCatalogEvidence('https://example.org/new', { allowedUrls: [url] }, { fetchImpl, lookupImpl: publicLookup })).rejects.toThrow('not listed');
    expect(fetchImpl).not.toHaveBeenCalled(); expect(publicLookup).not.toHaveBeenCalled();
  });
  it.each(['https://example.org/new', 'https://other.example/new', 'http://127.0.0.1/admin', '/listed?new=1'])('blocks an unlisted redirect to %s before fetching the next hop', async (location) => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location } }));
    await expect(fetchCatalogEvidence(url, { allowedUrls: [url] }, { fetchImpl, lookupImpl: publicLookup })).rejects.toThrow('not listed');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('allows only an explicitly listed redirect target and retains table data and dates', async () => {
    const target = 'https://example.org/report';
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: target } })).mockResolvedValueOnce(new Response(html, { headers: { 'content-type': 'text/html' } }));
    const result = await fetchCatalogEvidence(url, { allowedUrls: [url, target], searchableText: true }, { fetchImpl, lookupImpl: publicLookup });
    expect(result.contentSnippet).toContain('Year | Countries');
    expect(result.contentSnippet).toContain('2026 | 140');
    expect(result).toMatchObject({ finalUrl: target, publishedDate: '2025-02-03', updatedDate: '2026-08-01' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it('still blocks private destinations even if listed in a workbook', async () => {
    const fetchImpl = vi.fn();
    await expect(fetchCatalogEvidence('http://127.0.0.1/a', { allowedUrls: ['http://127.0.0.1/a'] }, { fetchImpl, lookupImpl: publicLookup })).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('reports a browser challenge as unavailable instead of treating the challenge HTML as evidence', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('<html><script src="/_Incapsula_Resource?challenge"></script><body></body></html>', { headers: { 'content-type': 'text/html' } }));
    await expect(fetchCatalogEvidence(url, { allowedUrls: [url], searchableText: true }, { fetchImpl, lookupImpl: publicLookup })).rejects.toThrow('browser verification challenge');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('normalizes document fragments while retaining query and path restrictions', () => {
    expect(normalizeWorkbookUrl(`${url}#page=2`)).toBe(url);
    expect(normalizeWorkbookUrl(`${url}?x=1`)).not.toBe(url);
  });
});

describe('searchable source extraction', () => {
  it('preserves short table cells and text well beyond the old first-block cutoff', () => {
    const content = extractExcelHtml(`<main>${'<p>Opening general material.</p>'.repeat(50)}<table><tr><th>Indicator</th><th>2026</th></tr><tr><td>Paris Agreement coverage</td><td>140</td></tr></table></main>`);
    expect(content).toContain('Paris Agreement coverage | 140');
  });
  it('searches PDF pages beyond page twelve and preserves the page location', async () => {
    const pdf = await PDFDocument.create(); const font = await pdf.embedFont(StandardFonts.Helvetica);
    for (let i = 1; i <= 14; i++) pdf.addPage([600, 800]).drawText(i === 14 ? 'Paris Agreement coverage reaches 140 countries in 2026. Banking disclosure obligations are material.' : `Introductory material on page ${i}.`, { x: 30, y: 700, size: 10, font });
    const bytes = await pdf.save();
    const fetchImpl = vi.fn().mockResolvedValue(new Response(new Uint8Array(bytes).buffer, { headers: { 'content-type': 'application/pdf' } }));
    const result = await fetchCatalogEvidence(url, { allowedUrls: [url], searchableText: true }, { fetchImpl, lookupImpl: publicLookup });
    expect(result.contentSnippet).toContain('Page 14:'); expect(result.contentSnippet).toContain('140 countries');
  });
  it('searches allowed sources once per run and preserves distinct citations', async () => {
    const checkpoint = createWorkbookCheckpoint({ country: 'UAE', sector: 'Banking', language: 'English' });
    checkpoint.allowedSources = [{ url, label: 'Test source', cells: ['G2'] }];
    const fetchEvidence = vi.fn(async () => ({ contentSnippet: extractExcelHtml(html), finalUrl: url, publishedDate: null, updatedDate: null, lastModified: null }));
    const search = createExcelSourceSearch(checkpoint, { fetchEvidence });
    const first = await search.search.invoke({ driverId: checkpoint.definitions[0].id });
    await search.search.invoke({ driverId: checkpoint.definitions[1].id });
    expect(first.passages.length).toBeGreaterThan(0); expect(first.passages[0].sourceId).toBe(first.sources[0].id);
    expect(fetchEvidence).toHaveBeenCalledTimes(1);
    expect(fetchEvidence).toHaveBeenCalledWith(url, { allowedUrls: [url], searchableText: true });
  });

  it('refreshes retained source metadata while preserving the driver citation passages', async () => {
    const checkpoint = createWorkbookCheckpoint({ country: 'UAE', sector: 'Banking', language: 'English' });
    checkpoint.allowedSources = [{ url, label: 'Test source', cells: ['G2'] }];
    const body = 'Paris Agreement coverage reaches 140 countries in 2026. Banking disclosure obligations are material. ';
    const fetchEvidence = vi.fn(async () => ({
      contentSnippet: body,
      finalUrl: url,
      publishedDate: null,
      updatedDate: null,
      lastModified: null,
      sourceDate: { value: 'November 2024', kind: 'version-issued' as const, evidence: 'Cover: November 2024', location: 'document cover' },
    }));
    const search = createExcelSourceSearch(checkpoint, { fetchEvidence });
    const found = await search.search.invoke({ driverId: checkpoint.definitions[0].id });
    const source = found.sources[0];
    const passage = found.passages[0];
    const driver = {
      id: 'retained-driver', driverSection: 'Global Drivers', driverType: 'General', driverTitle: 'Paris Agreement',
      driverText: 'Paris Agreement coverage.', countrySectorRelevance: 'UAE banking', evidenceKpi: 'Coverage', keySources: [url],
      sourceLinks: [url], confidence: 80, lastChecked: '2026-09-15', sourceRefs: [source.id], generationStatus: 'verified',
      citations: [{ sourceId: source.id, passageId: passage.id, quote: passage.text, location: passage.location }],
    } as import('../types').EsgDriver;

    const refreshed = await search.refreshRetainedSources(driver);
    expect(fetchEvidence).toHaveBeenCalledTimes(1);
    expect(refreshed).toHaveLength(1);
    expect(refreshed[0]).toMatchObject({ id: source.id, sourceDate: { value: 'November 2024', kind: 'version-issued' } });
    expect(refreshed[0].retrievedAt).toEqual(expect.any(String));
    expect(refreshed[0].passages).toEqual([{ id: passage.id, text: passage.text, location: passage.location }]);
    expect(refreshed[0].contentSnippet).toBe(passage.text);
  });

  it('throws when retained citation revalidation cannot resolve the original source version', async () => {
    const checkpoint = createWorkbookCheckpoint({ country: 'UAE', sector: 'Banking', language: 'English' });
    checkpoint.allowedSources = [{ url, label: 'Test source', cells: ['G2'] }];
    const fetchEvidence = vi.fn(async () => ({
      contentSnippet: 'Paris Agreement coverage reaches 140 countries in 2026. Banking disclosure obligations are material.',
      finalUrl: url,
      publishedDate: null,
      updatedDate: null,
      lastModified: null,
    }));
    const search = createExcelSourceSearch(checkpoint, { fetchEvidence });
    await expect(search.refreshRetainedSources({
      id: 'retained-driver', driverSection: 'Global Drivers', driverType: 'General', driverTitle: 'Paris Agreement',
      driverText: 'Paris Agreement coverage.', countrySectorRelevance: 'UAE banking', evidenceKpi: 'Coverage', keySources: [url],
      sourceLinks: [url], confidence: 80, lastChecked: '2026-09-15', sourceRefs: ['S-other-version'],
      citations: [{ sourceId: 'S-other-version', passageId: 'missing', quote: 'original quote', location: 'Page 1' }],
    } as import('../types').EsgDriver)).rejects.toThrow('revalidation failed');
  });
});
