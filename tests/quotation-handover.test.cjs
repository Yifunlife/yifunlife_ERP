const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { unzipSync, strFromU8 } = require('fflate');
const { createRuntime, request, call } = require('./support/runtime.cjs');
const payload = { contractNo: 'HANDOVER', projectName: 'Example project', snapshot: { products: [{ id: 'p1', sku: 'SKU', name: '<script>unsafe</script>', spec: '10x20', unit: '套', price: 100, cost: 999999 }], cart: { p1: 2 }, priceMode: 'vip', fees: {}, includeTax: false } };
async function setup(t) {
  const r = createRuntime(); t.after(r.close);
  r.sqlite.exec(fs.readFileSync('drizzle/0031_quotation_handover.sql','utf8'));
  const get = r.bindings.PRODUCT_IMAGES.get;
  r.bindings.PRODUCT_IMAGES.get = async key => { const object = await get(key); return object ? { ...object, arrayBuffer: async () => object.body.buffer } : null; };
  await r.db.insert(r.schema.productOverrides).values({ productId:'p1', cost:40 });
  const history = r.load('app/api/quotation-history/route.ts');
  const quote = (await call(history, 'POST', payload)).body.quotation;
  await call(history, 'PATCH', { id:quote.id, action:'confirm', finalAmount:180, finalCurrency:'CNY' });
  return { r, history, quote, route:r.load('app/api/quotation-handover/route.ts') };
}
const details = { previousId:'', responsiblePerson:'交接负责人', paymentTerms:'50% 定金，50% 发货前付清', customerConfirmation:'客户邮件确认，附件待补充', deliveryNotes:'按约定安装', fileIds:[] };
function req(id, body, owner='alice@example.test', method='POST', suffix='') { const q = request(body, owner, 'employee', method, '?quotation='+id+suffix); q.headers.set('origin','http://review.test'); return q; }

