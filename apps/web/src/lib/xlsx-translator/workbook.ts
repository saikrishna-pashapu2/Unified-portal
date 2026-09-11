import { createHash } from "node:crypto";
import path from "node:path";
import { load } from "cheerio";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import {
  detectCellLanguage,
  detectLegacyCellLanguage,
  isIdentifierText,
} from "./language";
import type {
  CellView,
  Inspection,
  Selection,
  SheetView,
  TableView,
  TranslationEntry,
  TranslationPlan,
} from "./types";

export class WorkbookInputError extends Error {}
const MAX_EXPANDED = 128 * 1024 * 1024;
const MAX_CELLS = 1_000_000;
const MAX_PARTS = 20_000;
type Xml = ReturnType<typeof load>;
type Sheet = {
  name: string;
  part: string;
  hidden: boolean;
  xml: Xml;
  cells: Map<string, CellView>;
  merges: string[];
  range: string;
  tables: TableView[];
};
export type WorkbookSource = {
  parts: Record<string, Uint8Array>;
  sheets: Sheet[];
  inspection: Inspection;
  // Only used to replay pre-values-only scopes without changing paid batches.
  legacyFormulaCells: Set<string>;
};

export function cellPosition(address: string) {
  const m = /^\$?([A-Z]{1,3})\$?([1-9]\d*)$/.exec(address.toUpperCase());
  if (!m) throw new WorkbookInputError("Use an Excel cell address such as A1.");
  const col = Array.from(m[1]).reduce(
    (n, c) => n * 26 + c.charCodeAt(0) - 64,
    0,
  );
  const row = Number(m[2]);
  if (col > 16384 || row > 1048576)
    throw new WorkbookInputError("Range is outside the worksheet.");
  return { row, col };
}
export function columnName(n: number): string {
  let s = "";
  for (; n > 0; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
export function rangeBounds(range: string) {
  const [a, b, ...rest] = range.toUpperCase().split(":");
  if (rest.length)
    throw new WorkbookInputError("Use one rectangular range per selection.");
  const start = cellPosition(a),
    end = cellPosition(b || a);
  if (start.row > end.row || start.col > end.col)
    throw new WorkbookInputError("Range ends before it starts.");
  return { r1: start.row, c1: start.col, r2: end.row, c2: end.col };
}
const inside = (
  c: { row: number; col: number },
  b: ReturnType<typeof rangeBounds>,
) => c.row >= b.r1 && c.row <= b.r2 && c.col >= b.c1 && c.col <= b.c2;
export const cellKey = (sheet: string, address: string) =>
  JSON.stringify([sheet, address]);

// Inspect the central directory BEFORE decompressing. No ZIP entries are extracted to disk.
export function readZip(buffer: Buffer): Record<string, Uint8Array> {
  if (buffer.length < 22 || buffer.readUInt32LE(0) !== 0x04034b50)
    throw new WorkbookInputError("Upload an unencrypted XLSX workbook.");
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--)
    if (
      buffer.readUInt32LE(i) === 0x06054b50 &&
      i + 22 + buffer.readUInt16LE(i + 20) === buffer.length
    ) {
      end = i;
      break;
    }
  if (end < 0)
    throw new WorkbookInputError("Workbook ZIP directory is invalid.");
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16),
    total = 0;
  if (
    count > MAX_PARTS ||
    buffer.readUInt16LE(end + 4) !== 0 ||
    buffer.readUInt16LE(end + 6) !== 0
  )
    throw new WorkbookInputError("Workbook archive is too complex.");
  const names = new Set<string>();
  const declared = new Map<string, number>();
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || buffer.readUInt32LE(offset) !== 0x02014b50)
      throw new WorkbookInputError("Workbook ZIP directory is invalid.");
    const flags = buffer.readUInt16LE(offset + 8),
      method = buffer.readUInt16LE(offset + 10),
      size = buffer.readUInt32LE(offset + 24);
    const len = buffer.readUInt16LE(offset + 28),
      extra = buffer.readUInt16LE(offset + 30),
      comment = buffer.readUInt16LE(offset + 32);
    const name = buffer
      .subarray(offset + 46, offset + 46 + len)
      .toString("utf8");
    total += size;
    if (
      total > MAX_EXPANDED ||
      size > 32 * 1024 * 1024 ||
      flags & 1 ||
      ![0, 8].includes(method) ||
      names.has(name) ||
      /(^\/|\\|(^|\/)\.\.(\/|$))/.test(name)
    )
      throw new WorkbookInputError(
        "Workbook exceeds safe processing limits or contains unsupported archive entries.",
      );
    names.add(name);
    declared.set(name, size);
    offset += 46 + len + extra + comment;
  }
  try {
    const result = unzipSync(buffer, {
      filter: (entry) => {
        if (
          entry.originalSize > 32 * 1024 * 1024 ||
          declared.get(entry.name) !== entry.originalSize
        )
          throw new WorkbookInputError("Unsafe workbook entry.");
        return true;
      },
    });
    if (
      Object.keys(result).length !== count ||
      Object.entries(result).some(
        ([name, bytes]) => bytes.length !== declared.get(name),
      )
    )
      throw new WorkbookInputError("Workbook archive sizes are inconsistent.");
    return result;
  } catch {
    throw new WorkbookInputError("Workbook cannot be safely decompressed.");
  }
}
function xml(parts: Record<string, Uint8Array>, part: string): Xml {
  if (!parts[part])
    throw new WorkbookInputError("Workbook is missing a required component.");
  const text = strFromU8(parts[part]);
  if (/<!DOCTYPE|<!ENTITY/i.test(text))
    throw new WorkbookInputError("XML entities are not supported.");
  return load(text, { xmlMode: true });
}
function related(
  parts: Record<string, Uint8Array>,
  part: string,
): Map<string, string> {
  const rp = path.posix.join(
    path.posix.dirname(part),
    "_rels",
    path.posix.basename(part) + ".rels",
  );
  if (!parts[rp]) return new Map();
  const $ = xml(parts, rp),
    result = new Map<string, string>();
  $("Relationship").each((_, el) => {
    const a = $(el).attr();
    if (a?.TargetMode !== "External" && a?.Id && a.Target)
      result.set(
        a.Id,
        a.Target.startsWith("/")
          ? a.Target.slice(1)
          : path.posix.normalize(
              path.posix.join(path.posix.dirname(part), a.Target),
            ),
      );
  });
  return result;
}
function textOf($: Xml, node: Parameters<Xml>[0]): string {
  return $(node)
    .find("t")
    .map((_, e) => $(e).text())
    .get()
    .join("");
}

