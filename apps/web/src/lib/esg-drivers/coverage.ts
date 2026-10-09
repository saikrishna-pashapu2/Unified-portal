import options from './workbook-options.generated.json';
import type { DriverWorkbookOptions } from './catalog-contracts';

export const ESG_DRIVER_COUNTRY_OPTIONS = options.countries;
export const ESG_DRIVER_SECTOR_OPTIONS = options.sectors;
export const ESG_DRIVER_WORKBOOK_OPTIONS = options;
export type SupportedEsgDriverCountry = string;
export type SupportedEsgDriverSector = string;

// Keep Unicode workbook labels when comparing uploaded values. This project
// still emits an ES5-compatible browser bundle, so avoid Unicode property
// escapes here. Removing only ASCII punctuation is enough for the bundled
// aliases and, unlike an ASCII-only character class, cannot collapse an
// unknown non-Latin input into an empty string that matches another label.
const normalize = (s: string) => s.trim().toLowerCase().replace(/&/g, ' and ').replace(/[\x00-\x2f\x3a-\x40\x5b-\x60\x7b-\x7f]+/g, ' ').replace(/\s+/g, ' ').trim();

function canonicalize(
  value: string,
  candidates: readonly string[],
  aliases: Record<string, string>,
): string | null {
  const raw = value.trim();
  if (!raw) return null;
  // Workbook labels are user data. Preserve an exact custom label before
  // applying the compatibility aliases used by the bundled workbook.
  const exact = candidates.find((candidate) => candidate === raw);
  if (exact) return exact;
  const normalized = normalize(raw);
  if (!normalized) return null;
  const normalizedMatch = candidates.find((candidate) => normalize(candidate) === normalized);
  if (normalizedMatch) return normalizedMatch;
  const alias = aliases[normalized];
  return alias && candidates.some((candidate) => candidate === alias) ? alias : null;
}

export function canonicalizeEsgDriverCountry(
  value: string,
  optionsCountries: readonly string[] = ESG_DRIVER_COUNTRY_OPTIONS,
): string | null {
  const aliases: Record<string, string> = {
    'united arab emirates': 'UAE',
    ksa: 'Saudi Arabia',
    saudi: 'Saudi Arabia',
    'kingdom of saudi arabia': 'Saudi Arabia',
    'republic of kazakhstan': 'Kazakhstan',
    'republic of uzbekistan': 'Uzbekistan',
  };
  return canonicalize(value, optionsCountries, aliases);
}

export function canonicalizeEsgDriverSector(
  value: string,
  optionsSectors: readonly string[] = ESG_DRIVER_SECTOR_OPTIONS,
): string | null {
  const aliases: Record<string, string> = {
    bank: 'Banking',
    banking: 'Banking',
    financial: 'Banking',
    finance: 'Banking',
    insurance: 'Banking',
    lending: 'Banking',
    credit: 'Banking',
    'financial services': 'Banking',
    construction: 'Construction',
    cement: 'Construction',
    'building materials': 'Construction',
    contractor: 'Construction',
    contractors: 'Construction',
    property: 'Real Estate',
    buildings: 'Real Estate',
    building: 'Real Estate',
    reit: 'Real Estate',
    'real estate': 'Real Estate',
    oil: 'Oil & Gas',
    gas: 'Oil & Gas',
    petroleum: 'Oil & Gas',
    lng: 'Oil & Gas',
    upstream: 'Oil & Gas',
    downstream: 'Oil & Gas',
    'oil and gas': 'Oil & Gas',
    'mining and metal': 'Mining & Metals',
    'mining and metals': 'Mining & Metals',
  };
  return canonicalize(value, optionsSectors, aliases);
}

export function workbookDriverCount(
  country: string,
  sector: string,
  workbookOptions: DriverWorkbookOptions = ESG_DRIVER_WORKBOOK_OPTIONS,
): number {
  const canonicalCountry = canonicalizeEsgDriverCountry(country, workbookOptions.countries) || country.trim();
  const canonicalSector = canonicalizeEsgDriverSector(sector, workbookOptions.sectors) || sector.trim();
  return workbookOptions.counts[canonicalSector]?.[canonicalCountry] || 0;
}
