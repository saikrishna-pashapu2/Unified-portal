import { createHash } from 'node:crypto';
import type { EsgDriver, GenerateEsgDriversInput } from './types';

/** Bind a relevance assessment to canonical identity, scope and exact evidence, never translated prose. */
export function relevanceEvidenceFingerprint(driver: EsgDriver, input: Pick<GenerateEsgDriversInput, 'country' | 'sector'>): string {
  const citations = (driver.citations || []).map(({ sourceId, passageId, quote }) => ({ sourceId, passageId, quote }))
    .sort((a, b) => a.passageId < b.passageId ? -1 : a.passageId > b.passageId ? 1 : 0);
  return createHash('sha256').update(JSON.stringify({
    country: input.country, sector: input.sector, driverId: driver.id, name: driver.driverTitle,
    section: driver.driverSection, type: driver.driverType, citations,
  })).digest('hex');
}
