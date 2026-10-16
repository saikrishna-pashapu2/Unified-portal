import { getPdfJsStandardFontDataUrl, loadNodePdfJs } from '@/lib/pdfjs-node';
import type { PdfElement } from './schemas';

export type Box = [number, number, number, number];
export type NativeText = { text: string; bbox: Box };
/**
 * A native rule is represented by its center line (`at`, `from`, `to`).
 * Filled rectangles do not have a real stroke center line, so they also carry
 * the visible ink interval on the fixed axis.  For an `x` rule this is the
 * rectangle's x interval; for a `y` rule it is its y interval.  Stroke rules
 * intentionally omit these fields and retain their historical semantics.
 */
export type NativeRule = {
  axis: 'x' | 'y';
  at: number;
  from: number;
  to: number;
  inkFrom?: number;
  inkTo?: number;
};
export type NativeGeometry = { texts: NativeText[]; rules: NativeRule[]; images: Box[]; canReconstruct?:boolean };
const cache = new WeakMap<Buffer, Map<number, Promise<NativeGeometry>>>();
export const canonicalText = (text: string) => text.normalize('NFKC').replace(/\s+/g, '');
export const containsBox = (outer: readonly number[], inner: readonly number[], pad = 0.5) =>
  inner[0] >= outer[0] - pad && inner[1] >= outer[1] - pad && inner[2] <= outer[2] + pad && inner[3] <= outer[3] + pad;
export const unionBoxes = (boxes: readonly (readonly number[])[]): Box => [
  Math.min(...boxes.map(b => b[0])), Math.min(...boxes.map(b => b[1])),
  Math.max(...boxes.map(b => b[2])), Math.max(...boxes.map(b => b[3])),
];
const intersects = (a: readonly number[], b: readonly number[]) =>
  Math.min(a[2], b[2]) > Math.max(a[0], b[0]) && Math.min(a[3], b[3]) > Math.max(a[1], b[1]);

// Spreadsheet exporters commonly encode a one-pixel rule as a filled
// rectangle.  The rectangle is measured in PDF user units here, rather than
// by a fixed normalized-coordinate cutoff: a 0.5 point rule should remain a
// rule on both a letter page and a large landscape page.  The aspect-ratio
// guard is just as important as the thickness guard; it prevents cell fills,
// banners, and other artwork from becoming table topology.
const FILLED_RULE_MAX_THICKNESS_POINTS = 2.5;
const FILLED_RULE_MIN_ASPECT = 24;
const FILLED_RULE_MIN_LENGTH_POINTS = 6;
const FILLED_INK_LUMINANCE_MAX = 0.82;
const FILLED_INK_ALPHA_MIN = 0.15;
const MAX_NATIVE_RULES = 8000;

type FilledRuleCandidate = {
  axis: 'x' | 'y';
  at: number;
  from: number;
  to: number;
  thickness: number;
  inkFrom: number;
  inkTo: number;
};

function componentToUnit(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  // PDF.js exposes RGB values as 0..255, while gray/CMYK operators use the
  // PDF 0..1 range.  Accept both forms so custom exporters remain safe.
  return Math.max(0, Math.min(1, value > 1 ? value / 255 : value));
}
function rgbLuminance(values: readonly unknown[]): number | null {
  if (values.length < 3) return null;
  const rgb = values.slice(0, 3).map(componentToUnit);
  if (rgb.some(value => value === null)) return null;
  return 0.2126 * rgb[0]! + 0.7152 * rgb[1]! + 0.0722 * rgb[2]!;
}

function cmykLuminance(values: readonly unknown[]): number | null {
  if (values.length < 4) return null;
  const cmyk = values.slice(0, 4).map(componentToUnit);
  if (cmyk.some(value => value === null)) return null;
  const [c, m, y, k] = cmyk as [number, number, number, number];
  return 0.2126 * (1 - c) * (1 - k) +
    0.7152 * (1 - m) * (1 - k) +
    0.0722 * (1 - y) * (1 - k);
}

function clipRule(rule: NativeRule): NativeRule | null {
  // A path can legitimately continue past a page edge.  Retain only the
  // visible interval; a rule whose supporting line is outside the page is not
  // visible topology and must not be fabricated back into the page.
  if (rule.at < -0.5 || rule.at > 1000.5) return null;
  const at = Math.max(0, Math.min(1000, rule.at));
  const from = Math.max(0, Math.min(1000, rule.from));
  const to = Math.max(0, Math.min(1000, rule.to));
  if (to - from <= 0.02) return null;
  if (rule.inkFrom === undefined && rule.inkTo === undefined) {
    return { ...rule, at, from: Math.min(from, to), to: Math.max(from, to) };
  }
  const rawInkFrom = rule.inkFrom ?? rule.inkTo ?? rule.at;
  const rawInkTo = rule.inkTo ?? rule.inkFrom ?? rule.at;
  if (!Number.isFinite(rawInkFrom) || !Number.isFinite(rawInkTo)) return null;
  const inkFrom = Math.max(0, Math.min(1000, Math.min(rawInkFrom, rawInkTo)));
  const inkTo = Math.max(0, Math.min(1000, Math.max(rawInkFrom, rawInkTo)));
  if (inkTo - inkFrom <= 0.02) return null;
  return { ...rule, at, from: Math.min(from, to), to: Math.max(from, to), inkFrom, inkTo };
}

function dedupeRules(rules: readonly NativeRule[]): NativeRule[] {
  const result: NativeRule[] = [];
  for (const rule of rules) {
    if (result.some(existing => existing.axis === rule.axis &&
      Math.abs(existing.at - rule.at) <= 0.18 &&
      Math.abs(existing.from - rule.from) <= 0.2 &&
      Math.abs(existing.to - rule.to) <= 0.2)) continue;
    result.push(rule);
  }
  return result;
}

function ruleFixedExtent(rule: NativeRule): [number, number] {
  const from = rule.inkFrom ?? rule.at;
  const to = rule.inkTo ?? rule.at;
  return from <= to ? [from, to] : [to, from];
}

function intervalsTouch(aFrom: number, aTo: number, bFrom: number, bTo: number, pad = 0.2): boolean {
  return Math.min(aTo, bTo) >= Math.max(aFrom, bFrom) - pad;
}

/**
 * Filled rectangles meet at their visible ink, not necessarily at their
 * center lines.  Keep the old 0.2 normalized tolerance for stroke rules, but
 * use the optional fixed-axis ink extent whenever a filled rule provides it.
 */
function rulesTouch(a: NativeRule, b: NativeRule): boolean {
  const [aFixedFrom, aFixedTo] = ruleFixedExtent(a);
  const [bFixedFrom, bFixedTo] = ruleFixedExtent(b);
  if (a.axis === b.axis) {
    return intervalsTouch(aFixedFrom, aFixedTo, bFixedFrom, bFixedTo) &&
      intervalsTouch(a.from, a.to, b.from, b.to);
  }
  return intervalsTouch(aFixedFrom, aFixedTo, b.from, b.to) &&
    intervalsTouch(bFixedFrom, bFixedTo, a.from, a.to);
}

