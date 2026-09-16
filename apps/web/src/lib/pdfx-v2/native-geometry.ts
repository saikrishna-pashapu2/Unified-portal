import { getPdfJsStandardFontDataUrl } from '@/lib/pdfjs-node';
import type { PdfElement } from './schemas';

export type Box = [number, number, number, number];
export type NativeText = { text: string; bbox: Box };
export type NativeRule = { axis: 'x' | 'y'; at: number; from: number; to: number };
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

/** Native positions corroborate OCR; they never make a scanned body disappear. */
export function readNativeGeometry(pdf: Buffer, clockwiseRotation = 0): Promise<NativeGeometry> {
  let rotations = cache.get(pdf);
  if (!rotations) { rotations = new Map(); cache.set(pdf, rotations); }
  let result = rotations.get(clockwiseRotation);
  if (!result) { result = read(pdf, clockwiseRotation); rotations.set(clockwiseRotation, result); }
  return result;
}

async function read(pdf: Buffer, clockwiseRotation: number): Promise<NativeGeometry> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
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
    let textState={font:'',size:0,scale:1,charSpacing:0,wordSpacing:0,rise:0,leading:0,x:0,y:0,lineX:0,lineY:0,mode:0,fillWhite:false,alpha:1,tm:[1,0,0,1,0,0]};
    const textStack:typeof textState[]=[];
    const rules: NativeRule[] = [];
    const images: Box[] = [];
    let matrix = [1, 0, 0, 1, 0, 0];
    const stack: number[][] = [];
    let pending: NativeRule[] = [];
    let thinRects: NativeRule[] = [];
    const point = (x: number, y: number) => {
      const p = pdfjs.Util.applyTransform(pdfjs.Util.applyTransform([x, y], matrix), viewport.transform);
      return [p[0] / viewport.width * 1000, p[1] / viewport.height * 1000];
    };
    const line = (a: number[], b: number[]): NativeRule[] => {
      if (Math.abs(a[0] - b[0]) < 0.01 && Math.abs(a[1] - b[1]) > 0.02) return [{axis:'x',at:(a[0]+b[0])/2,from:Math.min(a[1],b[1]),to:Math.max(a[1],b[1])}];
      if (Math.abs(a[1] - b[1]) < 0.01 && Math.abs(a[0] - b[0]) > 0.02) return [{axis:'y',at:(a[1]+b[1])/2,from:Math.min(a[0],b[0]),to:Math.max(a[0],b[0])}];
      return [];
    };
    const O = pdfjs.OPS;
    for (let i=0;i<ops.fnArray.length;i++) {
      const op = ops.fnArray[i], args = ops.argsArray[i];
      if (op === O.save || op===O.paintFormXObjectBegin) {stack.push([...matrix]);textStack.push({...textState,tm:[...textState.tm]});if(op===O.paintFormXObjectBegin&&args?.[0]) matrix=pdfjs.Util.transform(matrix,args[0]);}
      else if (op === O.restore || op===O.paintFormXObjectEnd) {matrix = stack.pop() ?? [1,0,0,1,0,0];textState=textStack.pop()??textState;}
      else if (op === O.transform) matrix = pdfjs.Util.transform(matrix, args);
      else if(op===O.setFillRGBColor) textState.fillWhite=Array.from(args as number[]).every(n=>n>=245);
      else if(op===O.setGState) for(const [key,value] of args[0]) {
        if(key==='Font') {textState.font=value[0];textState.size=value[1];}
        if(key==='ca') textState.alpha=value;
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
            if (Math.abs(a[1]-d[1]) < 0.25) thinRects.push(...line([(a[0]+d[0])/2,(a[1]+d[1])/2],[(b[0]+c[0])/2,(b[1]+c[1])/2]));
            else if (Math.abs(a[0]-b[0]) < 0.25) thinRects.push(...line([(a[0]+b[0])/2,(a[1]+b[1])/2],[(c[0]+d[0])/2,(c[1]+d[1])/2]));
          } else if (kind===O.closePath) { pending.push(...line(current,start)); current=start; }
          else if (kind===O.curveTo) { at+=4; current=point(v[at++],v[at++]); }
          else if (kind===O.curveTo2 || kind===O.curveTo3) { at+=2; current=point(v[at++],v[at++]); }
        }
      } else if ([O.stroke,O.closeStroke,O.fillStroke,O.eoFillStroke,O.closeFillStroke,O.closeEOFillStroke].includes(op)) {
        rules.push(...pending); pending=[]; thinRects=[];
      } else if ([O.fill,O.eoFill].includes(op)) {
        // Excel exports often draw thin filled four-sided paths, not `re`.
        const xx=pending.filter(r=>r.axis==='x').map(r=>r.at), yy=pending.filter(r=>r.axis==='y').map(r=>r.at);
        if(xx.length===2 && yy.length===2) {
          if(Math.abs(yy[1]-yy[0])<0.25) thinRects.push({axis:'y',at:(yy[0]+yy[1])/2,from:Math.min(...xx),to:Math.max(...xx)});
          else if(Math.abs(xx[1]-xx[0])<0.25) thinRects.push({axis:'x',at:(xx[0]+xx[1])/2,from:Math.min(...yy),to:Math.max(...yy)});
        }
        if(!textState.fillWhite && textState.alpha>0) rules.push(...thinRects); pending=[]; thinRects=[];
      }
      else if (op === O.endPath) { pending=[]; thinRects=[]; }
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
    return { texts:exactRuns?textRuns:texts, rules: rules.filter(r=>[r.at,r.from,r.to].every(n=>Number.isFinite(n)&&n>=0&&n<=1000)), images, canReconstruct:exactRuns&&!hiddenText };
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
  return lines.map(row=>row.sort((a,b)=>a.bbox[0]-b.bbox[0]).map(t=>t.text).join(' ')).join('\n');
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

