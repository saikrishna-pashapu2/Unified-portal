import { describe, expect, it, vi } from 'vitest';
import { PDFDocument, StandardFonts, setTextRenderingMode } from 'pdf-lib';
import { readNativeGeometry, rebuildNativeTable, nativeTableRegions, canonicalText, type NativeGeometry } from '../native-geometry';
import { repairExtractedLayout, nativeDensePage, mergeExtractionPatch, parseExtractionRecovery, EXTRACTION_RECOVERY_VERSION } from '../layout-repair';
import { extractPageWithOpenAi, translatePageWithOpenAi, type PdfxV2OpenAiRequester } from '../openai';
import { budgetedRequester, emptyRequestLedger, isPdfxTerminalError } from '../request-budget';
import { validateExtractedPage } from '../validation';
import { PdfPageExtractionSchema, parseStoredPdfPageLayout, type PdfElement, type PdfPageLayout } from '../schemas';
import { makeTranslatedPdfBytes } from '../makeTranslatedPdf';
import { planNativeTableBatches } from '../native-table-batches';

function table():PdfElement {
  return {id:'e031',kind:'table',text:'',order:0,level:0,bbox:[100,100,500,300],translate:true,rowCount:2,columnCount:1,
    rows:[0,1].map(r=>({rowIndex:r,cells:[0,1].map(c=>({id:`r${r}c${c}`,rowIndex:r,columnIndex:c,rowSpan:1,columnSpan:1,isHeader:r===0,translate:true,text:`item ${r}${c}`,bbox:[100+c*200,100+r*100,300+c*200,200+r*100]}))}))};
}
function page(elements:PdfElement[]=[table()]):PdfPageLayout {
  return {pageNumber:1,width:1000,height:1000,orientation:'portrait',sourceLanguage:'Uzbek',sourceScript:'Latin',warnings:[],elements};
}
function native():NativeGeometry {
  return {images:[],texts:table().rows.flatMap(r=>r.cells).map(c=>({text:c.text,bbox:[c.bbox[0]+10,c.bbox[1]+10,c.bbox[2]-10,c.bbox[1]+30]})),rules:[
    ...[100,300,500].map(at=>({axis:'x' as const,at,from:100,to:300})),
    ...[100,200,300].map(at=>({axis:'y' as const,at,from:100,to:500})),
  ]};
}
function f35Table(bbox:[number,number,number,number]=[100,630,930,940]):PdfElement {
  const xs=[123,235,347,459,571,683,795,904],ys=[652,705,758,811,864,918];
  return {id:'e008',kind:'table',text:'',order:1,level:0,bbox,translate:true,rowCount:5,columnCount:7,
    rows:Array.from({length:5},(_,rowIndex)=>({rowIndex,cells:Array.from({length:7},(_,columnIndex)=>({
      id:`e008-r${rowIndex}-c${columnIndex}`,rowIndex,columnIndex,rowSpan:1,columnSpan:1,isHeader:rowIndex===0,
      translate:true,text:`source ${rowIndex}-${columnIndex}`,bbox:[xs[columnIndex],ys[rowIndex],xs[columnIndex+1],ys[rowIndex+1]],
    }))}))};
}
function paragraph(id:string,text:string,bbox:[number,number,number,number],order=0):PdfElement {
  return {id,kind:'paragraph',text,order,level:0,bbox,translate:!!text.trim(),rowCount:0,columnCount:0,rows:[]};
}
const response=(value:PdfPageLayout)=>({value,model:'gpt-5.6-luna',inputTokens:30,outputTokens:20,responseId:'test'});
const provider=(overrides:Partial<PdfxV2OpenAiRequester>)=>({extract:vi.fn(),context:vi.fn(),translate:vi.fn(),validate:vi.fn(),...overrides}) as PdfxV2OpenAiRequester;

