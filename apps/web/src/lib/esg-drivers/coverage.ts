import options from './workbook-options.generated.json';

export const ESG_DRIVER_COUNTRY_OPTIONS = options.countries;
export const ESG_DRIVER_SECTOR_OPTIONS = options.sectors;
export const ESG_DRIVER_WORKBOOK_OPTIONS = options;
export type SupportedEsgDriverCountry = string;
export type SupportedEsgDriverSector = string;

const normalize = (s: string) => s.trim().toLowerCase().replace(/&/g, ' and ').replace(/\s+/g, ' ');

export function canonicalizeEsgDriverCountry(value: string): string | null {
  const aliases: Record<string, string> = {
    'united arab emirates': 'UAE', ksa: 'Saudi Arabia', saudi: 'Saudi Arabia',
    'kingdom of saudi arabia': 'Saudi Arabia', 'republic of kazakhstan': 'Kazakhstan',
    'republic of uzbekistan': 'Uzbekistan',
  };
  const key = normalize(value);
  return ESG_DRIVER_COUNTRY_OPTIONS.find((s) => normalize(s) === key) || aliases[key] || null;
}

export function canonicalizeEsgDriverSector(value: string): string | null {
  const aliases: Record<string, string> = { bank: 'Banking', 'financial services': 'Banking', property: 'Real Estate', 'mining and metal': 'Mining & Metals' };
  const key = normalize(value);
  return ESG_DRIVER_SECTOR_OPTIONS.find((s) => normalize(s) === key) || aliases[key] || null;
}

export function workbookDriverCount(country: string, sector: string): number {
  return (options.counts as Record<string, Record<string, number>>)[sector]?.[country] || 0;
}