function candidateRule(candidate: FilledRuleCandidate): NativeRule {
  return {
    axis: candidate.axis,
    at: candidate.at,
    from: candidate.from,
    to: candidate.to,
    inkFrom: candidate.inkFrom,
    inkTo: candidate.inkTo,
  };
}

function sameFilledCandidate(a: FilledRuleCandidate, b: FilledRuleCandidate): boolean {
  return a.axis === b.axis && Math.abs(a.at - b.at) <= 0.18 &&
    Math.abs(a.from - b.from) <= 0.2 && Math.abs(a.to - b.to) <= 0.2 &&
    Math.abs(a.inkFrom - b.inkFrom) <= 0.2 && Math.abs(a.inkTo - b.inkTo) <= 0.2;
}

type ShortRuleResult = { rules: NativeRule[]; excessive: boolean };

/**
 * Recover filled rectangles that are shorter than the global aspect guard
 * only when they belong to a connected, repeated grid.  A single short
 * rectangle (or a short decorative mark) remains rejected.  Pairwise work is
 * bounded by the same MAX_NATIVE_RULES cap used by the final topology pass.
 */
function acceptShortFilledRules(
  candidates: readonly FilledRuleCandidate[],
  existingRules: readonly NativeRule[],
  viewportWidth: number,
  viewportHeight: number,
): ShortRuleResult {
  if (candidates.length > MAX_NATIVE_RULES) return { rules: [], excessive: true };
  const shortCandidates: FilledRuleCandidate[] = [];
  for (const candidate of candidates) {
    const thicknessPageLength = candidate.axis === 'x' ? viewportWidth : viewportHeight;
    const spanPageLength = candidate.axis === 'x' ? viewportHeight : viewportWidth;
    const thicknessPoints = candidate.thickness * thicknessPageLength / 1000;
    const lengthPoints = (candidate.to - candidate.from) * spanPageLength / 1000;
    const aspect = lengthPoints / Math.max(thicknessPoints, 0.0001);
    if (!Number.isFinite(thicknessPoints) || !Number.isFinite(lengthPoints) ||
        thicknessPoints > FILLED_RULE_MAX_THICKNESS_POINTS ||
        lengthPoints < FILLED_RULE_MIN_LENGTH_POINTS || aspect >= FILLED_RULE_MIN_ASPECT) continue;
    if (!shortCandidates.some(previous => sameFilledCandidate(previous, candidate))) shortCandidates.push(candidate);
  }
  if (!shortCandidates.length) return { rules: [], excessive: false };
  if (existingRules.length + shortCandidates.length > MAX_NATIVE_RULES) return { rules: [], excessive: true };

  const shortRules = shortCandidates.map(candidateRule);
  const parents = shortRules.map((_, index) => index);
  const root = (index: number): number => {
    let current = index;
    while (parents[current] !== current) {
      parents[current] = parents[parents[current]!]!;
      current = parents[current]!;
    }
    return current;
  };
  const merge = (a: number, b: number) => {
    const left = root(a), right = root(b);
    if (left !== right) parents[left] = right;
  };

  // Short candidates are normally a small fraction of all rules.  Compare
  // them to one another and to existing source rules; never compare an
  // unbounded operator list.
  const supports = shortRules.map(() => [] as number[]);
  for (let i = 0; i < shortRules.length; i++) {
    for (let j = i + 1; j < shortRules.length; j++) {
      if (rulesTouch(shortRules[i]!, shortRules[j]!)) merge(i, j);
    }
    for (let j = 0; j < existingRules.length; j++) {
      if (rulesTouch(shortRules[i]!, existingRules[j]!)) supports[i]!.push(j);
    }
  }
  // Two candidate components that touch the same long/stroke rule are part of
  // the same source grid.  This avoids a quadratic pass over every existing
  // rule while still following a connected repeated grid.
  const supportOwner = new Map<number, number>();
  for (let i = 0; i < shortRules.length; i++) {
    for (const support of supports[i]!) {
      const owner = supportOwner.get(support);
      if (owner === undefined) supportOwner.set(support, i);
      else merge(i, owner);
    }
  }

  const componentCandidates = new Map<number, number[]>();
  for (let i = 0; i < shortRules.length; i++) {
    const key = root(i);
    componentCandidates.set(key, [...(componentCandidates.get(key) ?? []), i]);
  }
  const accepted = new Set<number>();
  for (const memberIndexes of Array.from(componentCandidates.values())) {
    const componentRules: NativeRule[] = memberIndexes.map((index: number) => shortRules[index]!);
    const seenSupports = new Set<number>();
    for (const index of memberIndexes) {
      for (const support of supports[index]!) {
        if (seenSupports.has(support)) continue;
        seenSupports.add(support);
        componentRules.push(existingRules[support]!);
      }
    }
    const xTracks = clusters(componentRules.filter(rule => rule.axis === 'x').map(rule => rule.at));
    const yTracks = clusters(componentRules.filter(rule => rule.axis === 'y').map(rule => rule.at));
    // nativeTableRegions requires three tracks in each direction.  Applying
    // the same lower bound here prevents a lone short mark from becoming
    // accepted topology while retaining small but genuine digitally ruled
    // tables.
    if (xTracks.length < 3 || yTracks.length < 3) continue;
    for (const index of memberIndexes) accepted.add(index);
  }
  return { rules: shortRules.filter((_, index) => accepted.has(index)), excessive: false };
}

/** Native positions corroborate OCR; they never make a scanned body disappear. */
export function readNativeGeometry(pdf: Buffer, clockwiseRotation = 0): Promise<NativeGeometry> {
  let rotations = cache.get(pdf);
  if (!rotations) { rotations = new Map(); cache.set(pdf, rotations); }
  let result = rotations.get(clockwiseRotation);
  if (!result) { result = read(pdf, clockwiseRotation); rotations.set(clockwiseRotation, result); }
  return result;
}

export type SourceRotation = 0 | 90 | 180 | 270;

/**
 * The page's own text layer states its reading direction exactly, so a digital
 * page never needs a model guess (a low-detail guess once turned upright pages
 * upside down). Returns the clockwise source rotation extraction uses: the
 * angle of the dominant text baseline as displayed. Undefined unless the layer
 * is substantial and nearly uniform (scans without text, mixed layouts).
 */
