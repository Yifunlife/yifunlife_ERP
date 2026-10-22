const test = require('node:test');
const assert = require('node:assert/strict');
const { createRuntime, request, call } = require('./support/runtime.cjs');

const snapshot = { version: 1, products: [{ id: 'p1', sku: 'TEST', price: 100, usd: 20, cost: 40 }], cart: { p1: 2 }, priceMode: 'vip', fees: {}, includeTax: false };
const payload = { contractNo: 'QT-DEMO', projectName: 'Review project', snapshot };
const runtime = t => { const value = createRuntime(); t.after(value.close); return value; };

test('revisions increment atomically; snapshots agree; unchanged exports preserve history', async t => {
  const r = runtime(t), route = r.load('app/api/quotation-history/route.ts');
  const first = (await call(route, 'POST', payload)).body.quotation;
  assert.equal(first.contractNo, 'QT-DEMO-R01');
  assert.equal((await call(route, 'GET', null, undefined, undefined, '?nextRevisionOf=' + first.id)).body.contractNo, 'QT-DEMO-R02');
  const revisions = await Promise.all(Array.from({ length: 8 }, () => call(route, 'POST', { ...payload, lineageId: first.lineageId })));
  assert.deepEqual(revisions.map(result => result.body.quotation.contractNo).sort(), Array.from({ length: 8 }, (_, index) => `QT-DEMO-R0${index + 2}`));
  const listed = (await call(route, 'GET', null)).body.quotations;
  assert.equal(listed.find(record => record.isLatest).contractNo, 'QT-DEMO-R09');
  const second = revisions[0].body.quotation;
  const opened = (await call(route, 'GET', null, undefined, undefined, '?id=' + second.id)).body.quotation;
  assert.equal(opened.snapshot.contractNo, opened.contractNo);
  const exported = await call(route, 'POST', { ...payload, contractNo: opened.contractNo, id: opened.id, snapshot: opened.snapshot });
  assert.equal(exported.body.quotation.id, opened.id);
  assert.equal(exported.body.quotation.generatedAt, opened.generatedAt);
  assert.equal(r.sqlite.prepare('SELECT count(*) AS n FROM quotation_history').get().n, 9);
});

test('confirmed snapshots cannot be overwritten; editing creates a separate version', async t => {
  const r = runtime(t), route = r.load('app/api/quotation-history/route.ts');
  const first = (await call(route, 'POST', payload)).body.quotation;
  assert.equal((await call(route, 'PATCH', { id: first.id, action: 'confirm', finalAmount: 180, finalCurrency: 'CNY' })).status, 200);
  const change = { ...payload, contractNo: first.contractNo, id: first.id, snapshot: { ...snapshot, cart: { p1: 999 } } };
  assert.equal((await call(route, 'POST', change)).status, 409);
  const opened = (await call(route, 'GET', null, undefined, undefined, '?id=' + first.id)).body.quotation;
  assert.equal(opened.snapshot.cart.p1, 2);
  assert.equal(opened.generatedAt, first.generatedAt);
  const edited = await call(route, 'POST', { ...change, id: undefined, lineageId: first.lineageId });
  assert.equal(edited.status, 201);
  assert.notEqual(edited.body.quotation.id, first.id);
  assert.equal(edited.body.quotation.isFinalized, false);
});

test('new projects and caller-supplied lineage IDs cannot inherit another employee data', async t => {
  const r = runtime(t), route = r.load('app/api/quotation-history/route.ts');
  const first = (await call(route, 'POST', payload)).body.quotation;
  r.sqlite.prepare('UPDATE quotation_history SET customer_name=?, loss_note=?').run('Private customer', 'Private note');
  const second = (await call(route, 'POST', payload, 'bob@example.test')).body.quotation;
  assert.notEqual(first.lineageId, second.lineageId);
  assert.equal(second.customerName, '');
  assert.equal(second.lossNote, '');
  assert.equal((await call(route, 'POST', { ...payload, lineageId: first.lineageId }, 'bob@example.test')).status, 404);
  assert.equal((await call(route, 'GET', null, 'bob@example.test', undefined, '?id=' + first.id)).status, 404);
});

