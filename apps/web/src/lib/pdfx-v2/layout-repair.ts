import type { PdfElement, PdfPageLayout, StoredPdfPageLayout } from './schemas';
import { PdfPageLayoutSchema } from './schemas';
import { isTextualElement } from './serialize';
import { normalizeTableIndexes } from './table-indexes';
import { enforceEnglishProtection } from './language-protection';
import { detectCellLanguage, isIdentifierText } from '@/lib/xlsx-translator/language';
import { containsBox, matchNativeBox, nativeTableRegions, rebuildNativeTable, unionBoxes, type Box, type NativeGeometry } from './native-geometry';

export const EXTRACTION_RECOVERY_VERSION = 'v5-local-repair-1';
export type ExtractionRecovery = {
  version: typeof EXTRACTION_RECOVERY_VERSION;
  attempts: number;
  rotation?: number;
  candidate?: PdfPageLayout;
  firstFailure?: string;
  failures: string[];
  requestFailure?: string;
  terminal?: boolean;
};

export function parseExtractionRecovery(value: unknown): ExtractionRecovery | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v=(value as {extractionRecovery?:ExtractionRecovery}).extractionRecovery;
  if(!v || v.version!==EXTRACTION_RECOVERY_VERSION || !Number.isInteger(v.attempts) || v.attempts<0 || v.attempts>3 ||
     !Array.isArray(v.failures) || !v.failures.every(f=>typeof f==='string') ||
     (v.rotation!==undefined && ![0,90,180,270].includes(v.rotation))) return undefined;
  const candidate=v.candidate ? PdfPageLayoutSchema.safeParse(v.candidate) : undefined;
  if(candidate && !candidate.success) return undefined;
  return {...v,candidate:candidate?.success?candidate.data:undefined};
}

export class PdfxExtractionStopError extends Error {
  constructor(message: string, readonly recovery: ExtractionRecovery, options?: ErrorOptions) {
    super(message,options); this.name='PdfxExtractionStopError';
  }
}

const intersection=(a:readonly number[],b:readonly number[])=>Math.max(0,Math.min(a[2],b[2])-Math.max(a[0],b[0]))*Math.max(0,Math.min(a[3],b[3])-Math.max(a[1],b[1]));
const area=(a:readonly number[])=>Math.max(0,a[2]-a[0])*Math.max(0,a[3]-a[1]);

const EMPTY_SEMANTIC_KINDS = new Set<PdfElement['kind']>([
  'heading',
  'paragraph',
  'list',
  'header',
  'footer',
  'page_number',
]);

function isValidNormalizedBox(bbox: readonly number[]): bbox is Box {
  return bbox.length === 4 &&
    bbox.every((value) => Number.isFinite(value) && value >= 0 && value <= 1000) &&
    bbox[0] < bbox[2] && bbox[1] < bbox[3];
}

function isEmptySemanticArtifact(element: PdfElement): boolean {
  return EMPTY_SEMANTIC_KINDS.has(element.kind) &&
    !element.text.trim() &&
    element.rows.length === 0 &&
    element.rowCount === 0 &&
    element.columnCount === 0;
}

/** The table envelope is redundant geometry. Recompute it only when the model
 * supplied a complete, nonoverlapping grid whose individual boxes are already
 * valid. This cannot hide missing cells, bad spans or malformed cell boxes. */
