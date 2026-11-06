const test = require('node:test');
const assert = require('node:assert/strict');
const { createRuntime } = require('./support/runtime.cjs');
const { clientFunction } = require('./support/client.cjs');

const snapshot = {
  version: 1, projectName: '未保存的项目', contractNo: 'EDIT-R02',
  products: [{ id: 'p1', sku: 'TEST', revision: { status: 'changed', changes: [] } }],
  importedProducts: [{ id: 'p1', price: 123 }], cart: { p1: 7 }, cartPairings: { p1: { toy: 2 } },
  fees: { packaging: 50, shipping: 80 }, designerName: 'Designer', salesName: 'Sales',
};

test('login cookie and server session last seven days, survive 31 minutes, and still expire or revoke', async t => {
  const r = createRuntime({ realAuth: true }); t.after(r.close);
  const auth = r.load('lib/auth.ts');
  const password = await auth.createPasswordRecord('session-fixture');
  for (const email of [auth.ADMIN_EMAIL, 'alice@example.test']) {
    await r.db.insert(r.schema.appUsers).values({ email, username: email, name: email, ...password, role: 'employee', status: 'active', createdAt: 'now', updatedAt: 'now' });
  }
  const start = Date.now();
  t.mock.method(Date, 'now', () => start);
  const response = await r.load('app/api/auth/login/route.ts').POST(new Request('https://test/api/auth/login', {
    method: 'POST', body: JSON.stringify({ username: 'alice@example.test', password: 'session-fixture' }),
  }));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /Max-Age=604800/);
  assert.match(response.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Lax/);
  assert.equal(Date.parse((await response.json()).expiresAt), start + 7 * 24 * 60 * 60 * 1000);
  const request = new Request('https://test', { headers: { cookie: response.headers.get('set-cookie').split(';')[0] } });
  Date.now.mock.mockImplementation(() => start + 31 * 60 * 1000);
  assert.equal((await auth.getLoginSession(request)).email, 'alice@example.test');
  r.sqlite.prepare("UPDATE app_users SET status='suspended' WHERE email='alice@example.test'").run();
  assert.equal(await auth.getLoginSession(request), null);
  r.sqlite.prepare("UPDATE app_users SET status='active' WHERE email='alice@example.test'").run();
  const { token } = await auth.createLoginSession('alice@example.test');
  Date.now.mock.mockImplementation(() => start + (7 * 24 * 60 + 31) * 60 * 1000);
  assert.equal(await auth.getLoginSession(new Request('https://test', { headers: { cookie: 'yifun_session=' + token } })), null);
});

test('expired export opens login and preserves the full editable quote and template', async () => {
  for (const storageFull of [false, true]) {
    const originalTemplate = { current: { source: new ArrayBuffer(8), id: 'template' } };
    const before = structuredClone(snapshot);
    let recovery, required, error, password;
    const requireQuoteLogin = clientFunction('requireQuoteLogin', [], {
      activeQuotationStorageKey: 'alice-draft', quotationHistorySnapshot: () => snapshot,
      recordedQuoteHistoryId: 'history-1', quoteHistoryLineageId: 'lineage-1', quoteHistoryMode: 'edit',
      window: { sessionStorage: { setItem: (key, value) => {
        if (storageFull) throw Error('Storage full');
        assert.equal(key, 'alice-draft:reauth'); recovery = JSON.parse(value);
      } } },
      setLoginPassword: value => { password = value; }, setLoginError: value => { error = value; },
      setReauthenticationRequired: value => { required = value; },
    });
    let saving = [], requests = 0;
    const recordQuoteHistory = clientFunction('recordQuoteHistory', [], {
      workspaceProjectId: '', quoteProject: snapshot.projectName, quoteContractNo: snapshot.contractNo,
      recordedQuoteHistoryId: 'history-1', quoteHistoryLineageId: 'lineage-1', quotationHistorySnapshot: () => snapshot,
      setQuoteHistorySaving: value => saving.push(value), requireQuoteLogin,
      fetch: async (_, options) => {
        requests++; assert.deepEqual(JSON.parse(options.body).snapshot, snapshot);
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
      },
      window: { alert: () => { throw Error('Must display the login dialog instead of an English alert'); } },
    });
    const exportQuoteExcel = clientFunction('exportQuoteExcel', [], { checkCostedQuote: () => true, recordQuoteHistory });
    await exportQuoteExcel();
    assert.equal(requests, 1); assert.deepEqual(saving, [true, false]);
    assert.equal(required, true); assert.equal(error, ''); assert.equal(password, '');
    if (!storageFull) {
      assert.deepEqual(recovery.snapshot, snapshot); assert.equal(recovery.recordedQuoteHistoryId, 'history-1');
      assert.equal(recovery.quoteHistoryLineageId, 'lineage-1'); assert.equal(recovery.quoteHistoryMode, 'edit');
    }
    assert.deepEqual(snapshot, before); assert.equal(originalTemplate.current.source.byteLength, 8);
  }
});

test('relogin keeps current quote on success, failure, and a different account; CEO also stays on quote', async () => {
  for (const scenario of ['success', 'password-error', 'other-account', 'ceo']) {
    let required = true, account, message, signedIn;
    const data = scenario === 'password-error' ? { error: '账户或密码不正确' } : {
      email: scenario === 'other-account' ? 'bob@example.test' : 'alice@example.test',
      role: scenario === 'ceo' ? 'ceo' : 'employee', expiresAt: '2099-01-01', name: 'Alice',
    };
    const login = clientFunction('login', [], {
      reauthenticationRequired: true, authAccount: { email: 'alice@example.test' },
      loginUsername: 'alice', loginPassword: 'fixture', activeQuotationStorageKey: 'alice-draft',
      setLoginError: value => { message = value; }, setLoginNotice: () => {}, setLoginPassword: () => {},
      setAuthAccount: value => { account = value; }, setAuth: value => { signedIn = value; },
      setReauthenticationRequired: value => { required = value; },
      fetch: async () => Response.json(data, { status: scenario === 'password-error' ? 401 : 200 }),
      window: { location: { replace: () => { throw Error('Relogin must not navigate away from the quote'); } }, sessionStorage: { removeItem: () => {} } },
    });
    const before = structuredClone(snapshot);
    await login({ preventDefault() {} });
    if (scenario === 'success' || scenario === 'ceo') {
      assert.equal(required, false); assert.equal(account.email, 'alice@example.test'); assert.equal(signedIn, 'signedIn');
    } else { assert.equal(required, true); assert.equal(account, undefined); assert.ok(message); }
    assert.deepEqual(snapshot, before);
  }
});
