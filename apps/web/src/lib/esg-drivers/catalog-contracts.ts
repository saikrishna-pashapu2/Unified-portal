import type { DriverWorkbook, WorkbookDriver } from './workbook-types';

/** Browser-safe contracts. Uploaded workbook content is data, never instructions. */
export interface DriverWorkbookOptions {
  workbook: string;
  version: string;
  countries: string[];
  sectors: string[];
  counts: Record<string, Record<string, number>>;
}

export interface WorkbookValidationIssue {
  sheet?: string;
  cell?: string;
  message: string;
}

export interface DriverCatalogVersion {
  id: string;
  version: string;
  workbook: string;
  sha256: string;
  uploadedAt: string;
  uploadedBy: { id: number | null; name: string };
  driverCount: number;
  sheetCount: number;
  sourceCount: number;
  isActive: boolean;
  isBundled: boolean;
}

export interface DriverCatalogChange {
  kind: 'added' | 'removed' | 'changed';
  sheet: string;
  driverName: string;
  fields: string[];
  before: WorkbookDriver | null;
  after: WorkbookDriver | null;
  detailsTruncated?: boolean;
}

export interface DriverCatalogDiff {
  addedDrivers: number;
  removedDrivers: number;
  changedDrivers: number;
  addedSources: number;
  removedSources: number;
  addedSourceUrls: string[];
  removedSourceUrls: string[];
  changes: DriverCatalogChange[];
  truncated: boolean;
  reorderedSheets?: string[];
  sourceChanges?: Array<{ sheet: string; url: string; kind: 'added' | 'removed' }>;
}

export interface DriverCatalogActivation {
  id: string;
  versionId: string;
  workbook: string;
  activatedAt: string;
  activatedBy: { id: number | null; name: string };
  revision: number;
}

export interface DriverCatalogListResponse {
  active: DriverCatalogVersion;
  options: DriverWorkbookOptions;
  revision: number;
  versions: DriverCatalogVersion[];
  nextCursor: string | null;
  activations: DriverCatalogActivation[];
}

export interface DriverCatalogPreviewResponse {
  version: DriverCatalogVersion;
  active: DriverCatalogVersion;
  revision: number;
  diff: DriverCatalogDiff;
  warnings: WorkbookValidationIssue[];
}

export interface DriverCatalogActivationRequest { expectedRevision: number }

/** Server-only callers use the catalog; HTTP responses use the smaller DTOs. */
export interface ActiveDriverCatalog {
  summary: DriverCatalogVersion;
  catalog: DriverWorkbook;
  options: DriverWorkbookOptions;
  revision: number;
}
