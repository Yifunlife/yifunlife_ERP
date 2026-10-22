const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PDFDocument } = require('pdf-lib');
const { createRuntime, request } = require('./support/runtime.cjs');

const data = { kind: 'equipment-pi', number: 'PI-TEST', date: '2026-10-18', buyer: 'Example Customer', buyerAddress: 'Example Address', buyerContact: 'Example Contact', buyerEmail: 'customer@example.test', sellerContact: 'Sales', sellerEmail: 'sales@hotmail.com', description: 'Equipment', items: [{ description: 'Equipment', quantity: 2, price: 123.45, hsCode: '' }], includedCosts: [] };
function runtime(t) {
  const r = createRuntime();
  // Exercise the document workflow independently of the temporary template withdrawal.
  r.load("lib/trade-document.ts").tradeTemplatesAvailable = true;
  r.sqlite.exec(fs.readFileSync('drizzle/0026_trade_documents.sql', 'utf8'));
  const get = r.bindings.PRODUCT_IMAGES.get;
  r.bindings.PRODUCT_IMAGES.get = async key => { const object = await get(key); return object ? { ...object, arrayBuffer: async () => object.body.buffer } : null; };
  t.after(r.close);
  return r;
}
function req(body, owner = 'alice@example.test', method = 'POST', query = '') {
  const r = request(body, owner, 'employee', method, query);
  r.headers.set('origin', 'http://review.test');
  return r;
}
async function prepare(r, owner = 'alice@example.test') {
  const pdf = await PDFDocument.create(); pdf.addPage();
  const bytes = await pdf.save();
  const response = await r.load('app/api/trade-documents/route.ts').POST(req({ data, recipient: data.buyerEmail, subject: 'For review', message: 'Please review the attached PDF.', pdf: Buffer.from(bytes).toString('base64') }, owner));
  assert.equal(response.status, 201);
  return response.json();
}
function configure(r) {
  Object.assign(r.bindings, { MICROSOFT_CLIENT_ID: 'test-client', MAIL_TOKEN_KEY: Buffer.alloc(32, 7).toString('base64') });
}
async function connect(r, owner = 'alice@example.test') {
  configure(r);
  const hotmail = r.load('lib/hotmail.ts');
  r.sqlite.prepare('INSERT INTO mail_connections VALUES (?, ?, ?, ?, ?)').run(owner, 'provider-' + owner, 'sales@hotmail.com', await hotmail.encryptToken('test-refresh', owner), new Date().toISOString());
}
function mockFetch(t, send) {
  const original = global.fetch;
  global.fetch = async (url, init) => {
    if (String(url).endsWith('/token')) return Response.json({ access_token: 'test-access', refresh_token: 'test-refreshed' });
    return send(url, init);
  };
  t.after(() => { global.fetch = original; });
}