export async function nativeTextRotation(pdf: Buffer): Promise<SourceRotation | undefined> {
  const pdfjs = await loadNodePdfJs();
  const document = await pdfjs.getDocument({ data: new Uint8Array(pdf), standardFontDataUrl: getPdfJsStandardFontDataUrl(), useSystemFonts: true, verbosity: 0 }).promise;
  try {
    const page = await document.getPage(1);
    const viewport = page.getViewport({ scale: 1, rotation: page.rotate });
    const content = await page.getTextContent();
    const characters = [0, 0, 0, 0];
    for (const item of content.items) {
      if (!('str' in item)) continue;
      const count = item.str.replace(/\s+/g, '').length;
      if (!count) continue;
      const t = pdfjs.Util.transform(viewport.transform, item.transform);
      const angle = (Math.atan2(t[1], t[0]) * 180 / Math.PI + 360) % 360;
      const bucket = Math.round(angle / 90) % 4;
      const offset = Math.min(Math.abs(angle - bucket * 90), Math.abs(angle - bucket * 90 - 360));
      if (offset <= 10) characters[bucket] += count;
    }
    const total = characters.reduce((sum, count) => sum + count, 0);
    const best = characters.indexOf(Math.max(...characters));
    if (total < 40 || characters[best] < total * 0.9) return undefined;
    return (best * 90) as SourceRotation;
  } finally { await document.destroy(); }
}