export function inspectWorkbook(buffer: Buffer): WorkbookSource {
  if (buffer.length < 22)
    throw new WorkbookInputError("Workbook is empty or invalid.");
  const parts = readZip(buffer);
  if (!parts["xl/workbook.xml"] || !parts["[Content_Types].xml"])
    throw new WorkbookInputError("This ZIP file is not an XLSX workbook.");
  const contentTypes = xml(parts, "[Content_Types].xml");
  if (
    !contentTypes("Override")
      .toArray()
      .some(
        (el) =>
          contentTypes(el).attr("PartName") === "/xl/workbook.xml" &&
          contentTypes(el).attr("ContentType") ===
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
      )
  )
    throw new WorkbookInputError("Only plain XLSX workbooks are supported.");
  if (
    Object.keys(parts).some((n) =>
      /vbaProject|externalLinks\/|_xmlsignatures\/|embeddings\//i.test(n),
    )
  )
    throw new WorkbookInputError(
      "Macros, embedded files, signed workbooks and external workbook links are not supported. Upload a plain XLSX copy.",
    );
  const wb = xml(parts, "xl/workbook.xml"),
    rel = related(parts, "xl/workbook.xml");
  const strings: string[] = [],
    richStrings = new Set<number>();
  if (parts["xl/sharedStrings.xml"]) {
    const $ = xml(parts, "xl/sharedStrings.xml");
    $("si").each((_, e) => {
      if ($(e).find("r").length) richStrings.add(strings.length);
      strings.push(textOf($, e));
    });
  }
  const styles: CellView["style"][] = [];
  if (parts["xl/styles.xml"]) {
    const $ = xml(parts, "xl/styles.xml");
    const fonts = $("fonts > font").toArray(),
      fills = $("fills > fill").toArray();
    $("cellXfs > xf").each((_, el) => {
      const e = $(el),
        font = $(fonts[Number(e.attr("fontId") || 0)]),
        fill = $(fills[Number(e.attr("fillId") || 0)]),
        rgb = font.find("color").attr("rgb"),
        bg = fill.find("fgColor").attr("rgb");
      styles.push({
        bold: font.find("b").length > 0,
        italic: font.find("i").length > 0,
        fontSize: Number(font.find("sz").attr("val")) || 11,
        color:
          rgb && /^[A-F\d]{8}$/i.test(rgb) ? "#" + rgb.slice(2) : undefined,
        fill: bg && /^[A-F\d]{8}$/i.test(bg) ? "#" + bg.slice(2) : undefined,
        align: e.find("alignment").attr("horizontal"),
        wrap: e.find("alignment").attr("wrapText") === "1",
        border: Number(e.attr("borderId") || 0) > 0,
      });
    });
  }
  const sheets: Sheet[] = [];
  const legacyFormulaCells = new Set<string>();
  let cellCount = 0;
  wb("sheets > sheet").each((_, el) => {
    const e = wb(el),
      part = rel.get(e.attr("r:id") || "");
    if (!part)
      throw new WorkbookInputError("Unsupported worksheet relationship.");
    const $ = xml(parts, part);
    if (!$("worksheet").length)
      throw new WorkbookInputError("Only ordinary worksheets are supported.");
    const cells = new Map<string, CellView>();
    $("sheetData c").each((_, el) => {
      const c = $(el),
        address = c.attr("r") || "",
        type = c.attr("t"),
        formula = c.find("f").length > 0;
      let text =
        type === "s"
          ? (strings[Number(c.find("v").text())] ?? "")
          : type === "inlineStr"
            ? textOf($, el)
            : c.find("v").text();
      if (!text && !formula) return;
      if (++cellCount > MAX_CELLS)
        throw new WorkbookInputError(
          "Workbook exceeds one million populated cells.",
        );
      const language = detectCellLanguage(text),
        pos = cellPosition(address);
      const rich =
        type === "s"
          ? richStrings.has(Number(c.find("v").text()))
          : c.find("is r").length > 0;
      if (formula)
        legacyFormulaCells.add(
          cellKey(e.attr("name") || `Sheet ${sheets.length + 1}`, address),
        );
      const protection =
        formula && !text.trim()
          ? "Empty or missing saved formula result"
          : rich
            ? "Rich text formatting"
            : !["s", "inlineStr", "str"].includes(type || "")
              ? "Number / date / value"
              : isIdentifierText(text)
                ? "Identifier / numeric text"
                : language === "English"
                  ? "English is preserved"
                  : undefined;
      cells.set(address, {
        address,
        ...pos,
        text,
        formula,
        language,
        protection,
        style: styles[Number(c.attr("s") || 0)] || {},
      });
    });
    const merges = $("mergeCell")
      .map((_, e) => $(e).attr("ref") || "")
      .get();
    const values = Array.from(cells.values()),
      mergeBounds = merges.map(rangeBounds);
    const lastRow = mergeBounds.reduce(
        (n, b) => Math.max(n, b.r2),
        values.reduce((n, c) => Math.max(n, c.row), 1),
      ),
      lastCol = mergeBounds.reduce(
        (n, b) => Math.max(n, b.c2),
        values.reduce((n, c) => Math.max(n, c.col), 1),
      );
    sheets.push({
      name: e.attr("name") || `Sheet ${sheets.length + 1}`,
      part,
      hidden: e.attr("state") === "hidden" || e.attr("state") === "veryHidden",
      xml: $,
      cells,
      merges,
      range: `A1:${columnName(lastCol)}${lastRow}`,
      tables: [],
    });
  });
  if (!sheets.length || sheets.length > 200)
    throw new WorkbookInputError("Workbook must contain 1–200 worksheets.");
  // Compatibility only: reconstruct the exact formula exclusions used by old
  // paid scopes. New scopes do not use this set. Never enlarge an old paid batch.
  const literals = new Set<string>();
  const dependencies: Array<{
    sheet: string;
    bounds: ReturnType<typeof rangeBounds>;
  }> = [];
  let dynamic = false;
  function scanFormula(formula: string, sheet: string) {
    for (const m of Array.from(formula.matchAll(/"((?:[^"]|"")*)"/g)))
      literals.add(m[1].replace(/""/g, '"'));
    if (
      /\b(?:INDIRECT|OFFSET)\s*\(/i.test(formula) ||
      /\[[^\]]+\]/.test(formula)
    )
      dynamic = true;
    const cleaned = formula.replace(/"(?:[^"]|"")*"/g, "");
    const refs =
      /(?:(?:'((?:[^']|'')+)'|([A-Za-z\u0400-\u04ff\d_.]+))!)?(\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?|\$?[A-Z]{1,3}:\$?[A-Z]{1,3})(?![A-Za-z\u0400-\u04ff\d_(])/g;
    for (const m of Array.from(cleaned.matchAll(refs))) {
      let r = m[3].replace(/\$/g, "");
      if (/^[A-Z]+:[A-Z]+$/.test(r)) {
        const [a, b] = r.split(":");
        r = `${a}1:${b}1048576`;
      }
      try {
        dependencies.push({
          sheet: (m[1] || m[2] || sheet).replace(/''/g, "'"),
          bounds: rangeBounds(r),
        });
      } catch {
        /* Function names are not cell references. */
      }
    }
  }
  for (const s of sheets)
    s.xml(
      "f, dataValidation formula1, dataValidation formula2, conditionalFormatting formula",
    ).each((_, e) => {
      const start = dependencies.length;
      scanFormula(s.xml(e).text(), s.name);
      if (s.xml(e).attr("t") === "shared" && s.xml(e).text()) {
        const ref = s.xml(e).attr("ref"),
          anchor = s.xml(e).parent().attr("r");
        if (!ref || !anchor) {
          dynamic = true;
          return;
        }
        const group = rangeBounds(ref),
          origin = cellPosition(anchor);
        // Expand precedents conservatively across the shared-formula group.
        // Absolute references may be over-protected, but never under-protected.
        for (const d of dependencies.slice(start)) {
          d.bounds = {
            r1: Math.max(1, d.bounds.r1 + Math.min(0, group.r1 - origin.row)),
            r2: Math.min(
              1048576,
              d.bounds.r2 + Math.max(0, group.r2 - origin.row),
            ),
            c1: Math.max(1, d.bounds.c1 + Math.min(0, group.c1 - origin.col)),
            c2: Math.min(
              16384,
              d.bounds.c2 + Math.max(0, group.c2 - origin.col),
            ),
          };
        }
      }
    });
  wb("definedName").each((_, e) =>
    scanFormula(
      wb(e).text(),
      sheets[Number(wb(e).attr("localSheetId") || 0)]?.name || sheets[0].name,
    ),
  );
  for (const s of sheets) {
    const deps = dependencies.filter((d) => d.sheet === s.name);
    // Coalesce duplicate references to keep large formula-heavy files inexpensive.
    const unique = Array.from(
      new Map(deps.map((d) => [JSON.stringify(d.bounds), d.bounds])).values(),
    );
    for (const c of Array.from(s.cells.values()))
      if (
        !c.protection &&
        (dynamic || literals.has(c.text) || unique.some((b) => inside(c, b)))
      )
        legacyFormulaCells.add(cellKey(s.name, c.address));
    s.tables = detectTables(s, parts);
    for (const t of s.tables.filter((t) => t.kind === "table")) {
      const bounds = rangeBounds(t.range);
      for (const c of Array.from(s.cells.values()))
        if (c.row === bounds.r1 && inside(c, bounds) && !c.protection)
          c.protection = "Excel table header";
    }
  }
  const views: SheetView[] = sheets.map((s) => ({
    name: s.name,
    hidden: s.hidden,
    range: s.range,
    tables: s.tables,
    formulaCount: Array.from(s.cells.values()).filter((c) => c.formula).length,
    mergeCount: s.merges.length,
    protectedCount: Array.from(s.cells.values()).filter((c) => c.protection)
      .length,
  }));
  const warnings = [
    "Detected table boundaries are suggestions. Check the preview and adjust ranges before translating.",
    "Downloads contain saved values, not cell formulas. Selected formula text and formula-dependent labels can be translated. English, numbers and identifiers stay unchanged. Hidden sheets are not selected automatically.",
  ];
  warnings.push(
    "Formula results must be saved in the uploaded file. Recalculate and save in Excel before uploading; this tool does not calculate missing or stale results.",
  );
  if (Object.keys(parts).some((n) => n.startsWith("xl/drawings/")))
    warnings.push(
      "Drawing objects are preserved in the download; text inside drawings is not translated or shown in the grid.",
    );
  if (richStrings.size)
    warnings.push(
      "Rich-text cells are preserved to avoid losing character-level formatting.",
    );
  return {
    parts,
    sheets,
    legacyFormulaCells,
    inspection: {
      sheets: views,
      warnings,
      sheetCount: sheets.length,
      formulaCount: views.reduce((n, s) => n + s.formulaCount, 0),
      mergeCount: views.reduce((n, s) => n + s.mergeCount, 0),
    },
  };
}

