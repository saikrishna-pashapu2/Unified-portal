import { MAX_WORKBOOK_CELL_CHARS, writeWorkbookBuffer } from '@/lib/workbook';
import type { EsgDriver, EsgDriverResult, EsgDriverSource } from './types';
import { EVIDENCE_STATUS_LABELS } from './quality-policy';
import { RELEVANCE_WEIGHTS } from './ranking-policy';
const DRIVER_HEADERS = [
  "Driver Section/Country",
  "Driver Type",
  "Driver Name",
  "Updated Driver Logic",
  "Country/Sector Relevance",
  "Evidence/KPI",
  "Key Sources",
  "Source Links",
  "Confidence",
  "Last Checked",
  "Update Status", "Status Reason", "Workbook Sheet", "Workbook Row",
  "Original Logic (unverified baseline)", "Original Evidence/KPI (unverified baseline)",
  "Evidence Basis", "Evidence Date / Period", "Evidence Limitation",
];

const SOURCE_HEADERS = [
  "Source ID",
  "Used By Drivers",
  "Approved Source",
  "Approval Usage",
  "Title",
  "Domain",
  "URL",
  "Evidence Preview (full quotes in Citations)",
  "Publication Date",
  "Updated Date",
  "Last Modified",
  "Retrieved At",
  "Authority",
  "Freshness",
  "Relevance",
  "Source Score",
  "Retrieval Method", "Dates Stated in Source Text (with context)",
];

const RANKED_DRIVER_HEADERS = [
  "Rank",
  "Relevance Score",
  "Relevance Band",
  "Relevance Rationale",
  "Country Relevance (points / rating)",
  "Sector Relevance (points / rating)",
  "Business Impact (points / rating)",
  "Urgency (points / rating)",
  "Primary Source Document Date",
];

const RANKED_SOURCE_HEADERS = [
  "Used By Candidate IDs",
  "Source Document Date",
  "Source Date Evidence",
  "Source Date Location",
];

export async function buildDriverWorkbook(result: EsgDriverResult): Promise<Buffer> {
  const ranked = isRankedResult(result);
  const candidatePool = ranked ? result.candidatePool || [] : [];
  // Ranked packs always reserve an audit sheet. The workbook writer has a
  // separate six-output-sheet limit, so source availability and candidate
  // audit can both be retained when a ranked run includes source checks.
  const includeCandidateAudit = ranked;
  const sheets = [
    {
      name: "Summary",
      rows: buildSummaryRows(result),
      columnWidths: [24, 80],
    },
    {
      name: "Drivers",
      rows: [ranked ? [...DRIVER_HEADERS, ...RANKED_DRIVER_HEADERS] : DRIVER_HEADERS, ...result.drivers.map((driver, index) => driverToRow(driver, ranked ? index + 1 : undefined, result))],
      columnWidths: ranked
        ? [24, 24, 48, 72, 64, 54, 42, 64, 12, 24, 22, 72, 24, 14, 72, 54, 26, 24, 64, 10, 14, 14, 72, 24, 24, 24, 24, 32]
        : [24, 24, 48, 72, 64, 54, 42, 64, 12, 24, 22, 72, 24, 14, 72, 54, 26, 24, 64],
      autoFilter: `A1:${ranked ? 'AB' : 'S'}${Math.max(result.drivers.length + 1, 1)}`,
      freezeRows: 1,
    },
    {
      name: "Citations",
      rows: [
        ranked
          ? ["Driver ID", "Driver Name", "Source ID", "Source URL", "Verbatim Supporting Quote", "Location", "Passage ID", "Published", "Rank", "Source Document Date", "Source Date Evidence", "Source Date Location"]
          : ["Driver ID", "Driver Name", "Source ID", "Source URL", "Verbatim Supporting Quote", "Location"],
        ...buildCitationRows(result, ranked, candidatePool),
      ],
      columnWidths: ranked ? [24, 48, 28, 70, 110, 50, 24, 12, 10, 28, 80, 36] : [24, 48, 28, 70, 110, 50],
      freezeRows: 1,
    },
    {
      name: "Sources",
      rows: [
        ranked ? [...SOURCE_HEADERS, ...RANKED_SOURCE_HEADERS] : SOURCE_HEADERS,
        ...result.evidence.map((source) => sourceToRow(source, result.drivers, candidatePool, ranked)),
      ],
      columnWidths: ranked ? [16, 24, 36, 16, 54, 26, 64, 90, 18, 18, 18, 18, 12, 12, 12, 12, 20, 100, 24, 36, 90, 36] : [16, 24, 36, 16, 54, 26, 64, 90, 18, 18, 18, 18, 12, 12, 12, 12, 20, 100],
      autoFilter: `A1:${ranked ? 'V' : 'R'}${Math.max(result.evidence.length + 1, 1)}`,
      freezeRows: 1,
    },
    ...(includeCandidateAudit ? [{
      name: 'Candidate Audit',
      rows: buildCandidateAuditRows(result, candidatePool),
      columnWidths: [10, 24, 48, 36, 24, 24, 14, 22, 14, 14, 72, 36, 36, 42, 36, 12, 32, 36, 72, 72, 72, 110, 72, 72, 90, 24, 24, 72, 72],
      autoFilter: `A1:AC${Math.max(candidatePool.length + 1, 1)}`,
      freezeRows: 1,
    }] : []),
    ...(result.sourceChecks?.length ? [{
      name: 'Source availability',
      rows: [['Workbook URL', 'Access status', 'Issue'], ...result.sourceChecks.map((source) => [source.url, source.status, source.reason || ''])],
      columnWidths: [90, 20, 90],
      freezeRows: 1,
    }] : []),
  ];
  return writeWorkbookBuffer(sheets);
}

