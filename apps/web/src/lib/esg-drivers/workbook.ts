import catalogJson from './workbook.generated.json';
import type { DriverWorkbook } from './workbook-types';
import type { EsgWorkbookCheckpoint, GenerateEsgDriversInput } from './types';
import { buildWorkbookOptions, isGlobalDriverSection } from './catalog-utils';
import { canonicalizeEsgDriverCountry, canonicalizeEsgDriverSector } from './coverage';
import { ESG_EVIDENCE_CONTRACT } from './result-integrity';
import { ESG_DRIVER_QUALITY_POLICY } from './quality-policy';
import { DRIVER_SELECTION_POLICY } from './ranking-policy';

export const ESG_DRIVER_WORKBOOK = catalogJson as DriverWorkbook;

export function selectWorkbookDrivers(
  input: GenerateEsgDriversInput,
  catalog: DriverWorkbook = ESG_DRIVER_WORKBOOK,
) {
  const options = buildWorkbookOptions(catalog);
  const country = canonicalizeEsgDriverCountry(input.country, options.countries);
  const sector = canonicalizeEsgDriverSector(input.sector, options.sectors);
  const sheet = catalog.sheets.find((s) => s.name === sector);
  if (!country || !sheet) throw new Error('Choose a country and sector present in the active workbook catalog.');
  const drivers = sheet.drivers.filter((d) => isGlobalDriverSection(d.section) || d.section.trim() === country);
  if (!drivers.some((d) => d.section.trim() === country)) throw new Error('This worksheet has no drivers for the selected country.');
  return { country, sector: sheet.name, drivers, sources: sheet.sources };
}

/**
 * Create a pure, immutable selection snapshot. Callers creating a real job
 * pass the catalog read under the job transaction's state-row lock. The
 * bundled catalog default remains for direct legacy helpers and unit tests.
 */
export function createWorkbookCheckpoint(
  input: GenerateEsgDriversInput,
  catalog: DriverWorkbook = ESG_DRIVER_WORKBOOK,
  catalogVersionId?: string,
): EsgWorkbookCheckpoint {
  const selection = selectWorkbookDrivers(input, catalog);
  return structuredClone({
    version: 2, workflow: 'excel-sources', evidenceContract: ESG_EVIDENCE_CONTRACT, qualityPolicy: ESG_DRIVER_QUALITY_POLICY, selectionPolicy: DRIVER_SELECTION_POLICY,
    ...(catalogVersionId ? { catalogVersionId } : {}),
    catalogVersion: catalog.version,
    workbook: catalog.workbook, workbookSha256: catalog.sha256,
    input: { country: selection.country, sector: selection.sector, language: input.language },
    definitions: selection.drivers, allowedSources: selection.sources, slots: [], updatedAt: new Date().toISOString(),
  });
}