test('latest-version flags are independent of pagination and search filters', async t => {
  const r = runtime(t), route = r.load('app/api/quotation-history/route.ts');
  const first = (await call(route, 'POST', payload)).body.quotation;
  r.sqlite.prepare('UPDATE quotation_history SET generated_at=?').run('2020-01-01T00:00:00.000Z');
  await call(route, 'POST', { ...payload, lineageId: first.lineageId });
  for (let index = 0; index < 22; index++) await call(route, 'POST', { ...payload, contractNo: 'OTHER-' + index, projectName: 'Project ' + index });
  const page2 = (await call(route, 'GET', null, undefined, undefined, '?page=2')).body.quotations;
  assert.ok(page2.some(record => record.isLatest));
  const filtered = (await call(route, 'GET', null, undefined, undefined, '?contractNo=' + first.contractNo)).body.quotations;
  assert.equal(filtered.find(record => record.id === first.id).isLatest, false);
});

test('product saves preserve hidden costs and pairing quantities, and roll back as one operation', async t => {
  const r = runtime(t), route = r.load('app/api/catalog/route.ts');
  await r.db.insert(r.schema.catalogProducts).values({ id: 'p1', sku: 'TEST', name: 'Test', family: '模拟设备', specification: '10x20', factoryPrice: 40 });
  await r.db.insert(r.schema.productOverrides).values({ productId: 'p1', cost: 77, name: 'Before' });
  await r.db.insert(r.schema.productRecommendations).values({ productId: 'p1', relatedProductId: 'toy1', quantity: 5 });
  assert.equal((await call(route, 'PATCH', { productId: 'p1', patch: { name: 'After', cost: 40 } }, 'admin@example.test', 'admin')).status, 200);
  assert.equal(r.sqlite.prepare('SELECT cost FROM product_overrides').get().cost, 77);
  await call(route, 'POST', { action: 'recommendations', productId: 'p1', relatedIds: ['toy1'] }, 'admin@example.test', 'admin');
  assert.equal(r.sqlite.prepare('SELECT quantity FROM product_recommendations').get().quantity, 5);
  const classification = { id: 'duplicate', level1: 'A', level2: 'B', level3: 'C' };
  await assert.rejects(call(route, 'PATCH', { productId: 'p1', patch: { name: 'Must roll back' }, classifications: [classification, classification] }, 'admin@example.test', 'admin'));
  assert.equal(r.sqlite.prepare('SELECT name FROM product_overrides').get().name, 'After');
  const saved = await call(route, 'PATCH', { productId: 'p1', patch: { name: 'Atomic' }, classifications: [classification], tags: ['主设备'], relatedProducts: [{ relatedProductId: 'toy1', quantity: 5 }] }, 'admin@example.test', 'admin');
  assert.equal(saved.status, 200);
  assert.equal(r.sqlite.prepare('SELECT cost FROM product_overrides').get().cost, 77);
  assert.equal(r.sqlite.prepare('SELECT quantity FROM product_recommendations').get().quantity, 5);
});

test('image reads reject private objects but keep catalog photos available', async t => {
  const r = runtime(t), route = r.load('app/api/catalog/image/route.ts');
  r.objects.set('catalog/catalog.json', { body: new TextEncoder().encode('[{"factory":40}]'), httpMetadata: { contentType: 'application/json' } });
  r.objects.set('catalog/photo.png', { body: new Uint8Array([137, 80, 78, 71]), httpMetadata: { contentType: 'image/png' } });
  r.objects.set('products/not-an-image', { body: new TextEncoder().encode('{}'), httpMetadata: { contentType: 'application/json' } });
  for (const key of ['catalog/catalog.json', 'products/not-an-image', 'quote-templates/test']) assert.equal((await route.GET(request(null, '', '', 'GET', '?key=' + key))).status, 404);
  const response = await route.GET(request(null, '', '', 'GET', '?key=catalog/photo.png'));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/png');
});