function normalizeSafeTableEnvelope(table: PdfElement): PdfElement {
  if (
    table.kind !== 'table' ||
    table.rowCount < 1 || table.rowCount > 2_000 ||
    table.columnCount < 1 || table.columnCount > 200
  ) return table;

  const occupied = new Uint8Array(table.rowCount * table.columnCount);
  const rowIndexes = new Set<number>();
  const cellIds = new Set<string>();
  const cells: PdfElement['rows'][number]['cells'] = [];

  for (const row of table.rows) {
    if (rowIndexes.has(row.rowIndex) || row.rowIndex < 0 || row.rowIndex >= table.rowCount) return table;
    rowIndexes.add(row.rowIndex);
    for (const cell of row.cells) {
      if (
        cellIds.has(cell.id) ||
        cell.rowIndex !== row.rowIndex ||
        cell.rowIndex < 0 || cell.columnIndex < 0 ||
        cell.rowSpan < 1 || cell.columnSpan < 1 ||
        cell.rowIndex + cell.rowSpan > table.rowCount ||
        cell.columnIndex + cell.columnSpan > table.columnCount ||
        !isValidNormalizedBox(cell.bbox)
      ) return table;
      cellIds.add(cell.id);
      cells.push(cell);
      for (let rowIndex = cell.rowIndex; rowIndex < cell.rowIndex + cell.rowSpan; rowIndex += 1) {
        for (let columnIndex = cell.columnIndex; columnIndex < cell.columnIndex + cell.columnSpan; columnIndex += 1) {
          const index = rowIndex * table.columnCount + columnIndex;
          if (occupied[index]) return table;
          occupied[index] = 1;
        }
      }
    }
  }
  if (!cells.length || !occupied.every(Boolean)) return table;
  return { ...table, bbox: unionBoxes(cells.map((cell) => cell.bbox)) };
}

/** Vision-model boxes on scans are approximate, and moderately overlapping
 * prose boxes were the single most common terminal extraction failure. When
 * two non-table text regions overlap enough to fail validation but each
 * clearly remains its own region, split the shared strip between them along
 * the axis with the smaller intrusion. Heavy overlap (over 60% of the smaller
 * box) still fails validation so a genuinely duplicated extraction is
 * re-requested rather than hidden. Thresholds mirror validateExtractedPage. */
function separateOverlappingProse(elements: PdfElement[]): PdfElement[] {
  const out = elements.map(element => ({ ...element, bbox: [...element.bbox] as PdfElement['bbox'] }));
  for (let pass = 0; pass < 3; pass += 1) {
    let changed = false;
    for (let i = 0; i < out.length; i += 1) for (let j = i + 1; j < out.length; j += 1) {
      const a = out[i], b = out[j];
      if (!isTextualElement(a) || !isTextualElement(b) || a.kind === 'table' || b.kind === 'table') continue;
      const overlap = intersection(a.bbox, b.bbox);
      const smaller = Math.min(area(a.bbox), area(b.bbox));
      if (smaller <= 0 || overlap <= 300 || overlap / smaller <= 0.15 || overlap / smaller > 0.6) continue;
      const width = Math.min(a.bbox[2], b.bbox[2]) - Math.max(a.bbox[0], b.bbox[0]);
      const height = Math.min(a.bbox[3], b.bbox[3]) - Math.max(a.bbox[1], b.bbox[1]);
      const splitVertical = () => {
        const boundary = (Math.max(a.bbox[1], b.bbox[1]) + Math.min(a.bbox[3], b.bbox[3])) / 2;
        const [upper, lower] = a.bbox[1] + a.bbox[3] <= b.bbox[1] + b.bbox[3] ? [a, b] : [b, a];
        if (boundary - upper.bbox[1] < 8 || lower.bbox[3] - boundary < 8) return false;
        upper.bbox[3] = boundary; lower.bbox[1] = boundary; return true;
      };
      const splitHorizontal = () => {
        const boundary = (Math.max(a.bbox[0], b.bbox[0]) + Math.min(a.bbox[2], b.bbox[2])) / 2;
        const [first, second] = a.bbox[0] + a.bbox[2] <= b.bbox[0] + b.bbox[2] ? [a, b] : [b, a];
        if (boundary - first.bbox[0] < 8 || second.bbox[2] - boundary < 8) return false;
        first.bbox[2] = boundary; second.bbox[0] = boundary; return true;
      };
      if (height <= width ? (splitVertical() || splitHorizontal()) : (splitHorizontal() || splitVertical())) changed = true;
    }
    if (!changed) break;
  }
  return out;
}

/** Source-derived changes only. Text, numbers and unrelated blocks are never
 * dropped to satisfy validation, and scans always retain the vision path. */
