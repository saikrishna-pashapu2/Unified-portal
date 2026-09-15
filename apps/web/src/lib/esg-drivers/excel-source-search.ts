import 'server-only';
import { createHash } from 'node:crypto';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { fetchCatalogEvidence } from './research';
import { fetchExcelSource } from './excel-source-retrieval';
import { documentDates } from './excel-source-metadata';
import { assertWorkbookUrlAllowed, normalizeWorkbookUrl, type WorkbookDriver } from './workbook-types';
import type { EsgDriverSource, EsgWorkbookCheckpoint } from './types';

export interface ExcelPassage { id: string; sourceId: string; url: string; text: string; location: string }
export interface ExcelSearchResult { passages: ExcelPassage[]; sources: EsgDriverSource[]; failures: Array<{ url: string; reason: string }> }
type Retrieved = { source: EsgDriverSource; passages: ExcelPassage[] };
const digest = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);
const words = (s: string) => Array.from(new Set(s.toLowerCase().match(new RegExp("[\\p{L}][\\p{L}\\p{N}-]{2,}", "gu")) || [])).filter((w) => !STOP_WORDS.has(w));
const STOP_WORDS = new Set('the and for with from that this are into their will sector drivers driver climate esg related requirements global under through including'.split(' '));

/** Named frameworks need their identity in evidence, not just generic ESG words. */
export function driverIdentityAnchors(name: string): string[] {
  const cop = name.match(/\bCOP\s*(\d+)\b/i);
  if (cop) return [`cop${cop[1]}`, `cop ${cop[1]}`];
  const ifrs = name.match(/\bIFRS\s*S[12]\b/i);
  if (ifrs) return [ifrs[0].toLowerCase().replace(/\s+/g, ' ')];
  const acronym = name.match(/\(([A-Z][A-Z\d]{1,7})\)/)?.[1];
  if (acronym) return [acronym.toLowerCase(), name.replace(/\s*\([^)]*\)/g, '').toLowerCase()];
  if (/^(TNFD|CDP|TCFD|GFANZ|CBAM|ESRS|SASB)\b/.test(name)) return [name.match(/^\w+/)![0].toLowerCase()];
  if (/^Science-Based Climate Targets/i.test(name)) return ['sbti', 'science based targets', name.toLowerCase()];
  if (/^ICMA /i.test(name)) return [name.replace(/^ICMA /i, '').toLowerCase()];
  if (/^(Paris Agreement|GHG Protocol|Equator Principles|Climate Bonds Standard)$/.test(name)) return [name.toLowerCase()];
  return [];
}

const identityText = (text: string) => ` ${text.toLowerCase().replace(new RegExp('[^\\p{L}\\p{N}]+', 'gu'), ' ').trim()} `;
const matchesIdentity = (text: string, anchors: string[]) => anchors.some((anchor) => identityText(text).includes(identityText(anchor)));

function countryTerms(country: string) {
  if (/^(UAE|United Arab Emirates)$/i.test(country)) return ['uae', 'united arab emirates', 'emirati', 'dubai', 'abu dhabi'];
  if (/^(KSA|Saudi Arabia)$/i.test(country)) return ['ksa', 'saudi arabia', 'saudi'];
  return [country.toLowerCase()];
}

