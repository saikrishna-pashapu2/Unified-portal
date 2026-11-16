import type { EsgDriver, EsgDriverSource } from './types';

export type DriverDisplayOrder = 'report' | 'alphabetical';

const driverNameCollator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

/** Display order never changes persisted selection, category quotas, or scores. */
export function orderDriversForDisplay(drivers: readonly EsgDriver[], order: DriverDisplayOrder): EsgDriver[] {
  const ordered = [...drivers];
  return order === 'alphabetical'
    ? ordered.sort((a, b) => driverNameCollator.compare(a.driverTitle, b.driverTitle)
      || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    : ordered;
}

/** Only the source's evidenced document date belongs here, never its retrieval time. */
export function sourceDateLabel(source?: Pick<EsgDriverSource, 'sourceDate'> | null): string {
  const date = source?.sourceDate;
  if (!date?.value?.trim()) return 'Date not provided';
  const kind = { published: 'Published', updated: 'Updated', 'version-issued': 'Version issued' }[date.kind];
  return kind ? `${kind}: ${date.value}` : 'Date not provided';
}

/** Keep each document date attached to its exact cited URL, including undated sources. */
export function driverSourceDateLines(driver: EsgDriver, evidence: readonly EsgDriverSource[]): string[] {
  return driver.sourceLinks.map((url) => {
    const source = evidence.find((item) => item.url === url && driver.sourceRefs.includes(item.id));
    return `${url} — ${sourceDateLabel(source)}`;
  });
}