function detectTables(
  s: Sheet,
  parts: Record<string, Uint8Array>,
): TableView[] {
  const result: TableView[] = [];
  const add = (range: string, label: string, kind: TableView["kind"]) => {
    const b = rangeBounds(range),
      cells = Array.from(s.cells.values()).filter((c) => inside(c, b));
    const languages: TableView["languages"] = {};
    for (const c of cells)
      if (!isIdentifierText(c.text))
        languages[c.language] = (languages[c.language] || 0) + 1;
    result.push({
      id: `${s.name}:${range}`,
      label,
      range,
      kind,
      rows: b.r2 - b.r1 + 1,
      columns: b.c2 - b.c1 + 1,
      languages,
      preview: cells
        .filter((c) => c.row < b.r1 + 5 && c.col < b.c1 + 8)
        .slice(0, 40),
    });
  };
  for (const part of Array.from(related(parts, s.part).values()))
    if (/^xl\/tables\/.*\.xml$/.test(part)) {
      const $ = xml(parts, part),
        t = $("table");
      if (t.attr("ref"))
        add(t.attr("ref")!, t.attr("displayName") || "Table", "table");
    }
  if (result.length) return result;
  const rows = Array.from(
    new Set(Array.from(s.cells.values()).map((c) => c.row)),
  ).sort((a, b) => a - b);
  const bands: number[][] = [];
  for (const r of rows) {
    const band = bands.at(-1);
    if (!band || r > band[1] + 1) bands.push([r, r]);
    else band[1] = r;
  }
  for (const [r1, r2] of bands) {
    const cells = Array.from(s.cells.values()).filter(
      (c) => c.row >= r1 && c.row <= r2,
    );
    const cols = Array.from(new Set(cells.map((c) => c.col))).sort(
        (a, b) => a - b,
      ),
      runs: number[][] = [];
    for (const c of cols) {
      const run = runs.at(-1);
      if (!run || c > run[1] + 1) runs.push([c, c]);
      else run[1] = c;
    }
    for (const [c1, c2] of runs) {
      const range = `${columnName(c1)}${r1}:${columnName(c2)}${r2}`;
      add(
        range,
        cells.find((c) => c.col === c1 && !c.formula)?.text.slice(0, 70) ||
          `Region ${result.length + 1}`,
        "detected",
      );
    }
  }
  return result.slice(0, 150);
}