function covered(rules: NativeRule[], axis: 'x'|'y', at: number, from: number, to: number): boolean {
  const spans=rules.filter(r=>r.axis===axis && Math.abs(r.at-at)<=0.2 && r.to>=from && r.from<=to).sort((a,b)=>a.from-b.from);
  let end=from;
  for(const span of spans) { if(span.from>end+0.2) break; end=Math.max(end,span.to); }
  return end>=to-0.2;
}

function horizontalOuterBoundary(rules:NativeRule[], xs:number[], at:number, inner:number):boolean {
  if(covered(rules,'y',at,xs[0],xs.at(-1)!)) return true;
  // Some Excel exports omit part of the top/bottom stroke. The boundary is
  // still determined by native horizontal segments and EVERY column's vertical
  // rule spanning the edge row. This does not guess a row from text alignment.
  return rules.some(r=>r.axis==='y' && Math.abs(r.at-at)<=0.2 && r.to-r.from>0.5) &&
    xs.every(x=>covered(rules,'x',x,Math.min(at,inner),Math.max(at,inner)));
}

export function nativeTableRegions(native: NativeGeometry): Box[] {
  const rules=native.rules.filter(r=>r.to-r.from>0.5);
  if(rules.length>8000) return [];
  const parents=rules.map((_,i)=>i);
  const root=(i:number):number=>{while(parents[i]!==i){parents[i]=parents[parents[i]];i=parents[i];}return i;};
  for(let i=0;i<rules.length;i++) for(let j=i+1;j<rules.length;j++) {
    const a=rules[i],b=rules[j];
    const touches=a.axis===b.axis
      ? Math.abs(a.at-b.at)<=0.2 && a.from<=b.to+0.2 && b.from<=a.to+0.2
      : a.at>=b.from-0.2 && a.at<=b.to+0.2 && b.at>=a.from-0.2 && b.at<=a.to+0.2;
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
