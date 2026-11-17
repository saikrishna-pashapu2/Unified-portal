import { createHash } from 'node:crypto';
import type { DriverRelevanceAssessmentVersion, EsgDriver, GenerateEsgDriversInput } from './types';

/**
 * Bind a relevance assessment to canonical identity, scope and exact evidence,
 * never translated prose. v2 deliberately keeps the original byte shape for
 * immutable historical reports; v3 additionally binds the verified status enum.
 */
export function relevanceEvidenceFingerprint(
  driver: EsgDriver,
  input: Pick<GenerateEsgDriversInput, 'country' | 'sector'>,
  assessmentVersion: DriverRelevanceAssessmentVersion = 'driver-specific-v3',
): string {
  const citations = (driver.citations || []).map(({ sourceId, passageId, quote }) => ({ sourceId, passageId, quote }))
    .sort((a, b) => a.passageId < b.passageId ? -1 : a.passageId > b.passageId ? 1 : 0);
  const canonical = {
    country: input.country, sector: input.sector, driverId: driver.id, name: driver.driverTitle,
    section: driver.driverSection, type: driver.driverType, citations,
    ...(assessmentVersion === 'driver-specific-v3' ? { evidenceStatus: driver.evidenceStatus ?? null } : {}),
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/** Explicit alias used when validating an immutable v2 report. */
export function legacyRelevanceEvidenceFingerprint(
  driver: EsgDriver,
  input: Pick<GenerateEsgDriversInput, 'country' | 'sector'>,
): string {
  return relevanceEvidenceFingerprint(driver, input, 'driver-specific-v2');
}