function buildSummaryRows(result: EsgDriverResult): Array<Array<string | number>> {
  const averageConfidence =
    result.drivers.reduce((sum, driver) => sum + driver.confidence, 0) /
    Math.max(result.drivers.length, 1);

  const rows: Array<Array<string | number>> = [
    ["ESG Driver Pack Export", ""],
    ["Country", result.country],
    ["Sector", result.sector],
    ["Language", result.language],
    ["Catalog Version", result.catalogVersion || "legacy-unknown"],
    ["Generated At", result.generatedAt],
    ["Completion", result.completion === "partial" ? "Partial" : "Complete"],
    ["Driver Count", result.drivers.length],
    ["Expected Driver Count", result.expectedDriverCount ?? result.drivers.length],
    [
      "Unavailable Driver Updates",
      (result.slotFailures || []).map((failure) => failure.driverId).join(", ") || "None",
    ],
    ["Source Count", result.evidence.length],
    [result.workflow === "excel-sources" ? "Source-supported Updates" : "Average Confidence", result.verifiedDriverCount ?? Math.round(averageConfidence)],
    ["Source Workbook", result.workbook || "Legacy catalog"],
    ["Models returned by provider", result.provenance?.actualModels.join(', ') || 'Not recorded'],
    ["Evidence verification", result.provenance?.contract ? 'Draft and independent review checked against cited workbook passages' : 'Not recorded'],
    ["Permitted sources retrieved", result.sourceChecks?.filter((s) => s.status === 'retrieved').length ?? 'Not recorded'],
    ["Permitted sources unavailable", result.sourceChecks?.filter((s) => s.status === 'unavailable').length ?? 'Not recorded'],
    ["Warnings", result.warnings.join("\n") || "None"],
  ];
  if (isRankedResult(result)) {
    const selection = result.selection!;
    const gaps = selection.requestedCount - result.drivers.length;
    rows.push(
      ["Selection Policy", selection.policyVersion],
      ["Published Driver Count", result.drivers.length],
      ["Target Driver Count", selection.requestedCount],
      ["Candidates Considered", selection.candidateCount],
      ["Supported Candidates", selection.supportedCandidateCount],
      ["Eligible Candidates", selection.eligibleCandidateCount],
      ["Selection Gaps", gaps > 0 ? `${gaps} target slot${gaps === 1 ? "" : "s"} unfilled` : "None"],
      ["Excluded Candidate IDs", selection.excluded.map((item) => `${item.driverId}: ${item.reason}${item.duplicateOf ? ` (${item.duplicateOf})` : ''}`).join("\n") || "None"],
    );
  }
  return rows;
}

