import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorker, fixturePassword } from './support/worker.mjs';

test('built worker authorizes Ge Jingyu pairing saves and identifies expired login separately', async () => {
  const { worker, db } = await createWorker();
  try {
    await db.prepare("UPDATE app_users SET username='yw052',name='葛晶玉' WHERE email='alice@example.test'").run();
    const login = await worker.dispatchFetch('https://test/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'yw052', password: fixturePassword }),
    });
    assert.equal(login.status, 200);
    assert.equal((await login.json()).canManageProductPairing, true);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const session = await worker.dispatchFetch('https://test/api/auth/session', { headers: { cookie } });
    assert.equal((await session.json()).canManageProductPairing, true);
    const save = () => worker.dispatchFetch('https://test/api/catalog', {
      method: 'POST', headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'recommendations', productId: 'source', relatedProducts: [{ relatedProductId: 'toy', quantity: 3 }] }),
    });
    assert.equal((await save()).status, 200);
    assert.equal((await db.prepare("SELECT quantity FROM product_recommendations WHERE product_id='source'").first()).quantity, 3);
    await db.prepare("UPDATE login_sessions SET expires_at='2000-01-01T00:00:00.000Z'").run();
    assert.equal((await save()).status, 401);
  } finally { await worker.dispose(); }
});
