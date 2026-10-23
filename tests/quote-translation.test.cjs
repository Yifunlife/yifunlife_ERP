const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const zip = require('fflate');
const {clientFunction} = require('./support/client.cjs');
const {createRuntime, request} = require('./support/runtime.cjs');

test('translation API requires login, validates input and rejects incomplete English', async t => {
  const r=createRuntime();t.after(r.close);
  r.bindings.AI={run:async()=>({translated_text:'Wall padding'})};
  const route=r.load('app/api/quote-translate/route.ts');
  assert.equal((await route.POST(request({texts:['墙面软包']},''))).status,401);
  assert.equal((await route.POST(request({texts:[null]}))).status,400);
  assert.equal((await route.POST(request({texts:Array(25).fill('墙面软包')}))).status,400);
  assert.deepEqual(await (await route.POST(request({texts:['墙面软包']}))).json(),{translations:['Wall Padding']});
  r.bindings.AI.run=async()=>({translated_text:'尚未翻译'});
  assert.equal((await route.POST(request({texts:['新产品']}))).status,503);
});

test('whole-form translation appends English without changing headers, numbers, formulas or images', async () => {
  const sheet=XLSX.utils.aoa_to_sheet([
    ['亦玩报价清单'],['序号','款号 Item Number','产品名称 Product Name','备注 Notes'],
    [1,'KNOWN','已知产品','客户自理'],[2,'CUSTOM','非标产品','保持尺寸 1*2*3'],
    [3,'EXISTING','原中文\nExisting English','个\nPiece'],['报价有效期30天'],
    [4,'UNIT','非标\nCustom','组 / Set'],[5,'SIZE','周长*高\nPerimeter × Height','EVA软垫（阻燃）'],
  ]);
  sheet.D9={t:'n',f:'SUM(A3:A5)',v:6};sheet['!ref']='A1:D9';
  const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,'Form');
  const files=zip.unzipSync(XLSX.write(book,{type:'buffer',bookType:'xlsx'}));files['xl/media/keep.png']=new Uint8Array([1,2,3]);
  const source=zip.zipSync(files);
  const translatedTexts=[];
  const fn=clientFunction('translateQuoteWorkbook',['xmlText','normalizeTemplateCellOrder','updateTemplateCell'],{
    XLSX,...zip,products:[{sku:'KNOWN',en:'Known product'}],
    fetch:async(url,options)=>{assert.equal(url,'/api/quote-translate');const {texts}=JSON.parse(options.body);translatedTexts.push(...texts);return Response.json({translations:texts.map((_,i)=>`English translation ${i+1}`)});},
  });
  const output=await fn(source.buffer);
  const after=XLSX.read(output,{type:'array',cellStyles:true}).Sheets.Form;
  assert.equal(after.C3.v,'已知产品\nKnown product');
  assert.equal(after.C5.v,'原中文\nExisting English');
  assert.equal(after.A2.v,'序号');assert.equal(after.B2.v,'款号 Item Number');
  assert.ok(after['!rows'][0].hpt >= 42, 'translated text has sufficient row height');
  assert.equal(after.A3.v,1);assert.equal(after.B4.v,'CUSTOM');assert.equal(after.D9.f,'SUM(A3:A5)');
  assert.equal(after.D5.v,'个\nPiece');assert.equal(after.C7.v,'非标\nCustom');assert.equal(after.D7.v,'组 / Set');assert.equal(after.C8.v,'周长*高\nPerimeter × Height');
  assert.ok(translatedTexts.includes('EVA软垫（阻燃）'));
  for(const ref of ['A1','C4','D3','D4','A6']) assert.match(after[ref].v,/\nEnglish translation/);
  assert.ok(!translatedTexts.includes('已知产品'));assert.ok(!translatedTexts.includes('原中文\nExisting English'));
  const final=zip.unzipSync(new Uint8Array(output));assert.deepEqual(final['xl/media/keep.png'],files['xl/media/keep.png']);assert.deepEqual(final['xl/styles.xml'],files['xl/styles.xml']);
  const count=translatedTexts.length;
  assert.deepEqual(new Uint8Array(await fn(output)),new Uint8Array(output));
  assert.equal(translatedTexts.length,count,'reimport does not translate existing bilingual text or grow row heights');
});

test('web units and remarks split existing English without adding a second translation',()=>{
  const split=clientFunction('splitBilingual',[],{});
  const unit=clientFunction('unitLabel',[],{splitBilingual:split,unitEnglish:{个:'Piece'}});
  const remark=clientFunction('englishRemark',[],{splitBilingual:split});
  assert.deepEqual(unit('个\nPiece'),{zh:'个',en:'Piece'});
  assert.deepEqual(unit('组 / Set'),{zh:'组',en:'Set'});
  assert.deepEqual(split('中文备注\nExisting English'),{zh:'中文备注',en:'Existing English'});
  assert.equal(remark('中文备注\nExisting English'),'Existing English');
});

for (const failure of ['unavailable','timeout']) test(`Excel import continues with untouched original workbook when translation is ${failure}`, async () => {
  const sheet=XLSX.utils.aoa_to_sheet([
    ['项目名称','原文项目'],
    ['序号','款号','产品名称','图片展示','玩具品牌','规格/尺寸','单位','数量','成本单价 RMB','成本价 RMB','单价 RMB','合计金额 RMB','美元单价','美元合计','区域小计','备注','材质/工艺做法','体积'],
    [1,'CUSTOM-FAIL','原中文设备','','','2*3*4','套',2,'','',100,200,20,40,'','原中文备注','原工艺',5],
  ]);
  const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,'报价');
  const files=zip.unzipSync(XLSX.write(book,{type:'buffer',bookType:'xlsx'}));files['xl/media/original.png']=new Uint8Array([1,2,3,4]);
  const bytes=zip.zipSync(files);let preview,error,uploaded,reading;
  const scope={XLSX,products:[],quoteImportPriceMode:'usd',quoteImportTemplateRef:{current:null},
    translateQuoteWorkbook:async(source,signal)=>{assert(signal instanceof AbortSignal);if(failure==='unavailable')throw Error('translation unavailable');return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError'))));},
    ...(failure==='timeout'?{setTimeout:fn=>{queueMicrotask(fn);return 1;},clearTimeout(){}}:{}),
    extractWorkbookImages:()=>new Map(),costingInputFromRow:()=>null,
    setQuoteImporting:value=>reading=value,setQuoteImportError:value=>error=value,setQuoteImportPreview:value=>preview=value,
    fetch:async(url,options)=>{if(url==='/api/quote-costing')return Response.json({results:[]});uploaded=options.body.get('file');return Response.json({id:'original-template'});},
  };
  await clientFunction('readQuoteImport',['uploadQuoteTemplate','importedSkuCodes','importCellText','importCellNumber','findImportColumn','findImportMeta','findImportMetaLocation','inferImportProjectName'],scope)(new File([bytes],'original.xlsx'));
  assert.match(error,/可继续导入/);assert.equal(reading,false);assert.equal(preview.rows.length,1);
  assert.equal(preview.rows[0].product.name,'原中文设备');assert.equal(preview.rows[0].quantity,2);assert.equal(preview.rows[0].product.note,'原中文备注');
  assert.deepEqual(new Uint8Array(await uploaded.arrayBuffer()),bytes,'fallback uploads the original package with its images and formulas intact');
});
