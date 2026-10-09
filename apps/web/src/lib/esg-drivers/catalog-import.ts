import 'server-only';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import type { WorkbookValidationIssue } from './catalog-contracts';
import type { DriverWorkbook, WorkbookSource } from './workbook-types';
import { normalizeWorkbookUrl } from './workbook-types';
import { isGlobalDriverSection } from './catalog-utils';

export const MAX_DRIVER_CATALOG_BYTES = 5 * 1024 * 1024;
const MAX_PARSE_WORKERS = 2;
let activeParsers = 0;

export class DriverCatalogValidationError extends Error {
  constructor(public readonly issues: WorkbookValidationIssue[], public readonly status = 400) {
    super(issues[0]?.message || 'The workbook could not be validated.');
    this.name = 'DriverCatalogValidationError';
  }
}

type CatalogCell = { text: string; hyperlink: string | null };
interface ParsedCatalogSheet { name: string; rows: CatalogCell[][]; merges: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }> }

/** Parse outside the web thread with bounded input, decompression, memory and time. No URL is fetched. */
export async function parseDriverCatalogUpload(bytes: Buffer, filename: string): Promise<{ catalog: DriverWorkbook; warnings: WorkbookValidationIssue[] }> {
  const workbook = filename.split(/[\\/]/).pop()?.replace(/[\u0000-\u001f\u007f]/g, '').trim() || '';
  if (!workbook.toLowerCase().endsWith('.xlsx') || workbook.length > 180) throw new DriverCatalogValidationError([{ message: 'Choose an .xlsx workbook with a filename of at most 180 characters.' }]);
  if (!bytes.length || bytes.length > MAX_DRIVER_CATALOG_BYTES) throw new DriverCatalogValidationError([{ message: 'The workbook must be non-empty and no larger than 5 MiB.' }], bytes.length ? 413 : 400);
  if (bytes.length < 4 || bytes.readUInt32LE(0) !== 0x04034b50) throw new DriverCatalogValidationError([{ message: 'The file is not a valid .xlsx workbook.' }]);
  if (activeParsers >= MAX_PARSE_WORKERS) throw new DriverCatalogValidationError([{ message: 'Workbook validation is busy. Please retry shortly.' }], 503);
  activeParsers++;
  let parsed: ParsedCatalogSheet[];
  try {
    parsed = await new Promise<ParsedCatalogSheet[]>((resolve, reject) => {
      const worker = new Worker(CATALOG_WORKER, { eval: true, execArgv: [],
        // Resolve inside the unbundled worker. Webpack rewrites both static
        // require.resolve and createRequire(...).resolve into module numbers.
        workerData: { bytes: Uint8Array.from(bytes), moduleRoots: [__dirname, process.cwd(), join(process.cwd(), 'apps/web')] },
        resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 },
      });
      let settled = false;
      const finish = (action: () => void) => {
        if (settled) return;
        settled = true; clearTimeout(timer); void worker.terminate(); action();
      };
      const fail = (message: string) => finish(() => reject(new DriverCatalogValidationError([{ message }])));
      const timer = setTimeout(() => fail('Workbook validation exceeded its time limit. Reduce the workbook size and try again.'), 12_000);
      worker.once('message', (message: { sheets?: ParsedCatalogSheet[]; error?: string }) => {
        if (message.sheets) finish(() => resolve(message.sheets!));
        else fail(message.error || 'The workbook could not be read.');
      });
      worker.once('error', () => fail('The workbook could not be read within the parser limits.'));
      worker.once('exit', () => { if (!settled) fail('Workbook validation stopped unexpectedly.'); });
    });
    return compileCatalog(parsed, bytes, workbook);
  } finally { activeParsers--; }
}