test('PDFs and source data are readable only by the employee who created them', async t => {
  const r = runtime(t), saved = await prepare(r), route = r.load('app/api/trade-documents/route.ts');
  assert.equal((await route.GET(req(null, '', 'GET', '?id=' + saved.id))).status, 401);
  assert.equal((await route.GET(req(null, 'bob@example.test', 'GET', '?id=' + saved.id))).status, 404);
  assert.equal((await route.GET(req(null, 'bob@example.test', 'GET', '?id=' + saved.id + '&details=1'))).status, 404);
  const own = await route.GET(req(null, undefined, 'GET', '?id=' + saved.id));
  assert.equal(own.status, 200); assert.equal(own.headers.get('content-type'), 'application/pdf');
  assert.equal(Buffer.from(await own.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
  const rows = await (await route.GET(req(null, 'bob@example.test', 'GET'))).json();
  assert.deepEqual(rows.documents, []);
});
test('generation rejects invalid amounts, recipients, non-PDFs, and cross-origin writes', async t => {
  const r = runtime(t), route = r.load('app/api/trade-documents/route.ts');
  const cross = req({}); cross.headers.set('origin', 'https://other.test');
  assert.equal((await route.POST(cross)).status, 403);
  for (const payload of [
    { data: { ...data, items: [{ description: 'Bad', quantity: -1, price: 5 }] } },
    { data, recipient: 'invalid' },
    { data, recipient: data.buyerEmail, subject: 'Review', message: 'Review', pdf: Buffer.from('not a PDF').toString('base64') },
  ]) assert.equal((await route.POST(req(payload))).status, 400);
});
test('send requires review hash, confirmed flag, own mailbox, and unchanged sender', async t => {
  const r = runtime(t), saved = await prepare(r), route = r.load('app/api/trade-documents/send/route.ts');
  assert.equal((await route.POST(req({ id: saved.id, hash: saved.hash, confirmed: true }, 'bob@example.test'))).status, 404);
  assert.equal((await route.POST(req({ id: saved.id, hash: saved.hash }))).status, 409);
  assert.equal((await route.POST(req({ id: saved.id, hash: 'wrong', confirmed: true }))).status, 409);
  assert.equal((await route.POST(req({ id: saved.id, hash: saved.hash, confirmed: true }))).status, 409);
  await connect(r); mockFetch(t, () => { throw new Error('should not send'); });
  assert.equal((await route.POST(req({ id: saved.id, hash: saved.hash, confirmed: true, sender: 'other@hotmail.com' }))).status, 409);
});
test('duplicate clicks send exactly one reviewed PDF and retain the sent-mail copy', async t => {
  const r = runtime(t), saved = await prepare(r), route = r.load('app/api/trade-documents/send/route.ts');
  await connect(r);
  let calls = 0;
  mockFetch(t, (url, init) => {
    assert.equal(url, 'https://graph.microsoft.com/v1.0/me/sendMail');
    const body = JSON.parse(init.body); calls++;
    assert.equal(body.saveToSentItems, true);
    assert.equal(body.message.toRecipients[0].emailAddress.address, data.buyerEmail);
    assert.equal(body.message.attachments.length, 1);
    assert.equal(body.message.attachments[0].contentType, 'application/pdf');
    assert.equal(Buffer.from(body.message.attachments[0].contentBytes, 'base64').subarray(0, 5).toString(), '%PDF-');
    assert.ok(body.message.attachments[0].name.endsWith('.pdf'));
    return new Response(null, { status: 202 });
  });
  const payload = { id: saved.id, hash: saved.hash, confirmed: true, sender: 'sales@hotmail.com' };
  const responses = await Promise.all([route.POST(req(payload)), route.POST(req(payload))]);
  assert.deepEqual(responses.map(response => response.status).sort(), [202, 409]);
  assert.equal(calls, 1);
  assert.equal(r.sqlite.prepare('SELECT status FROM trade_documents').get().status, 'accepted');
  assert.equal((await route.POST(req(payload))).status, 409);
});
test('network ambiguity and server errors never cause an automatic resend', async t => {
  const r = runtime(t), saved = await prepare(r), route = r.load('app/api/trade-documents/send/route.ts');
  await connect(r); let calls = 0;
  mockFetch(t, () => { calls++; throw new Error('connection lost after request'); });
  const payload = { id: saved.id, hash: saved.hash, confirmed: true, sender: 'sales@hotmail.com' };
  assert.equal((await route.POST(req(payload))).status, 502);
  assert.equal(r.sqlite.prepare('SELECT status FROM trade_documents').get().status, 'uncertain');
  assert.equal((await route.POST(req(payload))).status, 409); assert.equal(calls, 1);
});
test('device authorization keeps codes private, isolates employees, throttles polling, and encrypts refresh tokens', async t => {
  const r = runtime(t); configure(r); const hotmail = r.load('lib/hotmail.ts');
  let tokenCalls = 0;
  const original = global.fetch; t.after(() => { global.fetch = original; });
  global.fetch = async (url, init) => {
    if (String(url).endsWith('/devicecode')) {
      assert.ok(String(url).includes('/consumers/'));
      const params = new URLSearchParams(init.body);
      assert.ok(params.get('scope').includes('Mail.Send'));
      assert.ok(!params.get('scope').includes('Mail.Read'));
      return Response.json({ device_code: 'private-device-code', user_code: 'ABCD-EFGH', verification_uri: 'https://microsoft.com/devicelogin', expires_in: 900, interval: 5 });
    }
    if (String(url).endsWith('/token')) {
      tokenCalls++;
      assert.equal(new URLSearchParams(init.body).get('device_code'), 'private-device-code');
      return Response.json({ access_token: 'access', refresh_token: 'very-private-refresh-token', scope: 'User.Read Mail.Send' });
    }
    return Response.json({ id: 'microsoft-user', mail: 'sales@hotmail.com' });
  };
  const device = await hotmail.beginDeviceAuthorization('alice@example.test');
  assert.equal(device.userCode, 'ABCD-EFGH'); assert.equal(device.device_code, undefined);
  assert.ok(!r.sqlite.prepare('SELECT verifier FROM mail_oauth_states').get().verifier.includes('private-device-code'));
  await assert.rejects(hotmail.pollDeviceAuthorization('bob@example.test', device.state));
  assert.equal((await hotmail.pollDeviceAuthorization('alice@example.test', device.state)).status, 'pending');
  assert.equal(tokenCalls, 0);
  r.sqlite.exec('UPDATE mail_oauth_states SET next_poll_at = 0');
  const result = await hotmail.pollDeviceAuthorization('alice@example.test', device.state);
  assert.equal(result.status, 'connected');
  assert.equal(tokenCalls, 1);
  const row = r.sqlite.prepare('SELECT * FROM mail_connections').get();
  assert.ok(!row.refresh_token.includes('very-private'));
  await assert.rejects(hotmail.pollDeviceAuthorization('alice@example.test', device.state));
  const status = await (await r.load('app/api/hotmail/route.ts').GET(req(null, undefined, 'GET'))).json();
  assert.deepEqual(Object.keys(status.connection).sort(), ['address', 'connected_at']);
});
