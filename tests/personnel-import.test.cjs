const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRuntime } = require('./support/runtime.cjs');
const headers = ['用户名', '姓名', '密码', '角色', '工号'];
test('spreadsheet imports preserve text passwords and employee numbers and validate all rows', () => {
  const runtime = createRuntime();
  try {
    const { parsePersonnelRows } = runtime.load('lib/personnel-import.ts');
    const parsed = parsePersonnelRows([headers, ['Alice', '小王', '00123456', '核算人员', '0007'], ['', '', '', '', '']], []);
    assert.deepEqual(parsed.errors, []);
    assert.deepEqual(parsed.users[0], { username: 'alice', name: '小王', password: '00123456', role: 'cost_accountant', employeeNo: '0007' });
    assert.ok(parsePersonnelRows([headers, ['Alice', '小王', 'short', '未知', '']], ['alice']).errors.length >= 3);
    assert.ok(parsePersonnelRows([headers, ...Array.from({length:101}, (_,i) => [`a${i}`, '姓名', '12345678', '', ''])], []).errors.length);
    assert.throws(() => parsePersonnelRows([['wrong'], ['a']], []));
  } finally { runtime.close(); }
});
