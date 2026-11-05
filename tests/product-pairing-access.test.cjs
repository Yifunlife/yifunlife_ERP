const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRuntime } = require('./support/runtime.cjs');

test('only Ge Jingyu gains pairing writes while other administrator actions stay denied', async () => {
  const r = createRuntime({ realAuth: true });
  try {
    const auth = r.load('lib/auth.ts');
    const record = await auth.createPasswordRecord('test-password');
    const add = (username, name, role = 'employee') => {
      const email = `${username}@test`;
      r.sqlite.prepare("INSERT INTO app_users(email,username,name,password_hash,password_salt,role,status,created_at,updated_at) VALUES(?,?,?,?,?,?, 'active','now','now')")
        .run(email, username, name, record.passwordHash, record.passwordSalt, role);
      return email;
    };
    const users = [
      [add('yw052', '葛晶玉'), true],
      [add('yw003', '吴彬'), false],
      [add('yw028', '安振微'), false],
      [add('yw127', '周孟君'), false],
      [add('yw145', '邵飞飞'), false],
      [add('yw188', '何晨曦'), false],
      [add('wrong', '葛晶玉'), false],
      [add('admin', '管理员', 'admin'), true],
    ];
    const route = r.load('app/api/catalog/route.ts');
    for (const [email, allowed] of users) {
      const { token } = await auth.createLoginSession(email);
      const request = (method, payload) => new Request('https://test/api/catalog', {
        method, headers: { cookie: `yifun_session=${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const sessionRequest = new Request('https://test/api/auth/session', { headers: { cookie: `yifun_session=${token}` } });
      const session = await (await r.load('app/api/auth/session/route.ts').GET(sessionRequest)).json();
      assert.equal(session.canManageProductPairing, allowed, email);
      assert.equal((await route.POST(request('POST', { action: 'recommendations', productId: 'source', relatedProducts: [{ relatedProductId: 'toy', quantity: 2 }] }))).status, allowed ? 200 : 403, email);
      if (email === 'yw052@test') {
        assert.equal(session.role, 'employee');
        assert.equal(r.sqlite.prepare("SELECT quantity FROM product_recommendations WHERE product_id='source'").get().quantity, 2);
        for (const action of ['category', 'classifications', 'areaPairingRules', 'catalogImport', 'kitchenPackage', 'organizeToyTiers', 'organizePairedAreas']) {
          assert.equal((await route.POST(request('POST', { action }))).status, 403, action);
        }
        assert.equal((await route.PATCH(request('PATCH', { productId: 'source' }))).status, 403);
        assert.equal((await r.load('app/api/admin/users/route.ts').GET(sessionRequest)).status, 403);
      }
    }
    assert.equal((await route.POST(new Request('https://test/api/catalog', { method: 'POST' }))).status, 403);
  } finally { r.close(); }
});