async function read(pdf: Buffer, clockwiseRotation: number): Promise<NativeGeometry> {
  const pdfjs = await loadNodePdfJs();
  const document = await pdfjs.getDocument({ data: new Uint8Array(pdf), standardFontDataUrl: getPdfJsStandardFontDataUrl(), useSystemFonts: true, verbosity: 0 }).promise;
  try {
    const page = await document.getPage(1);
    const viewport = page.getViewport({ scale: 1, rotation: (page.rotate + clockwiseRotation) % 360 });
    const content = await page.getTextContent();
    const texts: NativeText[] = [];
    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim() || item.str.includes('\ufffd')) continue;
      const t = pdfjs.Util.transform(viewport.transform, item.transform);
      // Sideways spans must be read in a matching upright viewport, not guessed.
      if (Math.abs(t[1]) > Math.abs(t[0]) * 0.05 || t[0] <= 0) continue;
      const height = Math.hypot(t[2], t[3]);
      const style = content.styles[item.fontName];
      const ascent = style?.ascent ?? 0.8;
      const descent = style?.descent ?? -0.2;
      const bbox: Box = [t[4] / viewport.width * 1000, (t[5] - height * ascent) / viewport.height * 1000,
        (t[4] + item.width) / viewport.width * 1000, (t[5] - height * descent) / viewport.height * 1000];
      if (bbox.every(Number.isFinite) && bbox[0] >= 0 && bbox[1] >= 0 && bbox[2] <= 1000 && bbox[3] <= 1000) texts.push({ text: item.str, bbox });
    }
    const ops = await page.getOperatorList();
    const textRuns:NativeText[]=[];
    let hiddenText=false;
    let textState={font:'',size:0,scale:1,charSpacing:0,wordSpacing:0,rise:0,leading:0,x:0,y:0,lineX:0,lineY:0,mode:0,
      fillKnown:true,fillWhite:false,fillLuminance:0,alpha:1,tm:[1,0,0,1,0,0]};
    const textStack:typeof textState[]=[];
    const rules: NativeRule[] = [];
    const images: Box[] = [];
    let matrix = [1, 0, 0, 1, 0, 0];
    const stack: number[][] = [];
    let pending: NativeRule[] = [];
    let filledRects: FilledRuleCandidate[] = [];
    const shortFilledCandidates: FilledRuleCandidate[] = [];
    const point = (x: number, y: number) => {
      const p = pdfjs.Util.applyTransform(pdfjs.Util.applyTransform([x, y], matrix), viewport.transform);
      return [p[0] / viewport.width * 1000, p[1] / viewport.height * 1000];
    };
    const line = (a: number[], b: number[]): NativeRule[] => {
      if (Math.abs(a[0] - b[0]) < 0.01 && Math.abs(a[1] - b[1]) > 0.02) return [{axis:'x',at:(a[0]+b[0])/2,from:Math.min(a[1],b[1]),to:Math.max(a[1],b[1])}];
      if (Math.abs(a[1] - b[1]) < 0.01 && Math.abs(a[0] - b[0]) > 0.02) return [{axis:'y',at:(a[1]+b[1])/2,from:Math.min(a[0],b[0]),to:Math.max(a[0],b[0])}];
      return [];
    };
    const filledCandidate = (
      axis:'x'|'y', at:number, from:number, to:number, thickness:number,
      inkFrom = at - thickness / 2, inkTo = at + thickness / 2,
    ):FilledRuleCandidate|null => {
      const length=Math.abs(to-from);
      if(![at,from,to,thickness,length,inkFrom,inkTo].every(Number.isFinite) || thickness<=0 || length<=0) return null;
      return {axis,at,from:Math.min(from,to),to:Math.max(from,to),thickness,
        inkFrom:Math.min(inkFrom,inkTo),inkTo:Math.max(inkFrom,inkTo)};
    };
    const acceptedFilledRule = (candidate:FilledRuleCandidate):NativeRule|null => {
      const thicknessPageLength=candidate.axis==='x' ? viewport.width : viewport.height;
      const spanPageLength=candidate.axis==='x' ? viewport.height : viewport.width;
      const thicknessPoints=candidate.thickness*thicknessPageLength/1000;
      const length=candidate.to-candidate.from;
      const lengthPoints=length*spanPageLength/1000;
      if(thicknessPoints>FILLED_RULE_MAX_THICKNESS_POINTS ||
         lengthPoints<Math.max(FILLED_RULE_MIN_LENGTH_POINTS,thicknessPoints*FILLED_RULE_MIN_ASPECT)) return null;
      return candidateRule(candidate);
    };
    const filledCandidateFromCorners = (corners:number[][]):FilledRuleCandidate|null => {
      if(corners.length!==4 || corners.some(corner=>corner.length<2 || !corner.slice(0,2).every(Number.isFinite))) return null;
      const edges=corners.map((corner,index)=> {
        const next=corners[(index+1)%corners.length]!;
        return [next[0]!-corner[0]!,next[1]!-corner[1]!];
      });
      // A rotated page produces a still-axis-aligned rectangle after the
      // viewport transform.  Skewed/diagonal artwork must not be promoted to
      // table topology merely because its bounding box is elongated.
      if(edges.some(([dx,dy])=>Math.abs(dx)>0.01 && Math.abs(dy)>0.01)) return null;
      const xPositions=clusters(corners.map(corner=>corner[0]!));
      const yPositions=clusters(corners.map(corner=>corner[1]!));
      if(xPositions.length!==2 || yPositions.length!==2) return null;
      const width=xPositions[1]-xPositions[0],height=yPositions[1]-yPositions[0];
      if(width<=0 || height<=0 || width===height) return null;
      if(width>height) return filledCandidate('y',(yPositions[0]+yPositions[1])/2,xPositions[0],xPositions[1],height,
        yPositions[0],yPositions[1]);
      return filledCandidate('x',(xPositions[0]+xPositions[1])/2,yPositions[0],yPositions[1],width,
        xPositions[0],xPositions[1]);
    };
    const filledRuleFromEdges = (edges:NativeRule[]):FilledRuleCandidate|null => {
      const xEdges=edges.filter(rule=>rule.axis==='x');
      const yEdges=edges.filter(rule=>rule.axis==='y');
      const xPositions=clusters(xEdges.map(rule=>rule.at));
      const yPositions=clusters(yEdges.map(rule=>rule.at));
      if(xPositions.length!==2 || yPositions.length!==2) return null;
      const xThickness=Math.abs(xPositions[1]-xPositions[0]);
      const yThickness=Math.abs(yPositions[1]-yPositions[0]);
      if(xThickness<=0 || yThickness<=0 || xThickness===yThickness) return null;
      // All four sides must cover the same rectangle.  This rejects open or
      // diagonal artwork that happens to leave two x and two y coordinates.
      if(xEdges.some(rule=>rule.from>yPositions[0]+0.2 || rule.to<yPositions[1]-0.2) ||
         yEdges.some(rule=>rule.from>xPositions[0]+0.2 || rule.to<xPositions[1]-0.2)) return null;
      if(xThickness>yThickness) return filledCandidate('y',(yPositions[0]+yPositions[1])/2,xPositions[0],xPositions[1],yThickness,
        yPositions[0],yPositions[1]);
      return filledCandidate('x',(xPositions[0]+xPositions[1])/2,yPositions[0],yPositions[1],xThickness,
        xPositions[0],xPositions[1]);
    };
    const fillIsInk = () => textState.fillKnown && textState.fillLuminance < FILLED_INK_LUMINANCE_MAX && textState.alpha > FILLED_INK_ALPHA_MIN;
    const O = pdfjs.OPS;
    for (let i=0;i<ops.fnArray.length;i++) {
      const op = ops.fnArray[i], args = ops.argsArray[i];
      if (op === O.save || op===O.paintFormXObjectBegin) {stack.push([...matrix]);textStack.push({...textState,tm:[...textState.tm]});if(op===O.paintFormXObjectBegin&&args?.[0]) matrix=pdfjs.Util.transform(matrix,args[0]);}
      else if (op === O.restore || op===O.paintFormXObjectEnd) {matrix = stack.pop() ?? [1,0,0,1,0,0];textState=textStack.pop()??textState;}
      else if (op === O.transform) matrix = pdfjs.Util.transform(matrix, args);
      else if(op===O.setFillRGBColor) {
        const luminance=rgbLuminance(Array.from(args as number[]));
        textState.fillKnown=luminance!==null;textState.fillLuminance=luminance??1;textState.fillWhite=(luminance??1)>=0.96;
      }
      else if(op===O.setFillGray) {
        const luminance=componentToUnit((args as number[])[0]);
        textState.fillKnown=luminance!==null;textState.fillLuminance=luminance??1;textState.fillWhite=(luminance??1)>=0.96;
      }
      else if(op===O.setFillCMYKColor) {
        const luminance=cmykLuminance(Array.from(args as number[]));
        textState.fillKnown=luminance!==null;textState.fillLuminance=luminance??1;textState.fillWhite=(luminance??1)>=0.96;
      }
      else if(op===O.setFillColor || op===O.setFillColorN || op===O.setFillColorSpace) {
        // Pattern/device-independent colors cannot be proven to be ink from
        // the operator list alone.  A later explicit RGB/gray/CMYK operator
        // re-establishes a safe color; until then filled paths are ignored.
        textState.fillKnown=false;textState.fillLuminance=1;textState.fillWhite=true;
      }
      else if(op===O.setFillTransparent) {
        textState.fillKnown=true;textState.fillLuminance=1;textState.fillWhite=true;textState.alpha=0;
      }
      else if(op===O.setGState) for(const [key,value] of args[0]) {
        if(key==='Font') {textState.font=value[0];textState.size=value[1];}
        if(key==='ca' && typeof value==='number') textState.alpha=value;
      }
      else if(op===O.beginText) textState={...textState,x:0,y:0,lineX:0,lineY:0,tm:[1,0,0,1,0,0]};
      else if(op===O.setFont) {textState.font=args[0];textState.size=args[1];}
      else if(op===O.setTextMatrix) textState={...textState,tm:[...args],x:0,y:0,lineX:0,lineY:0};
      else if(op===O.setCharSpacing) textState.charSpacing=args[0];
      else if(op===O.setWordSpacing) textState.wordSpacing=args[0];
      else if(op===O.setHScale) textState.scale=args[0]/100;
      else if(op===O.setTextRise) textState.rise=args[0];
      else if(op===O.setTextRenderingMode) textState.mode=args[0];
      else if(op===O.setLeading) textState.leading=-args[0];
      else if(op===O.moveText || op===O.setLeadingMoveText || op===O.nextLine) {
        if(op===O.setLeadingMoveText) textState.leading=args[1];
        textState.lineX+=op===O.nextLine?0:args[0];textState.lineY+=op===O.nextLine?textState.leading:args[1];
        textState.x=textState.lineX;textState.y=textState.lineY;
      } else if(op===O.showText) {
        if(textState.mode===3 || textState.mode===7 || textState.alpha<=0) hiddenText=true;
        let font:any;
        try {font=page.commonObjs.get(textState.font);}catch{continue;}
        if(font.vertical || font.isType3Font || textState.size<=0) continue;
        const style=content.styles[textState.font];
        const ascent=style?.ascent??0.8,descent=style?.descent??-0.2;
        const textPoint=(x:number,y:number)=> {const p=pdfjs.Util.applyTransform([x,y],textState.tm);return point(p[0],p[1]);};
        let run='',boxes:Box[]=[];
        const flush=()=> {if(run.trim()&&boxes.length) textRuns.push({text:run.trim(),bbox:unionBoxes(boxes)});run='';boxes=[];};
        for(const glyph of args[0]) {
          if(typeof glyph==='number') {
            const shift=-glyph*textState.size/1000*textState.scale;
            if(Math.abs(shift)>textState.size*0.75) flush();
            textState.x+=shift;continue;
          }
          const width=glyph.width*textState.size*(font.fontMatrix?.[0]??0.001)*textState.scale;
          const a=textPoint(textState.x,textState.y+textState.rise+textState.size*ascent);
          const b=textPoint(textState.x+width,textState.y+textState.rise+textState.size*descent);
          if(textState.mode!==3 && textState.mode!==7 && glyph.unicode && b[0]>=a[0] && b[1]>=a[1]) {
            run+=glyph.unicode;
            if(glyph.unicode.trim()) boxes.push([a[0],a[1],b[0],b[1]]);
          }
          textState.x+=width+(textState.charSpacing+(glyph.isSpace?textState.wordSpacing:0))*textState.scale;
        }
        flush();
      }
      else if (op === O.constructPath) {
        let at=0, current=[0,0], start=[0,0];
        for (const kind of args[0]) {
          const v=args[1];
          if (kind===O.moveTo) { current=point(v[at++],v[at++]); start=current; }
          else if (kind===O.lineTo) { const next=point(v[at++],v[at++]); pending.push(...line(current,next)); current=next; }
          else if (kind===O.rectangle) {
            const x=v[at++],y=v[at++],w=v[at++],h=v[at++];
            const a=point(x,y),b=point(x+w,y),c=point(x+w,y+h),d=point(x,y+h);
            pending.push(...line(a,b),...line(b,c),...line(c,d),...line(d,a));
            const candidate=filledCandidateFromCorners([a,b,c,d]);
            if(candidate) filledRects.push(candidate);
          } else if (kind===O.closePath) { pending.push(...line(current,start)); current=start; }
          else if (kind===O.curveTo) { at+=4; current=point(v[at++],v[at++]); }
          else if (kind===O.curveTo2 || kind===O.curveTo3) { at+=2; current=point(v[at++],v[at++]); }
        }
      } else if ([O.stroke,O.closeStroke,O.fillStroke,O.eoFillStroke,O.closeFillStroke,O.closeEOFillStroke].includes(op)) {
        rules.push(...pending); pending=[]; filledRects=[];
      } else if ([O.fill,O.eoFill].includes(op)) {
        // Excel exports often draw thin filled four-sided paths, not `re`.
        // Keep both explicit rectangle candidates and a strict four-edge
        // candidate for move/line/closePath encodings.  The latter is only
        // accepted when the path is a strongly elongated, ink-colored shape.
        const candidates=[...filledRects];
        const edgeCandidate=filledRuleFromEdges(pending);
        if(edgeCandidate) candidates.push(edgeCandidate);
        if(fillIsInk()) {
          for(const candidate of candidates) {
            const rule=acceptedFilledRule(candidate);
            if(rule) rules.push(rule);
            else shortFilledCandidates.push(candidate);
          }
        }
        pending=[]; filledRects=[];
      }
      else if (op === O.endPath) { pending=[]; filledRects=[]; }
      else if ([O.paintImageXObject,O.paintInlineImageXObject,O.paintImageMaskXObject].includes(op)) {
        const corners=[point(0,0),point(1,0),point(1,1),point(0,1)];
        images.push([Math.min(...corners.map(p=>p[0])),Math.min(...corners.map(p=>p[1])),Math.max(...corners.map(p=>p[0])),Math.max(...corners.map(p=>p[1]))]);
      }
      else if([O.paintImageXObjectRepeat,O.paintImageMaskXObjectRepeat,O.paintInlineImageXObjectGroup,O.paintImageMaskXObjectGroup].includes(op)) images.push([0,0,1000,1000]);
    }
    // PDF.js text-content combines adjacent cell labels. Use actual glyph-run
    // coordinates only when they preserve the complete native transcription.
    const completeText=content.items.flatMap(item=>'str' in item?[item.str]:[]).join('');
    const exactRuns=canonicalText(textRuns.map(t=>t.text).join(''))===canonicalText(completeText);
    // Bound pairwise deduplication/topology work BEFORE it starts, not only
    // after collecting regions. Complex artwork falls back to OCR safely.
    const shortResult = rules.length > MAX_NATIVE_RULES
      ? { rules: [] as NativeRule[], excessive: true }
      : acceptShortFilledRules(shortFilledCandidates, rules, viewport.width, viewport.height);
    const excessiveRules = rules.length > MAX_NATIVE_RULES || shortResult.excessive;
    const allRules = excessiveRules ? [] : [...rules, ...shortResult.rules];
    const visibleRules=excessiveRules ? [] : dedupeRules(allRules.map(clipRule).filter((rule):rule is NativeRule=>rule!==null));
    return { texts:exactRuns?textRuns:texts, rules: visibleRules, images, canReconstruct:exactRuns&&!hiddenText&&!excessiveRules };
  } finally { await document.destroy(); }
}

