const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const XLSX=require('xlsx');
const zip=require('fflate');
const {clientFunction}=require('./support/client.cjs');
const {createRuntime}=require('./support/runtime.cjs');

test('imported zero-quantity rows remain visible without becoming effective data',()=>{
  const rows=clientFunction('quoteCartItems',[],{cartItems:[{id:'source',qty:0,importSourceRow:12},{id:'empty-cart',qty:0}]});
  assert.deepEqual(rows.map(row=>row.id),['source']);
  const runtime=createRuntime();try {
    const amount=runtime.load('lib/quote-amount.ts').quoteAmount({includeTax:false,products:[{id:'source',price:50}],cart:{source:0}});
    assert.equal(amount.amount,0);assert.equal(amount.skuCount,0);assert.deepEqual(amount.items,[]);
  }finally{runtime.close();}
});

test('ordinary quote preparation translates missing text once without changing identifiers, values or revision history',async()=>{
  let calls=0;
  const translate=clientFunction('translateQuoteWorkbook',['xmlText','normalizeTemplateCellOrder','updateTemplateCell'],{
    XLSX,...zip,products:[],fetch:async(url,options)=>{calls++;const {texts}=JSON.parse(options.body);return Response.json({translations:texts.map((_,i)=>'Translation '+i)});},
  });
  const prepare=clientFunction('bilingualQuoteProducts',[],{XLSX,translateQuoteWorkbook:translate,splitBilingual:clientFunction('splitBilingual',[],{}),needsEnglishTranslation:p=>!p.en,englishProductName:p=>p.en});
  const product={id:'custom',sku:'CUSTOM',name:'非标设备',en:'',spec:'周长*高',unit:'个',brand:'品牌',note:'客户备注',material:'阻燃材料',price:120,cost:50,revision:{status:'modified',changes:[{field:'数量',before:'1',after:'2',at:'2026-10-21'}]}};
  const first=await prepare([product]);assert.equal(calls,1);
  const second=await prepare(first);assert.equal(calls,1);assert.deepEqual(second,first);
  for(const key of ['id','sku','price','cost','revision'])assert.deepEqual(first[0][key],product[key]);
  assert.match(first[0].en,/Translation/);assert.match(first[0].spec,/\nTranslation/);
});

test('final extraction uses the latest row state once and keeps separate rows with the same SKU',()=>{
  const runtime=createRuntime();try{
    const {quoteAmount}=runtime.load('lib/quote-amount.ts');
    const result=quoteAmount({includeTax:false,cart:{a:2,b:1,c:1},products:[
      {id:'a',sku:'SAME',price:999,cost:999},
      {id:'a',sku:'SAME',price:10,cost:2,revision:{status:'modified',changes:[]}},
      {id:'b',sku:'SAME',price:10,cost:2},
      {id:'c',sku:'REMOVED',price:50,cost:20,revision:{status:'deleted',changes:[]}},
    ]});
    assert.equal(result.amount,30);assert.equal(result.costAmount,6);
    assert.equal(result.skuCount,2);assert.deepEqual(result.items.map(item=>item.quantity),[2,1]);
  }finally{runtime.close();}
});

test('downstream document import uses current effective rows instead of stale imported copies',async()=>{
  const runtime=createRuntime();try {
    let data,error;
    const snapshot={priceMode:'usd',cart:{a:2,b:1,c:1,d:1,zero:0},importedProducts:[{id:'a',name:'Old',usd:999},{id:'c',name:'Deleted stale copy',usd:999}],products:[
      {id:'a',name:'Current',en:'Current',usd:2,revision:{status:'modified'}},
      {id:'b',name:'Added',usd:4,revision:{status:'added'}},
      {id:'c',name:'Deleted',usd:null,revision:{status:'deleted'}},
      {id:'d',name:'Customer',usd:null,revision:{status:'customer'}},
    ]};
    await clientFunction('importQuote',[],{sourceId:'final',excludedFromQuote:runtime.load('lib/quote-revisions.ts').excludedFromQuote,
      jsonRequest:async()=>({quotation:{snapshot,contractNo:'FINAL',projectName:'Project',finalAmount:8}}),setBusy(){},setError:value=>error=value,setNotice(){},setData:fn=>data=fn({}),
    },'app/trade-documents/page.tsx')();
    assert.equal(error,'');assert.deepEqual(data.items.map(item=>[item.description,item.quantity,item.price]),[['Current',2,2],['Added',1,4]]);
  }finally{runtime.close();}
});

