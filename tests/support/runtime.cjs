const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { DatabaseSync } = require('node:sqlite');
const ts = require('typescript');
const { drizzle } = require('drizzle-orm/d1');
const { getTableConfig } = require('drizzle-orm/sqlite-core');
const root = path.resolve(__dirname, '../..');
function createRuntime({ realAuth = false } = {}) {
const sqlite = new DatabaseSync(':memory:');
const statement = (sql, params = []) => ({
  bind: (...values) => statement(sql, values),
  async run() { const result = sqlite.prepare(sql).run(...params); return { success: true, meta: { changes: Number(result.changes) } }; },
  async all() { return { success: true, results: sqlite.prepare(sql).all(...params) }; },
  async first() { return sqlite.prepare(sql).get(...params) || null; },
  async raw() { const query = sqlite.prepare(sql); query.setReturnArrays(true); return query.all(...params); },
});
const client = { prepare: sql => statement(sql), async batch(queries) {
  sqlite.exec('BEGIN');
  try { const result = []; for (const query of queries) result.push(await query.run()); sqlite.exec('COMMIT'); return result; }
  catch (error) { sqlite.exec('ROLLBACK'); throw error; }
} };
const modules = new Map();
let db;
const objects = new Map();
const bindings = { DB: client, PRODUCT_IMAGES: {
  async get(key) { const value = objects.get(key); return value ? { ...value, body: new Uint8Array(value.body) } : null; },
  async put(key, body, metadata = {}) { objects.set(key, { body: new Uint8Array(body), ...metadata }); }
} };
function load(relative) {
  const filename = path.resolve(root, relative);
  if (modules.has(filename)) return modules.get(filename);
  const exports = {};
  modules.set(filename, exports);
  const nativeRequire = createRequire(filename);
  const localRequire = name => {
    if (name === 'cloudflare:workers') return { env: bindings };
    if (!realAuth && name.endsWith('/lib/auth')) return { getLoginSession: async request => request.headers.get('x-test-email') ? { email: request.headers.get('x-test-email'), role: request.headers.get('x-test-role') || 'employee' } : null };
    if (name.endsWith('/db')) return { getDb: () => db };
    if (name.startsWith('.')) return load(path.relative(root, path.resolve(path.dirname(filename), name + '.ts')));
    return nativeRequire(name);
  };
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'exports', compiled)(localRequire, exports);
  return exports;
}
const schema = load('db/schema.ts');
for (const table of Object.values(schema)) {
  const config = getTableConfig(table);
  const columns = config.columns.map(column => {
    let result = `"${column.name}" ${column.getSQLType()}`;
    if (column.primary) result += ' PRIMARY KEY';
    if (column.notNull) result += ' NOT NULL';
    if (column.isUnique) result += ' UNIQUE';
    if (column.default !== undefined) {
      const value = column.default;
      result += ' DEFAULT ' + (typeof value === 'string' ? "'" + value.replaceAll("'", "''") + "'" : Number(value));
    }
    return result;
  });
  for (const pk of config.primaryKeys) columns.push(`PRIMARY KEY (${pk.columns.map(c => `"${c.name}"`).join(',')})`);
  sqlite.exec(`CREATE TABLE "${config.name}" (${columns.join(',')})`);
}
db = drizzle(client, { schema });
return { db, sqlite, schema, load, objects, bindings, close: () => sqlite.close() };
}
const request = (payload, email = 'alice@example.test', role = 'employee', method = 'POST', query = '') => new Request('http://review.test/api/review' + query, {
  method, headers: { 'content-type': 'application/json', ...(email ? { 'x-test-email': email, 'x-test-role': role } : {}) }, ...(payload ? { body: JSON.stringify(payload) } : {})
});
const call = async (route, method, payload, email, role, query) => {
  const response = await route[method](request(payload, email, role, method, query));
  const content = await response.text();
  let body; try { body = JSON.parse(content); } catch { body = content; }
  return { status: response.status, body };
};
module.exports = { createRuntime, request, call };