export function joinNativeText(items: NativeText[]): string {
  const lines: NativeText[][] = [];
  for (const item of [...items].sort((a,b)=>a.bbox[1]-b.bbox[1] || a.bbox[0]-b.bbox[0])) {
    const previous = lines.at(-1);
    const tolerance = Math.min(item.bbox[3]-item.bbox[1], previous ? previous[0].bbox[3]-previous[0].bbox[1] : 0)*0.4;
    if (previous && Math.abs(previous[0].bbox[1]-item.bbox[1]) <= tolerance) previous.push(item);
    else lines.push([item]);
  }
  return lines.map(row => {
    const ordered = row.sort((a,b)=>a.bbox[0]-b.bbox[0]);
    let text = '';
    let previous: NativeText | undefined;
    for (const item of ordered) {
      if (previous) {
        const gap = item.bbox[0] - previous.bbox[2];
        const fontHeight = Math.min(
          item.bbox[3] - item.bbox[1],
          previous.bbox[3] - previous.bbox[1],
        );
        // PDF text extraction frequently splits one word at glyph clusters
        // with tiny positive gaps.  A measured, font-relative gap is a
        // word-space; touching/overlap runs remain concatenated.  Existing
        // whitespace in a run always wins so this never duplicates a source
        // space.
        const wordGap = Math.max(0.5, fontHeight * 0.13);
        if (gap > wordGap && !/\s$/.test(text) && !/^\s/.test(item.text)) text += ' ';
      }
      text += item.text;
      previous = item;
    }
    return text;
  }).join('\n');
}

/** Only an exact local text match can replace a model's text bounding box. */
export function matchNativeBox(text: string, near: readonly number[], native: NativeGeometry): Box | null {
  const wanted=canonicalText(text);
  if (!wanted || native.canReconstruct===false || native.images.some(box=>intersects(box,near))) return null;
  const items=native.texts.filter(t=>containsBox(near,t.bbox,25)).sort((a,b)=>a.bbox[1]-b.bbox[1] || a.bbox[0]-b.bbox[0]);
  const hits: Box[]=[];
  for(let i=0;i<items.length;i++) {
    for(let end=i+1;end<=Math.min(items.length,i+80);end++) {
      const subset=items.slice(i,end), actual=canonicalText(joinNativeText(subset));
      if (actual===wanted) { hits.push(unionBoxes(subset.map(t=>t.bbox))); break; }
      if (actual.length>wanted.length) break;
    }
  }
  return hits.length===1 ? hits[0] : null;
}

function clusters(values: number[]): number[] {
  const result: number[][]=[];
  for(const n of values.sort((a,b)=>a-b)) {
    const group=result.at(-1);
    if(group && n-group[0]<=0.18) group.push(n); else result.push([n]);
  }
  return result.map(group=>group.reduce((a,b)=>a+b,0)/group.length);
}

function fixedContains(rule: NativeRule, value: number, pad = 0.2): boolean {
  const [from, to] = ruleFixedExtent(rule);
  return value >= from - pad && value <= to + pad;
}

