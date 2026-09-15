import { describe, expect, it } from 'vitest';
import { assertWorkbookResult, savedResultError, workbookResultIssues } from '../result-integrity';
import { workbookResultFixture, rankedWorkbookResultFixture } from './workbook-result.fixture';
import { selectRankedDrivers } from '../ranking-policy';

function rejectedRelevanceFixture() {
  const fixture = rankedWorkbookResultFixture(20);
  const driver = fixture.result.candidatePool![0];
  const assessment = structuredClone(driver.relevance!);
  assessment.review!.checks.noBorrowedObligations = false;
  driver.relevanceFailure = { assessment, reasons: ['The deadline belongs to another instrument.'] };
  driver.statusReason = 'Relevance score unavailable: The deadline belongs to another instrument.';
  delete driver.relevance;
  fixture.checkpoint.slots[0].driver = structuredClone(driver);
  Object.assign(fixture.result, selectRankedDrivers(fixture.result.candidatePool!, fixture.result.generatedAt));
  fixture.result.warnings = ['One supported candidate has no approved relevance score.'];
  return fixture;
}

describe('workbook result quality gate', () => {
  it('rejects the observed old-worker failure: twelve legacy rows for a pinned 52-row workbook', () => {
    const { checkpoint, result } = workbookResultFixture(52);
    result.drivers = result.drivers.slice(0, 12);
    delete result.workflow;
    result.catalogVersion = '1.0.0+9061d0574eca.3c81b6e1c573';
    result.expectedDriverCount = 12;
    result.verifiedDriverCount = 12;
    expect(() => assertWorkbookResult(result, checkpoint, true)).toThrow('all 52 workbook drivers');
    expect(savedResultError(result, checkpoint)).toContain('cannot be used or exported');
  });
  it.each(['title', 'order', 'url', 'redirect', 'reference', 'quote', 'review', 'completion', 'checkpoint'] as const)('rejects invalid %s before publication', (defect) => {
    const { checkpoint, result } = workbookResultFixture();
    if (defect === 'title') result.drivers[0].driverTitle = 'Invented replacement';
    if (defect === 'order') result.drivers.reverse();
    if (defect === 'url') result.evidence[0].url = 'https://unlisted.example/';
    if (defect === 'redirect') result.evidence[0].finalUrl = 'https://unlisted.example/';
    if (defect === 'reference') result.drivers[0].sourceRefs = ['missing'];
    if (defect === 'quote') result.drivers[0].citations![0].quote = 'Fabricated quote.';
    if (defect === 'review') delete result.drivers[0].verification;
    if (defect === 'completion') result.verifiedDriverCount = 0;
    if (defect === 'checkpoint') checkpoint.slots = [];
    expect(() => assertWorkbookResult(result, checkpoint, true)).toThrow();
  });
  it('accepts supported rows and explicit unavailable rows with honest completion counts', () => {
    for (const unavailable of [true, false]) {
      const { checkpoint, result } = workbookResultFixture(52, unavailable);
      expect(workbookResultIssues(result, checkpoint)).toEqual([]);
      expect(() => assertWorkbookResult(result, checkpoint, true)).not.toThrow();
    }
  });
  it('compares saved JSONB rows by values even when PostgreSQL changes key order', () => {
    const { checkpoint, result } = workbookResultFixture();
    checkpoint.slots[0].driver = Object.fromEntries(Object.entries(checkpoint.slots[0].driver).reverse()) as typeof checkpoint.slots[0]['driver'];
    expect(() => assertWorkbookResult(result, checkpoint, true)).not.toThrow();
  });
  it('keeps genuine legacy history readable without treating a missing workbook checkpoint as valid', () => {
    const { result } = workbookResultFixture();
    expect(savedResultError(result, null)).toContain('failed');
    delete result.workflow;
    expect(savedResultError(result, null)).toBeNull();
  });
  it('requires the editorial record and factual KPI policy for new jobs', () => {
    const { checkpoint, result } = workbookResultFixture(1);
    delete result.drivers[0].verification!.editorial;
    expect(workbookResultIssues(result, checkpoint)).toContain('A verified update is missing the current editorial review.');
    result.drivers[0].evidenceKpi = 'Proposed monitoring KPI: count of screened transactions.';
    expect(workbookResultIssues(result, checkpoint)).toContain('Suggested monitoring measures cannot be presented in the evidence field.');
  });
  it('keeps older saved jobs readable under their original policy', () => {
    const { checkpoint, result } = workbookResultFixture(1);
    delete checkpoint.qualityPolicy;
    delete result.drivers[0].verification!.editorial;
    delete result.drivers[0].evidenceStatus;
    expect(savedResultError(result, checkpoint)).toBeNull();
  });
});

