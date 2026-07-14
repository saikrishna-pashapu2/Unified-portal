export const ESG_DRIVER_COUNTRY_OPTIONS = [
  "UAE",
  "Saudi Arabia",
  "Kazakhstan",
] as const;

export const ESG_DRIVER_SECTOR_OPTIONS = [
  "Banking",
  "Construction",
  "Real Estate",
  "Oil & Gas",
] as const;

export type SupportedEsgDriverCountry =
  (typeof ESG_DRIVER_COUNTRY_OPTIONS)[number];
export type SupportedEsgDriverSector =
  (typeof ESG_DRIVER_SECTOR_OPTIONS)[number];

export function canonicalizeEsgDriverCountry(
  value: string,
): SupportedEsgDriverCountry | null {
  const normalized = normalizeCoverageValue(value);

  if (normalized === "uae" || normalized === "united arab emirates") {
    return "UAE";
  }
  if (
    normalized === "ksa" ||
    normalized === "saudi" ||
    normalized === "saudi arabia" ||
    normalized === "kingdom of saudi arabia"
  ) {
    return "Saudi Arabia";
  }
  if (
    normalized === "kazakhstan" ||
    normalized === "republic of kazakhstan"
  ) {
    return "Kazakhstan";
  }

  return null;
}

export function canonicalizeEsgDriverSector(
  value: string,
): SupportedEsgDriverSector | null {
  const normalized = normalizeCoverageValue(value);

  if (
    /\b(bank|banking|financial|finance|insurance|lending|credit)\b/.test(
      normalized,
    )
  ) {
    return "Banking";
  }
  if (
    /\b(construction|cement|building materials|contractor|contractors)\b/.test(
      normalized,
    )
  ) {
    return "Construction";
  }
  if (/\b(real estate|property|buildings?|reit)\b/.test(normalized)) {
    return "Real Estate";
  }
  if (
    /\b(oil|gas|petroleum|lng|upstream|downstream)\b/.test(normalized)
  ) {
    return "Oil & Gas";
  }

  return null;
}

function normalizeCoverageValue(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
