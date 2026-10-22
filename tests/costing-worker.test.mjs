import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorker, fixturePassword } from './support/worker.mjs';
import { createRuntime } from './support/runtime.cjs';
test('built Worker saves numbered libraries, calculates one SKU factor and hides costs from sales', async t => {
 const {worker,db}=await createWorker();t.after(()=>worker.dispose());
 await db.prepare('CREATE UNIQUE INDEX costing_previous_unique ON costing_rule_versions(previous_id)').run();
 const fetch=(path,options={})=>worker.dispatchFetch('http://localhost'+path,options);
 const signIn=async email=>{const response=await fetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password:fixturePassword})});assert.equal(response.status,200);return response.headers.get('set-cookie').split(';')[0];};
 const ceo=await signIn('yifunlife@hotmail.com'),sales=await signIn('alice@example.test');
 assert.equal((await fetch('/api/costing',{headers:{cookie:sales}})).status,403);
 const r=createRuntime();let settings,input;try {
  const core=r.load('lib/costing.ts');settings=r.load('lib/costing-library.ts').withLibraries(core.initialSettings());
  settings.resources.forEach(x=>x.price=x.kind==='material'?50:40);
  settings.recipes[0].difficultyFactor=1.5;
  settings.recipes[0].lines.forEach(x=>{const resource=settings.resources.find(r=>r.id===x.resourceId);x.enabled=x.part==='wall'&&['木板','木工'].includes(resource.name);x.usage=resource.kind==='material'?2:1.25;});
  settings.recipes[0].salePrices.wall=300;
  input={...core.blankInput(),area:10,mezzanine:{status:'none',area:null},roof:{status:'none',area:null},glass:{status:'none',area:null}};
 } finally {r.close();}
 const post=(path,body,cookie)=>fetch(path,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await post('/api/costing',{action:'settings',settings,baseVersion:0,reason:'local runtime'},ceo)).status,201);
 const payload={items:[{id:'house',input,quoteQuantity:1}]};
 const calculated=await (await post('/api/quote-costing',payload,ceo)).json();assert.equal(calculated.results[0].cost,2250);assert.equal(calculated.results[0].costing.saleUnit,3000);
 const visible=await (await post('/api/quote-costing',payload,sales)).json();assert.equal(Object.hasOwn(visible.results[0],'cost'),false);
 const saved=await (await fetch('/api/costing',{headers:{cookie:ceo}})).json();assert.equal(saved.settings.resources[0].code,'CL-GC-001');
});
