import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';
import { normalizeWorkbookUrl, type DriverWorkbook, type WorkbookSource } from '../src/lib/esg-drivers/workbook-types';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workbook = 'ESG_Drivers_September.xlsx';
const bytes = readFileSync(resolve(webRoot, 'data/esg-drivers', workbook));
const sha256 = createHash('sha256').update(bytes).digest('hex');
const book = XLSX.read(bytes, { type: 'buffer', cellText: true });
const catalog: DriverWorkbook = { version: `excel-v2.${sha256.slice(0, 16)}`, workbook, sha256, sheets: [] };
const warnings: string[] = [];

for (const name of book.SheetNames) {
  const sheet = book.Sheets[name];
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
  const cell = (row: number, col: number) => {
    const merge = sheet['!merges']?.find((m) => row >= m.s.r && row <= m.e.r && col >= m.s.c && col <= m.e.c);
    return sheet[XLSX.utils.encode_cell(merge ? merge.s : { r: row, c: col })];
  };
  const value = (row: number, col: number) => String(cell(row, col)?.v ?? '');
  if (!/Driver Name/i.test(value(0, 2))) throw new Error(`Unexpected header in ${name}!C1`);
  const sources = new Map<string, WorkbookSource>();
  const drivers: DriverWorkbook['sheets'][number]['drivers'] = [];
  let section = '';
  let type = '';
  for (let row = 1; row <= range.e.r; row++) {
    const sourceUrls: string[] = [];
    for (let col = 5; col <= range.e.c; col++) {
      const current = cell(row, col);
      const display = value(row, col);
      const urls = [...(current?.l?.Target ? [current.l.Target] : []), ...(display.match(/https?:\/\/[^\s<>"“”]+/gi) || [])];
      for (const raw of urls) {
        // Hyperlinks are authoritative; trim prose punctuation only from literal text URLs.
        const url = raw === current?.l?.Target ? raw.trim() : raw.replace(/[.,;]+$/, '');
        if (!/^https?:/i.test(url)) continue;
        try { normalizeWorkbookUrl(url); } catch { warnings.push(`${name}!${XLSX.utils.encode_cell({r: row, c: col})}: invalid source ${url}`); continue; }
        const address = XLSX.utils.encode_cell({ r: row, c: col });
        const source = sources.get(url) || { url, label: display && !display.includes('http') ? display : new URL(url).hostname, cells: [] };
        if (!source.cells.includes(address)) source.cells.push(address);
        sources.set(url, source);
        if (!sourceUrls.includes(url)) sourceUrls.push(url);
      }
    }
    const driverName = value(row, 2);
    if (!driverName.trim()) continue;
    // This workbook uses blank continuation cells instead of physical merges.
    // A new country starts a new category group; never inherit a prior country's type.
    const nextSection = value(row, 0);
    if (nextSection.trim() && nextSection !== section) type = '';
    section = nextSection.trim() ? nextSection : section;
    type = value(row, 1).trim() ? value(row, 1) : type;
    if (!section.trim() || !type.trim()) throw new Error(`Missing merged category at ${name}!${row + 1}`);
    drivers.push({ id: `${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-r${row + 1}`, sheet: name, row: row + 1, section, type, name: driverName, logic: value(row, 3), evidenceKpi: value(row, 4), keySources: value(row, 5), sourceUrls });
  }
  if (!drivers.length) throw new Error(`No drivers in ${name}`);
  catalog.sheets.push({ name, drivers, sources: [...sources.values()] });
}
if (warnings.length) throw new Error(warnings.join('\n'));
const isGlobal = (s: string) => /^global drivers?$/i.test(s.trim());
const countries = [...new Set(catalog.sheets.flatMap((s) => s.drivers.map((d) => d.section.trim()).filter((s) => !isGlobal(s))))];
const options = { workbook, version: catalog.version, countries, sectors: catalog.sheets.map((s) => s.name), counts: Object.fromEntries(catalog.sheets.map((s) => [s.name, Object.fromEntries(countries.map((country) => [country, s.drivers.filter((d) => isGlobal(d.section) || d.section.trim() === country).length]))])) };
for (const [file, data] of [['workbook.generated.json', catalog], ['workbook-options.generated.json', options]] as const) {
  const path = resolve(webRoot, 'src/lib/esg-drivers', file);
  const output = `${JSON.stringify(data, null, 2)}\n`;
  if (process.argv[2] === 'check') {
    if (readFileSync(path, 'utf8') !== output) throw new Error(`${file} is stale. Run pnpm catalog:generate.`);
  } else if (process.argv[2] === 'generate') writeFileSync(path, output);
  else throw new Error('Expected generate or check.');
}
console.log(`${catalog.version}: ${catalog.sheets.length} worksheets, ${catalog.sheets.reduce((n, s) => n + s.drivers.length, 0)} drivers. All workbook rows and source cells retained.`);
