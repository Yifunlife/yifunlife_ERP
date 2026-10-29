const test=require('node:test'),assert=require('node:assert/strict');
const {createRuntime,request,call}=require('./support/runtime.cjs');
async function setup(t){const r=createRuntime();t.after(r.close);const history=r.load('app/api/quotation-history/route.ts');const quote=(await call(history,'POST',{contractNo:'CRM-TEST',projectName:'Same Project',snapshot:{products:[{id:'p',sku:'X',name:'test',cost:987654,price:100,usd:20}],cart:{p:1},priceMode:'usd'}})).body.quotation;return {r,history,quote,route:r.load('app/api/crm-collaboration/route.ts')};}
const req=(id,body,email='alice@example.test',method='POST')=>{const r=request(body,email,'employee',method,'?quotation='+id);r.headers.set('origin','http://review.test');return r;};
test('quote completion publishes once per version and retains quote bytes; requires owner and same origin',async t=>{const {r,route,quote}=await setup(t),before=r.sqlite.prepare('SELECT * FROM quotation_history').all(),body={kind:'核算报价完成',content:'核算完成，请销售发送',requestId:'test-request-id'};
 assert.equal((await route.POST(req(quote.id,body,'bob@example.test'))).status,404);const bad=req(quote.id,body);bad.headers.set('origin','https://other.test');assert.equal((await route.POST(bad)).status,403);
 assert.equal((await route.POST(req(quote.id,{...body,content:''}))).status,400);
 assert.equal((await route.POST(req(quote.id,body))).status,200);assert.equal((await route.POST(req(quote.id,body))).status,200);assert.equal(r.sqlite.prepare('SELECT COUNT(*) n FROM quotation_crm_messages').get().n,1);assert.deepEqual(r.sqlite.prepare('SELECT * FROM quotation_history').all(),before);
});
test('verified project sharing allows read only, hides costs, receives CRM feedback and revokes access',async t=>{const {r,route,history,quote}=await setup(t);
 assert.equal((await route.GET(req(quote.id,null,'bob@example.test','GET'))).status,404);
 r.sqlite.prepare('INSERT INTO quotation_crm_links VALUES(?,?,?,?,?,?,?,?,?)').run(quote.id,'crm-project','Same Project','CRM-TEST','sales','测试销售','bob@example.test',1,'now');
 r.sqlite.prepare('INSERT INTO quotation_crm_messages VALUES(?,?,?,?,?,?,?,?)').run('crm-feedback',quote.id,'crm-project','crm','修改要求',JSON.stringify({content:'请调整方案',next_action:'复核报价'}),'测试销售','2026-10-29');
 const d=await (await route.GET(req(quote.id,null,'bob@example.test','GET'))).json();assert.equal(d.messages[0].body.content,'请调整方案');assert.equal(d.canPublish,false);
 const opened=await call(history,'GET',null,'bob@example.test','employee','?id='+quote.id);assert.equal(opened.status,200);assert.ok(!JSON.stringify(opened.body).includes('987654'));
 assert.equal((await route.POST(req(quote.id,{kind:'核算报价完成',content:'不能伪造核算',requestId:'test-request-id'},'bob@example.test'))).status,404);
 assert.equal((await call(history,'PATCH',{id:quote.id,action:'void'},'bob@example.test')).status,404);
 r.sqlite.exec('UPDATE quotation_crm_links SET active=0');assert.equal((await route.GET(req(quote.id,null,'bob@example.test','GET'))).status,404);assert.equal((await call(history,'GET',null,'bob@example.test','employee','?id='+quote.id)).status,404);
});
