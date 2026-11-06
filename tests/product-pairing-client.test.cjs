const test = require('node:test');
const assert = require('node:assert/strict');
const { clientFunction } = require('./support/client.cjs');
const { createRuntime, request } = require('./support/runtime.cjs');

const file = 'app/product-list/product-grid-manager.tsx';
const rows = [
  { id: 'device', productType: '主设备', category2: '厨房区' },
  { id: 'chair', productType: '配套产品', category2: '厨房区' },
  { id: 'toy', productType: '配套玩具', category2: '厨房区' },
  { id: 'hospital-toy', productType: '配套玩具', category2: '医院区' },
  { id: 'accessory-only-device', productType: '主设备', category2: '花店区' },
  { id: 'flower-chair', productType: '配套产品', category2: '花店区' },
  { id: 'airport-chair', productType: '配套产品', category2: '航空区' },
  { id: 'advertisement', productType: '广告类型', category2: '广告区' },
];
const scope = { rows, pairingCategory: '厨房区', useMemo: fn => fn(), pairedArea: area => area };

test('toy matching keeps equipment and accessories on the source side, including areas without toys', () => {
  const toys = clientFunction('pairingToyRows', ['isPairingItem', 'pairingAreaForRow'], scope, file);
  assert.deepEqual(toys.map(row => row.id), ['toy']);
  const areas = clientFunction('simulationCategories', ['isPairingSource', 'pairingAreaForRow'], scope, file);
  assert.deepEqual(areas, ['厨房区', '花店区', '航空区'].sort());
  const sources = clientFunction('pairingAreaSimulationRows', ['isPairingSource', 'pairingAreaForRow'], scope, file);
  assert.deepEqual(sources.map(row => row.id), ['device', 'chair']);
  const airport = clientFunction('pairingAreaSimulationRows', ['isPairingSource', 'pairingAreaForRow'], { ...scope, pairingCategory: '航空区' }, file);
  assert.deepEqual(airport.map(row => row.id), ['airport-chair']);
});

test('multiple classification paths for one SKU do not duplicate pairing rows or toy columns', () => {
  const duplicated = { ...scope, rows: [...rows, rows[0], rows[1], rows[2]] };
  const sources = clientFunction('pairingAreaSimulationRows', ['isPairingSource', 'pairingAreaForRow'], duplicated, file);
  const toys = clientFunction('pairingToyRows', ['isPairingItem', 'pairingAreaForRow'], duplicated, file);
  assert.deepEqual(sources.map(row => row.id), ['device', 'chair']);
  assert.deepEqual(toys.map(row => row.id), ['toy']);
});

test('saving and clearing the toy matrix preserves hidden equipment accessories and other pairings', async t => {
  const runtime = createRuntime();
  t.after(runtime.close);
  const route = runtime.load('app/api/catalog/route.ts');
  const relations = [
    { productId: 'device', relatedProductId: 'chair', quantity: 2 },
    { productId: 'device', relatedProductId: 'toy', quantity: 3 },
    { productId: 'device', relatedProductId: 'hospital-toy', quantity: 4 },
    { productId: 'other-device', relatedProductId: 'toy', quantity: 7 },
  ];
  await runtime.db.insert(runtime.schema.productRecommendations).values(relations);
  for (const quantity of [5, 0]) {
    const save = clientFunction('savePairingMatrix', [], {
      relations, pairingAreaSimulationRows: [rows[0]], pairingToyRows: [rows[2]],
      pairingMatrix: { device: { toy: quantity } },
      setPairingSaving() {}, setPairingSavedMessage() {}, setLoginRequired() {}, load: async () => {},
      fetch: async (_, options) => route.POST(request(JSON.parse(options.body), 'admin@example.test', 'admin')),
    }, file);
    await save();
    const saved = runtime.sqlite.prepare('SELECT product_id, related_product_id, quantity FROM product_recommendations ORDER BY product_id, related_product_id').all();
    assert.deepEqual(saved.map(row => ({ ...row })), [
      { product_id: 'device', related_product_id: 'chair', quantity: 2 },
      { product_id: 'device', related_product_id: 'hospital-toy', quantity: 4 },
      ...(quantity ? [{ product_id: 'device', related_product_id: 'toy', quantity }] : []),
      { product_id: 'other-device', related_product_id: 'toy', quantity: 7 },
    ]);
  }
});
