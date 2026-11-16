import { describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
vi.mock('server-only', () => ({}));

import { buildDriverWorkbook } from '../export';
import { rankedWorkbookResultFixture, workbookResultFixture } from './workbook-result.fixture';
import { CATEGORY_SELECTION_POLICY, selectDriversForPolicy } from '../ranking-policy';

function rowsBySheet(buffer: Buffer): Map<string, Array<Array<unknown>>> {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  return new Map(workbook.SheetNames.map((name) => [
    name,
    XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: true }) as Array<Array<unknown>>,
  ]));
}

function rankedFixture() {
  const fixture = rankedWorkbookResultFixture(2);
  const [first, second] = fixture.result.drivers;
  const source = fixture.result.evidence[0];
  source.sourceDate = {
    value: 'November 2024',
    kind: 'version-issued',
    evidence: 'Cover: November 2024',
    location: 'document cover',
  };
  fixture.result = {
    ...fixture.result,
    drivers: [second],
    candidatePool: [first, second],
    selection: {
      policyVersion: 'relevance-top15-v1',
      requestedCount: 15,
      minimumScore: 50,
      candidateCount: 2,
      supportedCandidateCount: 2,
      eligibleCandidateCount: 2,
      publishedDriverIds: [second.id],
      excluded: [{ driverId: first.id, reason: 'below-cutoff' }],
      assessedAt: fixture.result.generatedAt,
    },
    expectedDriverCount: 15,
    verifiedDriverCount: 1,
    sourceChecks: [{ url: source.url, status: 'retrieved' }],
  };
  return fixture.result;
}