test('original template bytes persist and are available only to owner or management', async t => {
  const r = runtime(t), route = r.load('app/api/quote-template/route.ts');
  const bytes = new Uint8Array([80, 75, 3, 4, 1]);
  const form = new FormData(); form.set('file', new File([bytes], 'quote.xlsx'));
  const response = await route.POST(new Request('http://review.test', { method: 'POST', headers: { 'x-test-email': 'alice@example.test' }, body: form }));
  const { id } = await response.json();
  assert.equal(response.status, 201);
  const opened = await route.GET(request(null, undefined, undefined, 'GET', '?id=' + id));
  assert.deepEqual(new Uint8Array(await opened.arrayBuffer()), bytes);
  assert.equal((await route.GET(request(null, 'bob@example.test', 'employee', 'GET', '?id=' + id))).status, 404);
  assert.equal((await route.GET(request(null, 'manager@example.test', 'management', 'GET', '?id=' + id))).status, 200);
  assert.equal((await route.GET(request(null, '', '', 'GET', '?id=' + id))).status, 401);
});

test('dashboard keeps CNY cost distinct from USD revenue and restricts cost visibility', async t => {
  const r = runtime(t), history = r.load('app/api/quotation-history/route.ts'), dashboard = r.load('app/api/ceo-dashboard/route.ts');
  await r.db.insert(r.schema.productOverrides).values({ productId: 'p1', cost: 40 });
  const saved = (await call(history, 'POST', { ...payload, snapshot: { ...snapshot, priceMode: 'usd' } })).body.quotation;
  const ceo = (await call(dashboard, 'GET', null, 'ceo@example.test', 'ceo')).body;
  assert.equal(ceo.projects[0].currency, 'USD');
  assert.equal(ceo.projects[0].costCurrency, 'CNY');
  assert.equal(ceo.projects[0].amount, 40);
  assert.equal(ceo.projects[0].costAmount, 80);
  const manager = (await call(dashboard, 'GET', null, 'manager@example.test', 'management')).body;
  assert.equal(manager.canViewCosts, false);
  assert.equal(manager.projects[0].costAmount, null);
  const opened = (await call(history, 'GET', null, undefined, undefined, '?id=' + saved.id)).body.quotation;
  assert.equal(opened.snapshot.products[0].cost, undefined);
});

test('authentication and toy draft ownership checks remain intact', async t => {
  const r = runtime(t);
  for (const path of ['catalog', 'quotation-history', 'ceo-dashboard', 'toy-matching-drafts']) assert.equal((await call(r.load(`app/api/${path}/route.ts`), 'GET', null, '', '')).status, 401);
  const drafts = r.load('app/api/toy-matching-drafts/route.ts');
  const draft = (await call(drafts, 'POST', { name: 'Private', snapshot })).body.draft;
  for (const method of ['GET', 'POST', 'DELETE']) assert.equal((await call(drafts, method, method === 'POST' ? { id: draft.id, snapshot } : null, 'bob@example.test', 'employee', '?id=' + draft.id)).status, 404);
  const auth = r.load('lib/auth.ts');
  const password = await auth.createPasswordRecord('test-password-only');
  assert.equal(await auth.passwordMatches('wrong-password', password.passwordHash, password.passwordSalt), false);
  await r.db.insert(r.schema.appUsers).values({ username: 'auth@example.test', email: 'auth@example.test', name: 'Fixture', ...password, role: 'employee', status: 'active', createdAt: '2026-09-11', updatedAt: '2026-09-11' });
  const session = await auth.createLoginSession('auth@example.test');
  const req = new Request('http://review.test', { headers: { cookie: `yifun_session=${session.token}` } });
  assert.ok(await auth.getLoginSession(req));
  r.sqlite.prepare('UPDATE login_sessions SET expires_at=?').run('2000-01-01T00:00:00.000Z');
  assert.equal(await auth.getLoginSession(req), null);
});


