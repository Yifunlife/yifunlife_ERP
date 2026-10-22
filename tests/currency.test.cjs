const test = require('node:test'), assert = require('node:assert/strict');
const { createRuntime } = require('./support/runtime.cjs');

test('shared USD conversion rounds money and preserves zero and missing prices', t => {
  const r = createRuntime(); t.after(r.close);
  const { usdFromCny } = r.load('lib/currency.ts');
  assert.equal(usdFromCny(660, 6.6), 100);
  assert.equal(usdFromCny(950, 6.6), 143.94);
  assert.equal(usdFromCny(950, 6.7), 141.79);
  assert.equal(usdFromCny(0, 6.6), 0);
  assert.equal(usdFromCny(null, 6.6), null);
  for (const rate of [0, -1, NaN, Infinity]) assert.equal(usdFromCny(950, rate), null);
  for (const price of [-1, NaN, Infinity]) assert.equal(usdFromCny(price, 6.6), null);
});