export function repairExtractedLayout(layout: PdfPageLayout, native?: NativeGeometry): PdfPageLayout {
  const indexed=normalizeTableIndexes(layout);
  const regions=native ? nativeTableRegions(native) : [];
  return {...indexed,elements:separateOverlappingProse(indexed.elements.filter(element=>!isEmptySemanticArtifact(element)).map(element=> {
    if(element.kind==='table') {
      if(!native) return normalizeSafeTableEnvelope(element);
      const matches=regions.filter(b=>intersection(b,element.bbox)/Math.max(1,area(b)+area(element.bbox)-intersection(b,element.bbox))>0.55);
      const rebuilt=rebuildNativeTable({...element,bbox:matches.length===1?matches[0]:element.bbox},native);
      return normalizeSafeTableEnvelope(rebuilt ?? element);
    }
    if(!native) return element;
    if(!isTextualElement(element) || !element.text.trim()) return element;
    const bbox=matchNativeBox(element.text,element.bbox,native);
    return bbox ? {...element,bbox} : element;
  }))};
}

/** Extremely dense digital spreadsheet PDFs don't need model-generated cell
 * coordinates. Only use this when every native text span is inside one proven
 * ruled table and there is no raster image that could hide additional content. */
export function nativeDensePage(native: NativeGeometry, pageNumber:number, targetLanguage:string): StoredPdfPageLayout | null {
  if(native.canReconstruct===false || native.images.length || native.texts.length<200) return null;
  for(const bbox of nativeTableRegions(native)) {
    if(native.texts.some(t=>!containsBox(bbox,t.bbox,0.5))) continue;
    const table:PdfElement={id:'native-table',kind:'table',order:0,level:0,text:'',bbox,translate:true,rowCount:0,columnCount:0,rows:[]};
    const rebuilt=rebuildNativeTable(table,native);
    if(!rebuilt || rebuilt.rowCount<40) continue;
    const startsWithData=/^\d+[.)]?$/.test(rebuilt.rows[0]?.cells[0]?.text.trim()??'');
    for(const row of rebuilt.rows) for(const cell of row.cells) {
      // Numeric/date/empty cells are copied locally, never translated.
      const language=detectCellLanguage(cell.text);
      cell.translate=!isIdentifierText(cell.text) && language!=='English' && language!==targetLanguage;
      if(startsWithData) cell.isHeader=false;
    }
    return {...enforceEnglishProtection({pageNumber,width:1000,height:1000,orientation:'portrait',rotation:0,sourceLanguage:'Mixed source languages',sourceScript:'Native PDF text',warnings:['Dense table recovered from native PDF text and ruled cell boundaries. Upload the original Excel file for a more readable spreadsheet.'],graphics:[],elements:[rebuilt]},targetLanguage),nativeTable:true};
  }
  return null;
}

export function failedElementIds(layout:PdfPageLayout, failures:readonly string[]):string[] {
  return layout.elements.filter(e=>failures.some(f=>f.split(/[\s;,]+/).includes(e.id))).map(e=>e.id);
}

export function mergeExtractionPatch(source:PdfPageLayout, patch:{elements:PdfElement[];warnings:string[]}, ids:readonly string[]):PdfPageLayout {
  const wanted=new Set(ids), returned=new Map(patch.elements.map(e=>[e.id,e]));
  if(returned.size!==ids.length || patch.elements.length!==ids.length || patch.elements.some(e=>!wanted.has(e.id))) throw new Error('Layout repair did not return exactly the requested element IDs');
  return {...source,warnings:Array.from(new Set([...source.warnings,...patch.warnings])),elements:source.elements.map(e=> {
    const replacement=returned.get(e.id);
    if(!replacement) return e;
    if(replacement.kind!==e.kind) throw new Error(`Layout repair changed the structural kind of ${e.id}`);
    return {...replacement,order:e.order};
  })};
}

export function repairRegion(source:PdfPageLayout, ids:readonly string[]):Box {
  const box=unionBoxes(source.elements.filter(e=>ids.includes(e.id)).map(e=>e.bbox));
  return [Math.max(0,box[0]-25),Math.max(0,box[1]-25),Math.min(1000,box[2]+25),Math.min(1000,box[3]+25)];
}

export function failureScore(failures:readonly string[]):number {
  return failures.reduce((sum,f)=>sum+1+Number(f.match(/missing (\d+) grid/)?.[1]??0),0);
}