function endpointInkExtent(
  rules: readonly NativeRule[],
  axis: 'x'|'y',
  at: number,
  coordinate: number,
): [number, number] | undefined {
  const candidates = rules.filter(rule => rule.axis !== axis &&
    intervalsTouch(rule.from, rule.to, at, at) && fixedContains(rule, coordinate))
    .sort((a, b) => {
      const aFixed = ruleFixedExtent(a), bFixed = ruleFixedExtent(b);
      return Math.abs((aFixed[0] + aFixed[1]) / 2 - coordinate) -
        Math.abs((bFixed[0] + bFixed[1]) / 2 - coordinate);
    });
  return candidates.length ? ruleFixedExtent(candidates[0]!) : undefined;
}

function covered(rules: NativeRule[], axis: 'x'|'y', at: number, from: number, to: number): boolean {
  // Filled rectangles meet at the inside edge of their ink.  Trim the
  // requested interval to those inside edges when both endpoint rules carry
  // actual ink extents; stroke-only rules continue to use the old interval.
  const startInk = endpointInkExtent(rules, axis, at, from);
  const endInk = endpointInkExtent(rules, axis, at, to);
  const coveredFrom = startInk ? Math.max(from, startInk[1]) : from;
  const coveredTo = endInk ? Math.min(to, endInk[0]) : to;
  if (coveredFrom > coveredTo + 0.2) return false;
  const spans=rules.filter(r=>r.axis===axis && fixedContains(r,at) && r.to>=coveredFrom && r.from<=coveredTo)
    .sort((a,b)=>a.from-b.from);
  let end=coveredFrom;
  for(const span of spans) { if(span.from>end+0.2) break; end=Math.max(end,span.to); }
  return end>=coveredTo-0.2;
}

function horizontalOuterBoundary(rules:NativeRule[], xs:number[], at:number, inner:number):boolean {
  if(covered(rules,'y',at,xs[0],xs.at(-1)!)) return true;
  // Keep the established strict whole-table rule. Open page continuations
  // must not be "closed" using paths outside an untracked PDF body clip.
  const hasPartialHorizontal=rules.some(r=>r.axis==='y' && Math.abs(r.at-at)<=0.2 && r.to-r.from>0.5);
  return hasPartialHorizontal &&
    xs.every(x=>covered(rules,'x',x,Math.min(at,inner),Math.max(at,inner)));
}

export function nativeTableRegions(native: NativeGeometry): Box[] {
  const rules=native.rules.filter(r=>r.to-r.from>0.5);
  if(rules.length>MAX_NATIVE_RULES) return [];
  const parents=rules.map((_,i)=>i);
  const root=(i:number):number=>{while(parents[i]!==i){parents[i]=parents[parents[i]];i=parents[i];}return i;};
  for(let i=0;i<rules.length;i++) for(let j=i+1;j<rules.length;j++) {
    const a=rules[i],b=rules[j];
    const touches=rulesTouch(a, b);
    if(touches) parents[root(i)]=root(j);
  }
  const groups=new Map<number,NativeRule[]>();
  rules.forEach((r,i)=>{const key=root(i);const group=groups.get(key)??[];group.push(r);groups.set(key,group);});
  return Array.from(groups.values()).flatMap(group=> {
    const xs=clusters(group.filter(r=>r.axis==='x').map(r=>r.at));
    const ys=clusters(group.filter(r=>r.axis==='y').map(r=>r.at));
    return xs.length>=3&&ys.length>=3 ? [[xs[0],ys[0],xs.at(-1)!,ys.at(-1)!] as Box] : [];
  });
}

/** Rebuild only an actually ruled, digitally born table. Missing internal rules
 * determine merged cells; never fabricate blanks to fill a model-declared grid. */
export function rebuildNativeTable(table: PdfElement, native: NativeGeometry, diagnostics?: string[]): PdfElement | null {
  const reject=(reason:string):null=>{diagnostics?.push(reason);return null;};
  if (table.kind!=='table' || native.canReconstruct===false || native.images.some(box=>intersects(box,table.bbox))) return null;
  const inTable=native.rules.filter(r=>r.at>=table.bbox[r.axis==='x'?0:1]-3 && r.at<=table.bbox[r.axis==='x'?2:3]+3 && r.from>=table.bbox[r.axis==='x'?1:0]-3 && r.to<=table.bbox[r.axis==='x'?3:2]+3);
  const xs=clusters(inTable.filter(r=>r.axis==='x').map(r=>r.at));
  const ys=clusters(inTable.filter(r=>r.axis==='y').map(r=>r.at));
  const columns=xs.length-1, rows=ys.length-1;
  if(columns<2 || rows<2 || columns>200 || rows>2000 || columns*rows>15000) return reject(`grid dimensions ${rows}x${columns}`);
  const box:Box=[xs[0],ys[0],xs.at(-1)!,ys.at(-1)!];
  if(!covered(inTable,'x',box[0],box[1],box[3]) || !covered(inTable,'x',box[2],box[1],box[3]) ||
     !horizontalOuterBoundary(inTable,xs,box[1],ys[1]) ||
     !horizontalOuterBoundary(inTable,xs,box[3],ys.at(-2)!)) return reject('open outer border without corroborating column rules');
  const parents=Array.from({length:rows*columns},(_,i)=>i);
  const root=(i:number):number=> { while(parents[i]!==i){parents[i]=parents[parents[i]];i=parents[i];} return i; };
  const merge=(a:number,b:number)=> {parents[root(a)]=root(b);};
  for(let r=0;r<rows;r++) for(let c=0;c<columns;c++) {
    if(c+1<columns && !covered(inTable,'x',xs[c+1],ys[r],ys[r+1])) merge(r*columns+c,r*columns+c+1);
    if(r+1<rows && !covered(inTable,'y',ys[r+1],xs[c],xs[c+1])) merge(r*columns+c,(r+1)*columns+c);
  }
  const groups=new Map<number,number[]>();
  for(let i=0;i<parents.length;i++) {const key=root(i);groups.set(key,[...(groups.get(key)??[]),i]);}
  const cells: PdfElement['rows'][number]['cells']=[];
  const sourceItems=native.texts.filter(t=>intersects(box,t.bbox));
  if(sourceItems.length<3 || sourceItems.some(t=>!containsBox(box,t.bbox,0.5))) return reject('native text crosses outer border');
  const centerX=(item:NativeText)=>(item.bbox[0]+item.bbox[2])/2;
  // Center-aligned Excel cells sometimes print a long value across a border.
  // Corroborate the column's alignment with other fully contained source runs
  // before assigning such overflow; a box's center alone is not sufficient.
  const centeredColumns=xs.slice(0,-1).map((left,c)=>sourceItems.filter(item=>
    item.bbox[0]>=left-0.2 && item.bbox[2]<=xs[c+1]+0.2 &&
    Math.abs(centerX(item)-(left+xs[c+1])/2)<=0.5).length>=5);
  const assigned=new Set<NativeText>();
  const oldByText=new Map<string,Array<PdfElement['rows'][number]['cells'][number]>>();
  for(const cell of table.rows.flatMap(row=>row.cells)) {const key=canonicalText(cell.text);const group=oldByText.get(key)??[];group.push(cell);oldByText.set(key,group);}
  for(const slots of Array.from(groups.values())) {
    const rr=slots.map(i=>Math.floor(i/columns)), cc=slots.map(i=>i%columns);
    const r=Math.min(...rr),c=Math.min(...cc),rs=Math.max(...rr)-r+1,cs=Math.max(...cc)-c+1;
    if(rs*cs!==slots.length) return reject('nonrectangular merged cell');
    const bbox:Box=[xs[c],ys[r],xs[c+cs],ys[r+rs]];
    const items=sourceItems.filter(t=> {
      // Font ascent/descent is a metric envelope, not the visible ink. Tiny
      // Excel printouts can have envelopes slightly taller than their cells.
      const cy=(t.bbox[1]+t.bbox[3])/2, pad=Math.min(0.5,(t.bbox[3]-t.bbox[1])*0.25);
      const contained=t.bbox[0]>=bbox[0]-0.2 && t.bbox[2]<=bbox[2]+0.2;
      const centeredOverflow=cs===1 && centeredColumns[c] &&
        Math.abs(centerX(t)-(bbox[0]+bbox[2])/2)<=0.5 &&
        (bbox[2]-bbox[0])/(t.bbox[2]-t.bbox[0])>=0.6;
      return cy>bbox[1] && cy<bbox[3] && (contained || centeredOverflow) && t.bbox[1]>=bbox[1]-pad && t.bbox[3]<=bbox[3]+pad;
    });
    if(items.some(t=>assigned.has(t))) return reject('ambiguous text assignment');
    items.forEach(t=>assigned.add(t));
    const text=joinNativeText(items);
    const old=oldByText.get(canonicalText(text))?.find(cell=>containsBox(bbox,cell.bbox,5));
    cells.push({id:`${table.id}-r${r}-c${c}`,rowIndex:r,columnIndex:c,rowSpan:rs,columnSpan:cs,isHeader:old?.isHeader??r===0,translate:old?.translate??!!text.trim(),text,bbox});
  }
  if(assigned.size!==sourceItems.length) return reject(`unassigned native text ${sourceItems.length-assigned.size}/${sourceItems.length}; metric boxes ${JSON.stringify(sourceItems.filter(t=>!assigned.has(t)).slice(0,4).map(t=>t.bbox))}`);
  // A hidden/partial text layer must not erase meaningful text from the OCR.
  const recovered=cells.map(cell=>canonicalText(cell.text));
  if(table.rows.flatMap(row=>row.cells).some(cell=>cell.text.trim() && !recovered.some(text=>text.includes(canonicalText(cell.text))))) return reject('OCR text is not present in native table');
  return {...table,bbox:box,columnCount:columns,rowCount:rows,translate:cells.some(c=>c.translate&&c.text.trim()),rows:Array.from({length:rows},(_,rowIndex)=>({rowIndex,cells:cells.filter(c=>c.rowIndex===rowIndex)}))};
}