export function buildPlan(
  book: WorkbookSource,
  selections: Selection[],
  target: string,
  legacyFormulaProtection = false,
  legacyLanguageDetection = false,
): TranslationPlan {
  if (!selections.length || selections.length > 200)
    throw new WorkbookInputError("Select between 1 and 200 table ranges.");
  const groups = new Map<string, TranslationEntry>(),
    seen = new Set<string>();
  let protectedCells = 0;
  for (const selection of selections) {
    const s = book.sheets.find((s) => s.name === selection.sheet);
    if (!s) throw new WorkbookInputError("Selected worksheet does not exist.");
    const b = rangeBounds(selection.range),
      bounds = rangeBounds(s.range);
    if (b.r2 > bounds.r2 || b.c2 > bounds.c2)
      throw new WorkbookInputError(
        "Selection extends beyond populated worksheet bounds.",
      );
    if (
      selection.columns?.some(
        (c) => !Number.isInteger(c) || c < b.c1 || c > b.c2,
      )
    )
      throw new WorkbookInputError(
        "Selected column is outside the table range.",
      );
    const header = new Map(
      Array.from(s.cells.values())
        .filter((c) => c.row === b.r1)
        .map((c) => [c.col, c.text]),
    );
    for (const c of Array.from(s.cells.values()))
      if (
        inside(c, b) &&
        (!selection.columns?.length || selection.columns.includes(c.col))
      ) {
        const key = cellKey(s.name, c.address);
        if (seen.has(key)) continue;
        seen.add(key);
        const detectedLanguage = legacyLanguageDetection
          ? detectLegacyCellLanguage(c.text)
          : c.language;
        // Inspection always uses the current classifier. Reconstruct language
        // protection for legacy plans as well as the language hashed into IDs.
        const protection =
          c.protection === "English is preserved"
            ? detectedLanguage === "English"
            : c.protection || detectedLanguage === "English";
        if (
          protection ||
          (legacyFormulaProtection && book.legacyFormulaCells.has(key)) ||
          detectedLanguage === target ||
          selection.sourceLanguage === "English" ||
          selection.sourceLanguage === target
        ) {
          protectedCells++;
          continue;
        }
        if (c.text.length > 8000)
          throw new WorkbookInputError(
            `Cell ${s.name}!${c.address} is too long for a safe translation batch.`,
          );
        const context = `Sheet: ${s.name}; column: ${header.get(c.col) || columnName(c.col)}`;
        const language =
          selection.sourceLanguage && selection.sourceLanguage !== "Auto"
            ? selection.sourceLanguage
            : detectedLanguage;
        const id = createHash("sha256")
          .update(JSON.stringify([context, c.text, language]))
          .digest("hex")
          .slice(0, 24);
        const item: TranslationEntry = groups.get(id) || {
          id,
          source: c.text,
          context,
          language,
          cells: [],
        };
        item.cells.push(key);
        groups.set(id, item);
      }
  }
  const entries = Array.from(groups.values()),
    batches: TranslationEntry[][] = [];
  let chars = 0;
  for (const entry of entries) {
    if (
      !batches.length ||
      batches.at(-1)!.length >= 40 ||
      chars + entry.source.length + entry.context.length > 8000
    ) {
      batches.push([]);
      chars = 0;
    }
    batches.at(-1)!.push(entry);
    chars += entry.source.length + entry.context.length;
  }
  return {
    entries,
    selectedCells: seen.size,
    protectedCells,
    characters: entries.reduce((n, e) => n + e.source.length, 0),
    batches,
  };
}

