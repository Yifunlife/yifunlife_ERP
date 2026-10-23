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

for (const format of ['xlsx','xls']) test(`Excel ${format} import preserves source text without requesting translation`, async () => {
  const sheet=XLSX.utils.aoa_to_sheet([
    ['项目名称','原文项目'],
    ['序号','款号','产品名称','图片展示','玩具品牌','规格/尺寸','单位','数量','成本单价 RMB','成本价 RMB','单价 RMB','合计金额 RMB','美元单价','美元合计','区域小计','备注','材质/工艺做法','体积'],
    [1,'CUSTOM-FAIL','原中文设备','','','2*3*4','套',2,'','',100,200,20,40,'','原中文备注','原工艺',5],
  ]);
  const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,'报价');
  const files=zip.unzipSync(XLSX.write(book,{type:'buffer',bookType:'xlsx'}));files['xl/media/original.png']=new Uint8Array([1,2,3,4]);
  const bytes=format==='xlsx'?zip.zipSync(files):XLSX.write(book,{type:'buffer',bookType:'xls'});let preview,error,uploaded,reading,translationCalls=0;
  const scope={XLSX,products:[],quoteImportPriceMode:'usd',quoteImportTemplateRef:{current:null},
    translateQuoteWorkbook:async()=>{translationCalls++;throw Error('Import must not translate');},
    extractWorkbookImages:()=>new Map(),costingInputFromRow:()=>null,
    setQuoteImporting:value=>reading=value,setQuoteImportError:value=>error=value,setQuoteImportPreview:value=>preview=value,
    fetch:async(url,options)=>{if(url==='/api/quote-costing')return Response.json({results:[]});uploaded=options.body.get('file');return Response.json({id:'original-template'});},
  };
  await clientFunction('readQuoteImport',['uploadQuoteTemplate','importedSkuCodes','importCellText','importCellNumber','findImportColumn','findImportMeta','findImportMetaLocation','inferImportProjectName'],scope)(new File([bytes],`original.${format}`));
  assert.equal(error,'');assert.equal(translationCalls,0);assert.equal(reading,false);assert.equal(preview.rows.length,1);
  assert.equal(preview.rows[0].product.name,'原中文设备');assert.equal(preview.rows[0].quantity,2);assert.equal(preview.rows[0].product.note,'原中文备注');
  const uploadedBytes=new Uint8Array(await uploaded.arrayBuffer());
  if(format==='xlsx')assert.deepEqual(uploadedBytes,bytes,'uploads the unchanged original package');
  const saved=XLSX.read(uploadedBytes,{type:'array'}).Sheets['报价'];
  assert.equal(saved.C3.v,'原中文设备');assert.equal(saved.L3.v,200);assert.equal(saved.Q3.v,'原工艺');
});

test('translation API keeps successful items when another phrase fails', async t => {
 const r=createRuntime();t.after(r.close);
 r.bindings.AI={run:async(_,input)=>{if(input.text==='故障文字')throw Error('AI unavailable');return {translated_text:'Custom product'};}};
 const route=r.load('app/api/quote-translate/route.ts');
 const response=await route.POST(request({texts:['墙面软包','非标产品甲','故障文字']}));
 assert.equal(response.status,200);const result=await response.json();
 assert.deepEqual(result.translations,['Wall Padding','Custom product',null]);assert.equal(result.failedCount,1);
});

test('partial workbook translation keeps successful English and original images, formulas and failed source text', async () => {
 const sheet=XLSX.utils.aoa_to_sheet([['序号','款号','产品名称','备注'],[1,'A','产品甲','备注甲'],[2,'B','产品乙','备注乙']]);
 sheet.E2={t:'n',v:2,f:'SUM(A2:A3)'};sheet['!ref']='A1:E3';
 const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,'Quote');
 const files=zip.unzipSync(XLSX.write(book,{type:'buffer',bookType:'xlsx'}));files['xl/media/test.png']=new Uint8Array([1,9,3]);
 const source=zip.zipSync(files);const progress=[];
 const translate=clientFunction('translateQuoteWorkbook',['xmlText','normalizeTemplateCellOrder','updateTemplateCell'],{XLSX,...zip,products:[],fetch:async(_,options)=>{
 const {texts}=JSON.parse(options.body);return Response.json({translations:texts.map(text=>text==='产品甲'?'Product A':null),failedCount:texts.length-1});
 }});
 const result=await translate(source.buffer,undefined,(completed,total,failed)=>progress.push({completed,total,failed}));
 const after=XLSX.read(result,{type:'array'}).Sheets.Quote;
 assert.equal(after.C2.v,'产品甲\nProduct A');assert.equal(after.C3.v,'产品乙');assert.equal(after.D2.v,'备注甲');assert.equal(after.E2.f,'SUM(A2:A3)');
 assert.deepEqual(zip.unzipSync(new Uint8Array(result))['xl/media/test.png'],files['xl/media/test.png']);
 assert.equal(progress.at(-1).failed,3);assert.equal(progress.at(-1).completed,4);
 await assert.rejects(()=>translate(source.buffer),/翻译未完成/,'export still requires complete English');
});

test('real quotation fee and workmanship terminology includes the full source meaning', async t => {
 const r=createRuntime();t.after(r.close);r.bindings.AI={run:async()=>{throw Error('Approved terms must not use AI');}};
 const route=r.load('app/api/quote-translate/route.ts');
 const response=await route.POST(request({texts:['除甲醛','运输费（含装货不含卸货）','安装费（含工人食宿）','小计（不含税）','待补齐成本','工艺做法']}));
 assert.equal(response.status,200);
 assert.deepEqual((await response.json()).translations,['Formaldehyde Removal','Transportation Fee (including loading; unloading excluded)',"Installation Fee (including workers' meals and accommodation)",'Subtotal (excluding tax)','Cost Information Pending','Workmanship']);
});
