const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createRuntime, request } = require('./support/runtime.cjs');
test('retired templates block new generation while employee history remains accessible', async t => {
  const r = createRuntime(); t.after(r.close);
  r.sqlite.exec(fs.readFileSync('drizzle/0026_trade_documents.sql', 'utf8'));
  const route = r.load('app/api/trade-documents/route.ts');
  const response = await route.POST(request({}, 'alice@example.test', 'employee', 'POST'));
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /模板已下架/);
  const history = await route.GET(request(null, 'alice@example.test', 'employee', 'GET'));
  assert.equal(history.status, 200);
  assert.deepEqual((await history.json()).documents, []);
});