const escapeXml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

export function assertSavedFormulaResults(book: WorkbookSource) {
  const missing: string[] = [];
  for (const sheet of book.sheets) {
    sheet.xml("sheetData c").each((_, el) => {
      const cell = sheet.xml(el);
      if (!cell.find("f").length) return;
      const type = cell.attr("t");
      const hasValue =
        cell.find("v").length > 0 &&
        (cell.find("v").text().trim().length > 0 || type === "str");
      const hasInline = type === "inlineStr" && cell.find("is").length > 0;
      if (!hasValue && !hasInline)
        missing.push(`${sheet.name}!${cell.attr("r")}`);
    });
  }
  if (missing.length)
    throw new WorkbookInputError(
      `${missing.length} formula cell(s) have no saved result (${missing.slice(0, 5).join(", ")}). Open the original workbook in Excel, recalculate, save, and upload it again. No blank values were substituted.`,
    );
}

function flattenFormulaParts(
  book: WorkbookSource,
  parts: Record<string, Uint8Array>,
) {
  for (const sheet of book.sheets) {
    const original = strFromU8(parts[sheet.part]);
    // Shared/array anchors and followers are all removed together. Saved values,
    // type attributes and styles are retained, including zero and empty strings.
    const flat = original.replace(/<f\b[^>]*\/>|<f\b[^>]*>[\s\S]*?<\/f>/g, "");
    if (flat !== original) parts[sheet.part] = strToU8(flat);
  }
  for (const name of Object.keys(parts)) {
    if (!/^xl\/tables\/.*\.xml$/.test(name)) continue;
    const original = strFromU8(parts[name]);
    const flat = original
      .replace(
        /<(?:calculatedColumnFormula|totalsRowFormula)\b[^>]*\/>|<(calculatedColumnFormula|totalsRowFormula)\b[^>]*>[\s\S]*?<\/\1>/g,
        "",
      )
      .replace(/\s+totalsRowFunction=(["'])[^"']*\1/g, "");
    if (flat !== original) parts[name] = strToU8(flat);
  }
  const relName = "xl/_rels/workbook.xml.rels";
  if (parts[relName]) {
    const relationships = related(parts, "xl/workbook.xml"),
      $ = xml(parts, relName);
    const chain = $("Relationship").filter((_, e) =>
      ($(e).attr("Type") || "").endsWith("/calcChain"),
    );
    if (chain.length) {
      chain.each((_, e) => {
        const target = relationships.get($(e).attr("Id") || "");
        if (target) delete parts[target];
      });
      chain.remove();
      parts[relName] = strToU8($.xml());
    }
  }
  const contentTypes = xml(parts, "[Content_Types].xml");
  const overrides = contentTypes("Override").filter((_, e) =>
    (contentTypes(e).attr("ContentType") || "").includes("calcChain"),
  );
  if (overrides.length) {
    overrides.each((_, e) => {
      delete parts[(contentTypes(e).attr("PartName") || "").replace(/^\//, "")];
    });
    overrides.remove();
    parts["[Content_Types].xml"] = strToU8(contentTypes.xml());
  }
  // Also clean the conventional orphan part if an input omitted its relationship.
  delete parts["xl/calcChain.xml"];
}

export function valuesOnlyWorkbook(input: Buffer): Buffer {
  return writeTranslations(inspectWorkbook(input), {});
}

export function writeTranslations(
  book: WorkbookSource,
  translations: Record<string, string>,
): Buffer {
  assertSavedFormulaResults(book);
  const parts = { ...book.parts };
  let applied = 0;
  for (const sheet of book.sheets) {
    let content = strFromU8(parts[sheet.part]);
    let changed = false;
    content = content.replace(
      /<c\b[^>]*\/>|<c\b[^>]*>[\s\S]*?<\/c>/g,
      (cell: string) => {
        const address = /\br="([A-Z]+\d+)"/.exec(
          cell.slice(0, cell.indexOf(">") + 1),
        )?.[1];
        if (!address) return cell;
        const key = cellKey(sheet.name, address),
          text = translations[key];
        if (text === undefined) return cell;
        const c = sheet.cells.get(address);
        if (!c || c.protection)
          throw new WorkbookInputError("Attempted to change a protected cell.");
        if (
          !text.trim() ||
          text.length > 32767 ||
          /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)
        )
          throw new WorkbookInputError("Invalid translated cell text.");
        // Inline strings avoid changing shared strings used by unselected cells.
        // Cell style remains unchanged; calculation metadata is stripped below.
        let open = cell
          .slice(0, cell.indexOf(">") + 1)
          .replace(/\s+t="[^"]*"/, "");
        open = open.slice(0, -1) + ' t="inlineStr">';
        const extras = cell
          .slice(cell.indexOf(">") + 1, -4)
          .replace(
            /<(?:v|is|f)\b[^>]*\/>|<(v|is|f)\b[^>]*>[\s\S]*?<\/\1>/g,
            "",
          );
        changed = true;
        applied++;
        return `${open}<is><t xml:space="preserve">${escapeXml(text)}</t></is>${extras}</c>`;
      },
    );
    if (changed) parts[sheet.part] = strToU8(content);
  }
  if (applied !== Object.keys(translations).length)
    throw new WorkbookInputError(
      "Not all translated cells could be written safely.",
    );
  flattenFormulaParts(book, parts);
  return Buffer.from(zipSync(parts, { level: 6 }));
}

export function sheetPreview(
  book: WorkbookSource,
  name: string,
  range: string,
  translations: Record<string, string> = {},
  pending: Set<string> = new Set(),
) {
  const s = book.sheets.find((s) => s.name === name);
  if (!s) throw new WorkbookInputError("Worksheet not found.");
  const b = rangeBounds(range);
  if ((b.r2 - b.r1 + 1) * (b.c2 - b.c1 + 1) > 4000)
    throw new WorkbookInputError("Preview at most 4,000 cells at a time.");
  return {
    range,
    cells: Array.from(s.cells.values())
      .filter((c) => inside(c, b))
      .map((c) => ({
        ...c,
        translated: translations[cellKey(name, c.address)] ?? c.text,
        translationPending: pending.has(cellKey(name, c.address)),
      })),
    merges: s.merges.filter((r) => {
      const m = rangeBounds(r);
      return m.r1 >= b.r1 && m.r2 <= b.r2 && m.c1 >= b.c1 && m.c2 <= b.c2;
    }),
  };
}
