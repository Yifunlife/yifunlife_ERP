const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRuntime, request } = require('./support/runtime.cjs');
const { clientFunction } = require('./support/client.cjs');
const fixture = require('./fixtures/catalog-corrections-20261106.json');
const corrections = require('../scripts/catalog-corrections-20261106.json');
const sql = fs.readFileSync(path.join(__dirname, '../scripts/catalog-corrections-20261106.sql'), 'utf8');

function seed(runtime) {
  for (const [table, records] of Object.entries(fixture)) {
    for (const row of records) {
      const columns = Object.keys(row);
      runtime.sqlite.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...Object.values(row));
    }
  }
  runtime.sqlite.exec("UPDATE catalog_products SET price=123, factory_price=100, vip_price=123; UPDATE product_overrides SET cost=60, stock=8");
}

test('confirmed data corrections change only 14 regions and four images; pending SKUs, prices, types and relations survive', t => {
  const runtime = createRuntime(); t.after(runtime.close); seed(runtime);
  const read = table => runtime.sqlite.prepare(`SELECT * FROM ${table} ORDER BY ${table === 'product_overrides' ? 'product_id' : table === 'product_tags' ? 'product_id,tag' : 'id'}`).all();
  const before = Object.fromEntries(Object.keys(fixture).map(table => [table, read(table)]));
  runtime.sqlite.exec("INSERT INTO product_recommendations VALUES ('junior-Y10341','junior-Y10444',2)");
  runtime.sqlite.exec(sql);
  const areas = new Map(corrections.areas.map(item => [item.productId, item]));
  const images = new Map(corrections.images.map(item => [item.productId, item]));
  assert.equal(areas.size, 14); assert.equal(images.size, 4);
  for (const row of read('catalog_products')) {
    const old = before.catalog_products.find(item => item.id === row.id);
    assert.deepEqual({ ...row }, { ...old, category: areas.get(row.id)?.area ?? old.category, image_key: images.get(row.id)?.key ?? old.image_key });
  }
  for (const row of read('product_classifications')) {
    const old = before.product_classifications.find(item => item.id === row.id);
    const correction = areas.get(row.product_id);
    assert.deepEqual({ ...row, updated_at: old.updated_at }, { ...old, ...(correction ? { level_1: correction.majorCategory, level_3: correction.area } : {}) });
  }
  for (const row of read('product_overrides')) {
    const old = before.product_overrides.find(item => item.product_id === row.product_id);
    const correction = areas.get(row.product_id);
    assert.deepEqual({ ...row, updated_at: old.updated_at }, { ...old, ...(correction ? { major_category: correction.majorCategory, category_2: correction.area } : {}) });
  }
  assert.deepEqual(read('product_tags'), before.product_tags);
  assert.equal(runtime.sqlite.prepare('SELECT quantity FROM product_recommendations').get().quantity, 2);
  const after = Object.fromEntries(Object.keys(fixture).map(table => [table, read(table)]));
  runtime.sqlite.exec(sql);
  assert.deepEqual(Object.fromEntries(Object.keys(fixture).map(table => [table, read(table)])), after, 'reapplying must not overwrite later data or timestamps');
});

test('older quotations keep saved regions, images, prices and amounts after catalogue corrections', async t => {
  const runtime = createRuntime(); t.after(runtime.close); seed(runtime);
  const old = { id: 'junior-Y10341', sku: 'Y10341', name: '原报价花车', category2: '超市区', image: '/api/catalog/image?key=old-image', price: 888, factory: 777, cost: 600, tags: ['主设备'] };
  const snapshot = { version: 1, products: [old], importedProducts: [], cart: { [old.id]: 2 }, priceMode: 'vip', includeTax: false };
  const raw = JSON.stringify(snapshot);
  runtime.sqlite.prepare('INSERT INTO quotation_history(id,contract_no,project_name,created_by,generated_at,snapshot_json) VALUES(?,?,?,?,?,?)').run('old-quote','OLD-R01','历史项目','alice@example.test','2026-11-01',raw);
  const { quoteAmount } = runtime.load('lib/quote-amount.ts');
  const amount = quoteAmount(snapshot);
  const history = runtime.load('app/api/quotation-history/route.ts');
  const getHistory = async () => (await (await history.GET(request(null, 'alice@example.test', 'employee', 'GET', '?id=old-quote'))).json());
  const before = await getHistory();
  runtime.sqlite.exec(sql);
  assert.equal(runtime.sqlite.prepare('SELECT snapshot_json FROM quotation_history').get().snapshot_json, raw);
  assert.deepEqual(await getHistory(), before);
  const current = runtime.sqlite.prepare("SELECT category,image_key FROM catalog_products WHERE id='junior-Y10341'").get();
  const quoteProducts = clientFunction('quoteProducts', [], { products: [{ ...old, category2: current.category, price: 123 }], importedProducts: [], restoredQuoteProducts: snapshot.products });
  assert.deepEqual(quoteProducts, [old], 'restoring history must prefer the saved product over the current catalogue');
  assert.deepEqual(quoteAmount({ ...snapshot, products: quoteProducts }), amount);
});