/** Select direct facts, dated updates and applicability context before filling with general relevance. */
export function selectExcelPassages(driver: WorkbookDriver, retrieved: Retrieved[], country: string, query = ''): ExcelPassage[] {
  const titleTerms = words(driver.name);
  const identityAnchors = driverIdentityAnchors(driver.name);
  const terms = words(`${driver.name} ${driver.logic} ${query}`);
  const ownUrls = new Set(driver.sourceUrls.map(normalizeWorkbookUrl));
  const countrySpecific = !/^global drivers?$/i.test(driver.section.trim());
  const countryAnchors = countryTerms(country);
  const ranked = retrieved.flatMap(({ source, passages }) => {
    const own = ownUrls.has(normalizeWorkbookUrl(source.url));
    const sourceInCountry = passages.some((p) => matchesIdentity(p.text, countryAnchors));
    return passages.map((passage) => {
      const text = passage.text.toLowerCase();
      const titleHits = titleTerms.filter((w) => text.includes(w)).length;
      const hits = terms.filter((w) => text.includes(w)).length;
      const identity = matchesIdentity(passage.text, identityAnchors);
      const dates = documentDates(passage.text).filter((d) => d.kind !== 'effective');
      const dated = Math.max(0, ...dates.map((d) => Date.parse(d.value)).filter((d) => Number.isFinite(d) && d <= Date.now()));
      const update = /\b(amendments?|revised|updated|standard history|new edition|issued|published)\b/i.test(passage.text);
      const scope = /\b(scope|applicability|applies? to|application|all of the following|banks and insurance|financial institutions.*include)\b/i.test(passage.text);
      const geographic = countrySpecific && sourceInCountry ? (matchesIdentity(passage.text, countryAnchors) ? 22 : 12) : 0;
      const score = hits + titleHits * 4 + (own && hits > 0 ? 30 : 0) + (identity ? 24 : 0) + geographic;
      return { passage, score, dated, own, scope, update, eligible: titleHits > 0 || (own && (hits >= 2 || scope)) };
    });
  }).filter((p) => p.eligible).sort((a, b) => b.score - a.score || b.dated - a.dated || a.passage.id.localeCompare(b.passage.id));
  const selected: ExcelPassage[] = [];
  const perSource = new Map<string, number>();
  const pdfCovers = new Map<string, ExcelPassage>();
  for (const { source, passages } of retrieved) {
    if (/\.pdf(?:$|[?#])/i.test(source.url) && passages[0]) pdfCovers.set(source.id, passages[0]);
  }
  const add = (p: ExcelPassage) => {
    if (selected.some((s) => s.id === p.id)) return;
    // Keep the report date citable for every selected PDF, including a supporting
    // worksheet source whose cover title differs from this row's topic.
    const cover = pdfCovers.get(p.sourceId);
    const additions = cover && cover.id !== p.id && !selected.some((s) => s.id === cover.id) ? [p, cover] : [p];
    if (selected.length + additions.length > 16 || (perSource.get(p.sourceId) || 0) + additions.length > 6) return;
    selected.push(...additions); perSource.set(p.sourceId, (perSource.get(p.sourceId) || 0) + additions.length);
  };
  // Keep a relevant opening/cover passage too: PDF titles and edition dates
  // often occur only there, while the strongest evidence is deeper in the file.
  for (const { source, passages } of retrieved.filter((r) => ownUrls.has(normalizeWorkbookUrl(r.source.url)))) {
    const candidates = ranked.filter((p) => p.passage.sourceId === source.id);
    if (!candidates.length) continue;
    add(candidates[0].passage);
    const opening = passages[0];
    if (opening && titleTerms.some((term) => identityText(opening.text).includes(identityText(term)))) add(opening);
    const latest = candidates.filter((p) => p.update && p.dated).sort((a, b) => b.dated - a.dated || b.score - a.score)[0];
    if (latest) add(latest.passage);
    const scope = candidates.find((p) => p.scope);
    if (scope) add(scope.passage);
  }
  for (const item of ranked) add(item.passage);
  if (identityAnchors.length && !selected.some((p) => matchesIdentity(p.text, identityAnchors))) return [];
  return selected;
}

export function sourcePassages(text: string, url: string): ExcelPassage[] {
  // Keep different retrieved versions of one URL distinct across interrupted runs.
  const sourceId = `S-${digest(normalizeWorkbookUrl(url))}-${digest(text)}`;
  const passages: ExcelPassage[] = [];
  const markers = Array.from(text.matchAll(/(?:^|\n\n)Page (\d+):\n/g));
  const sections = markers.length ? markers.map((m, i) => ({ start: m.index!, end: markers[i + 1]?.index ?? text.length, page: `Page ${m[1]}, ` })) : [{ start: 0, end: text.length, page: '' }];
  for (const section of sections) for (let offset = section.start; offset < section.end; offset += 1600) {
    const chunk = text.slice(offset, Math.min(offset + 2000, section.end));
    passages.push({ id: `${sourceId}-P${offset}`, sourceId, url, text: chunk, location: `${section.page}characters ${offset + 1}–${offset + chunk.length}` });
  }
  return passages;
}

/** Searches text already fetched from the pinned worksheet allowlist. No discovery API is available. */
export function createExcelSourceSearch(
  checkpoint: EsgWorkbookCheckpoint,
  options: { fetchEvidence?: typeof fetchCatalogEvidence; onFetch?: (url: string, index: number, total: number, error?: string, completed?: boolean) => Promise<void> } = {},
) {
  const allowedUrls = checkpoint.allowedSources.map((s) => s.url);
  const fetched = new Map<string, Retrieved>();
  const failures: ExcelSearchResult['failures'] = [];
  let loaded = false;
  async function load() {
    if (loaded) return;
    // Four bounded requests at a time; telemetry callbacks also fence cancellation/lease loss.
    const unique = Array.from(new Map(checkpoint.allowedSources.map((s) => [normalizeWorkbookUrl(s.url), s])).values());
    for (let start = 0; start < unique.length; start += 4) {
      await options.onFetch?.(unique[start].url, start, unique.length, undefined, false);
      const batch = unique.slice(start, start + 4);
      const results = await Promise.allSettled(batch.map(async (entry) => {
        assertWorkbookUrlAllowed(entry.url, allowedUrls);
        const data = await (options.fetchEvidence || fetchExcelSource)(entry.url, { allowedUrls, searchableText: true });
        assertWorkbookUrlAllowed(data.finalUrl, allowedUrls);
        const passages = sourcePassages(data.contentSnippet, entry.url);
        const source: EsgDriverSource = {
          id: `S-${digest(normalizeWorkbookUrl(entry.url))}-${digest(data.contentSnippet)}`, title: data.title || entry.label, url: entry.url,
          domain: new URL(entry.url).hostname, snippet: '', contentSnippet: '', retrievalStatus: 'retrieved',
          evidenceProvenance: 'retrieved-page', isContextualFallback: false, finalUrl: data.finalUrl,
          retrievalError: null, publishedDate: data.publishedDate, updatedDate: data.updatedDate,
          lastModified: data.lastModified, retrievedAt: new Date().toISOString(),
          sourceDate: data.sourceDate ?? null,
          documentDates: data.documentDates || [], retrievalMethod: data.retrievalMethod || 'direct',
          ...(data.directRetrievalError ? { directRetrievalError: data.directRetrievalError } : {}),
          // Workbook approval establishes permitted use, not an authority/freshness score.
          authorityScore: 0, freshnessScore: 0, relevanceScore: 0, sourceScore: 0,
        };
        return { source, passages };
      }));
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status === 'fulfilled') fetched.set(normalizeWorkbookUrl(batch[i].url), result.value);
        else failures.push({ url: batch[i].url, reason: result.reason instanceof Error ? result.reason.message : 'Source retrieval failed.' });
        await options.onFetch?.(batch[i].url, start + i + 1, unique.length, result.status === 'rejected' ? failures[failures.length - 1].reason : undefined, true);
      }
    }
    loaded = true;
  }
  async function search(driver: WorkbookDriver, query: string): Promise<ExcelSearchResult> {
    await load();
    const passages = selectExcelPassages(driver, Array.from(fetched.values()), checkpoint.input.country, query);
    const sources = Array.from(fetched.values()).filter((r) => passages.some((p) => p.sourceId === r.source.id)).map(({ source }) => {
      const selected = passages.filter((p) => p.sourceId === source.id);
      return { ...source, snippet: selected[0].text.slice(0, 600), contentSnippet: selected.map((p) => p.text).join('\n\n'), passages: selected.map((p) => ({ id: p.id, text: p.text, location: p.location })) };
    });
    return { passages, sources, failures: [...failures] };
  }

  /**
   * Revalidate a retained driver's complete source versions and return fresh
   * source metadata for the same source IDs. The driver's saved citations are
   * copied back onto the refreshed records so checkpoint integrity can continue
   * to resolve the original passage IDs, quotes, and locations.
   */
  async function refreshRetainedSources(driver: import('./types').EsgDriver): Promise<EsgDriverSource[]> {
    await load();
    if (!validateRetainedDriver(driver)) {
      throw new Error(`Retained source revalidation failed for driver ${driver.id}.`);
    }

    const citationsBySource = new Map<string, Array<{ id: string; text: string; location: string }>>();
    for (const citation of driver.citations || []) {
      const entries = citationsBySource.get(citation.sourceId) || [];
      if (!entries.some((entry) => entry.id === citation.passageId)) {
        entries.push({ id: citation.passageId, text: citation.quote, location: citation.location });
      }
      citationsBySource.set(citation.sourceId, entries);
    }

    const refreshed: EsgDriverSource[] = [];
    for (const sourceId of driver.sourceRefs || []) {
      const sourceIndex = driver.sourceRefs.indexOf(sourceId);
      const sourceUrl = driver.sourceLinks?.[sourceIndex];
      const retained = sourceUrl ? fetched.get(normalizeWorkbookUrl(sourceUrl))?.source : undefined;
      if (!retained || retained.id !== sourceId) {
        throw new Error(`Retained source revalidation failed for driver ${driver.id}.`);
      }
      const originalPassages = citationsBySource.get(sourceId) || [];
      refreshed.push({
        ...retained,
        snippet: originalPassages[0]?.text.slice(0, 600) || retained.snippet,
        contentSnippet: originalPassages.map((passage) => passage.text).join('\n\n') || retained.contentSnippet,
        passages: originalPassages.length ? originalPassages : retained.passages,
      });
    }
    return refreshed;
  }

  function validateRetainedDriver(driver: import('./types').EsgDriver): boolean {
    if (!driver.citations?.length || !driver.sourceRefs?.length || driver.sourceRefs.length !== driver.sourceLinks?.length) return false;
    if (new Set(driver.sourceRefs).size !== driver.sourceRefs.length) return false;
    const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
    return driver.citations.every((citation) => {
      const sourceIndex = driver.sourceRefs.indexOf(citation.sourceId);
      const sourceUrl = sourceIndex >= 0 ? driver.sourceLinks[sourceIndex] : undefined;
      const source = sourceUrl ? fetched.get(normalizeWorkbookUrl(sourceUrl)) : undefined;
      return Boolean(source && source.source.id === citation.sourceId && source.passages.some((passage) => normalize(passage.text).includes(normalize(citation.quote))));
    });
  }
  const searchTool = new DynamicStructuredTool({
    func: async ({ driverId, query }: { driverId: string; query?: string }) => {
    const driver = checkpoint.definitions.find((d) => d.id === driverId);
    if (!driver) throw new Error('Driver is not in this workbook selection.');
    return search(driver, query || '');
  },
    name: 'search_excel_sources',
    description: 'Search passages only in the exact URLs and hyperlink targets of the selected Excel worksheet. Returns source dates, locations, excerpts and retrieval failures. Cannot discover or open any other URL.',
    schema: z.object({ driverId: z.string(), query: z.string().max(500).optional() }),
  });
  return {
    search: searchTool,
    sourceChecks: () => loaded ? checkpoint.allowedSources.map(({ url }) => {
      const failure = failures.find((f) => f.url === url);
      return { url, status: fetched.has(normalizeWorkbookUrl(url)) ? 'retrieved' as const : 'unavailable' as const, ...(failure ? { reason: failure.reason } : {}) };
    }) : undefined,
    revalidate: async (driver: import('./types').EsgDriver) => {
      await load();
      return validateRetainedDriver(driver);
    },
    refreshRetainedSources,
  };
}
