const test = require('node:test');
const assert = require('node:assert/strict');
const { createRuntime, call } = require('./support/runtime.cjs');
async function fixture(t) {
  const r=createRuntime(); t.after(r.close);
  const core=r.load('lib/costing.ts'), settings=core.initialSettings();
  settings.saleRules.find(x=>x.family==='house'&&x.part==='wall').prices=[200,300,400,500];
  settings.rules.forEach(x=>{x.enabled=x.family==='house'&&x.part==='wall'&&['木板','木工'].includes(x.name);x.usage=x.kind==='material'?2:0.5;x.price=x.kind==='material'?50:40;x.factors=[1,1.5,2,3];});
  const input={...core.blankInput(),sku:'FB0001-B',perimeter:20,height:3,mezzanine:{status:'none',area:null},roof:{status:'none',area:null},glass:{status:'none',area:null}};
  await call(r.load('app/api/costing/route.ts'),'POST',{action:'settings',baseVersion:0,settings,reason:'test'},'boss@test','ceo');
  return {r,core,settings,input,route:r.load('app/api/quote-costing/route.ts')};
}
test('sale is area times grade price, independently of material and labor difficulty',async t=>{
  const {core,settings,input}=await fixture(t);
  assert.equal(core.calculateSale(input,settings).total,18000);
  assert.equal(core.calculate(input,settings).total,10800);
  settings.rules.forEach(x=>x.price=null);
  assert.equal(core.calculate(input,settings).total,null);
  assert.equal(core.calculateSale(input,settings).total,18000);
  settings.saleRules.find(x=>x.family==='house'&&x.part==='roof').prices[1]=100;
  assert.equal(core.calculateSale({...input,roof:{status:'present',area:10}},settings).total,19000);
});
test('original import reads labeled geometry, and area units do not multiply area twice',async t=>{
  const {r,core,settings}=await fixture(t), parse=r.load('lib/costing-import.ts').costingInputFromRow;
  const h=['夹层面积','屋顶面积','玻璃面积'];
  const area=parse(h,['无','无','无'],{sku:'FB0001-B',name:'house',unit:'㎡'},60.5,'project');
  assert.equal(core.calculateSale(area,settings).total,18150);
  const pieces=parse([...h,'周长','高度'],['无','无','无',20,3],{sku:'FB0001-B',name:'house',unit:'件'},2,'project');
  assert.equal(core.calculateSale(pieces,settings).total,36000);
  assert.equal(core.calculateSale(parse([],[],{sku:'FB0001-B',name:'house',unit:'件'},1,''),settings).total,null);
});
test('ordinary quote users get sale only; accountant sees cost; unknown difficulty stays pending',async t=>{
  const {route,input}=await fixture(t);
  const payload={items:[{id:'house',input,quoteQuantity:1}]};
  const employee=await call(route,'POST',payload,'alice@test','employee');
  assert.equal(employee.body.results[0].costing.saleUnit,18000);
  assert.equal(Object.hasOwn(employee.body.results[0],'cost'),false);
  assert.doesNotMatch(JSON.stringify(employee.body),/木板|10800|settings/);
  const accountant=await call(route,'POST',payload,'accountant@test','cost_accountant');
  assert.equal(accountant.body.results[0].cost,10800);
  const unknown=await call(route,'POST',{items:[{id:'house',input:{...input,sku:'FB0001-X'},quoteQuantity:1}]});
  assert.equal(unknown.body.results[0].costing.status,'pending');
  assert.equal((await call(route,'POST',payload,null)).status,401);
});
test('saved quotation uses authoritative costing snapshot, rejects stolen links and pending sale',async t=>{
  const {r,route,input}=await fixture(t);
  const c=(await call(route,'POST',{items:[{id:'house',input,quoteQuantity:1}]},'alice@test','employee')).body.results[0].costing;
  const history=r.load('app/api/quotation-history/route.ts');
  const snapshot={priceMode:'vip',cart:{house:1},products:[{id:'house',sku:'FB0001-B',price:1,cost:1,quoteCosting:c}],includeTax:false};
  const payload={projectName:'Cost project',contractNo:'COST-001',snapshot};
  const saved=await call(history,'POST',payload,'alice@test','employee');
  assert.equal(saved.status,201,JSON.stringify(saved.body));
  const stored=JSON.parse(r.sqlite.prepare('SELECT snapshot_json FROM quotation_history').get().snapshot_json);
  assert.equal(stored.products[0].cost,10800);assert.equal(stored.products[0].price,18000);
  assert.equal((await call(history,'POST',payload,'other@test','employee')).status,400);
  snapshot.priceMode='usd';
  assert.equal((await call(history,'POST',payload,'alice@test','employee')).status,400);
  const visible=r.load('lib/quote-snapshot.ts').visibleQuoteSnapshot;
  assert.equal(visible(stored,'employee').products[0].cost,undefined);
  assert.equal(visible(stored,'cost_accountant').products[0].cost,10800);
});
test('real XLSX original import recognizes FB SKUs and applies backend rate instead of catalog price', async t=>{
  const {r}=await fixture(t), XLSX=require('xlsx'),{clientFunction}=require('./support/client.cjs');
  const sheet=XLSX.utils.aoa_to_sheet([['款号','产品名称','单位','数量','人民币单价','合计金额（人民币）','规格尺寸 / Size','夹层面积','屋顶面积','玻璃面积'],['FB0001-B','非标房子','件',2,99,198,'12+8,高3','无','无','无'],['FB0001-X','未知难度','件',1,99,99,'12+8,高3','无','无','无']]);
  const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,'报价');const bytes=XLSX.write(book,{type:'buffer',bookType:'xlsx'});
  let preview,error;
  const scope={XLSX,quoteImportPriceMode:'vip',products:[],quoteImportTemplateRef:{current:null},translateQuoteWorkbook:async source=>source,extractWorkbookImages:()=>new Map(),costingInputFromRow:r.load('lib/costing-import.ts').costingInputFromRow,
  setQuoteImporting(){},setQuoteImportError:v=>error=v,setQuoteImportPreview:v=>preview=v,
  fetch:async(url,options)=>url==='/api/quote-costing'?r.load('app/api/quote-costing/route.ts').POST(new Request('http://test'+url,{method:'POST',headers:{'x-test-email':'alice@test'},body:options.body})):Response.json({id:'template'})};
  const read=clientFunction('readQuoteImport',['uploadQuoteTemplate','importedSkuCodes','importCellText','importCellNumber','findImportColumn','findImportMeta','findImportMetaLocation','inferImportProjectName'],scope);
  await read(new File([bytes],'houses.xlsx'));assert.equal(error,'');assert.equal(preview.rows[0].product.sku,'FB0001-B');assert.equal(preview.rows[0].product.price,18000);assert.equal(preview.rows[0].quantity,2);assert.equal(preview.rows[1].product.price,null);assert.equal(preview.rows[1].product.quoteCosting.status,'pending');
  const history=r.load('app/api/quotation-history/route.ts');
  const saved=await call(history,'POST',{projectName:'Import test',contractNo:'IMP-1',snapshot:{priceMode:'vip',products:[preview.rows[0].product],importedProducts:preview.rows.map(x=>x.product),cart:{[preview.rows[0].product.id]:2,[preview.rows[1].product.id]:0}}},'alice@test','employee');
  assert.equal(saved.status,201,JSON.stringify(saved.body));
});
