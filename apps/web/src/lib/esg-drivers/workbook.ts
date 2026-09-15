import catalogJson from './workbook.generated.json';
import type { DriverWorkbook } from './workbook-types';
import type { EsgWorkbookCheckpoint, GenerateEsgDriversInput } from './types';
import { canonicalizeEsgDriverCountry, canonicalizeEsgDriverSector } from './coverage';
import { ESG_EVIDENCE_CONTRACT } from './result-integrity';
import { ESG_DRIVER_QUALITY_POLICY } from './quality-policy';
import { DRIVER_SELECTION_POLICY } from './ranking-policy';

export const ESG_DRIVER_WORKBOOK = catalogJson as DriverWorkbook;

export function selectWorkbookDrivers(input: GenerateEsgDriversInput) {
  const country = canonicalizeEsgDriverCountry(input.country);
  const sector = canonicalizeEsgDriverSector(input.sector);
  const sheet = ESG_DRIVER_WORKBOOK.sheets.find((s) => s.name === sector);
  if (!country || !sheet) throw new Error('Choose a country and sector present in the September workbook.');
  const drivers = sheet.drivers.filter((d) => /^global drivers?$/i.test(d.section.trim()) || d.section.trim() === country);
  if (!drivers.some((d) => d.section.trim() === country)) throw new Error('This worksheet has no drivers for the selected country.');
  return { country, sector: sheet.name, drivers, sources: sheet.sources };
}

export function createWorkbookCheckpoint(input: GenerateEsgDriversInput): EsgWorkbookCheckpoint {
  const selection = selectWorkbookDrivers(input);
  return structuredClone({
    version: 2, workflow: 'excel-sources', evidenceContract: ESG_EVIDENCE_CONTRACT, qualityPolicy: ESG_DRIVER_QUALITY_POLICY, selectionPolicy: DRIVER_SELECTION_POLICY, catalogVersion: ESG_DRIVER_WORKBOOK.version,
    workbook: ESG_DRIVER_WORKBOOK.workbook, workbookSha256: ESG_DRIVER_WORKBOOK.sha256,
    input: { country: selection.country, sector: selection.sector, language: input.language },
    definitions: selection.drivers, allowedSources: selection.sources, slots: [], updatedAt: new Date().toISOString(),
  });
}
