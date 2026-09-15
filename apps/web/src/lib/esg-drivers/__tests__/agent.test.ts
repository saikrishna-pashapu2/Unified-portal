import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ writer: vi.fn(), reviewer: vi.fn(), editorial: vi.fn(), relevance: vi.fn(), relevanceReview: vi.fn(), translation: vi.fn(), fetch: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/config/env', () => ({ env: { OPENAI_API_KEY: 'test', OPENAI_ESG_DRIVERS_MODEL: 'test' } }));
vi.mock('@langchain/openai', () => ({ ChatOpenAI: class { withStructuredOutput(_schema: unknown, options: { name: string }) { return { invoke: async (...args: unknown[]) => ({ parsed: await (options.name === 'excel_driver_update' ? mocks.writer : options.name === 'excel_driver_editorial_review' ? mocks.editorial : options.name === 'esg_driver_relevance_assessment' ? mocks.relevance : options.name === 'esg_driver_relevance_review' ? mocks.relevanceReview : options.name === 'esg_driver_relevance_translation' ? mocks.translation : mocks.reviewer)(...args), raw: { id: 'chatcmpl-test', response_metadata: { model_name: 'test-returned-model' } } }) }; } } }));
vi.mock('../research', () => ({ fetchCatalogEvidence: mocks.fetch }));
import { generateEsgDriverResult, removeInlineEvidenceIds, validateExcelDraft } from '../agent';
import { createWorkbookCheckpoint, selectWorkbookDrivers } from '../workbook';
import { DRIVER_SELECTION_POLICY } from '../ranking-policy';
import type { AnyEsgDriverCheckpoint, EsgWorkbookCheckpoint } from '../types';
import type { ExcelSearchResult } from '../excel-source-search';

const input = { country: 'UAE', sector: 'Banking', language: 'English' };
function snapshot(count = 2) {
  const checkpoint = createWorkbookCheckpoint(input);
  // These tests cover the historical full-workbook contract. Ranked reports
  // opt in explicitly through the checkpoint selection policy.
  delete checkpoint.selectionPolicy;
  checkpoint.definitions = checkpoint.definitions.slice(0, count);
  checkpoint.allowedSources = checkpoint.allowedSources.slice(0, 1);
  return checkpoint;
}
function rankedSnapshot(count = 20) {
  const checkpoint = snapshot(count);
  checkpoint.allowedSources = checkpoint.allowedSources.length ? checkpoint.allowedSources : createWorkbookCheckpoint(input).allowedSources;
  checkpoint.selectionPolicy = DRIVER_SELECTION_POLICY;
  return checkpoint;
}
const content = 'Paris Agreement and UN Sustainable Development Goals (SDGs) guide disclosure. The framework covered 140 countries in 2025, including obligations for banks.';
const review = { supported: true, directDriverEvidence: true, sameDriver: true, correctLanguage: true, allClaimsSupported: true, metricsMatchScopeUnitAndPeriod: true, usesLatestSupportedInformation: true, reasons: [] };
const editorial = { factualEvidenceKpi: true, latestRelevantEvidenceUsed: true, countrySectorGrounded: true, coherentDriver: true, evidenceStatusAccurate: true, reasons: [], requiredPassageIds: [] };
function writer(messages: Array<{ content: string }>) {
  const data = JSON.parse(messages[messages.length - 1].content);
  const passage = data.evidence.passages[0];
  return { supported: true, reason: '', driverText: 'The framework covered 140 countries in 2025.', countrySectorRelevance: 'This may influence the selected banking sector through disclosure expectations.', evidenceKpi: '140 countries in 2025.', evidenceStatus: 'dated-update', evidenceDate: '2025', evidenceLimitation: '', citations: [{ passageId: passage.id, quote: passage.text.slice(0, 1800) }] };
}
function relevance(messages: Array<{ content: string }>) {
  const payload = JSON.parse(messages[messages.length - 1].content);
  const passageId = payload.citedPassages[0].passageId;
  return {
    dimensions: {
      country: { rating: 4, reason: 'The supplied framework applies to the selected country scope.', passageIds: [passageId] },
      sector: { rating: 5, reason: 'The supplied framework is directly applicable to the selected sector.', passageIds: [passageId] },
      businessImpact: { rating: 3, reason: 'The supplied passage supports a material business implication.', passageIds: [passageId] },
      urgency: { rating: 2, reason: 'The supplied passage supports conditional time pressure.', passageIds: [passageId] },
    },
    rationale: 'The canonical framework is relevant to the selected country and sector based on the supplied passage.',
  };
}
function relevanceReview() {
  return {
    checks: { exactDriverSupport: true, noBorrowedObligations: true, urgencySupported: true, ratingsProportionate: true },
    reasons: [],
  };
}
beforeEach(() => {
  mocks.writer.mockReset().mockImplementation(writer);
  mocks.reviewer.mockReset().mockResolvedValue(review);
  mocks.editorial.mockReset().mockResolvedValue(editorial);
  mocks.relevance.mockReset().mockImplementation(relevance);
  mocks.relevanceReview.mockReset().mockImplementation(relevanceReview);
  mocks.translation.mockReset();
  mocks.fetch.mockReset().mockImplementation(async (url) => ({ contentSnippet: content, finalUrl: url, publishedDate: '2025-01-10', updatedDate: '2026-09-01', lastModified: null }));
});