test('final confirmation requires a negotiated total, preserves quote and rejects overwrites', async t => {
  const r = runtime(t), route = r.load('app/api/quotation-history/route.ts');
  const first = (await call(route, 'POST', payload)).body.quotation;
  const before = r.sqlite.prepare('SELECT snapshot_json FROM quotation_history WHERE id=?').get(first.id).snapshot_json;
  for (const amount of [undefined, null, '', '150', 0, -1, 1.001, 1e20]) {
    assert.equal((await call(route, 'PATCH', { id: first.id, action: 'confirm', finalAmount: amount, finalCurrency: 'CNY' })).status, 400);
  }
  assert.equal((await call(route, 'PATCH', { id: first.id, action: 'confirm', finalAmount: 150, finalCurrency: 'USD' })).status, 400);
  assert.equal((await call(route, 'PATCH', { id: first.id, action: 'confirm', finalAmount: 150.25, finalCurrency: 'CNY' }, 'bob@example.test')).status, 404);
  assert.equal((await call(route, 'PATCH', { id: first.id, action: 'confirm', finalAmount: 150.25, finalCurrency: 'CNY' })).status, 200);
  const stored = r.sqlite.prepare('SELECT * FROM quotation_history WHERE id=?').get(first.id);
  assert.equal(stored.snapshot_json, before);
  assert.equal(stored.final_amount, 150.25);
  assert.equal(stored.confirmed_by, 'alice@example.test');
  assert.ok(stored.confirmed_at);
  assert.equal((await call(route, 'PATCH', { id: first.id, action: 'confirm', finalAmount: 120, finalCurrency: 'CNY' })).status, 409);
  const dashboard = (await call(r.load('app/api/ceo-dashboard/route.ts'), 'GET', null, 'ceo@example.test', 'ceo')).body;
  assert.equal(dashboard.projects[0].amount, 150.25);
  assert.equal(dashboard.projects[0].quotedAmount, 200);
});

test('void affects one version, excludes it from totals, and blocks mutation and revision links', async t => {
  const r = runtime(t), route = r.load('app/api/quotation-history/route.ts');
  const first = (await call(route, 'POST', payload)).body.quotation;
  const second = (await call(route, 'POST', { ...payload, lineageId: first.lineageId })).body.quotation;
  await call(route, 'PATCH', { id: second.id, action: 'confirm', finalAmount: 160, finalCurrency: 'CNY' });
  assert.equal((await call(route, 'PATCH', { id: second.id, action: 'void' }, 'bob@example.test')).status, 404);
  assert.equal((await call(route, 'PATCH', { id: second.id, action: 'void', voidReason: 'Duplicate version' })).status, 200);
  const row = r.sqlite.prepare('SELECT * FROM quotation_history WHERE id=?').get(second.id);
  assert.equal(row.is_finalized, 0);
  assert.equal(row.final_amount, 160);
  assert.equal(row.voided_by, 'alice@example.test');
  assert.equal(row.void_reason, 'Duplicate version');
  for (const action of ['confirm', 'reactivate', 'lost', 'project']) {
    assert.equal((await call(route, 'PATCH', { id: second.id, action, finalAmount: 100, finalCurrency: 'CNY' })).status, 409);
  }
  assert.equal((await call(route, 'POST', { ...payload, id: second.id })).status, 409);
  assert.equal((await call(route, 'GET', null, undefined, undefined, '?nextRevisionOf=' + second.id)).status, 409);
  const list = (await call(route, 'GET', null)).body.quotations;
  assert.equal(list.length, 1);
  assert.equal(list[0].id, first.id);
  assert.equal(list[0].isLatest, true);
  const voided = (await call(route, 'GET', null, undefined, undefined, '?voided=1')).body.quotations;
  assert.equal(voided.length, 1);
  assert.equal(voided[0].id, second.id);
  const third = (await call(route, 'POST', { ...payload, lineageId: first.lineageId })).body.quotation;
  assert.equal(third.contractNo, 'QT-DEMO-R03');
  const dashboard = (await call(r.load('app/api/ceo-dashboard/route.ts'), 'GET', null, 'ceo@example.test', 'ceo')).body;
  assert.equal(dashboard.quotationCount, 2);
  assert.equal(dashboard.projects[0].versions.some(version => version.id === second.id), false);
  await call(route, 'PATCH', { id: first.id, action: 'void' });
  await call(route, 'PATCH', { id: third.id, action: 'void' });
  const empty = (await call(r.load('app/api/ceo-dashboard/route.ts'), 'GET', null, 'ceo@example.test', 'ceo')).body;
  assert.equal(empty.projects.length, 0);
});

