const test = require('node:test');
const assert = require('node:assert/strict');
const { createRuntime, call } = require('./support/runtime.cjs');
const runtime = t => { const r = createRuntime(); t.after(r.close); r.sqlite.exec('CREATE UNIQUE INDEX costing_previous_unique ON costing_rule_versions(previous_id)'); return r; };
function fixture(r) {
  const core = r.load('lib/costing.ts');
  const settings = core.initialSettings();
  settings.rules.forEach(rule => { rule.enabled = rule.family === 'house' && rule.part === 'wall' && ['木板','木工'].includes(rule.name); rule.usage = rule.kind === 'material' ? 2 : 0.5; rule.price = rule.kind === 'material' ? 50 : 40; rule.factors = [1,1.5,2,3]; });
  const input = { ...core.blankInput(), project: '测试项目', name: 'F01', sku: 'FB0001-B', perimeter: 20, height: 3, mezzanine: { status: 'none', area: null }, roof: { status: 'none', area: null }, glass: { status: 'none', area: null } };
  return { core, settings, input };
}
test('roles allow admin, CEO and accountant while denying sales and management', async t => {
  const r=runtime(t), route=r.load('app/api/costing/route.ts');
  for (const role of ['employee','management']) {
    assert.equal((await call(route,'GET',null,'user@test',role)).status,403);
    assert.equal((await call(route,'POST',{action:'settings'},'user@test',role)).status,403);
  }
  assert.equal((await call(route,'GET',null,null)).status,401);
  for (const role of ['admin','ceo','cost_accountant']) assert.equal((await call(route,'GET',null,'user@test',role)).status,200);
});
test('material and labor coefficients apply once; quantity applies once; missing input is not zero', t => {
  const r=runtime(t), {core,settings,input}=fixture(r);
  const result=core.calculate(input,settings);
  assert.equal(result.material,9000); assert.equal(result.labor,1800); assert.equal(result.total,10800);
  assert.equal(core.calculate({...input,quantity:2},settings).total,21600);
  settings.rules.find(x=>x.name==='木板' && x.part==='wall').price=null;
  assert.equal(core.calculate(input,settings).total,null);
  assert.ok(core.calculate({...input,area:50},settings).issues.some(x=>x.includes('不一致')));
});
test('extra parts require their own rules; replacement avoids double counting', t => {
  const r=runtime(t), {core,settings,input}=fixture(r);
  settings.rules.filter(x=>x.family==='house' && x.part==='glass' && ['玻璃','木工'].includes(x.name)).forEach(x=>{ x.enabled=true; x.usage=1; x.price=10; });
  const result=core.calculate({...input,glass:{status:'present',area:10},glassReplacesWall:true},settings);
  assert.equal(result.areas.wall,50); assert.equal(result.total,9300);
  assert.equal(core.calculate({...input,roof:{status:'present',area:20}},settings).total,null);
  assert.equal(core.calculate({...input,glass:{status:'present',area:70},glassReplacesWall:true},settings).total,null);
});
test('settings revisions, server calculation, historical immutability, and reprice lineage', async t => {
  const r=runtime(t),{settings,input}=fixture(r),route=r.load('app/api/costing/route.ts');
  const post=body=>call(route,'POST',body,'accountant@test','cost_accountant');
  assert.equal((await post({action:'settings',baseVersion:0,settings,reason:'首次设置'})).status,201);
  const old=await post({action:'record',baseVersion:1,input,result:{total:1}});
  assert.equal(old.body.result.total,10800);
  settings.rules.filter(x=>x.enabled).forEach(x=>x.price*=2);
  assert.equal((await post({action:'settings',baseVersion:1,settings,reason:'更新单价'})).status,201);
  assert.equal((await post({action:'settings',baseVersion:1,settings,reason:'冲突'})).status,409);
  assert.equal((await post({action:'record',baseVersion:1,input})).status,409);
  const reprice=await post({action:'record',baseVersion:2,input,parentId:old.body.id});
  assert.equal(reprice.body.result.total,21600);
  const prior=(await call(route,'GET',null,'accountant@test','cost_accountant','?id='+old.body.id)).body.record;
  assert.equal(prior.snapshot.result.total,10800); assert.equal(prior.snapshot.settings.rules.find(x=>x.enabled).price,50);
  assert.equal(r.sqlite.prepare('SELECT count(*) AS n FROM costing_records').get().n,2);
});
test('invalid/negative data, unconfigured state and explicit per-order adjustments', async t => {
  const r=runtime(t),{core,settings,input}=fixture(r),route=r.load('app/api/costing/route.ts');
  const post=body=>call(route,'POST',body,'ceo@test','ceo');
  assert.equal((await post({action:'record',baseVersion:0,input})).status,400);
  settings.rules[0].price=-1;
  assert.equal((await post({action:'settings',baseVersion:0,settings,reason:'bad'})).status,400);
  settings.rules[0].price=1;
  await post({action:'settings',baseVersion:0,settings,reason:'init'});
  assert.equal((await post({action:'record',baseVersion:1,input:{...input,quantity:-1}})).status,400);
  const pending=await post({action:'record',baseVersion:1,input:{...input,sku:'UNKNOWN'}});
  assert.equal(pending.body.result.total,null);
  const id=settings.rules.find(x=>x.enabled && x.kind==='material').id;
  const adjusted={...input,adjustments:[{id,quantity:1,price:0}]};
  assert.equal(core.calculate(adjusted,settings).total,null);
  assert.equal(core.calculate({...adjusted,note:'客户自备板材'},settings).total,1800);
  assert.equal(core.calculate({...input,note:'bad',adjustments:[{id:'unknown',quantity:0,price:0}]},settings).total,null);
});
test('accountants can create their own quotations without gaining management privileges',async t=>{
  const r=runtime(t),route=r.load('app/api/quotation-history/route.ts');
  const response=await call(route,'POST',{contractNo:'COST-QUOTE',projectName:'核算报价',snapshot:{version:1,products:[{id:'p1',sku:'TEST',price:100,usd:20,cost:40}],cart:{p1:1},priceMode:'vip',fees:{},includeTax:false}},'accountant@test','cost_accountant');
  assert.equal(response.status,201);
  assert.equal((await call(route,'GET',null,'accountant@test','cost_accountant','?id='+response.body.quotation.id)).status,200);
  assert.equal((await call(route,'GET',null,'other@test','cost_accountant','?id='+response.body.quotation.id)).status,404);
});