describe('source-backed v5 layout repair',()=> {
  it('repairs a misdeclared invoice grid from real rules without changing text',()=> {
    const original=page(),fixed=repairExtractedLayout(original,native());
    expect(validateExtractedPage(original,1).valid).toBe(false);
    expect(validateExtractedPage(fixed,1).failures).toEqual([]);
    expect(fixed.elements[0].columnCount).toBe(2);
    expect(fixed.elements[0].rows.flatMap(r=>r.cells.map(c=>c.text))).toEqual(original.elements[0].rows.flatMap(r=>r.cells.map(c=>c.text)));
    expect(original.elements[0].columnCount).toBe(1);
  });
  it('does not invent missing source text or use text behind a scan',()=> {
    const evidence=native();evidence.images=[[100,100,500,300]];
    expect(rebuildNativeTable(table(),evidence)).toBeNull();
    expect(rebuildNativeTable(table(),{...native(),texts:native().texts.slice(1)})).toBeNull();
  });
  it('derives a merged header from absent internal rules',()=> {
    const evidence=native();
    evidence.rules=evidence.rules.map(r=>r.axis==='x'&&r.at===300?{...r,from:200}:r);
    evidence.texts=[{text:'Merged header',bbox:[130,120,440,150]},...evidence.texts.slice(2)];
    const rebuilt=rebuildNativeTable({...table(),rows:[]},evidence)!;
    expect(rebuilt.rows[0].cells).toHaveLength(1);
    expect(rebuilt.rows[0].cells[0]).toMatchObject({columnSpan:2,text:'Merged header'});
    expect(validateExtractedPage(page([rebuilt]),1).valid).toBe(true);
  });
  it('recovers a missing outer stroke only when every native column corroborates the edge row',()=> {
    const evidence=native();
    evidence.rules=evidence.rules.map(r=>r.axis==='y'&&r.at===100?{...r,to:300}:r);
    expect(rebuildNativeTable(table(),evidence)?.columnCount).toBe(2);
    evidence.rules=evidence.rules.map(r=>r.axis==='x'&&r.at===300?{...r,from:200}:r);
    expect(rebuildNativeTable(table(),evidence)).toBeNull();
  });
  it('retains an overflowing centered value only with corroborated column alignment',()=> {
    const evidence:NativeGeometry={images:[],rules:[
      ...[100,300,500,700].map(at=>({axis:'x' as const,at,from:100,to:700})),
      ...[100,200,300,400,500,600,700].map(at=>({axis:'y' as const,at,from:100,to:700})),
    ],texts:Array.from({length:18},(_,i)=>({text:`Cell ${i}`,bbox:[140+i%3*200,110+Math.floor(i/3)*100,260+i%3*200,140+Math.floor(i/3)*100]}))};
    evidence.texts[16]={text:'The entire long organization name',bbox:[270,610,530,640]};
    const t={...table(),bbox:[100,100,700,700],rows:[]};
    expect(rebuildNativeTable(t,evidence)?.rows[5].cells[1].text).toBe('The entire long organization name');
    evidence.texts[16].bbox=[300,610,560,640];
    expect(rebuildNativeTable(t,evidence)).toBeNull();
  });
  it('tightens overlapping prose only for exact native text matches',()=> {
    const first={...table(),id:'e012',kind:'paragraph' as const,text:'First source sentence',rowCount:0,columnCount:0,rows:[],bbox:[100,100,500,230]};
    const second={...first,id:'e014',order:1,text:'Second source sentence',bbox:[100,180,500,300]};
    const evidence={rules:[],images:[],texts:[{text:first.text,bbox:[110,110,480,130] as [number,number,number,number]},{text:second.text,bbox:[110,240,480,260] as [number,number,number,number]}]};
    const fixed=repairExtractedLayout(page([first,second]),evidence);
    expect(validateExtractedPage(fixed,1).failures).toEqual([]);
    expect(fixed.elements.map(e=>e.text)).toEqual([first.text,second.text]);
  });
  it('repairs the f35 page-3 table envelope and removes its empty paragraph artifact',()=> {
    const sourceTable=f35Table();
    const source={...page([
      paragraph('e003','Visible source paragraph',[100,300,800,350]),
      sourceTable,
      paragraph('e009','',[110,640,210,700],2),
    ]),pageNumber:3};
    const initialFailures=validateExtractedPage(source,3).failures;
    expect(initialFailures).toContain('table e008 bounding box does not match the union of its cells');
    expect(initialFailures).toContain('elements e008 and e009 have overlapping text regions that would overwrite each other');

    const fixed=repairExtractedLayout(source);
    expect(fixed.elements.map(element=>element.id)).toEqual(['e003','e008']);
    expect(fixed.elements[1].bbox).toEqual([123,652,904,918]);
    expect(fixed.elements[1].rows).toEqual(sourceTable.rows);
    expect(validateExtractedPage(fixed,3).failures).toEqual([]);
    expect(repairExtractedLayout(fixed)).toEqual(fixed);
    expect(source.elements[1].bbox).toEqual([100,630,930,940]);
    expect(source.elements).toHaveLength(3);
  });
  it('accepts the retained f35 candidate after Luna collapses only the empty artifact box',()=> {
    const retained={...page([
      paragraph('e003','Visible source paragraph',[100,300,800,350]),
      f35Table([123,652,904,918]),
      paragraph('e009','',[0,0,0,0],2),
    ]),pageNumber:3};
    expect(validateExtractedPage(retained,3).failures).toEqual([
      'element e009 has an invalid normalized bounding box',
    ]);
    const fixed=repairExtractedLayout(retained);
    expect(fixed.elements.map(element=>element.id)).toEqual(['e003','e008']);
    expect(validateExtractedPage(fixed,3).failures).toEqual([]);
  });
  it('preserves empty protected, visual and table elements while pruning empty semantic blocks',()=> {
    const protectedText={...paragraph('protected','',[0,0,0,0],0),kind:'suppressed_text' as const,translate:false};
    const visual={...paragraph('visual','',[100,100,200,200],1),kind:'image' as const,translate:false};
    const emptyTable={...paragraph('empty-table','',[200,200,300,300],2),kind:'table' as const};
    const emptyPageNumber={...paragraph('empty-page-number','',[300,300,320,320],3),kind:'page_number' as const,translate:false};
    const fixed=repairExtractedLayout(page([protectedText,visual,emptyTable,emptyPageNumber]));
    expect(fixed.elements.map(element=>element.id)).toEqual(['protected','visual','empty-table']);
    expect(validateExtractedPage(fixed,1).failures).toContain(
      'suppressed language element protected must retain its verbatim source text for original-page reconstruction',
    );
  });
  it('does not normalize a table envelope when any cell box or grid position is invalid',()=> {
    const invalidCell=f35Table();
    invalidCell.rows[0].cells[0].bbox=[123,652,123,705];
    const missingCell=f35Table();
    missingCell.id='missing';
    missingCell.rows[4].cells.pop();
    const fixed=repairExtractedLayout(page([invalidCell,{...missingCell,order:2}]));
    expect(fixed.elements[0].bbox).toEqual([100,630,930,940]);
    expect(fixed.elements[1].bbox).toEqual([100,630,930,940]);
    expect(validateExtractedPage(fixed,1).failures).toEqual(expect.arrayContaining([
      'table e008 cell e008-r0-c0 has an invalid normalized bounding box',
      'table missing is missing 1 grid position(s)',
    ]));
  });
  it('normalizes a one-based complete grid before deriving its table envelope',()=> {
    const oneBased=f35Table();
    oneBased.rows=oneBased.rows.map(row=>({...row,rowIndex:row.rowIndex+1,cells:row.cells.map(cell=>({
      ...cell,rowIndex:cell.rowIndex+1,columnIndex:cell.columnIndex+1,
    }))}));
    const fixed=repairExtractedLayout(page([oneBased]));
    expect(fixed.elements[0].rows[0].rowIndex).toBe(0);
    expect(fixed.elements[0].rows[0].cells[0].columnIndex).toBe(0);
    expect(fixed.elements[0].bbox).toEqual([123,652,904,918]);
    expect(validateExtractedPage(fixed,1).failures).toEqual([]);
  });
  it('does not expose unvalidated or wrong-version state as a checkpoint',()=> {
    expect(parseExtractionRecovery({extractionRecovery:{version:'v7',attempts:1,failures:[]}})).toBeUndefined();
    expect(parseExtractionRecovery({extractionRecovery:{version:EXTRACTION_RECOVERY_VERSION,attempts:1,failures:[],candidate:{}}})).toBeUndefined();
  });
  it('only replaces requested elements and keeps their order',()=> {
    const source=page([table(),{...table(),id:'other',order:1}]);
    const patched=mergeExtractionPatch(source,{elements:[{...table(),columnCount:2,order:99}],warnings:[]},['e031']);
    expect(patched.elements[1]).toBe(source.elements[1]);
    expect(patched.elements[0].order).toBe(0);
    expect(()=>mergeExtractionPatch(source,{elements:[{...table(),id:'other'}],warnings:[]},['e031'])).toThrow(/exactly/);
  });
  it('extracts separate cell runs from an actual digital PDF',async()=> {
    const pdf=await PDFDocument.create(),p=pdf.addPage([600,800]),font=await pdf.embedFont(StandardFonts.Helvetica);
    for(const x of [60,180,300]) p.drawLine({start:{x,y:500},end:{x,y:700},thickness:0.5});
    for(const y of [500,600,700]) p.drawLine({start:{x:60,y},end:{x:300,y},thickness:0.5});
    ['Header one','Header two','Amount 123','Value 456'].forEach((text,i)=>p.drawText(text,{x:70+(i%2)*120,y:650-Math.floor(i/2)*100,size:10,font}));
    const data=await readNativeGeometry(Buffer.from(await pdf.save()));
    const region=nativeTableRegions(data)[0];
    const rebuilt=rebuildNativeTable({...table(),bbox:region,rows:[]},data)!;
    expect(rebuilt.rows.flatMap(r=>r.cells.map(c=>c.text))).toEqual(['Header one','Header two','Amount 123','Value 456']);
    expect(canonicalText(rebuilt.rows.flatMap(r=>r.cells.map(c=>c.text)).join(''))).toBe(canonicalText(data.texts.map(t=>t.text).join('')));
  });
  it.each([3,7])('refuses an invisible or clip-only native text layer (mode %s)',async(mode)=> {
    const pdf=await PDFDocument.create(),p=pdf.addPage([600,800]);
    p.pushOperators(setTextRenderingMode(mode));
    p.drawText('Not visible source text',{x:60,y:700,size:10});
    const geometry=await readNativeGeometry(Buffer.from(await pdf.save()));
    expect(geometry.canReconstruct).toBe(false);
  });
  it('refuses transparent native text',async()=> {
    const pdf=await PDFDocument.create(),p=pdf.addPage([600,800]);
    p.drawText('Not visible source text',{x:60,y:700,size:10,opacity:0});
    const geometry=await readNativeGeometry(Buffer.from(await pdf.save()));
    expect(geometry.canReconstruct).toBe(false);
  });
  it('keeps text and rules aligned inside a transformed Form XObject',async()=> {
    const original=await PDFDocument.create(),p=original.addPage([300,400]);
    for(const x of [30,150,270]) p.drawLine({start:{x,y:100},end:{x,y:300}});
    for(const y of [100,200,300]) p.drawLine({start:{x:30,y},end:{x:270,y}});
    ['One','Two','Three','Four'].forEach((text,i)=>p.drawText(text,{x:40+i%2*120,y:250-Math.floor(i/2)*100,size:10}));
    const document=await PDFDocument.create();
    const [form]=await document.embedPdf(await original.save());
    document.addPage([600,800]).drawPage(form,{x:50,y:60,width:450,height:600});
    const geometry=await readNativeGeometry(Buffer.from(await document.save()));
    expect(geometry.canReconstruct).toBe(true);
    const rebuilt=rebuildNativeTable({...table(),bbox:nativeTableRegions(geometry)[0],rows:[]},geometry)!;
    expect(rebuilt.rows.flatMap(r=>r.cells.map(c=>c.text))).toEqual(['One','Two','Three','Four']);
  });
  it('persists native provenance internally but never adds it to the model schema',()=> {
    const source={...page(),rotation:0,graphics:[],nativeTable:true};
    expect(parseStoredPdfPageLayout(source)?.nativeTable).toBe(true);
    expect(PdfPageExtractionSchema.parse(source)).not.toHaveProperty('nativeTable');
  });
  it('fits all text into a sub-two-point cell instead of dropping trailing lines',async()=> {
    const tableElement=table();tableElement.bbox=[100,100,500,102];
    tableElement.columnCount=1;tableElement.rowCount=1;
    tableElement.rows=[{rowIndex:0,cells:[{...tableElement.rows[0].cells[0],text:'A complete long cell including the final words 123',bbox:tableElement.bbox}]}];
    const pdf=await PDFDocument.create();pdf.addPage([600,800]);
    const output=await makeTranslatedPdfBytes([page([tableElement])],Buffer.from(await pdf.save()));
    const geometry=await readNativeGeometry(output.bytes);
    expect(canonicalText(geometry.texts.map(t=>t.text).join(''))).toBe(canonicalText(tableElement.rows[0].cells[0].text));
  });
});