test('saved costs survive catalog changes and new revisions capture new costs', async t => {
  const {r,history,quote} = await setup(t);
  const original = r.sqlite.prepare('SELECT snapshot_json FROM quotation_history WHERE id=?').get(quote.id).snapshot_json;
  r.sqlite.prepare('UPDATE product_overrides SET cost=90').run();
  const records = (await call(history,'GET',null,'alice@example.test','admin')).body.quotations;
  assert.equal(records[0].estimatedCost,80);
  const next = (await call(history,'POST',{...payload,lineageId:quote.lineageId})).body.quotation;
  const opened = (await call(history,'GET',null,'alice@example.test','admin','?id='+next.id)).body.quotation;
  assert.equal(opened.snapshot.products[0].cost,90);
  assert.equal(r.sqlite.prepare('SELECT snapshot_json FROM quotation_history WHERE id=?').get(quote.id).snapshot_json,original);
});
test('source version validation rejects foreign, void, archived and replaced versions, preserves manual docs', async t => {
  const {r,history,quote} = await setup(t);
  const validate = r.load('lib/quotation-source.ts').quotationSourceError;
  const alice = {email:'alice@example.test',role:'employee'};
  assert.equal(await validate(undefined,alice),'');
  assert.ok(await validate(quote.id,{...alice,email:'bob@example.test'}));
  assert.equal(await validate(quote.id,alice),'');
  const next = (await call(history,'POST',{...payload,lineageId:quote.lineageId})).body.quotation;
  assert.equal(await validate(quote.id,alice),''); // confirmed version stays authoritative over a draft
  assert.ok(await validate(next.id,alice));
  await call(history,'PATCH',{id:next.id,action:'confirm',finalAmount:170,finalCurrency:'CNY'});
  assert.ok(await validate(quote.id,alice));
  await call(history,'PATCH',{id:next.id,action:'void'});
  assert.ok(await validate(next.id,alice));
});
test('handover saves immutable revisions; stale saves fail and quote bytes stay unchanged', async t => {
  const {r,route,quote} = await setup(t);
  const before = r.sqlite.prepare('SELECT * FROM quotation_history WHERE id=?').get(quote.id);
  const first = await route.POST(req(quote.id,details)); assert.equal(first.status,201); const saved = await first.json();
  assert.equal((await route.POST(req(quote.id,details))).status,409);
  const second = await route.POST(req(quote.id,{...details,previousId:saved.id,deliveryNotes:'新的交付说明'})); assert.equal(second.status,201);
  const records = (await (await route.GET(req(quote.id,null,undefined,'GET'))).json()).records;
  assert.equal(records.length,2); assert.equal(records[1].data.deliveryNotes,details.deliveryNotes);
  assert.equal(records[0].data.deliveryNotes,'新的交付说明');
  assert.deepEqual(r.sqlite.prepare('SELECT * FROM quotation_history WHERE id=?').get(quote.id),before);
  const html = await (await route.GET(req(quote.id,null,undefined,'GET','&id='+saved.id))).text();
  assert.ok(html.includes('已有新交接记录')); assert.ok(html.includes('&lt;script&gt;')); assert.ok(!html.includes('<script>')); assert.ok(!html.includes('999999'));
});
test('handover attachments, ZIP and history enforce quote ownership and retain evidence after void', async t => {
  const {r,route,quote,history} = await setup(t);
  const upload = new Request('http://review.test/api/quotation-handover?quotation='+quote.id+'&upload=1&name=confirmation.pdf',{method:'POST',headers:{origin:'http://review.test','x-test-email':'alice@example.test'},body:'%PDF-1.7\nconfirmation'});
  const fileResponse = await route.POST(upload); assert.equal(fileResponse.status,201); const {file} = await fileResponse.json();
  const saved = await (await route.POST(req(quote.id,{...details,fileIds:[file.id]}))).json();
  for(const suffix of ['', '&file='+file.id, '&id='+saved.id, '&id='+saved.id+'&download=1']) assert.equal((await route.GET(req(quote.id,null,'bob@example.test','GET',suffix))).status,404);
  assert.equal((await route.POST(req(quote.id,details,'bob@example.test'))).status,404);
  const zip = await route.GET(req(quote.id,null,undefined,'GET','&id='+saved.id+'&download=1'));
  assert.equal(zip.status,200); const entries=unzipSync(new Uint8Array(await zip.arrayBuffer()));
  assert.equal(Object.keys(entries).length,3);
  const data=JSON.parse(strFromU8(entries['成交资料.json'])); assert.equal(data.finalAmount,180); assert.equal(data.items[0].quantity,2); assert.equal(data.items[0].specification,'10x20'); assert.equal(data.current,true);
  assert.ok(!Object.hasOwn(data.items[0],'cost'));
  await call(history,'PATCH',{id:quote.id,action:'void'});
  assert.equal((await route.POST(req(quote.id,{...details,previousId:saved.id}))).status,409);
  const html=await (await route.GET(req(quote.id,null,undefined,'GET','&id='+saved.id))).text(); assert.ok(html.includes('不可作为当前执行依据'));
  assert.equal((await route.GET(req(quote.id,null,undefined,'GET','&file='+file.id))).status,200);
  r.objects.clear(); assert.equal((await route.GET(req(quote.id,null,undefined,'GET','&id='+saved.id+'&download=1'))).status,409);
});
test('handover validates required fields, attachment scope and cross-origin writes', async t => {
  const {route,quote} = await setup(t);
  const cross=req(quote.id,details);cross.headers.set('origin','https://other.test');assert.equal((await route.POST(cross)).status,403);
  assert.equal((await route.POST(req(quote.id,{...details,responsiblePerson:''}))).status,400);
  assert.equal((await route.POST(req(quote.id,{...details,fileIds:['foreign-file']}))).status,400);
});
test('additive migration preserves pre-existing quotation and trade records byte for byte', async t => {
  const r=createRuntime();t.after(r.close);
  r.sqlite.exec(fs.readFileSync('drizzle/0026_trade_documents.sql','utf8'));
  const history=r.load('app/api/quotation-history/route.ts');await call(history,'POST',payload);
  r.sqlite.prepare("INSERT INTO trade_documents (id,owner,kind,number,recipient,subject,message,data_json,pdf_key,pdf_hash,filename,created_at) VALUES ('old','alice','equipment-pi','OLD','customer','subject','message','{}','old-file','hash','old.pdf','2026-01-01')").run();
  const before=JSON.stringify([r.sqlite.prepare('SELECT * FROM quotation_history').all(),r.sqlite.prepare('SELECT * FROM trade_documents').all()]);
  r.sqlite.exec(fs.readFileSync('drizzle/0031_quotation_handover.sql','utf8'));
  assert.equal(JSON.stringify([r.sqlite.prepare('SELECT * FROM quotation_history').all(),r.sqlite.prepare('SELECT * FROM trade_documents').all()]),before);
});
