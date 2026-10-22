import assert from "node:assert/strict";
import test from "node:test";
import { createWorker, fixturePassword } from "./support/worker.mjs";

test("built Worker renders, authenticates, persists revisions and protects private R2 files", async t => {
  const { worker, db } = await createWorker();
  t.after(() => worker.dispose());
  const fetch = (path, options = {}) => worker.dispatchFetch("http://localhost" + path, options);
  const html = await fetch("/");
  assert.equal(html.status, 200);
  assert.match(await html.text(), /Yifun Life · 智能报价中心/);
  for (const path of ["catalog", "quotation-history", "ceo-dashboard", "toy-matching-drafts", "quote-template?id=test"]) {
    assert.equal((await fetch("/api/" + path)).status, 401);
  }
  const login = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "alice@example.test", password: fixturePassword }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  assert.equal((await (await fetch("/api/auth/session", { headers: { cookie } })).json()).authenticated, true);
  const post = async (payload) => {
    const response = await fetch("/api/quotation-history", { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(payload) });
    assert.equal(response.status, 201, await response.clone().text());
    return (await response.json()).quotation;
  };
  const payload = { contractNo: "WORKER-TEST", projectName: "Isolated runtime check", snapshot: { version: 1, products: [], cart: {}, includeTax: false } };
  const first = await post(payload);
  const revisions = await Promise.all(Array.from({ length: 4 }, () => post({ ...payload, lineageId: first.lineageId })));
  assert.deepEqual(revisions.map(row => row.contractNo).sort(), ["WORKER-TEST-R02", "WORKER-TEST-R03", "WORKER-TEST-R04", "WORKER-TEST-R05"]);
  const list = (await (await fetch("/api/quotation-history", { headers: { cookie } })).json()).quotations;
  assert.equal(list.find(row => row.isLatest).contractNo, "WORKER-TEST-R05");
  const rows = await db.prepare("SELECT contract_no,snapshot_json FROM quotation_history").all();
  for (const row of rows.results) assert.equal(JSON.parse(row.snapshot_json).contractNo, row.contract_no);
  const patch = async (payload) => fetch("/api/quotation-history", { method: "PATCH", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(payload) });
  assert.equal((await patch({ id: first.id, action: "confirm", finalAmount: 99.95, finalCurrency: "CNY" })).status, 200);
  assert.equal((await patch({ id: revisions[1].id, action: "confirm", finalAmount: 88.88, finalCurrency: "CNY" })).status, 200);
  const confirmed = await db.prepare("SELECT id,final_amount FROM quotation_history WHERE is_finalized=1").all();
  assert.equal(confirmed.results.length, 1);
  assert.equal(confirmed.results[0].id, revisions[1].id);
  assert.equal(confirmed.results[0].final_amount, 88.88);
  assert.equal((await patch({ id: revisions[1].id, action: "void", voidReason: "runtime fixture" })).status, 200);
  assert.equal((await patch({ id: revisions[1].id, action: "confirm", finalAmount: 80, finalCurrency: "CNY" })).status, 409);
  const voids = await (await fetch("/api/quotation-history?voided=1", { headers: { cookie } })).json();
  assert.equal(voids.quotations.length, 1);
  assert.equal(voids.quotations[0].voidReason, "runtime fixture");
  const r2 = await worker.getR2Bucket("PRODUCT_IMAGES");
  await r2.put("catalog/catalog.json", "private fixture", { httpMetadata: { contentType: "application/json" } });
  assert.equal((await fetch("/api/catalog/image?key=catalog/catalog.json")).status, 404);
  const form = new FormData();
  // Ordinary Excel uploads can exceed the framework's 1MB server-action limit.
  const bytes = new Uint8Array(1800 * 1024).fill(37);
  bytes.set([80, 75, 3, 4]);
  form.set("file", new File([bytes], "上海亦玩报价测试.xlsx"));
  const multipart = new Request("http://localhost/api/quote-template", { method: "POST", body: form });
  const upload = await fetch("/api/quote-template", { method: "POST", headers: { cookie, "content-type": multipart.headers.get("content-type") }, body: await multipart.arrayBuffer() });
  assert.equal(upload.status, 201);
  const template = await upload.json();
  const downloaded = await fetch("/api/quote-template?id=" + template.id, { headers: { cookie } });
  assert.deepEqual(new Uint8Array(await downloaded.arrayBuffer()), bytes);
  assert.equal((await fetch("/api/catalog/image?key=quote-templates/" + template.id)).status, 404);
  assert.equal((await fetch("/api/auth/logout", { method: "POST", headers: { cookie } })).status, 200);
  assert.equal((await fetch("/api/quotation-history", { headers: { cookie } })).status, 401);
});

test('employee uploads a full 200MB template in chunks with ownership and size checks', async t => {
  const { worker } = await createWorker();
  t.after(() => worker.dispose());
  const fetch = (path, options = {}) => worker.dispatchFetch('http://localhost' + path, options);
  async function signIn(email) {
    const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: fixturePassword }) });
    return response.headers.get('set-cookie').split(';')[0];
  }
  const cookie = await signIn('alice@example.test');
  const otherCookie = await signIn('bob@example.test');
  const base = '/api/quote-template/upload';
  const json = (method, body, who = cookie) => ({ method, headers: { cookie: who, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await fetch(base, json('POST', { name: 'large.xlsx', size: 200 * 1024 * 1024 + 1 }))).status, 413);
  const start = await fetch(base, json('POST', { name: 'large.xlsx', size: 200 * 1024 * 1024 }));
  assert.equal(start.status, 201);
  const { id, partSize } = await start.json();
  const endpoint = base + '?id=' + id;
  assert.equal((await fetch(endpoint, json('PATCH', { parts: [] }))).status, 400);
  assert.equal((await fetch(endpoint, json('PATCH', { parts: [] }, otherCookie))).status, 404);
  assert.equal((await fetch(endpoint + '&part=1', { method: 'PUT', headers: { cookie }, body: new Uint8Array(5) })).status, 400);
  const bytes = new Uint8Array(partSize).fill(37);
  const parts = [];
  for (let part = 1; part <= 25; part++) {
    const response = await fetch(endpoint + '&part=' + part, { method: 'PUT', headers: { cookie, 'content-length': String(bytes.length) }, body: bytes });
    assert.equal(response.status, 200, await response.clone().text());
    parts.push(await response.json());
  }
  assert.equal((await fetch(endpoint, json('PATCH', { parts }))).status, 201);
  const bucket = await worker.getR2Bucket('PRODUCT_IMAGES');
  const object = await bucket.head('quote-templates/' + id);
  assert.equal(object.size, 200 * 1024 * 1024);
  assert.equal(object.customMetadata.owner, 'alice@example.test');
  assert.equal(await bucket.head('quote-template-uploads/' + id), null);
  assert.equal((await fetch('/api/quote-template?id=' + id, { headers: { cookie: otherCookie } })).status, 404);
  const download = await fetch('/api/quote-template?id=' + id, { headers: { cookie } });
  assert.equal(download.status, 200);
  let total = 0;
  for await (const chunk of download.body) { total += chunk.length; assert.ok(chunk.every(byte => byte === 37)); }
  assert.equal(total, 200 * 1024 * 1024);
});
