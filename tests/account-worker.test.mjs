import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorker, fixturePassword } from './support/worker.mjs';
test('built worker supports username login and CEO account management', async () => {
  const { worker } = await createWorker();
  try {
    const response = await worker.dispatchFetch('https://test/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'ceo@example.test', password: fixturePassword }) });
    assert.equal(response.status, 200);
    const cookie = response.headers.get('set-cookie').split(';')[0];
    const page = await worker.dispatchFetch('https://test/personnel', { headers: { cookie } });
    assert.equal(page.status, 200);
    assert.match(await page.text(), /人员及权限/);
    const users = await worker.dispatchFetch('https://test/api/admin/users', { headers: { cookie } });
    assert.equal(users.status, 200);
    assert.equal((await users.json()).users.length, 4);
    const added = await worker.dispatchFetch('https://test/api/admin/users', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ users: [{ username: 'newstaff', name: 'New staff', employeeNo: '0007', password: '12345678' }] }) });
    assert.equal(added.status, 200);
    const login = await worker.dispatchFetch('https://test/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'newstaff', password: '12345678' }) });
    assert.equal(login.status, 200);
  } finally { await worker.dispose(); }
});