for(const mode of ['vip','factory','usd']) test(`ordinary ${mode} quotations export the same 18 columns and effective rows`,async()=>{
  const runtime=createRuntime();try{
    const revision=status=>({status,changes:[{field:status==='modified'?'数量':'状态',before:'1',after:'2',at:'2026-10-21T00:00:00Z'}]});
    const items=['modified','added','deleted','customer'].map((status,index)=>({area:'区域 / Area',quantity:index===0?2:1,product:{id:String(index),sku:'SKU'+index,name:'产品'+index,en:'Product '+index,price:(index+1)*10,factory:(index+1)*5,usd:(index+1)*2,cost:1,note:'备注\nNotes',material:'材料\nMaterials',unit:'个\nPiece',spec:'1m',image:'',revision:revision(status)}}));
    let output,error;
    const headers=clientFunction('importedQuoteHeaders',[],{});
    const currency=mode==='usd'?'USD':'CNY', subtotal=mode==='usd'?8:mode==='factory'?20:40;
    const fn=clientFunction('exportQuoteExcel',['formatQuoteCurrencyCells','xmlText','normalizeTemplateCellOrder','restoreTemplatePriceStyles','updateTemplateCell','updateTemplateFormula','templateRow','setTemplateHiddenColumns','updateTemplateRowCell','updateTemplateRowFormula','updateTemplateRowTextFormula'],{
      XLSX,...zip,...runtime.load('lib/quote-revisions.ts'),quotationTotals:runtime.load('lib/quotation.ts').quotationTotals,
      quoteImportTemplateRef:{current:null},checkCostedQuote:()=>true,recordQuoteHistory:async()=>true,authAccount:{role:'admin'},
      quoteItemsInOrder:items,quoteGroups:[['区域 / Area',items]],currency,priceMode:mode,displayPrice:p=>mode==='usd'?p.usd:mode==='factory'?p.factory:p.price,
      billableQuantity:(p,q)=>['deleted','customer'].includes(p.revision?.status)?0:q,
      needsEnglishTranslation:()=>false,englishProductName:p=>p.en,englishRemark:()=>'',splitBilingual:s=>({zh:s,en:''}),
      importedQuoteHeaders:headers,fees:{packaging:0,formaldehyde:0,shipping:0,installation:0,designDeduction:0},includeTax:false,showDesignDeduction:false,
      preTax:subtotal,tax:0,totalWithTax:subtotal,quoteProject:'Generic',designerName:'Designer',salesName:'Sales',quoteExportFileName:()=>mode,
      skuImageKey:s=>s,window:{location:{origin:'https://example.test'},alert:value=>error=value},
      fetch:async()=>new Response(fs.readFileSync('public/quotation-templates/YIFUNLIFE_MINIMDO_AUS_PRODUCTS_QUOTATION.xlsx')),
      translateQuoteWorkbook:async source=>source,downloadExcelFile:data=>output=data,
    });
    await fn(false);assert.equal(error,undefined);assert.ok(output);
    const book=XLSX.read(output,{type:'array',cellStyles:true}),sheet=book.Sheets[book.SheetNames[0]];
    assert.deepEqual(headers.map((lines,index)=>sheet[XLSX.utils.encode_cell({r:2,c:index})]?.v),headers.map(lines=>lines.join('\n')));
    assert.equal(XLSX.utils.decode_range(sheet['!ref']).e.c,17);
    assert.equal(sheet.P5.v,'备注\nNotes');assert.equal(sheet.Q5.v,'材料\nMaterials');
    assert.equal(sheet.N7.v,0);assert.equal(sheet.N8.v,0);assert.equal(sheet.L7.v,0);assert.equal(sheet.L8.v,0);
    assert.equal(sheet[currency==='USD'?'N122':'L122'].v,subtotal);
    assert.equal(sheet.O4.v,8);assert.equal(sheet.H5.v,2);
    assert.equal(sheet.A7.s.fgColor.rgb,'FF0000');assert.equal(sheet.A8.s.fgColor.rgb,'FFFF00');
    assert.ok(book.SheetNames.includes('修改记录'));
    for(let pass=0;pass<2;pass++) {
      let preview,importError;
      const read=clientFunction('readQuoteImport',['uploadQuoteTemplate','importedSkuCodes','importCellText','importCellNumber','findImportColumn','findImportMeta','findImportMetaLocation','inferImportProjectName'],{
        XLSX,...runtime.load('lib/quote-revisions.ts'),products:[],quoteImportPriceMode:mode,quoteImportTemplateRef:{current:null},
        translateQuoteWorkbook:async source=>source,extractWorkbookImages:()=>new Map(),costingInputFromRow:runtime.load('lib/costing-import.ts').costingInputFromRow,
        setQuoteImporting(){},setQuoteImportError:value=>importError=value,setQuoteImportPreview:value=>preview=value,
        fetch:async url=>Response.json(url==='/api/quote-costing'?{results:[]}:{id:'generic'}),
      });
      await read(new File([output],'ordinary.xlsx'));assert.equal(importError,'');assert.equal(preview.rows.length,4);
      const amount=runtime.load('lib/quote-amount.ts').quoteAmount({products:preview.rows.map(row=>row.product),cart:Object.fromEntries(preview.rows.map(row=>[row.product.id,row.quantity])),priceMode:mode,includeTax:false,fees:preview.fees});
      assert.equal(amount.skuCount,2);assert.equal(amount.amount,subtotal);assert.equal(amount.items.length,2);
    }
  }finally{runtime.close();}
});