describe('September workbook generation', () => {
  it('runs the full 52-row UAE Banking pipeline without capping, changing names, or omitting rows', async () => {
    const checkpoint = createWorkbookCheckpoint(input);
    delete checkpoint.selectionPolicy;
    checkpoint.allowedSources = checkpoint.allowedSources.slice(0, 1);
    mocks.fetch.mockImplementation(async (url) => ({ contentSnippet: checkpoint.definitions.map((d) => `${d.name}. ${content}`).join('\n\n'), finalUrl: url, publishedDate: '2025-01-10', updatedDate: null, lastModified: null }));
    const saved: AnyEsgDriverCheckpoint[] = [];
    const result = await generateEsgDriverResult(input, { checkpoint, onCheckpoint: async (c) => { saved.push(structuredClone(c)); } });
    const expected = selectWorkbookDrivers(input).drivers;
    expect(result.drivers).toHaveLength(52);
    expect(result.verifiedDriverCount).toBe(52);
    expect(result.drivers.map((d) => [d.driverTitle, d.driverType, d.driverSection, d.workbookRow])).toEqual(expected.map((d) => [d.name, d.type, d.section, d.row]));
    expect(saved).toHaveLength(53);
    expect(result.drivers.every((d) => d.generationStatus === 'verified' || d.generationStatus === 'unavailable')).toBe(true);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    for (const driver of result.drivers.filter((d) => d.generationStatus === 'verified')) {
      for (const ref of driver.sourceRefs) expect(result.evidence.some((s) => s.id === ref && driver.sourceLinks.includes(s.url))).toBe(true);
    }
  });

  it('keeps dates and verbatim citations, and excludes uncited sources', async () => {
    const result = await generateEsgDriverResult(input, { checkpoint: snapshot(1) });
    expect(result.completion).toBe('complete');
    expect(result.evidence[0]).toMatchObject({ publishedDate: '2025-01-10', updatedDate: '2026-09-01', lastModified: null });
    expect(result.drivers[0].citations?.[0].quote).toBe(content);
    expect(result.evidence[0].id).toBe(result.drivers[0].sourceRefs[0]);
    expect(result.provenance?.actualModels).toEqual(['test-returned-model']);
    expect(result.drivers[0].verification).toMatchObject({ citedPassagesOnly: true, writer: { model: 'test-returned-model' }, reviewer: { model: 'test-returned-model' } });
  });

  it('keeps unverified baseline KPIs out of the writing prompt and uncited passages out of the review', async () => {
    mocks.fetch.mockImplementation(async (url) => ({ contentSnippet: content.repeat(60), finalUrl: url, publishedDate: null, updatedDate: null, lastModified: null }));
    await generateEsgDriverResult(input, { checkpoint: snapshot(1) });
    const writing = JSON.parse(mocks.writer.mock.calls[0][0].at(-1).content);
    const reviewing = JSON.parse(mocks.reviewer.mock.calls[0][0].at(-1).content);
    expect(writing.workbookDriver.evidenceKpi).toBeUndefined();
    expect(writing.workbookDriver.logic).toBeUndefined();
    expect(reviewing.workbookDriver.unverifiedResearchPurpose).toBeUndefined();
    expect(writing.evidence.passages.length).toBeGreaterThan(1);
    expect(reviewing.evidence.passages.map((p: { id: string }) => p.id)).toEqual(reviewing.draft.citations.map((c: { passageId: string }) => c.passageId));
  });

  it.each(['English', 'Russian', 'Arabic'])('retains unavailable rows and baseline, with a %s narrative', async (language) => {
    mocks.fetch.mockRejectedValue(new Error('Source URL is not listed in the selected Excel worksheet.'));
    const checkpoint = snapshot(); checkpoint.input.language = language;
    const result = await generateEsgDriverResult({ ...input, language }, { checkpoint });
    expect(result).toMatchObject({ completion: 'partial', verifiedDriverCount: 0, expectedDriverCount: 2 });
    expect(result.drivers).toHaveLength(2);
    expect(result.drivers[0].baseline?.evidenceKpi).toBe(checkpoint.definitions[0].evidenceKpi);
    expect(result.drivers[0].sourceLinks).toEqual([]);
    expect(result.drivers[0].evidenceKpi).not.toBe(checkpoint.definitions[0].evidenceKpi);
    if (language === 'Russian') expect(result.drivers[0].driverText).toContain('Не удалось');
    if (language === 'Arabic') expect(result.drivers[0].driverText).toContain('تعذّر');
    expect(mocks.writer).not.toHaveBeenCalled();
  });

  it('rejects an invented KPI even when the year matches, and rejects a forged passage id', () => {
    const evidence = { passages: [{ id: 'p', sourceId: 's', url: 'https://example.org', text: content, location: 'page 1' }], sources: [], failures: [] } as ExcelSearchResult;
    const draft = { supported: true, reason: '', driverText: 'Funding reached 999 billion in 2025.', countrySectorRelevance: 'Banking implications.', evidenceKpi: '999 billion in 2025.', citations: [{ passageId: 'p', quote: content }] };
    expect(validateExcelDraft(draft, evidence).join(' ')).toContain('999');
    expect(validateExcelDraft({ ...draft, citations: [{ passageId: 'forged', quote: content }] }, evidence).join(' ')).toContain('not present');
  });

  it('does not accept a number with the wrong unit/scope/period just because its digits occur', async () => {
    mocks.reviewer.mockResolvedValue({ ...review, metricsMatchScopeUnitAndPeriod: false, reasons: ['The number is countries, not money.'] });
    const result = await generateEsgDriverResult(input, { checkpoint: snapshot(1) });
    expect(result.drivers[0].generationStatus).toBe('unavailable');
    expect(mocks.writer).toHaveBeenCalledTimes(3);
    expect(result.drivers[0].statusReason).toContain('countries');
  });
  it('removes known citation metadata from prose without erasing unsupported factual numbers', () => {
    const evidence = { passages: [{ id: 'S-38abc-562def-P3200', sourceId: 'S-38abc-562def', url: 'https://example.org', text: content, location: 'page 1' }], sources: [], failures: [] } as ExcelSearchResult;
    const text = removeInlineEvidenceIds('140 countries in 2025 [S-38abc-562def-P3200]; funding reached 999 billion.', evidence);
    expect(text).not.toContain('3200');
    expect(text).toContain('999 billion');
    expect(text).toContain('140 countries');
  });

  it('rejects adjacent ESG background when the reviewer finds no direct evidence for the named driver', async () => {
    mocks.reviewer.mockResolvedValue({ ...review, directDriverEvidence: false, reasons: ['Generic climate-finance context does not establish the named framework.'] });
    const result = await generateEsgDriverResult(input, { checkpoint: snapshot(1) });
    expect(result.drivers[0].generationStatus).toBe('unavailable');
    expect(result.drivers[0].verification).toBeUndefined();
  });

  it('does not accept a historical status presented as current when temporal review fails', async () => {
    mocks.reviewer.mockResolvedValue({ ...review, usesLatestSupportedInformation: false, reasons: ['The dated announcement does not establish that scrutiny remains pending today.'] });
    const result = await generateEsgDriverResult(input, { checkpoint: snapshot(1) });
    expect(mocks.writer).toHaveBeenCalledTimes(3);
    expect(result.drivers[0].generationStatus).toBe('unavailable');
    expect(result.drivers[0].citations).toEqual([]);
    expect(result.drivers[0].statusReason).toContain('does not establish');
  });

  it('never writes COP29 decisions from passages that only discuss generic climate policy', async () => {
    const checkpoint = snapshot();
    checkpoint.definitions = selectWorkbookDrivers(input).drivers.filter((d) => d.name === 'COP 29 Decisions');
    mocks.fetch.mockImplementation(async (url) => ({ contentSnippet: 'Climate finance decisions support disclosure and responsible investment for banking in UAE.', finalUrl: url, publishedDate: null, updatedDate: null, lastModified: null }));
    const result = await generateEsgDriverResult(input, { checkpoint });
    expect(result.drivers[0].generationStatus).toBe('unavailable');
    expect(mocks.writer).not.toHaveBeenCalled();
  });

  it('propagates a provider 503 and resumes from the last durable completed driver', async () => {
    const checkpoint = snapshot();
    let saved: EsgWorkbookCheckpoint = checkpoint;
    mocks.writer.mockImplementationOnce(writer).mockRejectedValueOnce(Object.assign(new Error('Provider unavailable'), { status: 503 }));
    await expect(generateEsgDriverResult(input, { checkpoint, onCheckpoint: async (c) => { saved = c as EsgWorkbookCheckpoint; } })).rejects.toMatchObject({ status: 503 });
    expect(saved.slots).toHaveLength(1);
    const accepted = structuredClone(saved.slots[0]);
    mocks.writer.mockReset().mockImplementation(writer);
    mocks.fetch.mockImplementation(async (url) => ({ contentSnippet: `${content} Updated page version.`, finalUrl: url, publishedDate: null, updatedDate: '2026-09-09', lastModified: null }));
    const result = await generateEsgDriverResult(input, { checkpoint: saved });
    expect(mocks.writer).toHaveBeenCalledTimes(1);
    expect(result.drivers[0]).toEqual(accepted.driver);
    expect(result.verifiedDriverCount).toBe(2);
    expect(result.evidence).toHaveLength(2);
    expect(result.drivers[0].sourceRefs[0]).not.toBe(result.drivers[1].sourceRefs[0]);
    for (const driver of result.drivers) for (const citation of driver.citations || []) {
      expect(result.evidence.find((s) => s.id === citation.sourceId)?.contentSnippet).toContain(citation.quote);
    }
  });

  it('lets cancellation/checkpoint failures escape without falsely completing', async () => {
    const error = Object.assign(new Error('Lease lost'), { name: 'JobLeaseLostError' });
    await expect(generateEsgDriverResult(input, { checkpoint: snapshot(), onCheckpoint: async () => { throw error; } })).rejects.toBe(error);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('scores every supported ranked candidate, persists all 20 slots, and reuses scores after retained-source refresh', async () => {
    const checkpoint = rankedSnapshot(20);
    checkpoint.allowedSources = createWorkbookCheckpoint(input).allowedSources;
    const rankedContent = checkpoint.definitions.map((definition) => `${definition.name}. ${content}`).join('\n\n');
    mocks.fetch.mockImplementation(async (url) => ({ contentSnippet: rankedContent, finalUrl: url, publishedDate: '2025-01-10', updatedDate: '2026-09-01', lastModified: null }));
    const savedCheckpoints: EsgWorkbookCheckpoint[] = [];
    const relevanceProgressNumbers: number[] = [];
    const first = await generateEsgDriverResult(input, {
      checkpoint,
      onCheckpoint: async (value) => { savedCheckpoints.push(structuredClone(value as EsgWorkbookCheckpoint)); },
      onProgress: async (stage, _progress, detail) => {
        if (stage.startsWith('Assessing relevance for ') && detail?.driverNumber !== undefined) relevanceProgressNumbers.push(detail.driverNumber);
      },
    });
    expect(first.candidatePool).toHaveLength(20);
    expect(first.drivers).toHaveLength(15);
    expect(first).toMatchObject({ expectedDriverCount: 15, verifiedDriverCount: 15, completion: 'complete' });
    expect(first.selection).toMatchObject({ policyVersion: DRIVER_SELECTION_POLICY, candidateCount: 20, supportedCandidateCount: 20, eligibleCandidateCount: 20 });
    expect(first.selection?.publishedDriverIds).toHaveLength(15);
    expect(first.selection?.excluded.filter((item) => item.reason === 'below-cutoff')).toHaveLength(5);
    expect(first.candidatePool?.every((driver) => driver.generationStatus === 'verified' && driver.relevance?.score === 75)).toBe(true);
    expect(savedCheckpoints.at(-1)?.slots).toHaveLength(20);
    expect(savedCheckpoints.at(-1)?.slots.every((slot) => slot.driver.relevance?.policyVersion === DRIVER_SELECTION_POLICY)).toBe(true);
    expect(mocks.relevance).toHaveBeenCalledTimes(20);
    expect(relevanceProgressNumbers).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));

    const retryCheckpoint = structuredClone(savedCheckpoints.at(-1)!);
    retryCheckpoint.resume = { parentJobId: 'parent-ranked', requestedAt: new Date().toISOString(), revalidateAcceptedSources: true };
    mocks.writer.mockClear();
    mocks.reviewer.mockClear();
    mocks.editorial.mockClear();
    mocks.relevance.mockClear();
    mocks.fetch.mockReset().mockImplementation(async (url) => ({ contentSnippet: rankedContent, finalUrl: url, publishedDate: '2025-01-10', updatedDate: '2026-09-14', lastModified: null }));
    const retry = await generateEsgDriverResult(input, { checkpoint: retryCheckpoint });
    expect(retry.drivers.map((driver) => driver.id)).toEqual(first.drivers.map((driver) => driver.id));
    expect(retry.candidatePool?.map((driver) => driver.relevance)).toEqual(first.candidatePool?.map((driver) => driver.relevance));
    expect(mocks.writer).not.toHaveBeenCalled();
    expect(mocks.reviewer).not.toHaveBeenCalled();
    expect(mocks.relevance).not.toHaveBeenCalled();
    expect(retry.evidence.every((source) => source.updatedDate === '2026-09-14')).toBe(true);
    expect(retryCheckpoint.slots).toHaveLength(20);
  }, 15_000);

  it('keeps a review-rejected candidate unscored while publishing other qualified candidates', async () => {
    const checkpoint = rankedSnapshot(20);
    checkpoint.allowedSources = createWorkbookCheckpoint(input).allowedSources;
    const failedDriverId = checkpoint.definitions[0].id;
    const rankedContent = checkpoint.definitions.map((definition) => `${definition.name}. ${content}`).join('\n\n');
    mocks.fetch.mockImplementation(async (url) => ({ contentSnippet: rankedContent, finalUrl: url, publishedDate: '2025-01-10', updatedDate: '2026-09-01', lastModified: null }));
    const savedCheckpoints: EsgWorkbookCheckpoint[] = [];
    mocks.relevanceReview.mockImplementation(async (messages: Array<{ content: string }>) => {
      const payload = JSON.parse(messages[messages.length - 1].content) as { workbookDriver?: { id?: string } };
      if (payload.workbookDriver?.id === failedDriverId) {
        return {
          checks: { exactDriverSupport: false, noBorrowedObligations: false, urgencySupported: false, ratingsProportionate: false },
          reasons: ['The proposed ratings rely on background context rather than exact-driver support.'],
        };
      }
      return relevanceReview();
    });

    const result = await generateEsgDriverResult(input, {
      checkpoint,
      onCheckpoint: async (value) => { savedCheckpoints.push(structuredClone(value as EsgWorkbookCheckpoint)); },
    });

    const failed = result.candidatePool?.find((driver) => driver.id === failedDriverId);
    expect(result.candidatePool).toHaveLength(20);
    expect(result.drivers).toHaveLength(15);
    expect(result.selection).toMatchObject({
      supportedCandidateCount: 20,
      eligibleCandidateCount: 19,
    });
    expect(result.selection?.publishedDriverIds).not.toContain(failedDriverId);
    expect(result.selection?.excluded).toContainEqual({ driverId: failedDriverId, reason: 'unscored' });
    expect(result.warnings.some((warning) => warning.includes('no valid relevance assessment'))).toBe(true);
    expect(failed).toMatchObject({
      id: failedDriverId,
      generationStatus: 'verified',
      relevanceFailure: {
        assessment: {
          review: { checks: { exactDriverSupport: false, noBorrowedObligations: false, urgencySupported: false, ratingsProportionate: false } },
        },
        reasons: ['The proposed ratings rely on background context rather than exact-driver support.'],
      },
    });
    expect(failed?.relevance).toBeUndefined();
    expect(failed?.statusReason).toContain('Relevance score unavailable:');
    expect(failed?.driverText).toBeTruthy();
    expect(failed?.citations?.length).toBeGreaterThan(0);
    expect(savedCheckpoints.at(-1)?.slots).toHaveLength(20);
    expect(savedCheckpoints.at(-1)?.slots.find((slot) => slot.driver.id === failedDriverId)?.driver.relevanceFailure).toEqual(failed?.relevanceFailure);
    expect(mocks.relevance).toHaveBeenCalledTimes(21);
    expect(mocks.relevanceReview).toHaveBeenCalledTimes(21);
  }, 20_000);

  it('propagates a relevance provider failure instead of marking the row as an unscored review rejection', async () => {
    const checkpoint = rankedSnapshot(1);
    checkpoint.allowedSources = createWorkbookCheckpoint(input).allowedSources;
    const providerError = Object.assign(new Error('Relevance provider unavailable'), { status: 503 });
    mocks.relevance.mockRejectedValue(providerError);

    await expect(generateEsgDriverResult(input, { checkpoint })).rejects.toMatchObject({ status: 503, message: 'Relevance provider unavailable' });
    expect(mocks.relevance).toHaveBeenCalledTimes(2);
    expect(mocks.relevanceReview).not.toHaveBeenCalled();
  }, 15_000);

  it('keeps source-wide dates outside writing and citation-only review evidence', async () => {
    mocks.fetch.mockImplementation(async (url) => ({ contentSnippet: content, finalUrl: url, publishedDate: '2026-03-29', updatedDate: null, lastModified: null, documentDates: [{ kind: 'publication', value: '29 March 2026', excerpt: 'Unselected news published 29 March 2026.' }] }));
    const result = await generateEsgDriverResult(input, { checkpoint: snapshot(1) });
    for (const invoke of [mocks.writer, mocks.reviewer, mocks.editorial]) {
      const data = JSON.parse(invoke.mock.calls[0][0].at(-1).content);
      expect(data.evidence.sources[0].documentDates).toBeUndefined();
      expect(data.evidence.sources[0].publishedDate).toBeUndefined();
    }
    expect(result.evidence[0].documentDates?.[0].value).toBe('29 March 2026');
  });

  it('rejects a source-supported draft when the editorial review detects an omitted newer update', async () => {
    mocks.fetch.mockImplementation(async (url) => ({ contentSnippet: content.repeat(30), finalUrl: url, publishedDate: null, updatedDate: null, lastModified: null }));
    mocks.reviewer.mockResolvedValue({ ...review, reasons: ['All cited facts are supported.'] });
    mocks.editorial.mockResolvedValue({ ...editorial, latestRelevantEvidenceUsed: false, reasons: ['Include the newer amendment from the supplied primary source.'] });
    const result = await generateEsgDriverResult(input, { checkpoint: snapshot(1) });
    expect(result.drivers[0].generationStatus).toBe('unavailable');
    expect(result.drivers[0].statusReason).toContain('newer amendment');
    expect(result.drivers[0].statusReason).not.toContain('All cited facts');
    expect(JSON.parse(mocks.writer.mock.calls[1][0].at(-1).content).repairs).not.toContain('All cited facts are supported.');
    const factual = JSON.parse(mocks.reviewer.mock.calls[0][0].at(-1).content);
    const quality = JSON.parse(mocks.editorial.mock.calls[0][0].at(-1).content);
    expect(factual.evidence.passages.length).toBe(1);
    expect(quality.evidence.passages.length).toBeGreaterThan(1);
  });

  it('passes concise reviewer corrections to a third repair without relaxing the gates', async () => {
    mocks.reviewer.mockResolvedValueOnce({ ...review, allClaimsSupported: false, reasons: ['Preserve should consider instead of must.'] }).mockResolvedValueOnce({ ...review, metricsMatchScopeUnitAndPeriod: false, reasons: ['Cite the banking applicability clause.'] }).mockResolvedValue(review);
    const result = await generateEsgDriverResult(input, { checkpoint: snapshot(1) });
    expect(result.drivers[0].generationStatus).toBe('verified');
    expect(mocks.writer).toHaveBeenCalledTimes(3);
    expect(JSON.parse(mocks.writer.mock.calls[2][0].at(-1).content).repairs).toContain('Cite the banking applicability clause.');
    expect(JSON.parse(mocks.writer.mock.calls[2][0].at(-1).content).rejectedDraft).toBeUndefined();
    expect(result.drivers[0].verification?.editorial?.checks.latestRelevantEvidenceUsed).toBe(true);
  });

  it('rejects analyst monitoring suggestions before a model can approve them as evidence', async () => {
    mocks.writer.mockImplementation((messages) => ({ ...writer(messages), evidenceKpi: 'Suggested monitoring measure: track lending coverage.' }));
    const result = await generateEsgDriverResult(input, { checkpoint: snapshot(1) });
    expect(result.drivers[0].generationStatus).toBe('unavailable');
    expect(mocks.reviewer).not.toHaveBeenCalled();
  });

  it('rechecks saved evidence for a child retry and preserves a supported row', async () => {
    const checkpoint = snapshot(1);
    let saved = checkpoint;
    await generateEsgDriverResult(input, { checkpoint, onCheckpoint: async (c) => { saved = c as EsgWorkbookCheckpoint; } });
    saved.resume = { parentJobId: 'parent', requestedAt: new Date().toISOString(), revalidateAcceptedSources: true };
    mocks.writer.mockClear(); mocks.fetch.mockClear();
    const result = await generateEsgDriverResult(input, { checkpoint: saved });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.writer).not.toHaveBeenCalled();
    expect(result.drivers[0]).toEqual(saved.slots[0].driver);
  });

  it('rewrites a retained row when its source changes even if the old quote survives', async () => {
    const checkpoint = snapshot(1);
    let saved = checkpoint;
    await generateEsgDriverResult(input, { checkpoint, onCheckpoint: async (c) => { saved = c as EsgWorkbookCheckpoint; } });
    saved.resume = { parentJobId: 'parent', requestedAt: new Date().toISOString(), revalidateAcceptedSources: true };
    mocks.writer.mockClear();
    mocks.fetch.mockImplementation(async (url) => ({ contentSnippet: `${content}\nNew amendment published in December 2025.`, finalUrl: url, publishedDate: null, updatedDate: null, lastModified: null }));
    const result = await generateEsgDriverResult(input, { checkpoint: saved });
    expect(mocks.writer).toHaveBeenCalledTimes(1);
    expect(result.drivers[0].sourceRefs[0]).not.toBe(saved.slots[0].driver?.sourceRefs[0]);
  });

  it('rejects a redirect result outside Excel even if a fetch adapter bypasses redirect protection', async () => {
    mocks.fetch.mockResolvedValue({ contentSnippet: content, finalUrl: 'https://unlisted.example/report', publishedDate: null, updatedDate: null, lastModified: null });
    const result = await generateEsgDriverResult(input, { checkpoint: snapshot(1) });
    expect(result.drivers[0].generationStatus).toBe('unavailable');
    expect(mocks.writer).not.toHaveBeenCalled();
  });
});
