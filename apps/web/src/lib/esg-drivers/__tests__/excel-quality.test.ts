import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/config/env', () => ({ env: {} }));
import { fetchExcelSource } from '../excel-source-retrieval';
import { documentDates, extractHtmlSourceDateMetadata, extractSourceDate, isPlausibleSourceDate, sourceDateOptions, sourceDocumentTitle } from '../excel-source-metadata';
import { selectExcelPassages } from '../excel-source-search';
import { hasSuggestedEvidenceKpi, hasUnverifiedPriMapping, hasCurrentNzbaClaimFromOldReport } from '../quality-policy';
import { workbookResultFixture } from './workbook-result.fixture';

const url = 'https://example.org/approved.pdf';
const text = 'The approved source establishes a national emissions target and the corresponding baseline, reporting period and sectoral scope. '.repeat(3);
const lookupImpl = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]);
const blocked = () => vi.fn().mockRejectedValue(new Error('Source returned a browser verification challenge instead of readable evidence.'));

describe('exact-URL extraction fallback', () => {
  it('recovers content for exactly the requested URL without search or link discovery', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: [{ url, raw_content: text, title: null }] })));
    const result = await fetchExcelSource(url, { allowedUrls: [url], searchableText: true }, { directFetch: blocked(), fetchImpl, lookupImpl, apiKey: 'test-reader-key' });
    expect(result).toMatchObject({ finalUrl: url, contentSnippet: text.trim(), retrievalMethod: 'tavily-extract', publishedDate: null, lastModified: null });
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.tavily.com/extract');
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.urls).toEqual([url]); expect(body.query).toBeUndefined(); expect(body.chunks_per_source).toBeUndefined();
    expect(fetchImpl.mock.calls[0][1].redirect).toBe('error');
  });
  it('never uses the reader to bypass an unlisted URL or redirect', async () => {
    const fetchImpl = vi.fn(); const directFetch = vi.fn().mockRejectedValue(new Error('Source URL is not listed in the selected Excel worksheet.'));
    await expect(fetchExcelSource(url, { allowedUrls: [] }, { directFetch, fetchImpl, apiKey: 'test' })).rejects.toThrow('not listed');
    await expect(fetchExcelSource(url, { allowedUrls: [url] }, { directFetch, fetchImpl, apiKey: 'test' })).rejects.toThrow('not listed');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('rejects a reader result from another page, even when that page is also listed', async () => {
    const other = 'https://example.org/other';
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: [{ url: other, raw_content: text }] })));
    await expect(fetchExcelSource(url, { allowedUrls: [url, other] }, { directFetch: blocked(), fetchImpl, lookupImpl, apiKey: 'test' })).rejects.toThrow('different source');
  });
  it('blocks private destinations before sending a URL to the remote reader', async () => {
    const privateUrl = 'http://127.0.0.1/internal'; const fetchImpl = vi.fn();
    await expect(fetchExcelSource(privateUrl, { allowedUrls: [privateUrl] }, { directFetch: blocked(), fetchImpl, apiKey: 'test' })).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each(['Verify you are human. '.repeat(20), 'x'.repeat(500_001)])('rejects challenge or oversized extracted text', async (raw_content) => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: [{ url, raw_content }] })));
    await expect(fetchExcelSource(url, { allowedUrls: [url] }, { directFetch: blocked(), fetchImpl, lookupImpl, apiKey: 'test' })).rejects.toThrow();
  });
});

