const test=require('node:test'),assert=require('node:assert/strict'),{createRuntime}=require('./support/runtime.cjs');const fixture=require('./fixtures/maze-standard-20261016.json');
test('one material may have separate labor rows without double-counting material',t=>{const r=createRuntime();t.after(r.close);const c=r.load('lib/costing.ts'),s=structuredClone(fixture),p=s.recipes.find(x=>x.sku==='MP-02'),original=c.calculate({...c.blankInput(),sku:p.sku},s),skin=p.lines[1],tailor=s.resources.find(x=>x.name==='车缝&裁剪');tailor.dailyOutput=72.4137931034483;p.lines.push({...skin,id:'tailor',laborResourceId:tailor.id,usageFromLineId:skin.id,materialEnabled:false});assert(c.validSettings(s));const out=c.calculate({...c.blankInput(),sku:p.sku},s);assert.equal(out.material,original.material);assert.equal(out.labor,Math.round((original.rows.filter(x=>x.kind==='labor').reduce((sum,x)=>sum+x.amount,0)+3*4.005)*100)/100);skin.usage=4;skin.expression='4';assert(c.validSettings(s));assert.equal(c.calculate({...c.blankInput(),sku:p.sku},s).rows.find(x=>x.id==='tailor-labor').quantity,4);});
test('unresolved procurement and formula decisions block total cost, and source links cannot cycle',t=>{const r=createRuntime();t.after(r.close);const c=r.load('lib/costing.ts'),s=structuredClone(fixture),p=s.recipes.find(x=>x.sku==='MP-02');p.pendingIssues=['采购成本待填写'];assert(c.validSettings(s));assert.equal(c.calculate({...c.blankInput(),sku:p.sku},s).total,null);p.lines[0].usageFromLineId=p.lines[0].id;assert(!c.validSettings(s));p.lines[0].usageFromLineId='missing';assert(!c.validSettings(s));});
test('packaging and numbering follow maximum material usage, wages and product difficulty',t=>{
 const r=createRuntime();t.after(r.close);const c=r.load('lib/costing.ts'),s=structuredClone(fixture),p=s.recipes.find(x=>x.sku==='MP-02');
 const pack=s.resources.find(x=>x.name==='包装'),numbering=s.resources.find(x=>x.name==='编号');
 pack.dailyOutput=36;numbering.dailyOutput=129.31;s.resources.find(x=>x.name==='车缝&裁剪').dailyOutput=72.4137931034483;
 p.maxUsageLaborResourceIds=[pack.id,numbering.id];p.difficultyFactor=1.5;assert(c.validSettings(s));
 const input={...c.blankInput(),sku:p.sku,quantity:2},out=c.calculate(input,s),extras=out.rows.filter(x=>x.id.startsWith('max-usage-'));
 assert.equal(extras.length,2);assert(extras.every(x=>x.quantity===6));
 const total=rows=>Math.round((rows.filter(x=>x.kind==='material').reduce((n,x)=>n+x.amount,0)+rows.filter(x=>x.kind==='labor').reduce((n,x)=>n+x.amount,0)*1.5)*1.1*100)/100;
 assert.equal(out.total,total(out.rows));
 const first=p.lines[0];first.usage=5;first.expression='5';pack.price*=2;
 p.lines.push({...first,id:'labor-only',resourceId:p.lines[1].resourceId,laborResourceId:s.resources.find(x=>x.name==='车缝&裁剪').id,usage:100,expression:'100',materialEnabled:false});
 assert(c.validSettings(s));const changed=c.calculate(input,s),extra=changed.rows.find(x=>x.id===`max-usage-${pack.id}`);
 assert.equal(extra.quantity,10);assert.equal(extra.price,Math.round(pack.price/pack.dailyOutput*1000)/1000);assert.equal(changed.total,total(changed.rows));
 pack.price=null;assert.equal(c.calculate(input,s).total,null);
 p.maxUsageLaborResourceIds=[p.lines[0].resourceId];assert(!c.validSettings(s));
});
