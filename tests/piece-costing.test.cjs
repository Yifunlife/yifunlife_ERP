const test=require('node:test'),assert=require('node:assert/strict');
const {createRuntime,call}=require('./support/runtime.cjs');
const fixture=require('./fixtures/maze-standard-20261016.json');
const round=n=>Math.round(n*100)/100;
test('source standard pieces use per-piece material and matched trade usage',t=>{
 const r=createRuntime();t.after(r.close);const c=r.load('lib/costing.ts'),s=structuredClone(fixture);
 assert(c.validSettings(s));
 for(const [sku,expected] of [['MP-02',304.64],['M201',273.07]]){
  const input={...c.blankInput(),sku};const out=c.calculate(input,s);
  assert.deepEqual(out.issues,[]);assert.equal(out.total,expected);
  assert.equal(out.rows.length,sku==='MP-02'?10:14);
  for(let i=0;i<out.rows.length;i+=2)assert.equal(out.rows[i].quantity,out.rows[i+1].quantity);
  assert.equal(c.calculate({...input,quantity:3},s).total,round(out.rows.reduce((v,x)=>v+x.amount,0)*3*1.1));
  const sale=c.calculateSale(input,s);assert.equal(sale.total,round(expected*2));
 }
 const last=s.recipes.find(x=>x.sku==='M201').lines.at(-1);
 assert.equal(last.expression,'0.2*0.2*4+0.2*3.14*0.2*4+1.22+1.22');
 assert.equal(last.usage,3.1024000000000003);
});
test('library price, wage, productivity, difficulty and management changes recalculate pieces',t=>{
 const r=createRuntime();t.after(r.close);const c=r.load('lib/costing.ts'),s=structuredClone(fixture),input={...c.blankInput(),sku:'MP-02'};
 const recipe=s.recipes.find(x=>x.sku===input.sku),material=s.resources.find(x=>x.id===recipe.lines[0].resourceId),labor=s.resources.find(x=>x.id===recipe.lines[0].laborResourceId);
 const original=c.calculate(input,s);
 material.price*=2;assert(c.calculate(input,s).material>original.material);assert.equal(c.calculate(input,s).labor,original.labor);
 labor.price*=2;assert(c.calculate(input,s).labor>original.labor);
 labor.dailyOutput*=2;assert.equal(c.calculate(input,s).labor,original.labor);
 recipe.difficultyFactor=2;s.houseStandard.managementRate=.2;
 const out=c.calculate(input,s),sum=k=>out.rows.filter(x=>x.kind===k).reduce((v,x)=>v+x.amount,0);
 assert.equal(out.total,round((sum('material')+sum('labor')*2)*1.2));
 material.areaPerUnit=null;assert.equal(c.calculate(input,s).total,null);
 recipe.lines[0].laborResourceId='missing';assert.equal(c.validSettings(s),false);
});
test('quotation import calculates standard pieces without dimensions and protects costs',async t=>{
 const r=createRuntime();t.after(r.close);const c=r.load('lib/costing.ts'),route=r.load('app/api/quote-costing/route.ts');
 r.sqlite.prepare('INSERT INTO costing_rule_versions(id,previous_id,settings_json,reason,created_by,created_at) VALUES (1,0,?,?,?,?)').run(JSON.stringify(fixture),'test','test','2026-10-16');
 for(const role of ['employee','admin','ceo','cost_accountant']){
  const input=r.load('lib/costing-import.ts').costingInputFromRow(['款号','数量'],['MP-02',2],{sku:'MP-02',name:'二步梯',unit:'件'},2,'test');
  const response=await call(route,'POST',{items:[{id:'piece',input,quoteQuantity:2}]},'test@example.test',role);
  assert.equal(response.status,200);const item=response.body.results[0];assert.equal(item.matched,true);assert.equal(item.costing.status,'ready');
  assert.equal(item.costing.saleUnit,c.calculateSale(input,fixture).total/2);
  if(role==='employee')assert(!Object.hasOwn(item,'cost'));else assert.equal(item.cost,c.calculate(input,fixture).total/2);
 }
});