describe('ranked workbook integrity', () => {
  it('publishes other qualified drivers while retaining an explicitly rejected relevance assessment in the audit pool', () => {
    const { result, checkpoint } = rejectedRelevanceFixture();
    expect(result.drivers).toHaveLength(15);
    expect(result.selection!.excluded).toContainEqual({ driverId: result.candidatePool![0].id, reason: 'unscored' });
    expect(result.candidatePool![0].generationStatus).toBe('verified');
    expect(result.candidatePool![0].citations).toHaveLength(1);
    expect(() => assertWorkbookResult(result, checkpoint, true)).not.toThrow();
  });
  it.each(['no-record', 'no-reason', 'approved', 'fingerprint', 'no-warning'] as const)('rejects invalid unscored qualification proof: %s', (defect) => {
    const { result, checkpoint } = rejectedRelevanceFixture();
    const driver = result.candidatePool![0];
    if (defect === 'no-record') delete driver.relevanceFailure;
    if (defect === 'no-reason') driver.relevanceFailure!.reasons = [];
    if (defect === 'approved') driver.relevanceFailure!.assessment.review!.checks.noBorrowedObligations = true;
    if (defect === 'fingerprint') driver.relevanceFailure!.assessment.evidenceFingerprint = 'Different driver';
    if (defect === 'no-warning') result.warnings = [];
    expect(workbookResultIssues(result, checkpoint).length).toBeGreaterThan(0);
  });
  it('checks durable scored rows when reading a saved ranked report', () => {
    const { result, checkpoint } = rankedWorkbookResultFixture();
    result.drivers[0].relevance!.rationale = 'A rationale not approved in the durable checkpoint.';
    expect(savedResultError(result, checkpoint)).toContain('cannot be used or exported');
  });
  it('binds plausible source dates to the persisted retrieval metadata on saved reads', () => {
    const { result, checkpoint } = rankedWorkbookResultFixture();
    result.evidence[0] = { ...result.evidence[0], sourceDate: { value: '2024-06-01', kind: 'published', evidence: 'Invented date label', location: 'Invented cover' } };
    expect(workbookResultIssues(result, checkpoint)).toContain('A document date does not match its durably retrieved source metadata.');
    expect(savedResultError(result, checkpoint)).toContain('cannot be used or exported');
  });
  it.each(['updatedDate', 'publishedDate', 'lastModified'] as const)('rejects tampered fallback metadata %s', (field) => {
    const { result, checkpoint } = rankedWorkbookResultFixture();
    result.evidence[0] = { ...result.evidence[0], [field]: '2024-06-01' };
    expect(workbookResultIssues(result, checkpoint)).toContain('A document date does not match its durably retrieved source metadata.');
  });
  it.each(['2050 target', '2050-01-01', '2024-02-30'])('rejects an invalid persisted source date %s', (value) => {
    const { result, checkpoint, source } = rankedWorkbookResultFixture();
    source.sourceDate = { value, kind: 'published', evidence: `Published: ${value}`, location: 'document date label' };
    expect(workbookResultIssues(result, checkpoint)).toContain('A document date is invalid or in the future.');
  });
  it('preserves date precision and last persisted metadata when sources share merged passages', () => {
    const { result, checkpoint, source } = rankedWorkbookResultFixture();
    source.sourceDate = { value: '2024', kind: 'version-issued', evidence: 'Version issued: 2024', location: 'document cover' };
    const last = checkpoint.slots.at(-1)!;
    last.sources = [{ ...source, sourceDate: { value: 'June 2024', kind: 'updated', evidence: 'Last updated: June 2024', location: 'document header' } }];
    result.evidence = [{ ...last.sources[0], contentSnippet: 'Merged content', passages: [...source.passages!, { id: 'other', text: 'Another paragraph.', location: 'paragraph 2' }] }];
    expect(() => assertWorkbookResult(result, checkpoint, true)).not.toThrow();
    result.evidence[0] = { ...result.evidence[0], sourceDate: null };
    expect(savedResultError(result, checkpoint)).toContain('cannot be used or exported');
  });
  it('accepts15 published drivers and the complete pinned candidate pool', () => {
    const { result, checkpoint } = rankedWorkbookResultFixture();
    expect(() => assertWorkbookResult(result, checkpoint, true)).not.toThrow();
  });
  it('accepts a partial report without inventing unsupported drivers', () => {
    for (const unavailable of [false, true]) {
      const { result, checkpoint } = rankedWorkbookResultFixture(4, unavailable);
      expect(result.completion).toBe('partial');
      expect(() => assertWorkbookResult(result, checkpoint, true)).not.toThrow();
    }
  });
  it.each(['order', 'score', 'scope', 'citation', 'pool', 'baseline', 'count', 'policy', 'saved-score', 'date-proof', 'score-review', 'score-version'] as const)('rejects a tampered %s', (defect) => {
    const { result, checkpoint } = rankedWorkbookResultFixture();
    if (defect === 'order') result.drivers.reverse();
    if (defect === 'score') result.drivers[0].relevance!.score = 99;
    if (defect === 'scope') result.drivers[0].relevance!.evidenceFingerprint = 'other-country';
    if (defect === 'citation') result.drivers[0].relevance!.dimensions.country.passageIds = ['unprovided-passage'];
    if (defect === 'pool') result.candidatePool!.pop();
    if (defect === 'baseline') result.candidatePool![0].baseline!.logic = 'Changed original';
    if (defect === 'count') result.drivers.push(result.candidatePool![16]);
    if (defect === 'policy') delete checkpoint.selectionPolicy;
    if (defect === 'saved-score') checkpoint.slots[0].driver.relevance!.rationale = 'Different durable assessment';
    if (defect === 'date-proof') result.evidence[0].sourceDate = { value: '2026', kind: 'published', evidence: '', location: '' };
    if (defect === 'score-review') result.drivers[0].relevance!.review!.checks.noBorrowedObligations = false;
    if (defect === 'score-version') delete result.drivers[0].relevance!.assessmentVersion;
    expect(() => assertWorkbookResult(result, checkpoint, true)).toThrow();
  });
});
