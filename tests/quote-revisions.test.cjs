const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const ts=require('typescript');const XLSX=require('xlsx');const zip=require('fflate');
const source=fs.readFileSync('lib/quote-revisions.ts','utf8');const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const exported={};new Function('require','exports',compiled)(require,exported);
const {applyQuoteRevisions}=exported;
test('four revision colours preserve source cells, exclude removed amounts and retain readable audit data',()=>{
 const sheet=XLSX.utils.aoa_to_sheet([['No','SKU','Name','Image','Brand','Size','Unit','Qty','Cost','Cost total','Price','Amount','USD','USD amount'],[1,'A','原产品','','','1m','套',2,4,8,10,20,2,4],[2,'B','新增'],[3,'C','修改'],[4,'D','客户自理']]);sheet.H4={t:'n',v:2};const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,'Quote');const files=zip.unzipSync(XLSX.write(book,{type:'buffer'}));files['xl/media/keep.png']=new Uint8Array([1,2,3]);
 const lines=['deleted','added','modified','customer'].map((status,i)=>({row:i+2,product:{sku:String(i),name:'产品',revision:{status,changes:[{field:status==='modified'?'数量':'状态',before:'1',after:'2',at:'2026-10-21T00:00:00Z'}]}}}));
 applyQuoteRevisions(files,'xl/worksheets/sheet1.xml',lines);
 const result=XLSX.read(zip.zipSync(files),{type:'array',cellStyles:true});assert.equal(result.Sheets.Quote.C2.v,'原产品');assert.equal(result.Sheets.Quote.H2.v,2);assert.equal(result.Sheets.Quote.L2.v,0);assert.equal(result.Sheets.Quote.L2.f,'0');
 assert.deepEqual(files['xl/media/keep.png'],new Uint8Array([1,2,3]));assert.ok(result.SheetNames.includes('修改记录'));
 assert.equal(result.Sheets.Quote.C2.s.fgColor.rgb,'FF0000');assert.equal(result.Sheets.Quote.C3.s.fgColor.rgb,'92D050');assert.equal(result.Sheets.Quote.H4.s.fgColor.rgb,'00B0F0');assert.equal(result.Sheets.Quote.C5.s.fgColor.rgb,'FFFF00');
 assert.equal(JSON.parse(result.Sheets['修改记录'].I2.v).status,'deleted');
});

test('final data uses current quantities and excludes deleted and customer-supplied rows',()=>{
 const {createRuntime}=require('./support/runtime.cjs');const r=createRuntime();try{
 const {quoteAmount}=r.load('lib/quote-amount.ts');
 const revision=status=>({status,changes:[]});
 const result=quoteAmount({priceMode:'vip',includeTax:false,cart:{a:2,b:3,c:4,d:5},products:[{id:'a',price:10,cost:4,revision:revision('modified')},{id:'b',price:20,cost:5,revision:revision('added')},{id:'c',price:30,cost:6,revision:revision('deleted')},{id:'d',price:40,cost:7,revision:revision('customer')}]});
 assert.equal(result.amount,80);assert.equal(result.costAmount,23);assert.equal(result.skuCount,2);assert.deepEqual(result.items.map(item=>item.quantity),[2,3]);
 }finally{r.close();}
});
