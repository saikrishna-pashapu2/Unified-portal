import type { DriverCatalogChange, DriverCatalogDiff, DriverWorkbookOptions } from './catalog-contracts';
import type { DriverWorkbook, WorkbookDriver } from './workbook-types';
import { normalizeWorkbookUrl } from './workbook-types';

export const isGlobalDriverSection = (value: string) => /^global drivers?$/i.test(value.trim());

export function buildWorkbookOptions(catalog: DriverWorkbook): DriverWorkbookOptions {
  const countries = new Set<string>();
  const counts = Object.fromEntries(catalog.sheets.map((sheet) => {
    const localCounts = new Map<string, number>();
    let globalCount = 0;
    for (const driver of sheet.drivers) {
      const section = driver.section.trim();
      if (isGlobalDriverSection(section)) globalCount++;
      else {
        countries.add(section);
        localCounts.set(section, (localCounts.get(section) || 0) + 1);
      }
    }
    // Keep the matrix sparse: a country is selectable in a sector only when
    // that worksheet has a country-specific row. Avoid a sector × country scan.
    return [sheet.name, Object.fromEntries(Array.from(localCounts, ([country, count]) => [country, count + globalCount]))];
  }));
  return {
    workbook: catalog.workbook, version: catalog.version, countries: Array.from(countries),
    sectors: catalog.sheets.map((sheet) => sheet.name),
    counts,
  };
}

/** Match semantic identities so inserting an Excel row does not mark every later row changed. */
export function compareDriverCatalogs(before: DriverWorkbook, after: DriverWorkbook): DriverCatalogDiff {
  const key = (driver: WorkbookDriver) => JSON.stringify([driver.sheet, driver.section, driver.type, driver.name]);
  const group = (catalog: DriverWorkbook) => {
    const result = new Map<string, WorkbookDriver[]>();
    for (const sheet of catalog.sheets) for (const driver of sheet.drivers) {
      const id = key(driver);
      result.set(id, [...(result.get(id) || []), driver]);
    }
    return result;
  };
  const oldRows = group(before);
  const newRows = group(after);
  const changes: DriverCatalogChange[] = [];
  let addedDrivers = 0, removedDrivers = 0, changedDrivers = 0;
  const excerpt = (row: WorkbookDriver | null) => row && Object.fromEntries(Object.entries(row).map(([field, value]) => [
    field, field === 'sourceUrls' ? (value as string[]).slice(0, 4).map((url) => url.slice(0, 240)) : typeof value === 'string' ? value.slice(0, 240) : value,
  ])) as WorkbookDriver | null;
  const record = (kind: DriverCatalogChange['kind'], previous: WorkbookDriver | null, current: WorkbookDriver | null, fields: string[]) => {
    const row = current || previous!;
    const oldExcerpt = excerpt(previous), newExcerpt = excerpt(current);
    if (changes.length < 100) changes.push({ kind, sheet: row.sheet, driverName: row.name.slice(0, 240), fields, before: oldExcerpt, after: newExcerpt,
      detailsTruncated: JSON.stringify(oldExcerpt) !== JSON.stringify(previous) || JSON.stringify(newExcerpt) !== JSON.stringify(current) });
  };
  for (const id of Array.from(new Set([...Array.from(oldRows.keys()), ...Array.from(newRows.keys())]))) {
    const previous = oldRows.get(id) || [], current = newRows.get(id) || [];
    for (let index = 0; index < Math.max(previous.length, current.length); index++) {
      const oldRow = previous[index], newRow = current[index];
      if (!oldRow) { addedDrivers++; record('added', null, newRow, []); }
      else if (!newRow) { removedDrivers++; record('removed', oldRow, null, []); }
      else {
        const fields = (['logic', 'evidenceKpi', 'keySources', 'sourceUrls'] as const)
          .filter((field) => JSON.stringify(oldRow[field]) !== JSON.stringify(newRow[field]));
        if (fields.length) { changedDrivers++; record('changed', oldRow, newRow, [...fields]); }
      }
    }
  }
  const reorderedSheets = after.sheets.filter((sheet) => {
    const oldSheet = before.sheets.find((item) => item.name === sheet.name);
    if (!oldSheet) return false;
    const previous = oldSheet.drivers.map(key), current = sheet.drivers.map(key);
    const oldSet = new Set(previous), newSet = new Set(current);
    return JSON.stringify(previous.filter((id) => newSet.has(id))) !== JSON.stringify(current.filter((id) => oldSet.has(id)));
  }).map((sheet) => sheet.name);
  const urls = (catalog: DriverWorkbook) => new Map(catalog.sheets.flatMap((sheet) => sheet.sources.map((source) => {
    const url = normalizeWorkbookUrl(source.url);
    return [JSON.stringify([sheet.name, url]), { sheet: sheet.name, url }] as const;
  })));
  const oldUrls = urls(before), newUrls = urls(after);
  const added = Array.from(newUrls).filter(([id]) => !oldUrls.has(id)).map(([, source]) => ({ ...source, kind: 'added' as const }));
  const removed = Array.from(oldUrls).filter(([id]) => !newUrls.has(id)).map(([, source]) => ({ ...source, kind: 'removed' as const }));
  const addedSourceUrls = added.map((source) => source.url), removedSourceUrls = removed.map((source) => source.url);
  return {
    addedDrivers, removedDrivers, changedDrivers, addedSources: addedSourceUrls.length, removedSources: removedSourceUrls.length,
    addedSourceUrls: addedSourceUrls.slice(0, 100), removedSourceUrls: removedSourceUrls.slice(0, 100), changes,
    truncated: addedDrivers + removedDrivers + changedDrivers > changes.length || addedSourceUrls.length > 100 || removedSourceUrls.length > 100,
    reorderedSheets, sourceChanges: [...added.slice(0, 100), ...removed.slice(0, 100)],
  };
}
