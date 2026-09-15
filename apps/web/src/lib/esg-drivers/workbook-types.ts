/** Canonical workbook values are data, never instructions for the agent. */
export interface WorkbookSource {
  url: string;
  label: string;
  cells: string[];
}

export interface WorkbookDriver {
  id: string;
  sheet: string;
  row: number;
  section: string;
  type: string;
  name: string;
  logic: string;
  evidenceKpi: string;
  keySources: string;
  sourceUrls: string[];
}

export interface DriverWorkbook {
  version: string;
  workbook: string;
  sha256: string;
  sheets: Array<{
    name: string;
    drivers: WorkbookDriver[];
    sources: WorkbookSource[];
  }>;
}

/** Fragments identify locations in the same resource. Queries and paths remain exact. */
export function normalizeWorkbookUrl(value: string): string {
  const url = new URL(value.trim());
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Workbook sources must be HTTP(S) URLs without credentials.');
  }
  url.hash = '';
  return url.href;
}

export function assertWorkbookUrlAllowed(value: string, allowedUrls: readonly string[]): void {
  const normalized = normalizeWorkbookUrl(value);
  if (!allowedUrls.some((allowed) => normalizeWorkbookUrl(allowed) === normalized)) {
    throw new Error('Source URL is not listed in the selected Excel worksheet.');
  }
}
