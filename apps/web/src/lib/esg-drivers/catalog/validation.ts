import { ESG_DRIVER_CATALOG, getCatalogSeedSource, normalizeExactUrl } from "./data";
import {
  domainMatchesCatalogPolicy,
  normalizeCatalogHostname,
} from "./publisher-policy";

export type CatalogPublisherClassification =
  | "direct-publisher"
  | "guidance-only"
  | "unreviewed";

export function classifyCatalogPublisherUrl(url: string): CatalogPublisherClassification {
  const parsed = parseHttpsUrl(url);
  const host = normalizeCatalogHostname(parsed.hostname);
  if (
    ESG_DRIVER_CATALOG.manifest.reviewedDirectDomains.some((domain) =>
      domainMatchesCatalogPolicy(host, domain),
    )
  ) {
    return "direct-publisher";
  }
  if (
    ESG_DRIVER_CATALOG.manifest.reviewedGuidanceDomains.some((domain) =>
      domainMatchesCatalogPolicy(host, domain),
    )
  ) {
    return "guidance-only";
  }
  return "unreviewed";
}

export function assertReviewedCatalogWorkbookUrl(url: string): string {
  const normalized = normalizeExactUrl(parseHttpsUrl(url).toString());
  if (classifyCatalogPublisherUrl(normalized) === "unreviewed") {
    throw new Error(`Unreviewed ESG catalog publisher: ${new URL(normalized).hostname}`);
  }
  return normalized;
}

export function assertExactCatalogSeedUrl(url: string): string {
  const normalized = normalizeExactUrl(parseHttpsUrl(url).toString());
  if (!getCatalogSeedSource(normalized)) {
    throw new Error(`URL is not an approved exact ESG catalog seed: ${normalized}`);
  }
  return normalized;
}

function parseHttpsUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid ESG catalog URL: ${url}`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error(`ESG catalog URLs must be valid HTTPS URLs: ${url}`);
  }
  return parsed;
}