function driverToRow(driver: EsgDriver, rank: number | undefined, result: EsgDriverResult): Array<string | number> {
  const row: Array<string | number> = [
    driver.driverSection,
    driver.driverType,
    driver.driverTitle,
    driver.driverText,
    driver.countrySectorRelevance,
    driver.evidenceKpi,
    driver.keySources.join("\n"),
    driver.sourceLinks.join("\n"),
    driver.generationStatus ? "" : driver.confidence,
    driver.lastChecked,
    driver.generationStatus || "Legacy", driver.statusReason || "", driver.workbookSheet || "", driver.workbookRow || "",
    driver.baseline?.logic || "", driver.baseline?.evidenceKpi || "",
    driver.evidenceStatus ? EVIDENCE_STATUS_LABELS[driver.evidenceStatus] : '', driver.evidenceDate || '', driver.evidenceLimitation || '',
  ];
  if (rank !== undefined) row.push(...rankedDriverFields(driver, rank, result));
  return row;
}

function sourceToRow(
  source: EsgDriverSource,
  drivers: EsgDriver[],
  candidatePool: EsgDriver[],
  ranked: boolean,
): Array<string | number> {
  const usedByDrivers = drivers
    .filter(
      (driver) =>
        driver.sourceRefs.includes(source.id) || driver.sourceLinks.includes(source.url),
    )
    .map((driver) => driver.id)
    .join(", ");

  const row: Array<string | number> = [
    source.id,
    usedByDrivers,
    source.approvalLabel || "",
    source.approvalUsage || "",
    source.title,
    source.domain,
    source.url,
    (source.contentSnippet || source.snippet).length > MAX_WORKBOOK_CELL_CHARS
      ? (source.contentSnippet || source.snippet).slice(0, MAX_WORKBOOK_CELL_CHARS - 60) + '\n[Preview shortened; supporting quotes are in Citations.]'
      : source.contentSnippet || source.snippet,
    source.publishedDate || "",
    source.updatedDate || "",
    source.lastModified || "",
    source.retrievedAt,
    source.passages ? "" : source.authorityScore,
    source.passages ? "" : source.freshnessScore,
    source.passages ? "" : source.relevanceScore,
    source.passages ? "" : source.sourceScore,
    source.retrievalMethod || '',
    (source.documentDates || []).map((d) => `${d.kind}: ${d.value} — ${d.excerpt}`).join('\n').slice(0, MAX_WORKBOOK_CELL_CHARS),
  ];
  if (ranked) {
    const usedByCandidates = candidatePool.filter((candidate) => candidate.sourceRefs.includes(source.id) || candidate.sourceLinks.includes(source.url)).map((candidate) => candidate.id).join(", ");
    row.push(usedByCandidates, formatSourceDate(source), source.sourceDate?.evidence || '', source.sourceDate?.location || '');
  }
  return row;
}

function citationToRow(
  driver: EsgDriver,
  citation: NonNullable<EsgDriver['citations']>[number],
  result: EsgDriverResult,
  ranked: boolean,
): Array<string | number> {
  const source = result.evidence.find((item) => item.id === citation.sourceId);
  const row: Array<string | number> = [driver.id, driver.driverTitle, citation.sourceId, source?.url || '', citation.quote, citation.location];
  if (ranked) {
    const rank = result.drivers.findIndex((candidate) => candidate.id === driver.id);
    row.push(
      citation.passageId,
      rank >= 0 ? 'Yes' : 'No',
      rank >= 0 ? rank + 1 : '',
      formatSourceDate(source),
      source?.sourceDate?.evidence || '',
      source?.sourceDate?.location || '',
    );
  }
  return row;
}

function rankedDriverFields(driver: EsgDriver, rank: number, result: EsgDriverResult): Array<string | number> {
  const relevance = driver.relevance;
  const primarySource = driver.sourceRefs.map((id) => result.evidence.find((source) => source.id === id)).find(Boolean);
  return [
    rank,
    relevance?.score ?? '',
    relevance?.band ?? '',
    relevance?.rationale || '',
    dimensionLabel(relevance?.dimensions.country, RELEVANCE_WEIGHTS.country),
    dimensionLabel(relevance?.dimensions.sector, RELEVANCE_WEIGHTS.sector),
    dimensionLabel(relevance?.dimensions.businessImpact, RELEVANCE_WEIGHTS.businessImpact),
    dimensionLabel(relevance?.dimensions.urgency, RELEVANCE_WEIGHTS.urgency),
    formatSourceDate(primarySource),
  ];
}