function compileCatalog(sheets: ParsedCatalogSheet[], bytes: Buffer, workbook: string) {
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const catalog: DriverWorkbook = { version: `excel-v2.${sha256.slice(0, 16)}`, workbook, sha256, sheets: [] };
  const issues: WorkbookValidationIssue[] = [], warnings: WorkbookValidationIssue[] = [];
  const addIssue = (sheet: string, cell: string, message: string) => { if (issues.length < 100) issues.push({ sheet, cell, message }); };
  const address = (row: number, col: number) => `${String.fromCharCode(65 + Math.floor(col / 26) - 1).repeat(Number(col >= 26))}${String.fromCharCode(65 + col % 26)}${row + 1}`;
  const normalized = (text: string) => text.trim().toLowerCase().replace(/\s+/g, ' ');
  const headers = ['driver section/country', 'driver type', 'driver name', 'driver logic', 'evidence/kpi', 'key sources'];
  let totalDrivers = 0;
  for (const sheet of sheets) {
    const get = (row: number, col: number): CatalogCell => sheet.rows[row]?.[col] || { text: '', hyperlink: null };
    headers.forEach((header, col) => {
      if (normalized(get(0, col).text) !== header) addIssue(sheet.name, address(0, col), `Expected the “${['Driver Section/Country', 'Driver Type', 'Driver Name', 'Driver Logic', 'Evidence/KPI', 'Key Sources'][col]}” column in ${address(0, col)}.`);
    });
    if (!/^links?$/i.test(get(0, 6).text.trim())) addIssue(sheet.name, 'G1', 'At least one Link column is required, starting at G1.');
    for (let col = 6; col < sheet.rows[0].length; col++) {
      if (get(0, col).text.trim() && !/^links?$/i.test(get(0, col).text.trim())) addIssue(sheet.name, address(0, col), 'Columns after Key Sources must be Link columns.');
    }
    const sources = new Map<string, WorkbookSource>();
    const drivers: DriverWorkbook['sheets'][number]['drivers'] = [];
    const detailedDrivers = new Map<string, number>();
    let section = '', type = '';
    const headerLabels = ['driver section/country', 'driver type', 'driver name', 'driver logic', 'evidence/kpi', 'key sources'];
    const sourceHeader = (col: number) => col >= 6 ? /^(?:link|links)$/ : headerLabels[col] || '';
    const hasContent = (cell: CatalogCell) => Boolean(cell.text.trim() || cell.hyperlink);
    const rowHasContent = (cells: CatalogCell[]) => cells.some(hasContent);
    const rowHasContentFrom = (cells: CatalogCell[], start: number) => cells.slice(start).some(hasContent);
    const rowHasHyperlink = (cells: CatalogCell[]) => cells.some((cell) => Boolean(cell.hyperlink));
    const addWarning = (cell: string, message: string) => {
      if (warnings.length < 100) warnings.push({ sheet: sheet.name, cell, message });
    };
    const driverKey = (resolvedSection: string, resolvedType: string, name: string) => JSON.stringify([resolvedSection, resolvedType, name]);
    for (let row = 1; row < sheet.rows.length; row++) {
      const currentRow = sheet.rows[row] || [];
      const aText = get(row, 0).text.trim();
      const hasAnyHyperlink = rowHasHyperlink(currentRow);

      // A single text cell in column A is a note or heading, not a category
      // continuation. It must clear the inherited context before the next
      // blank-category row is considered.
      if (aText && !rowHasContentFrom(currentRow, 1)) {
        if (hasAnyHyperlink) {
          addIssue(sheet.name, address(row, 0), 'A note/heading row with hyperlink metadata is malformed; remove the hyperlink before retrying.');
        } else {
          addWarning(address(row, 0), 'Skipped a standalone note or heading. The next driver must specify its section/country and type.');
        }
        section = '';
        type = '';
        continue;
      }

      // Excel users sometimes paste the header row into the middle of a
      // worksheet. Only an exact, normalized A-C match with blank or expected
      // header labels in D+ is safely discardable. Any other content is an
      // error, so it cannot become a bogus "Driver Name" driver.
      const repeatsHeaders = headerLabels.slice(0, 3).every((header, col) => normalized(get(row, col).text) === header);
      if (repeatsHeaders) {
        let malformed = false;
        for (let col = 0; col < currentRow.length; col++) {
          const current = get(row, col);
          if (current.hyperlink) {
            addIssue(sheet.name, address(row, col), 'Repeated header rows cannot contain hyperlink metadata; remove it before retrying.');
            malformed = true;
            continue;
          }
          if (col < 3 || !current.text.trim()) continue;
          const expected = sourceHeader(col);
          if (typeof expected === 'string' ? normalized(current.text) !== expected : !expected.test(normalized(current.text))) {
            addIssue(sheet.name, address(row, col), 'Repeated header row contains unexpected content; review the row instead of dropping it.');
            malformed = true;
          }
        }
        if (!malformed) addWarning(address(row, 0), 'Skipped repeated column headers. The next driver must specify its section/country and type.');
        section = '';
        type = '';
        continue;
      }

      const name = get(row, 2).text;
      if (!name.trim()) {
        if (rowHasContent(currentRow)) addIssue(sheet.name, `C${row + 1}`, 'A row with driver content must have a Driver Name.');
        continue;
      }

      const nextSection = get(row, 0).text;
      let resolvedSection = section;
      let resolvedType = type;
      if (nextSection.trim()) {
        if (nextSection !== section) resolvedType = '';
        resolvedSection = nextSection;
      }
      if (get(row, 1).text.trim()) resolvedType = get(row, 1).text;

      // A-C-only rows are valid new compact drivers. When the exact resolved
      // identity already had an earlier detailed row in this same worksheet,
      // the compact row is a repeated summary and can be skipped. Do not use
      // normalized names here: distinct workbook identities must remain.
      const compactRow = !rowHasContentFrom(currentRow, 3);
      if (compactRow && hasAnyHyperlink && rowHasContentFrom(currentRow, 0)) {
        // Hyperlinks in A-C are unsupported metadata. A link in D+ would make
        // the row non-compact and is handled as ordinary driver content.
        const unsupported = currentRow.findIndex((_, col) => col < 5 && Boolean(get(row, col).hyperlink));
        if (unsupported >= 0) {
          addIssue(sheet.name, address(row, unsupported), 'Hyperlink metadata is only supported in source/link columns.');
          continue;
        }
      }
      const originalRow = compactRow ? detailedDrivers.get(driverKey(resolvedSection, resolvedType, name)) : undefined;
      if (originalRow !== undefined) {
        section = resolvedSection;
        type = resolvedType;
        addWarning(address(row, 2), `Skipped a duplicate summary; the complete driver from row ${originalRow} was retained.`);
        continue;
      }

      // Canonical values are reused verbatim in checkpoints, progress updates
      // and evidence prompts. Bound those fields independently of ZIP/cell size.
      const fieldLimits: Array<[number, number, string]> = [
        [1, 160, 'Driver Type'], [2, 160, 'Driver Name'],
        [3, 2000, 'Driver Logic'], [4, 2000, 'Evidence/KPI'], [5, 4096, 'Key Sources'],
      ];
      for (const [column, limit, label] of fieldLimits) {
        if (get(row, column).text.length > limit) addIssue(sheet.name, address(row, column), `${label} must be at most ${limit.toLocaleString('en-US')} characters.`);
      }
      section = resolvedSection;
      type = resolvedType;
      if (!section.trim()) addIssue(sheet.name, `A${row + 1}`, 'Enter a section/country before using blank continuation cells.');
      if (!type.trim()) addIssue(sheet.name, `B${row + 1}`, 'Enter a driver type for this country or section.');
      if (section.trim().length > 120 || sheet.name.trim().length < 2) addIssue(sheet.name, `A${row + 1}`, 'Country labels must be at most 120 characters and sector names at least two characters.');

      const sourceUrls: string[] = [];
      for (let col = 5; col < currentRow.length; col++) {
        const current = get(row, col), display = current.text;
        const urls = [...(current.hyperlink ? [current.hyperlink] : []), ...(display.match(/https?:\/\/[^\s<>"“”]+/gi) || [])];
        if (col >= 6 && display.trim() && !current.hyperlink && !urls.length) addWarning(address(row, col), 'This Link cell contains a label without a URL. It will not be used as a source; add an HTTP(S) URL or embedded hyperlink to enable it.');
        for (const raw of urls) {
          const url = raw === current.hyperlink ? raw.trim() : raw.replace(/[.,;]+$/, '');
          try {
            normalizeWorkbookUrl(url);
            const host = new URL(url).hostname.toLowerCase();
            if (url.length > 2048 || /^(localhost|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|\[::)/.test(host) || /\.(localhost|local|internal)$/.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) throw new Error('non-public source');
          } catch { addIssue(sheet.name, address(row, col), 'Use a public HTTP(S) source URL without credentials.'); continue; }
          const location = address(row, col);
          const source = sources.get(url) || { url, label: display && !display.includes('http') ? display : new URL(url).hostname, cells: [] };
          if (!source.cells.includes(location)) source.cells.push(location);
          sources.set(url, source);
          if (sources.size > 250) throw new DriverCatalogValidationError([{ sheet: sheet.name, cell: location, message: 'A sector worksheet may contain at most 250 distinct source URLs.' }]);
          if (!sourceUrls.includes(url)) sourceUrls.push(url);
        }
      }
      drivers.push({ id: `${sheet.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-r${row + 1}`, sheet: sheet.name, row: row + 1, section, type, name, logic: get(row, 3).text, evidenceKpi: get(row, 4).text, keySources: get(row, 5).text, sourceUrls });
      if (rowHasContentFrom(currentRow, 3) && !detailedDrivers.has(driverKey(section, type, name))) {
        detailedDrivers.set(driverKey(section, type, name), row + 1);
      }
      if (!sourceUrls.length) addWarning(`G${row + 1}`, 'This driver has no row-specific source link. Research can use only the other permitted links in this worksheet.');
    }
    if (!drivers.length) addIssue(sheet.name, 'C2', 'Every sector worksheet must contain at least one named driver.');
    if (!drivers.some((driver) => driver.section.trim() && !isGlobalDriverSection(driver.section))) addIssue(sheet.name, 'A2', 'Include a country-specific driver so this worksheet can be selected for generation.');
    if (!sources.size) addIssue(sheet.name, 'G2', 'Every sector worksheet needs at least one permitted source URL.');
    const globalCount = drivers.filter((driver) => isGlobalDriverSection(driver.section)).length;
    const countryCounts = new Map<string, number>();
    for (const driver of drivers) if (!isGlobalDriverSection(driver.section)) countryCounts.set(driver.section.trim(), (countryCounts.get(driver.section.trim()) || 0) + 1);
    for (const [country, count] of Array.from(countryCounts)) if (count + globalCount > 150) addIssue(sheet.name, 'A2', `${country} selects ${count + globalCount} candidates. Limit each country/sector selection, including global rows, to 150 drivers.`);
    totalDrivers += drivers.length;
    catalog.sheets.push({ name: sheet.name, drivers, sources: Array.from(sources.values()) });
  }
  if (totalDrivers > 10_000) issues.push({ message: 'A driver workbook may contain at most 10,000 drivers.' });
  if (catalog.sheets.reduce((total, sheet) => total + sheet.sources.length, 0) > 1000) issues.push({ message: 'A driver workbook may contain at most 1,000 source URLs across its worksheets.' });
  if (issues.length) throw new DriverCatalogValidationError(issues);
  return { catalog, warnings };
}

const CATALOG_WORKER = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
const { inflateRawSync } = require('node:zlib');
const fail = (message) => { throw new Error(message); };
try {
  const bytes = Buffer.from(workerData.bytes);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) { end = i; break; }
  }
  if (end < 0 || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6)) fail('The XLSX archive is invalid or uses an unsupported format.');
  const entries = bytes.readUInt16LE(end + 10);
  if (!entries || entries > 2000 || entries !== bytes.readUInt16LE(end + 8)) fail('The workbook contains too many archive entries.');
  let offset = bytes.readUInt32LE(end + 16), expanded = 0;
  const centralEnd = offset + bytes.readUInt32LE(end + 12);
  if (centralEnd !== end) fail('The workbook archive directory is invalid.');
  const names = new Set();
  for (let index = 0; index < entries; index++) {
    if (offset + 46 > centralEnd || bytes.readUInt32LE(offset) !== 0x02014b50) fail('The workbook archive directory is invalid.');
    const flags = bytes.readUInt16LE(offset + 8), method = bytes.readUInt16LE(offset + 10);
    const packed = bytes.readUInt32LE(offset + 20), size = bytes.readUInt32LE(offset + 24);
    const nameSize = bytes.readUInt16LE(offset + 28), extraSize = bytes.readUInt16LE(offset + 30), commentSize = bytes.readUInt16LE(offset + 32);
    const next = offset + 46 + nameSize + extraSize + commentSize;
    if (next > centralEnd || (flags & 1) || ![0,8].includes(method) || size > 8 * 1024 * 1024) fail('Encrypted, oversized or unsupported workbook entries are not allowed.');
    const name = bytes.subarray(offset + 46, offset + 46 + nameSize).toString('utf8');
    if (names.has(name) || name.startsWith('/') || name.includes('..') || name.includes('\\')) fail('The workbook has invalid archive paths.');
    names.add(name);
    if (/vbaProject|externalLinks\/|embeddings\//i.test(name)) fail('Macros, embedded objects and external workbook links are not supported. Save a values-only .xlsx workbook.');
    expanded += size;
    if (expanded > 32 * 1024 * 1024) fail('The expanded workbook exceeds the 32 MiB limit.');
    const local = bytes.readUInt32LE(offset + 42);
    if (local + 30 > bytes.length || bytes.readUInt32LE(local) !== 0x04034b50) fail('The workbook entry is invalid.');
    const begin = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    if (begin + packed > bytes.readUInt32LE(end + 16)) fail('The workbook entry size is invalid.');
    const data = bytes.subarray(begin, begin + packed);
    const unpacked = method === 8 ? inflateRawSync(data, { maxOutputLength: 8 * 1024 * 1024 }) : data;
    if (unpacked.length !== size) fail('The workbook entry size is invalid.');
    offset = next;
  }
  if (offset !== centralEnd || !names.has('[Content_Types].xml') || !names.has('xl/workbook.xml')) fail('The archive is not an Excel workbook.');
  const XLSX = require(require.resolve('xlsx', { paths: workerData.moduleRoots }));
  const workbook = XLSX.read(bytes, { type: 'buffer', sheetRows: 2001, cellFormula: true, cellHTML: false, cellStyles: false, bookVBA: false });
  if (!workbook.SheetNames.length || workbook.SheetNames.length > 20) fail('Use between 1 and 20 sector worksheets.');
  let cells = 0, textSize = 0;
  const sheets = workbook.SheetNames.map(name => {
    const sheet = workbook.Sheets[name];
    const range = XLSX.utils.decode_range(sheet['!fullref'] || sheet['!ref'] || 'A1');
    if (range.e.r >= 2000 || range.e.c >= 32) fail(name + ': limit each sheet to 2,000 rows and 32 columns.');
    cells += (range.e.r + 1) * (range.e.c + 1);
    if (cells > 100000) fail('The workbook contains too many cells.');
    const merges = sheet['!merges'] || [];
    if (merges.length > 2000 || merges.some(m => m.s.r < 0 || m.s.c < 0 || m.s.r > m.e.r || m.s.c > m.e.c || m.e.r > range.e.r || m.e.c > range.e.c)) fail(name + ': invalid merged-cell range.');
    const rows = [];
    for (let r=0; r<=range.e.r; r++) {
      const row=[];
      for (let c=0; c<=range.e.c; c++) {
        const address=XLSX.utils.encode_cell({r,c}), cell=sheet[address];
        if (cell && (cell.f || cell.t === 'e')) fail(name + '!' + address + ': replace formulas or Excel errors with plain values; use embedded hyperlinks for source links.');
        const text=String(cell?.v ?? ''), hyperlink=cell?.l?.Target ? String(cell.l.Target) : null;
        if (text.length > 20000 || (hyperlink && hyperlink.length > 2048)) fail(name + '!' + address + ': cell content is too long.');
        textSize += text.length + (hyperlink?.length || 0);
        if (textSize > 4000000) fail('The workbook contains too much text.');
        row.push({text,hyperlink});
      }
      rows.push(row);
    }
    const merged = new Set();
    for (const merge of merges) {
      for (let r=merge.s.r;r<=merge.e.r;r++) for(let c=merge.s.c;c<=merge.e.c;c++) {
        const key=r*32+c;
        if(merged.has(key) || merged.size>=100000) fail(name + ': overlapping or excessive merged-cell ranges.');
        merged.add(key);
        const previous=rows[r][c], value=rows[merge.s.r][merge.s.c];
        textSize += value.text.length + (value.hyperlink?.length || 0) - previous.text.length - (previous.hyperlink?.length || 0);
        if (textSize > 4000000) fail('The workbook contains too much text after resolving merged cells.');
        rows[r][c]=value;
      }
    }
    return {name,rows,merges:[]};
  });
  parentPort.postMessage({sheets});
} catch (error) {
  parentPort.postMessage({error: error instanceof Error ? error.message.slice(0,500) : 'The workbook could not be read.'});
}
`;