describe('source metadata and evidence selection', () => {
  it('keeps old NZBA reports historical rather than asserting current institutional status', () => {
    const name = 'Net-Zero Banking Alliance (NZBA)';
    expect(hasCurrentNzbaClaimFromOldReport(name, 'The Net-Zero Banking Alliance is an initiative. Its members commit to targets.', 'dated-update', 'December 2023')).toBe(true);
    expect(hasCurrentNzbaClaimFromOldReport(name, 'The Net-Zero Banking Alliance is an initiative.', 'historical', 'December 2023')).toBe(true);
    expect(hasCurrentNzbaClaimFromOldReport(name, 'The report described the alliance; members committed to targets in 2023.', 'historical', 'December 2023')).toBe(false);
    expect(hasCurrentNzbaClaimFromOldReport('IFRS S1', 'IFRS S1 is a framework.', 'framework-reference', 'January 2024')).toBe(false);
  });
  it('rejects secondary numbered PRI mappings even when attributed, without rejecting general reporting roles', () => {
    const name = 'Principles for Responsible Investment (PRI)';
    const mapping = 'CDP states that its programme supports PRI Principles 1 to 4.';
    expect(hasUnverifiedPriMapping(name, mapping, ['https://www.cdp.net/en/capital-markets-signatories'])).toBe(true);
    expect(hasUnverifiedPriMapping(name, mapping, ['https://www.unpri.org/'])).toBe(false);
    expect(hasUnverifiedPriMapping(name, mapping, ['https://unpri.org.example.com/'])).toBe(true);
    expect(hasUnverifiedPriMapping(name, 'OECD guidance refers to PRI signatory reporting requirements.', ['https://www.oecd.org/report'])).toBe(false);
  });
  it('limits date choices to written source dates and years without inventing ISO components', () => {
    expect(sourceDateOptions('Issued in December 2025. Effective 1 January 2027.')).toEqual(['December 2025', '1 January 2027', '2025', '2027']);
    expect(sourceDateOptions('This undated framework describes disclosure.')).toEqual([]);
    expect(sourceDateOptions('Published July 2025.')).not.toContain('2025-07-01');
  });
  it('separates publication, amendment, effective and event dates without assigning bare target years', () => {
    const dates = documentDates('Issued in December 2025. Effective from 1 January 2027. As of 30 September 2023 there were members. Net zero by 2050.');
    expect(dates.map(({ kind, value }) => ({ kind, value }))).toEqual([
      { kind: 'publication', value: 'December 2025' }, { kind: 'effective', value: '1 January 2027' }, { kind: 'event', value: '30 September 2023' },
    ]);
    expect(sourceDocumentTitle('Ignored', '<h1>IFRS S2 Climate-related Disclosures</h1>')).toBe('IFRS S2 Climate-related Disclosures');
    expect(documentDates('In December 2025, the ISSB issued amendments to the standard.')[0]).toMatchObject({ kind: 'publication', value: 'December 2025' });
  });
  it('does not promote an unrelated body event or target date to the source document date', () => {
    expect(extractSourceDate({
      title: 'Water scarcity',
      text: 'The policy was adopted in 2016. Net zero by 2050. Banks assess water scarcity risks.',
    })).toBeNull();
  });
  it('uses explicit own-page metadata before body dates and excludes HTTP headers', () => {
    const html = '<html><head><meta property="article:published_time" content="2024-11"><meta property="article:modified_time" content="2025-02-03"></head><body><main><h1>Climate disclosure report</h1><p>An event occurred on 2026-01-01.</p></main></body></html>';
    expect(extractHtmlSourceDateMetadata(html)).toMatchObject({ publishedDate: '2024-11', updatedDate: '2025-02-03' });
    expect(extractSourceDate({ html, text: 'An event occurred on 2026-01-01.' })).toMatchObject({ kind: 'updated', value: '2025-02-03', location: 'HTML meta[property="article:modified_time"]' });
  });
  it('rejects future metadata and target times while accepting a plausible semantic own timestamp', () => {
    const future = '<meta property="article:published_time" content="2099-01-01"><h1>Climate report</h1>';
    expect(extractHtmlSourceDateMetadata(future).sourceDates).toEqual([]);
    const target = '<main><h1>Climate report</h1><p>Updated target to be achieved by <time datetime="2030-01-01">2030</time></p></main>';
    expect(extractHtmlSourceDateMetadata(target).sourceDates).toEqual([]);
    expect(extractSourceDate({ html: target })).toBeNull();
    const own = '<main><h1>Climate report</h1><p><time itemprop="datePublished" datetime="2024-11-01">Published</time></p></main>';
    expect(extractSourceDate({ html: own })).toMatchObject({ kind: 'published', value: '2024-11-01' });
  });
 it.each([
   ['United Arab Emirates Third NDC 3.0 November 2024', 'November 2024'],
   ['Net-Zero Banking Alliance Progress Report December 2023', 'December 2023'],
 ])('recognises a source-owned cover/title date without inventing day precision', (title, value) => {
   expect(extractSourceDate({ title })).toMatchObject({ kind: 'version-issued', value });
 });
  it('captures a CBUAE issued date when DOM text nodes run together and excludes its regulation identifier year', () => {
   const html = '<main><h1>Climate-related Financial Risk Management Regulation<span>C 8/2025</span><span>Issued on </span><span>14/10/2025</span><span>Status: In-Force</span></h1></main>';
   const sourceDate = extractSourceDate({ html });
    expect(sourceDate).toMatchObject({ kind: 'version-issued', value: '14/10/2025', location: 'document opening / labelled metadata' });
   expect(sourceDate?.evidence).toContain('14/10/2025 Status: In-Force');
   expect(sourceDateOptions('Climate-related Financial Risk Management Regulation C 8/2025')).not.toContain('2025');
   expect(sourceDateOptions('Climate-related Financial Risk Management Regulation C 8/2025 Issued on 14/10/2025Status: In-Force')).toContain('14/10/2025');
 });
  it('distinguishes explicit publication, issuance, and semantic time labels', () => {
    expect(extractSourceDate({ text: 'Page 1:\nIssued on 5th of November 2024' })).toMatchObject({ kind: 'version-issued', value: '5th of November 2024' });
    expect(extractSourceDate({ text: 'Page 1:\nDate of issue: November 2024' })).toMatchObject({ kind: 'version-issued', value: 'November 2024' });
    expect(extractSourceDate({ text: 'Page 1:\nPublished on November 2024' })).toMatchObject({ kind: 'published', value: 'November 2024' });
    expect(extractSourceDate({ text: 'Page 1:\nReleased on November 2024' })).toMatchObject({ kind: 'published', value: 'November 2024' });

    const html = '<head><meta property="article:published_time" content="2024-01-01"><meta property="article:modified_time" content="2024-02-01"></head><main><p>Issued on <time datetime="2024-03-01">1 March 2024</time></p></main>';
    expect(extractHtmlSourceDateMetadata(html).sourceDates.map(({ kind, value }) => ({ kind, value }))).toEqual([
      { kind: 'updated', value: '2024-02-01' },
      { kind: 'published', value: '2024-01-01' },
      { kind: 'version-issued', value: '2024-03-01' },
    ]);
    const semanticPublished = '<main><p>Issued on <time itemprop="datePublished" datetime="2024-03-01">1 March 2024</time></p></main>';
    expect(extractHtmlSourceDateMetadata(semanticPublished).sourceDates).toMatchObject([{ kind: 'published', value: '2024-03-01' }]);
  });
 it('does not treat a CBUAE regulation identifier year as a source date without an issuance label', () => {
    const html = '<main><h1>Climate-related Financial Risk Management Regulation<span>C 8/2025</span><span>Status: In-Force</span></h1></main>';
   expect(extractSourceDate({ html })).toBeNull();
   expect(extractSourceDate({ text: 'Page 1:\nClimate-related Financial Risk Management Regulation C 8/2025' })).toBeNull();
    expect(extractSourceDate({ text: 'Page 1:\nClimate report\nRegulation C 8/2025 issued on 14/10/2025 Status: In-Force' })).toBeNull();
   expect(extractSourceDate({ text: 'Page 1:\nPublished: 2025' })).toMatchObject({ kind: 'published', value: '2025' });
  });
 it('does not treat an annual report year as its publication date without an issuance label', () => {
   expect(extractSourceDate({ title: 'Bank of America Annual Report 2016' })).toBeNull();
 });
  it('recognises a PDF cover date while ignoring later report/event dates', () => {
    const text = 'Page 1:\nNet-Zero Banking Alliance Progress Report\nDecember 2023\nPage 2:\nThe alliance reported members in 2024 and targets for 2030.';
    expect(extractSourceDate({ text })).toMatchObject({ kind: 'version-issued', value: 'December 2023', location: 'document cover / opening text' });
  });
  it('requires opening publication labels to be metadata-like rather than prose about another report', () => {
    expect(extractSourceDate({ text: 'Page 1:\nClimate disclosure framework\nThe report was published July 2023.' })).toBeNull();
    expect(extractSourceDate({ text: 'Page 1:\nClimate disclosure framework\nPublication date: November 2024.' })).toMatchObject({ kind: 'published', value: 'November 2024' });
  });
  it('keeps known body event dates out of sourceDate while retaining an explicit day-month publication label', () => {
    expect(extractSourceDate({ title: 'SBFN report', text: 'As of July 2026 SBFN brings together 105 member institutions.' })).toBeNull();
    expect(extractSourceDate({ title: 'UNEP FI ESRS guidance', text: 'In July 2025, EFRAG proposed changes to reporting requirements.' })).toBeNull();
    expect(extractSourceDate({ text: 'Page 1:\nPublished on 5th of November 2024' })).toMatchObject({ kind: 'published', value: '5th of November 2024' });
  });
  it('rejects impossible and future source-owned dates conservatively', () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 8, 15));
    try {
     expect(extractSourceDate({ title: 'Climate report February 30, 2024' })).toBeNull();
     expect(extractSourceDate({ title: 'Climate report 2050 target' })).toBeNull();
      expect(isPlausibleSourceDate('September 15, 2026')).toBe(true);
      expect(isPlausibleSourceDate('September 16, 2026')).toBe(false);
      expect(isPlausibleSourceDate('September 17, 2026')).toBe(false);
      expect(isPlausibleSourceDate('September 2026')).toBe(true);
     expect(isPlausibleSourceDate('September 30, 2026')).toBe(false);
      expect(isPlausibleSourceDate('30/09/2026')).toBe(false);
      expect(isPlausibleSourceDate('09/30/2026')).toBe(false);
      expect(extractSourceDate({ text: 'Page 1:\nPublication date: 2024' })).toMatchObject({ kind: 'published', value: '2024' });
      expect(extractSourceDate({ text: 'Page 1:\nVersion 2024' })).toMatchObject({ kind: 'version-issued', value: '2024' });
      expect(extractSourceDate({ title: 'Climate report 2024' })).toBeNull();
    } finally {
      nowSpy.mockRestore();
    }
  });
  it('reserves a newer amendment and applicability passage despite many older high keyword matches', () => {
    const { checkpoint, source } = workbookResultFixture(1);
    const driver = { ...checkpoint.definitions[0], name: 'IFRS S2', sourceUrls: [url] };
    const contents = [
      ...Array.from({ length: 12 }, () => 'IFRS S2 climate reporting banking disclosure requirements. '.repeat(20)),
      'IFRS S2: In December 2025, the ISSB issued amendments to greenhouse gas emissions disclosures.',
      'Scope and applicability: This regulation applies to Banks and Insurance Companies.',
    ];
    const passages = contents.map((text, i) => ({ id: i === 12 ? 'zz-newest-amendment' : `p${i}`, sourceId: source.id, url, text, location: `paragraph ${i}` }));
    const selected = selectExcelPassages(driver, [{ source: { ...source, url }, passages }], 'UAE');
    expect(selected.map((p) => p.id)).toContain('zz-newest-amendment'); expect(selected.map((p) => p.id)).toContain('p13');
    expect(selected.length).toBeLessThanOrEqual(6);
  });
  it('prioritizes country-specific evidence over a similar foreign-country passage', () => {
    const { checkpoint, source } = workbookResultFixture(1);
    const driver = { ...checkpoint.definitions[0], name: 'Water scarcity', section: 'UAE', sourceUrls: [] };
    const rows = ['Water scarcity in Saudi Arabia affects economic activity.', 'Water scarcity in the UAE affects economic activity.'];
    const selected = selectExcelPassages(driver, rows.map((text, i) => ({ source: { ...source, id: `s${i}`, url: `https://example.org/${i}` }, passages: [{ id: `p${i}`, sourceId: `s${i}`, url: `https://example.org/${i}`, text, location: 'paragraph 1' }] })), 'UAE');
    expect(selected[0].id).toBe('p1');
  });
  it.each(['UAE NDC 3.0', 'Water scarcity'])('preserves the PDF cover date when researching %s', (name) => {
    const { checkpoint, source } = workbookResultFixture(1);
    const driver = { ...checkpoint.definitions[0], name, section: 'UAE', sourceUrls: [url] };
    const texts = ['The United Arab Emirates Third NDC 3.0. November 2024.', ...Array.from({ length: 12 }, () => 'UAE NDC national emissions targets and water scarcity for banking. '.repeat(20))];
    const passages = texts.map((text, i) => ({ id: `p${i}`, sourceId: source.id, url, text, location: `Page ${i + 1}` }));
    const selected = selectExcelPassages(driver, [{ source: { ...source, url }, passages }], 'UAE');
    expect(selected.map((p) => p.id)).toContain('p0');
    expect(selected.some((p) => p.text.includes('national emissions targets'))).toBe(true);
  });
  it('rejects suggested KPIs without rejecting factual regulatory monitoring requirements', () => {
    expect(hasSuggestedEvidenceKpi('Proposed monitoring KPI: number of transactions screened.')).toBe(true);
    expect(hasSuggestedEvidenceKpi('Relevant readiness KPIs include coverage.')).toBe(true);
    expect(hasSuggestedEvidenceKpi('The regulation requires internal systems for monitoring material risks.')).toBe(false);
    expect(hasSuggestedEvidenceKpi('ICMA recommended external reviews in June 2025.')).toBe(false);
    expect(hasSuggestedEvidenceKpi('Предлагаемые показатели: доля проверенных кредитов.')).toBe(true);
    expect(hasSuggestedEvidenceKpi('Предложенная метрика: охват портфеля.')).toBe(true);
    expect(hasSuggestedEvidenceKpi('مؤشر أداء مقترح: نسبة القروض التي تمت مراجعتها.')).toBe(true);
    expect(hasSuggestedEvidenceKpi('Стандарт предусматривает рекомендуемые показатели раскрытия.')).toBe(false);
  });
});
