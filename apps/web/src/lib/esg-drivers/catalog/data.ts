import catalogJson from "./catalog.generated.json";

import type { EsgDriverCatalog } from "./types";

export const ESG_DRIVER_CATALOG = catalogJson as unknown as EsgDriverCatalog;

const archetypeById = new Map(
  ESG_DRIVER_CATALOG.archetypes.map((archetype) => [archetype.id, archetype]),
);
const seedSourceByUrl = new Map(
  ESG_DRIVER_CATALOG.seedSources.map((source) => [normalizeExactUrl(source.exactUrl), source]),
);

export function getCatalogVersion(): string {
  return ESG_DRIVER_CATALOG.manifest.catalogVersion;
}

export function getCatalogArchetype(id: string) {
  return archetypeById.get(id);
}

export function getCatalogSeedSource(url: string) {
  try {
    return seedSourceByUrl.get(normalizeExactUrl(url));
  } catch {
    return undefined;
  }
}

export function normalizeExactUrl(url: string): string {
  return new URL(url).toString();
}