describe('ESG driver workbook export', () => {
  it('keeps ranked driver order and includes the candidate audit, all candidate citations, and source checks', async () => {
    const result = rankedFixture();
    const sheets = rowsBySheet(await buildDriverWorkbook(result));

    expect(Array.from(sheets.keys())).toEqual([
      'Summary',
      'Drivers',
      'Citations',
      'Sources',
      'Candidate Audit',
      'Source availability',
    ]);

    const drivers = sheets.get('Drivers')!;
    const driverHeaders = drivers[0]!;
    const rankIndex = driverHeaders.indexOf('Rank');
    const nameIndex = driverHeaders.indexOf('Driver Name');
    const rationaleIndex = driverHeaders.indexOf('Relevance Rationale');
    const dateIndex = driverHeaders.indexOf('Primary Source Document Date');
    expect(drivers).toHaveLength(2);
    expect(drivers[1]![rankIndex]).toBe(1);
    expect(drivers[1]![nameIndex]).toBe(result.drivers[0].driverTitle);
    expect(drivers[1]![rationaleIndex]).toBe(result.drivers[0].relevance?.rationale);
    expect(drivers[1]![dateIndex]).toBe('version-issued: November 2024');

    const citations = sheets.get('Citations')!;
    const publishedIndex = citations[0]!.indexOf('Published');
    const citationDriverIndex = citations[0]!.indexOf('Driver ID');
    const dateEvidenceIndex = citations[0]!.indexOf('Source Date Evidence');
    expect(citations).toHaveLength(3);
    expect(citations.slice(1).map((row) => row[publishedIndex])).toEqual(['No', 'Yes']);
    expect(citations.slice(1).map((row) => row[citationDriverIndex])).toEqual(result.candidatePool!.map((driver) => driver.id));
    expect(citations.slice(1).every((row) => row[dateEvidenceIndex] === 'Cover: November 2024')).toBe(true);

    const audit = sheets.get('Candidate Audit')!;
    const auditHeaders = audit[0]!;
    const auditIdIndex = auditHeaders.indexOf('Candidate ID');
    const auditSectionIndex = auditHeaders.indexOf('Driver Section');
    const auditTypeIndex = auditHeaders.indexOf('Driver Type');
    const auditSelectedIndex = auditHeaders.indexOf('Selected');
    const auditReasonIndex = auditHeaders.indexOf('Relevance Rationale');
    const auditCountryIndex = auditHeaders.indexOf('Country Relevance (points / rating; reason)');
    const auditExclusionIndex = auditHeaders.indexOf('Exclusion Reason');
    const auditOriginalLogicIndex = auditHeaders.indexOf('Original Logic');
    const auditOriginalEvidenceIndex = auditHeaders.indexOf('Original Evidence/KPI');
    const auditOriginalSourcesIndex = auditHeaders.indexOf('Original Key Sources');
    const auditGeneratedTextIndex = auditHeaders.indexOf('Generated Driver Text');
    const auditSourceLinksIndex = auditHeaders.indexOf('Source Links');
    const auditEvidenceStatusIndex = auditHeaders.indexOf('Evidence Status');
    expect(audit.slice(1).map((row) => row[auditIdIndex])).toEqual(result.candidatePool!.map((driver) => driver.id));
    expect(audit[1]![auditSectionIndex]).toBe(result.candidatePool![0].driverSection);
    expect(audit[1]![auditTypeIndex]).toBe(result.candidatePool![0].driverType);
    expect(audit.slice(1).map((row) => row[auditSelectedIndex])).toEqual(['No', 'Yes']);
    expect(audit[1]![auditReasonIndex]).toBe(result.candidatePool![0].relevance?.rationale);
    expect(String(audit[1]![auditCountryIndex])).toContain('The cited framework supports this assessment.');
    expect(audit[1]![auditExclusionIndex]).toBe('below-cutoff');
    expect(audit[1]![auditOriginalLogicIndex]).toBe(result.candidatePool![0].baseline?.logic);
    expect(audit[1]![auditOriginalEvidenceIndex]).toBe(result.candidatePool![0].baseline?.evidenceKpi);
    expect(audit[1]![auditOriginalSourcesIndex]).toBe(result.candidatePool![0].baseline?.keySources);
    expect(audit[1]![auditGeneratedTextIndex]).toBe(result.candidatePool![0].driverText);
    expect(audit[1]![auditSourceLinksIndex]).toBe(result.candidatePool![0].sourceLinks.join('\n'));
    expect(audit[1]![auditEvidenceStatusIndex]).toBe(result.candidatePool![0].evidenceStatus);

    const summary = sheets.get('Summary')!;
    const summaryLabels = summary.map((row) => row[0]);
    expect(summaryLabels).toContain('Published Driver Count');
    expect(summaryLabels).toContain('Target Driver Count');
    expect(summaryLabels).toContain('Candidates Considered');
    expect(summaryLabels).toContain('Supported Candidates');
    expect(summaryLabels).toContain('Selection Gaps');
  });

  it('preserves the legacy sheet and driver column layout when selection is absent', async () => {
    const { result } = workbookResultFixture(1);
    const sheets = rowsBySheet(await buildDriverWorkbook(result));
    expect(Array.from(sheets.keys())).toEqual(['Summary', 'Drivers', 'Citations', 'Sources']);
    expect(sheets.get('Drivers')![0]).not.toContain('Rank');
    expect(sheets.get('Candidate Audit')).toBeUndefined();
    expect(sheets.get('Drivers')![0]).toHaveLength(19);
  });

  it('exports A–Z on request while retaining saved positions and the original candidate audit', async () => {
    const { result } = rankedWorkbookResultFixture(3);
    result.drivers = [...result.drivers].sort((a, b) => b.driverTitle.localeCompare(a.driverTitle, 'en'));
    const saved = structuredClone(result);
    const sheets = rowsBySheet(await buildDriverWorkbook(result, { order: 'alphabetical' }));
    const drivers = sheets.get('Drivers')!;
    const headers = drivers[0]!;
    const ordered = [...saved.drivers].sort((a, b) => a.driverTitle.localeCompare(b.driverTitle, 'en'));
    expect(drivers.slice(1).map((row) => row[headers.indexOf('Driver Name')])).toEqual(ordered.map((driver) => driver.driverTitle));
    expect(drivers.slice(1).map((row) => row[headers.indexOf('Rank')])).toEqual(ordered.map((driver) => saved.drivers.findIndex((candidate) => candidate.id === driver.id) + 1));
    const audit = sheets.get('Candidate Audit')!;
    expect(audit.slice(1).map((row) => row[audit[0]!.indexOf('Candidate ID')])).toEqual(saved.candidatePool!.map((driver) => driver.id));
    expect(result).toEqual(saved);
    expect(sheets.get('Summary')).toContainEqual(['Display Order', 'Alphabetical (A–Z)']);
  });

  it('lists every cited URL with its own date or explicit unknown label on the Drivers sheet', async () => {
    const result = rankedFixture();
    const undated = { ...result.evidence[0], id: 'undated', url: 'https://example.org/undated', sourceDate: null, publishedDate: null, updatedDate: null, lastModified: '2026-01-01', retrievedAt: '2026-11-16T00:00:00Z' };
    result.evidence.push(undated);
    result.drivers[0].sourceRefs.push(undated.id);
    result.drivers[0].sourceLinks.push(undated.url);
    const sheets = rowsBySheet(await buildDriverWorkbook(result));
    const drivers = sheets.get('Drivers')!;
    const cell = drivers[1]![drivers[0]!.indexOf('Source Document Dates (by URL)')];
    expect(cell).toBe(`${result.evidence[0].url} — Version issued: November 2024\n${undated.url} — Date not provided`);
    const sources = sheets.get('Sources')!;
    expect(sources[2]![sources[0]!.indexOf('Source Document Date')]).toBe('Date not provided');
  });

  it('exports balanced selection, category totals and explicit gaps while preserving the candidate audit', async () => {
    const { result } = rankedWorkbookResultFixture(52);
    const selected = selectDriversForPolicy(result.candidatePool!, CATEGORY_SELECTION_POLICY, result.generatedAt);
    Object.assign(result, selected, { verifiedDriverCount: selected.drivers.length, completion: selected.drivers.length === 15 ? 'complete' : 'partial' });
    const sheets = rowsBySheet(await buildDriverWorkbook(result));
    expect(sheets.get('Drivers')![0]).toContain('Report Position');
    expect(sheets.get('Drivers')![0]).toContain('Report Category');
    expect(sheets.get('Candidate Audit')).toHaveLength(result.candidatePool!.length + 1);
    for (const quota of selected.selection.categoryQuotas!) {
      expect(sheets.get('Summary')).toContainEqual([`${quota.category} — published / target`, `${quota.publishedDriverIds.length} / 3`]);
      if (quota.gap) expect(sheets.get('Summary')!.some((row) => row[0] === `${quota.category} — gap`)).toBe(true);
    }
  });
});