/** Repair only an existing, closed merged header whose understated row span
 * leaves holes immediately below it. Unlike a full native reconstruction this
 * never imports native text, invents cells, or touches an open/clipped table body.
 * Every changed header needs exact text corroboration, all four ruled sides,
 * and native row boundaries corroborated by the OTHER existing cells.
 */
export function repairNativeHeaderRowSpans(table: PdfElement, native: NativeGeometry): PdfElement | null {
  if (table.kind !== 'table' || native.canReconstruct === false || native.rules.length > MAX_NATIVE_RULES ||
      native.images.some(box => intersects(box, table.bbox))) return null;
  const { rowCount, columnCount } = table;
  if (rowCount < 2 || columnCount < 1 || rowCount * columnCount > 15000) return null;
  const cells = table.rows.flatMap(row => row.cells);
  const occupied = new Set<number>();
  for (const cell of cells) {
    if (cell.rowIndex < 0 || cell.columnIndex < 0 || cell.rowSpan < 1 || cell.columnSpan < 1 ||
        cell.rowIndex + cell.rowSpan > rowCount || cell.columnIndex + cell.columnSpan > columnCount) return null;
    for (let row = cell.rowIndex; row < cell.rowIndex + cell.rowSpan; row++) {
      for (let col = cell.columnIndex; col < cell.columnIndex + cell.columnSpan; col++) {
        const slot = row * columnCount + col;
        if (occupied.has(slot)) return null;
        occupied.add(slot);
      }
    }
  }
  if (occupied.size === rowCount * columnCount) return null;
  const rules = native.rules;
  const xs = clusters(rules.filter(rule => rule.axis === 'x').map(rule => rule.at));
  const ys = clusters(rules.filter(rule => rule.axis === 'y').map(rule => rule.at));
  const snap = (values: number[], approximate: number): number | undefined => {
    const nearby = values.filter(value => Math.abs(value - approximate) <= 12)
      .sort((a, b) => Math.abs(a - approximate) - Math.abs(b - approximate));
    if (!nearby.length || (nearby.length > 1 && Math.abs(nearby[0] - approximate) + 1 >= Math.abs(nearby[1] - approximate))) return undefined;
    return nearby[0];
  };
  const fixes = new Map<string, { rowSpan: number; bbox: Box }>();
  for (const cell of cells) {
    if (!cell.isHeader || !cell.text.trim()) continue;
    let end = cell.rowIndex + cell.rowSpan;
    const originalEnd = end;
    while (end < rowCount && Array.from({ length: cell.columnSpan }, (_, offset) => cell.columnIndex + offset)
      .every(col => !occupied.has(end * columnCount + col))) end++;
    if (end === originalEnd || end === rowCount) continue; // require a following source row, never the open bottom
    const boundary = (row: number): number | undefined => {
      const evidence = cells.filter(other => other !== cell &&
        (other.rowIndex === row || other.rowIndex + other.rowSpan === row));
      if (evidence.reduce((sum, other) => sum + other.columnSpan, 0) < 2) return undefined;
      const positions = evidence.map(other => other.rowIndex === row ? other.bbox[1] : other.bbox[3]).sort((a, b) => a - b);
      return snap(ys, positions[Math.floor(positions.length / 2)]);
    };
    const top = boundary(cell.rowIndex), bottom = boundary(end);
    const left = snap(xs, cell.bbox[0]), right = snap(xs, cell.bbox[2]);
    if (top === undefined || bottom === undefined || left === undefined || right === undefined || left >= right || top >= bottom) continue;
    const box: Box = [left, top, right, bottom];
    const textBox = matchNativeBox(cell.text, cell.bbox, native);
    if (!textBox || !containsBox(box, textBox, 0.5) ||
        !covered(rules, 'x', left, top, bottom) || !covered(rules, 'x', right, top, bottom) ||
        !covered(rules, 'y', top, left, right) || !covered(rules, 'y', bottom, left, right)) continue;
    const interior = Array.from({ length: end - cell.rowIndex - 1 }, (_, offset) => boundary(cell.rowIndex + offset + 1));
    if (interior.some(y => y === undefined || y <= top || y >= bottom)) continue;
    // Any horizontal ink inside the proposed cell contradicts the merge.
    if (rules.some(rule => rule.axis === 'y' && rule.at > top + 0.2 && rule.at < bottom - 0.2 &&
      Math.min(rule.to, right) - Math.max(rule.from, left) > 0.5)) continue;
    fixes.set(cell.id, { rowSpan: end - cell.rowIndex, bbox: box });
    for (let row = originalEnd; row < end; row++) {
      for (let col = cell.columnIndex; col < cell.columnIndex + cell.columnSpan; col++) occupied.add(row * columnCount + col);
    }
  }
  if (!fixes.size || occupied.size !== rowCount * columnCount) return null;
  return { ...table, rows: table.rows.map(row => ({ ...row, cells: row.cells.map(cell => {
    const fix = fixes.get(cell.id);
    return fix ? { ...cell, ...fix } : cell;
  }) })) };
}