test('confirming different versions leaves exactly one final selection and retains negotiated history', async t => {
  const r = runtime(t), route = r.load('app/api/quotation-history/route.ts');
  const first = (await call(route, 'POST', payload)).body.quotation;
  const second = (await call(route, 'POST', { ...payload, lineageId: first.lineageId })).body.quotation;
  assert.equal((await call(route, 'PATCH', { id: second.id, action: 'confirm', finalAmount: 160, finalCurrency: 'CNY' })).status, 200);
  assert.equal((await call(route, 'PATCH', { id: first.id, action: 'confirm', finalAmount: 150, finalCurrency: 'CNY' })).status, 200);
  assert.equal(r.sqlite.prepare('SELECT count(*) AS n FROM quotation_history WHERE is_finalized=1').get().n, 1);
  assert.equal(r.sqlite.prepare('SELECT id FROM quotation_history WHERE is_finalized=1').get().id, first.id);
  assert.equal(r.sqlite.prepare('SELECT final_amount FROM quotation_history WHERE id=?').get(second.id).final_amount, 160);
});


test('history displays account names while retaining creator ownership', async t => {
  const r = runtime(t), route = r.load('app/api/quotation-history/route.ts');
  const first = (await call(route, 'POST', payload)).body.quotation;
  r.sqlite.prepare('INSERT INTO app_users (email,username,name,password_hash,password_salt,role,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(first.createdBy, first.createdBy, '测试姓名', 'hash', 'salt', 'employee', 'active', '2026-10-21', '2026-10-21');
  const listed = (await call(route, 'GET', null)).body.quotations;
  assert.equal(listed[0].createdByName, '测试姓名');
  assert.equal(listed[0].createdBy, first.createdBy);
});

test('batch archive preserves snapshots, applies ownership and rejects mixed invalid selections', async t => {
  const r = runtime(t), route = r.load('app/api/quotation-history/route.ts');
  const first = (await call(route, 'POST', payload)).body.quotation;
  const second = (await call(route, 'POST', {...payload, projectName: 'Second project'})).body.quotation;
  const before = r.sqlite.prepare('SELECT snapshot_json FROM quotation_history WHERE id=?').get(first.id).snapshot_json;
  assert.equal((await call(route, 'PATCH', {action: 'archive', ids: []})).status, 400);
  assert.equal((await call(route, 'PATCH', {action: 'archive', ids: [first.id]}, 'bob@example.test', 'employee')).status, 409);
  assert.equal((await call(route, 'PATCH', {action: 'archive', ids: [first.id, 'missing']})).status, 409);
  assert.equal(r.sqlite.prepare('SELECT archived_at FROM quotation_history WHERE id=?').get(first.id).archived_at, null);
  assert.equal((await call(route, 'PATCH', {action: 'archive', ids: [first.id, second.id]})).body.archivedCount, 2);
  assert.equal((await call(route, 'GET', null)).body.total, 0);
  assert.equal((await call(route, 'GET', null, undefined, undefined, '?archived=1')).body.total, 2);
  assert.equal(r.sqlite.prepare('SELECT snapshot_json FROM quotation_history WHERE id=?').get(first.id).snapshot_json, before);
});


test('history lists sales name and complete estimated costs without exposing costs to employees', async t => {
  const r = runtime(t), route = r.load('app/api/quotation-history/route.ts');
  const first = (await call(route, 'POST', {...payload, snapshot: {...snapshot, salesName: '商务姓名'}})).body.quotation;
  r.sqlite.prepare('UPDATE quotation_history SET snapshot_json=? WHERE id=?').run(JSON.stringify({...snapshot, salesName: '商务姓名'}), first.id);
  const owner = r.sqlite.prepare('SELECT created_by FROM quotation_history WHERE id=?').get(first.id).created_by;
  const admin = (await call(route, 'GET', null, owner, 'admin')).body.quotations[0];
  assert.equal(admin.salesName, '商务姓名');
  assert.equal(admin.estimatedCost, 80);
  const employee = (await call(route, 'GET', null, owner, 'employee')).body.quotations[0];
  assert.equal(employee.estimatedCost, null);
  assert.equal(employee.canViewCost, false);
});


test('estimated costs resolve catalog IDs and SKUs for existing snapshots and show partial totals', async t => {
  const r = runtime(t), route = r.load('app/api/quotation-history/route.ts');
  const first = (await call(route, 'POST', payload)).body.quotation;
  await r.db.insert(r.schema.catalogProducts).values({id:'catalog-test',sku:'MATCH-SKU',name:'Catalog product'});
  await r.db.insert(r.schema.productOverrides).values({productId:'catalog-test',cost:25});
  const source={...snapshot, products:[{id:'imported-test',sku:'MATCH-SKU',cost:null},{id:'missing',sku:'UNKNOWN',cost:null}],cart:{'imported-test':3,missing:1}};
  r.sqlite.prepare('UPDATE quotation_history SET snapshot_json=? WHERE id=?').run(JSON.stringify(source),first.id);
  let row=(await call(route,'GET',null,'alice@example.test','admin')).body.quotations[0];
  assert.equal(row.estimatedCost,75);assert.equal(row.missingCostCount,1);
  source.products[0]={id:'imported-test',sku:'old-sku',catalogProductId:'catalog-test',cost:null};
  r.sqlite.prepare('UPDATE quotation_history SET snapshot_json=? WHERE id=?').run(JSON.stringify(source),first.id);
  row=(await call(route,'GET',null,'alice@example.test','admin')).body.quotations[0];assert.equal(row.estimatedCost,75);
  assert.equal(JSON.parse(r.sqlite.prepare('SELECT snapshot_json FROM quotation_history WHERE id=?').get(first.id).snapshot_json).products[0].cost,null);
});

test('batch void validates all selected versions, preserves records and records the operator', async t => {
  const r = runtime(t), route = r.load('app/api/quotation-history/route.ts');
  const first = (await call(route, 'POST', { ...payload, contractNo: 'BATCH-A' })).body.quotation;
  const second = (await call(route, 'POST', { ...payload, contractNo: 'BATCH-B' })).body.quotation;
  const other = (await call(route, 'POST', { ...payload, contractNo: 'BATCH-OTHER' }, 'bob@example.test')).body.quotation;
  assert.equal((await call(route, 'PATCH', { action: 'void', ids: [] })).status, 400);
  assert.equal((await call(route, 'PATCH', { action: 'void', ids: [first.id, other.id] })).status, 409);
  assert.equal(r.sqlite.prepare('SELECT count(*) AS n FROM quotation_history WHERE voided_at IS NOT NULL').get().n, 0);
  await call(route, 'PATCH', { action: 'confirm', id: first.id, finalAmount: 180, finalCurrency: 'CNY' });
  const result = await call(route, 'PATCH', { action: 'void', ids: [first.id, second.id, first.id], voidReason: '重复报价' });
  assert.equal(result.status, 200); assert.equal(result.body.voidedCount, 2);
  const rows = r.sqlite.prepare('SELECT * FROM quotation_history WHERE voided_at IS NOT NULL').all();
  assert.equal(rows.length, 2);
  for (const row of rows) { assert.equal(row.void_reason, '重复报价'); assert.equal(row.voided_by, 'alice@example.test'); assert.equal(row.is_finalized, 0); }
  assert.equal(r.sqlite.prepare('SELECT count(*) AS n FROM quotation_history').get().n, 3);
  assert.equal((await call(route, 'PATCH', { action: 'void', ids: [other.id, first.id] }, 'admin@test', 'admin')).status, 409);
  assert.equal((await call(route, 'PATCH', { action: 'void', ids: [other.id] }, 'admin@test', 'admin')).status, 200);
});