function dimensionLabel(
  dimension: { rating: number; reason: string; passageIds: string[] } | undefined,
  weight: number,
): string {
  if (!dimension || !Number.isInteger(dimension.rating)) return '';
  const points = dimension.rating * weight / 5;
  return `${points} / ${dimension.rating}`;
}

function dimensionAuditLabel(
  dimension: { rating: number; reason: string; passageIds: string[] } | undefined,
  weight: number,
): string {
  if (!dimension || !Number.isInteger(dimension.rating)) return '';
  const points = dimension.rating * weight / 5;
  const reason = dimension.reason.trim();
  return `${points} / ${dimension.rating}${reason ? ` — ${reason}` : ''}`;
}

function formatSourceDate(source: EsgDriverSource | undefined): string {
  return source?.sourceDate ? `${source.sourceDate.kind}: ${source.sourceDate.value}` : '';
}

function buildCandidateAuditRows(result: EsgDriverResult, candidatePool: EsgDriver[]): Array<Array<string | number>> {
  const selection = result.selection;
  const selected = new Set(selection?.publishedDriverIds || []);
  return [
    ["Original Order", "Candidate ID", "Driver Name", "Driver Section", "Driver Type", "Workbook Sheet", "Workbook Row", "Support Status", "Relevance Score", "Relevance Band", "Relevance Rationale", "Country Relevance (points / rating; reason)", "Sector Relevance (points / rating; reason)", "Business Impact (points / rating; reason)", "Urgency (points / rating; reason)", "Selected", "Exclusion Reason", "Duplicate Of", "Original Logic", "Original Evidence/KPI", "Original Key Sources", "Generated Driver Text", "Country/Sector Relevance", "Generated Evidence/KPI", "Source Links", "Evidence Status", "Evidence Date / Period", "Evidence Limitation", "Status Reason"],
    ...candidatePool.map((candidate, index) => {
      const exclusion = selection?.excluded.find((item) => item.driverId === candidate.id);
      const relevance = candidate.relevance;
      return [
        index + 1,
        candidate.id,
        candidate.driverTitle,
        candidate.driverSection,
        candidate.driverType,
        candidate.workbookSheet || '',
        candidate.workbookRow || '',
        candidate.generationStatus === 'verified' ? 'Source supported' : candidate.generationStatus === 'unavailable' ? 'Unavailable' : 'Unknown',
        candidate.relevance?.score ?? '',
        candidate.relevance?.band || '',
        relevance?.rationale || '',
        dimensionAuditLabel(relevance?.dimensions.country, RELEVANCE_WEIGHTS.country),
        dimensionAuditLabel(relevance?.dimensions.sector, RELEVANCE_WEIGHTS.sector),
        dimensionAuditLabel(relevance?.dimensions.businessImpact, RELEVANCE_WEIGHTS.businessImpact),
        dimensionAuditLabel(relevance?.dimensions.urgency, RELEVANCE_WEIGHTS.urgency),
        selected.has(candidate.id) ? 'Yes' : 'No',
        exclusion?.reason || '',
        exclusion?.duplicateOf || '',
        candidate.baseline?.logic || candidate.driverLogic || '',
        candidate.baseline?.evidenceKpi || '',
        candidate.baseline?.keySources || '',
        candidate.driverText,
        candidate.countrySectorRelevance,
        candidate.evidenceKpi,
        candidate.sourceLinks.join('\n'),
        candidate.evidenceStatus || '',
        candidate.evidenceDate || '',
        candidate.evidenceLimitation || '',
        candidate.statusReason || '',
      ];
    }),
  ];
}

function citationCandidates(candidatePool: EsgDriver[], result: EsgDriverResult): EsgDriver[] {
  // candidatePool is the immutable original-order audit set. A malformed or
  // older ranked pack may omit it; retain published citations in that case so
  // the ranked report never loses supporting evidence.
  return candidatePool.length > 0 ? candidatePool : result.drivers;
}

function buildCitationRows(
  result: EsgDriverResult,
  ranked: boolean,
  candidatePool: EsgDriver[],
): Array<Array<string | number>> {
  return citationCandidates(ranked ? candidatePool : [], result)
    .flatMap((driver) => (driver.citations || []).map((citation) => citationToRow(driver, citation, result, ranked)));
}

function isRankedResult(result: EsgDriverResult): boolean {
  return result.selection?.policyVersion === 'relevance-top15-v1';
}