describe('bounded, durable targeted recovery',()=> {
  it('revalidates a terminal retained candidate locally without another paid request',async()=> {
    const retained={...page([
      paragraph('e003','Visible source paragraph',[100,300,800,350]),
      f35Table([123,652,904,918]),
      {...paragraph('e009','',[0,0,0,0],2),translate:true},
    ]),pageNumber:3};
    const extract=vi.fn(),repair=vi.fn(),orientation=vi.fn();
    const nativeGeometry=vi.fn(async()=>({images:[],texts:[],rules:[]}));
    const result=await extractPageWithOpenAi(
      Buffer.from('fixture'),
      3,
      'Russian',
      provider({extract,repair,orientation,nativeGeometry}),
      {resume:{
        version:EXTRACTION_RECOVERY_VERSION,
        attempts:3,
        rotation:0,
        candidate:retained,
        firstFailure:'table e008 bounding box does not match the union of its cells',
        failures:['element e009 has an invalid normalized bounding box'],
        terminal:true,
      }},
    );
    expect(result).toMatchObject({
      attempts:3,
      responseId:'retained-layout-repair',
      inputTokens:0,
      outputTokens:0,
    });
    expect(result.layout.elements.map(element=>element.id)).toEqual(['e003','e008']);
    expect(validateExtractedPage(result.layout,3).failures).toEqual([]);
    expect(nativeGeometry).toHaveBeenCalledTimes(1);
    expect(extract).not.toHaveBeenCalled();
    expect(repair).not.toHaveBeenCalled();
    expect(orientation).not.toHaveBeenCalled();
  });
  it('uses a region repair instead of re-extracting the whole page',async()=> {
    const extract=vi.fn(async()=>response(page()));
    const repair=vi.fn(async(_args:unknown)=>response(page([{...table(),columnCount:2}])));
    const saved:any[]=[];
    const result=await extractPageWithOpenAi(Buffer.from('fixture'),1,'Russian',provider({extract,repair}),{save:async s=>{saved.push(structuredClone(s));}});
    expect(result.attempts).toBe(2);expect(extract).toHaveBeenCalledTimes(1);expect(repair).toHaveBeenCalledTimes(1);
    expect(repair.mock.calls[0]?.[0]).toMatchObject({elementIds:['e031'],model:'gpt-5.6-luna'});
    expect(saved.some(s=>s.candidate?.elements[0].id==='e031')).toBe(true);
  });
  it('stops a stalled repair and makes no paid calls when replayed',async()=> {
    const extract=vi.fn(async()=>response(page())),repair=vi.fn(async()=>response(page()));
    let saved:any;
    const requester=provider({extract,repair});
    const first=await extractPageWithOpenAi(Buffer.from('fixture'),1,'Russian',requester,{save:async s=>{saved=structuredClone(s);}}).catch(e=>e);
    expect(isPdfxTerminalError(first)).toBe(true);expect(saved.terminal).toBe(true);
    await expect(extractPageWithOpenAi(Buffer.from('fixture'),1,'Russian',requester,{resume:saved})).rejects.toThrow(/outside the declared grid/);
    expect(extract).toHaveBeenCalledTimes(1);expect(repair).toHaveBeenCalledTimes(1);
  });
  it('counts region repairs within the original page cap and retains root cause at exhaustion',async()=> {
    const ledger=emptyRequestLedger();ledger.counts['extract:1']=4;
    const repair=vi.fn(),orientation=vi.fn();
    const requester=budgetedRequester(provider({repair,orientation}),ledger,async()=>{});
    const resume={version:EXTRACTION_RECOVERY_VERSION as typeof EXTRACTION_RECOVERY_VERSION,attempts:1,rotation:0,candidate:page(),firstFailure:'table e031 cell r0c1 lies outside the declared grid',failures:['table e031 cell r0c1 lies outside the declared grid']};
    const error=await extractPageWithOpenAi(Buffer.from('fixture'),1,'Russian',requester,{resume}).catch(e=>e);
    expect(error.message).toMatch(/outside the declared grid/);expect(error.message).toMatch(/request budget/);
    expect(repair).not.toHaveBeenCalled();expect(orientation).not.toHaveBeenCalled();
  });
  it('stops before an API call if candidate persistence fails',async()=> {
    const extract=vi.fn();
    await expect(extractPageWithOpenAi(Buffer.from('fixture'),1,'Russian',provider({extract}),{save:async()=>{throw new Error('DB disconnected');}})).rejects.toThrow(/persist/);
    expect(extract).not.toHaveBeenCalled();
  });
  it.each(['JobCancelledError','JobLeaseLostError'])('does not disguise %s as a spending failure',async(name)=> {
    const controlFlow=Object.assign(new Error(name),{name});
    const extract=vi.fn();
    await expect(extractPageWithOpenAi(Buffer.from('fixture'),1,'Russian',provider({extract}),{save:async()=>{throw controlFlow;}})).rejects.toBe(controlFlow);
    expect(extract).not.toHaveBeenCalled();
  });
  it('keeps the targeted region after a failed repair request instead of replaying OCR',async()=> {
    const extract=vi.fn(async()=>response(page()));
    const repair=vi.fn().mockRejectedValueOnce(new Error('Request timed out')).mockResolvedValueOnce(response(page([{...table(),columnCount:2}])));
    const result=await extractPageWithOpenAi(Buffer.from('fixture'),1,'Russian',provider({extract,repair}));
    expect(result.attempts).toBe(3);
    expect(extract).toHaveBeenCalledTimes(1);expect(repair).toHaveBeenCalledTimes(2);
    expect(repair.mock.calls[1][0].elementIds).toEqual(['e031']);
  });
  it('will not treat a header-only text layer as a complete dense page',()=> {
    expect(nativeDensePage({...native(),images:[[0,0,1000,1000]]},1,'Russian')).toBeNull();
    expect(nativeDensePage(native(),1,'Russian')).toBeNull();
  });
});

