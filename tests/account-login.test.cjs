const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRuntime } = require('./support/runtime.cjs');
const root = 'app/api/admin/users/route.ts';
test('username migration preserves account keys and blocks duplicates', () => {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE app_users(email TEXT PRIMARY KEY, name TEXT); INSERT INTO app_users VALUES ('old@example.com','Old');");
  db.exec(require('node:fs').readFileSync('drizzle/0027_username_login.sql', 'utf8'));
  assert.equal(db.prepare('SELECT email FROM app_users WHERE username=?').get('old@example.com').email, 'old@example.com');
  assert.throws(() => db.exec("INSERT INTO app_users VALUES ('other','Other','old@example.com')"));
  db.close();
});
test('admin and CEO manage credentials, ordinary users cannot; ownership and hashing survive renaming', async () => {
  const r = createRuntime({ realAuth: true });
  const auth = r.load('lib/auth.ts');
  assert.equal(auth.passwordError('12345678'), '');
  assert.ok(auth.passwordError('12345'));
  const record = await auth.createPasswordRecord('original-pass-123');
  const add = (email, role) => r.sqlite.prepare('INSERT INTO app_users(email,username,name,password_hash,password_salt,role,status,created_at,updated_at) VALUES(?,?,?,?,?,?,\'active\',\'now\',\'now\')').run(email,email,email,record.passwordHash,record.passwordSalt,role);
  add(auth.ADMIN_EMAIL, 'admin'); add('ceo@test', 'ceo'); add('staff@test', 'employee');
  const route = r.load(root);
  const request = async (email, method, payload) => {
    const { token } = await auth.createLoginSession(email);
    return route[method](new Request('https://test/api/admin/users', { method, headers: { cookie: `yifun_session=${token}`, 'content-type': 'application/json' }, body: JSON.stringify(payload) }));
  };
  const users = [{ username: 'Alice', name: 'Alice', password: '12345678' }];
  assert.equal((await request('staff@test', 'POST', { users })).status, 403);
  assert.equal((await request('ceo@test', 'POST', { users })).status, 200);
  const alice = r.sqlite.prepare("SELECT * FROM app_users WHERE username='alice'").get();
  assert.notEqual(alice.password_hash, users[0].password);
  assert.equal((await request(auth.ADMIN_EMAIL, 'POST', { users: [{ username: 'bob', name: 'Bob', password: 'password-123' }, ...users] })).status, 409);
  assert.equal(r.sqlite.prepare("SELECT count(*) AS n FROM app_users WHERE username='bob'").get().n, 0);
  const session = await auth.createLoginSession(alice.email);
  assert.equal((await request('ceo@test', 'PATCH', { email: alice.email, action: 'credentials', username: 'ALICE2', password: '87654321' })).status, 200);
  assert.equal(r.sqlite.prepare('SELECT email FROM app_users WHERE username=?').get('alice2').email, alice.email);
  assert.equal(await auth.getLoginSession(new Request('https://test', { headers: { cookie: `yifun_session=${session.token}` } })), null);
  const login = r.load('app/api/auth/login/route.ts');
  const signIn = (username, password) => login.POST(new Request('https://test', { method: 'POST', body: JSON.stringify({ username, password }) }));
  assert.equal((await signIn('ALICE2', '87654321')).status, 200);
  assert.equal((await signIn('alice', 'new-password-123')).status, 401);
  assert.equal((await request('ceo@test', 'PATCH', { email: alice.email, action: 'credentials', username: auth.ADMIN_EMAIL })).status, 409);
  assert.equal((await request('ceo@test', 'PATCH', { email: auth.ADMIN_EMAIL, action: 'suspend' })).status, 400);
  assert.equal((await request('ceo@test', 'POST', { users: [{ username: 'short', name: 'Short', password: '123' }] })).status, 400);
  r.close();
});
test('all six existing accounts including administrator can rename and reset passwords', async () => {
  const r = createRuntime({ realAuth: true });
  try {
    const auth = r.load('lib/auth.ts');
    const record = await auth.createPasswordRecord('old-pass-123');
    const emails = [auth.ADMIN_EMAIL, 'ceo@test', 'one@test', 'two@test', 'three@test', 'four@test'];
    for (const [index, email] of emails.entries()) r.sqlite.prepare("INSERT INTO app_users(email,username,name,password_hash,password_salt,role,status,created_at,updated_at) VALUES(?,?,?,?,?,?,'active','now','now')").run(email,email,email,record.passwordHash,record.passwordSalt,index === 0 ? 'admin' : index === 1 ? 'ceo' : 'employee');
    const route = r.load('app/api/admin/users/route.ts');
    for (const [index, email] of emails.entries()) {
      const { token } = await auth.createLoginSession('ceo@test');
      const response = await route.PATCH(new Request('https://test', { method: 'PATCH', headers: { cookie: `yifun_session=${token}` }, body: JSON.stringify({ email, action: 'credentials', username: `user${index}`, password: '12345678', name: `姓名${index}`, employeeNo: `000${index}` }) }));
      assert.equal(response.status, 200);
      const user = r.sqlite.prepare('SELECT * FROM app_users WHERE email=?').get(email);
      assert.equal(user.username, `user${index}`);
      assert.equal(user.name, `姓名${index}`);
      assert.equal(user.employee_no, `000${index}`);
      assert.ok(await auth.passwordMatches('12345678', user.password_hash, user.password_salt));
    }
    assert.equal(r.sqlite.prepare('SELECT count(*) AS n FROM app_users').get().n, 6);
  } finally { r.close(); }
});
test('administrator can change own name and employee number without losing session', async () => {
  const r = createRuntime({ realAuth: true });
  try {
    const auth = r.load('lib/auth.ts');
    const password = await auth.createPasswordRecord('12345678');
    await r.db.insert(r.schema.appUsers).values({ email: auth.ADMIN_EMAIL, username: auth.ADMIN_EMAIL, name: 'Administrator', ...password, role: 'admin', status: 'active', createdAt: 'now', updatedAt: 'now' });
    const { token } = await auth.createLoginSession(auth.ADMIN_EMAIL);
    const headers = { cookie: `yifun_session=${token}`, 'content-type': 'application/json' };
    const route = r.load('app/api/admin/users/route.ts');
    const result = await route.PATCH(new Request('https://test', { method: 'PATCH', headers, body: JSON.stringify({ email: auth.ADMIN_EMAIL, action: 'credentials', username: auth.ADMIN_EMAIL, name: 'Winnie Wu', employeeNo: '0001' }) }));
    assert.equal(result.status, 200);
    assert.equal((await result.json()).reauthenticate, false);
    const list = await route.GET(new Request('https://test', { headers }));
    assert.equal(list.status, 200);
    assert.equal((await list.json()).users[0].name, 'Winnie Wu');
    assert.equal((await auth.getLoginSession(new Request('https://test', { headers }))).name, 'Winnie Wu');
    const changed = await route.PATCH(new Request('https://test', { method: 'PATCH', headers, body: JSON.stringify({ email: auth.ADMIN_EMAIL, action: 'credentials', username: 'winnie', name: 'Winnie Wu', employeeNo: '0001' }) }));
    assert.equal((await changed.json()).reauthenticate, true);
    assert.equal(await auth.getLoginSession(new Request('https://test', { headers })), null);
  } finally { r.close(); }
});