/** Recover a multi-row header only inside a genuinely closed
 * source rectangle. The body may continue off-page and is NEVER reconstructed
 * here. Keep a one-to-one mapping of existing cells; native text may populate
 * an empty header, but must exactly corroborate every non-empty OCR header.
 */
export function repairNativeHeaderGrid(table: PdfElement, native: NativeGeometry): PdfElement | null {
  if (table.kind !== 'table' || native.canReconstruct === false || native.rules.length > MAX_NATIVE_RULES ||
      table.rowCount * table.columnCount > 15000 || native.images.some(box => intersects(box, table.bbox))) return null;
  const rows = [...table.rows].sort((a, b) => a.rowIndex - b.rowIndex);
  const bodyStart = rows.findIndex(row => row.cells.some(cell => !cell.isHeader));
  if (bodyStart < 2 || rows[bodyStart].rowIndex !== bodyStart ||
      rows.some((row, index) => row.rowIndex !== index)) return null;
  const headerRows = rows.slice(0, bodyStart);
  const headers = headerRows.flatMap(row => row.cells);
  if (!headers.length || headers.some(cell => !cell.isHeader || cell.rowIndex + cell.rowSpan > bodyStart)) return null;
  for (const cell of headers) {
    if (cell.rowIndex < 0 || cell.columnIndex < 0 || cell.rowSpan < 1 || cell.columnSpan < 1 ||
        cell.columnIndex + cell.columnSpan > table.columnCount) return null;
  }
  // Even an overlap-free grid may omit header labels or assign a header box
  // across body rows. A full source-backed bijection is the safety gate, not
  // the presence of a particular model validation error.
  const xs = clusters(native.rules.filter(rule => rule.axis === 'x').map(rule => rule.at));
  const ys = clusters(native.rules.filter(rule => rule.axis === 'y').map(rule => rule.at));
  const snap = (values: number[], approximate: number): number | undefined => {
    const nearby = values.filter(value => Math.abs(value - approximate) <= 12)
      .sort((a, b) => Math.abs(a - approximate) - Math.abs(b - approximate));
    if (!nearby.length || (nearby.length > 1 && Math.abs(nearby[0] - approximate) + 1 >= Math.abs(nearby[1] - approximate))) return undefined;
    return nearby[0];
  };
  const starts = rows[bodyStart].cells.map(cell => cell.bbox[1]);
  if (starts.length < 2) return null;
  const bottomEvidence = starts.map(y => snap(ys, y));
  const left = snap(xs, table.bbox[0]), right = snap(xs, table.bbox[2]);
  const top = snap(ys, table.bbox[1]), bottom = bottomEvidence[0];
  if (left === undefined || right === undefined || top === undefined || bottom === undefined ||
      bottomEvidence.some(y => y === undefined || Math.abs(y - bottom) > 0.2) || left >= right || top >= bottom) return null;
  if (!covered(native.rules, 'x', left, top, bottom) || !covered(native.rules, 'x', right, top, bottom) ||
      !covered(native.rules, 'y', top, left, right) || !covered(native.rules, 'y', bottom, left, right)) return null;
  const bbox: Box = [left, top, right, bottom];
  // Only after proving all four sides may long body strokes be restricted to
  // this header. Whole-table reconstruction keeps its strict containment rule.
  const headerNative: NativeGeometry = { ...native, rules: native.rules.flatMap(rule => {
    const atMin = bbox[rule.axis === 'x' ? 0 : 1], atMax = bbox[rule.axis === 'x' ? 2 : 3];
    const from = Math.max(rule.from, bbox[rule.axis === 'x' ? 1 : 0]);
    const to = Math.min(rule.to, bbox[rule.axis === 'x' ? 3 : 2]);
    return rule.at >= atMin - 0.2 && rule.at <= atMax + 0.2 && to > from ? [{ ...rule, from, to }] : [];
  }) };
  const rebuilt = rebuildNativeTable({ ...table, bbox, rowCount: bodyStart, rows: headerRows }, headerNative);
  if (!rebuilt || rebuilt.rowCount !== bodyStart || rebuilt.columnCount !== table.columnCount) return null;
  const recovered = rebuilt.rows.flatMap(row => row.cells);
  if (recovered.length !== headers.length) return null;
  const used = new Set<string>();
  const replacements = new Map<string, typeof recovered[number]>();
  for (const cell of recovered) {
    const matches = headers.filter(old => !used.has(old.id) && old.rowIndex === cell.rowIndex &&
      (old.text.trim()
        ? canonicalText(old.text) === canonicalText(cell.text)
        : old.columnIndex === cell.columnIndex && old.columnSpan === cell.columnSpan &&
          Math.abs((snap(xs, old.bbox[0]) ?? Infinity) - cell.bbox[0]) <= 0.2 &&
          Math.abs((snap(xs, old.bbox[2]) ?? Infinity) - cell.bbox[2]) <= 0.2));
    if (matches.length !== 1) return null;
    const old = matches[0];
    used.add(old.id);
    replacements.set(old.id, { ...old, rowIndex: cell.rowIndex, columnIndex: cell.columnIndex,
      rowSpan: cell.rowSpan, columnSpan: cell.columnSpan, bbox: cell.bbox,
      text: old.text.trim() ? old.text : cell.text,
      translate: old.text.trim() ? old.translate : !!cell.text.trim(),
    });
  }
  if (used.size !== headers.length) return null;
  const repairedRows = table.rows.map(row => ({ ...row, cells: row.cells.map(cell => replacements.get(cell.id) ?? cell) }));
  return { ...table, rows: repairedRows, translate: repairedRows.some(row => row.cells.some(cell => cell.translate && cell.text.trim())) };
}