describe('dense table translation without whole-page replays',()=> {
  it('keeps distinct columns and header roles separate even for identical wording',()=> {
    const t=table();t.columnCount=2;
    t.rows.flatMap(row=>row.cells).forEach(cell=>{cell.text='Ушбу ҳужжат';});
    expect(planNativeTableBatches(page([t])).entries.size).toBe(4);
    t.rows.flatMap(row=>row.cells).forEach(cell=>{cell.isHeader=false;});
    expect(planNativeTableBatches(page([t])).entries.size).toBe(2);
  });
  it('rejects an over-budget dense page before any translation call',async()=> {
    const t=table();t.columnCount=1;t.rowCount=801;
    const cell=t.rows[0].cells[0];
    t.rows=Array.from({length:801},(_,rowIndex)=>({rowIndex,cells:[{...cell,rowIndex,id:`c${rowIndex}`,text:`Ушбу ҳужжат ${rowIndex}`}]}));
    const translate=vi.fn();
    await expect(translatePageWithOpenAi({...page([t]),nativeTable:true},{sourceLanguage:'Uzbek',targetLanguage:'Russian',documentType:'Table',summary:'Test',preserveTerms:[],terminology:[]},'Russian',provider({translate}))).rejects.toThrow(/bounded page translation/);
    expect(translate).not.toHaveBeenCalled();
  });
  it('deduplicates within columns, saves validated values and reuses them without calls',async()=> {
    const t=table();t.columnCount=2;
    t.rows[0].cells[0].text='Ушбу ҳужжат 100';t.rows[0].cells[0].isHeader=false;
    t.rows[1].cells[0].text='Ушбу ҳужжат 100';t.rows[1].cells[0].isHeader=false;
    for(const row of t.rows) {row.cells[1].text='200.00';row.cells[1].translate=false;}
    const source={...page([t]),nativeTable:true};
    const translate=vi.fn(async(args:any)=>({ ...response(page()),value:{pageNumber:1,warnings:[],elements:args.source.elements.map((e:any)=>({id:e.id,text:'Настоящий документ 100',cells:[]}))} }));
    const validate=vi.fn(async()=>({...response(page()),value:{pageNumber:1,complete:true,meaningPreserved:true,targetLanguageSatisfied:true,tableStructurePreserved:true,failures:[],warnings:[]}}));
    const r=provider({translate,validate});
    const context={sourceLanguage:'Uzbek',targetLanguage:'Russian',documentType:'Table',summary:'Test',preserveTerms:[],terminology:[]};
    let state:any;
    const result=await translatePageWithOpenAi(source,context,'Russian',r,{save:async s=>{state=structuredClone(s);}});
    expect(translate.mock.calls[0][0].source.elements).toHaveLength(1);
    expect(result.translation.elements[0].cells.map(c=>c.text)).toEqual(['Настоящий документ 100','200.00','Настоящий документ 100','200.00']);
    expect(validate).toHaveBeenCalledTimes(1);
    const second=await translatePageWithOpenAi(source,context,'Russian',r,{resume:state});
    expect(second.translation).toEqual(result.translation);
    expect(translate).toHaveBeenCalledTimes(1);expect(validate).toHaveBeenCalledTimes(1);
  });
  it('does not trust model warnings as native provenance',async()=> {
    const source=page([{...table(),columnCount:2}]);
    source.warnings=['Dense table recovered from native PDF'];
    const translate=vi.fn().mockRejectedValue(Object.assign(new Error('no access'),{status:403}));
    await translatePageWithOpenAi(source,{sourceLanguage:'Uzbek',targetLanguage:'Russian',documentType:'Table',summary:'Test',preserveTerms:[],terminology:[]},'Russian',provider({translate})).catch(()=>{});
    expect(translate.mock.calls[0][0].source.elements[0].kind).toBe('table');
  });
});
