const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { PDFDocument } = require('pdf-lib');
const templates = require('../lib/trade-templates/templates.json');
const root = path.resolve(__dirname, '..');
const modules = new Map();
function load(relative) {
  const filename = path.resolve(root, relative);
  if (modules.has(filename)) return modules.get(filename);
  const exports = {}; modules.set(filename, exports);
  const localRequire = name => name.startsWith('.') ? load(path.relative(root, path.resolve(path.dirname(filename), name + '.ts'))) : require(name);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  new Function('require', 'exports', compiled)(localRequire, exports);
  return exports;
}
const { makeTradePdf, moneyWords } = load('lib/trade-pdf.ts');
const { tradeTotal, lineCents, tradeError, paymentAmounts, defaultPayments } = load('lib/trade-document.ts');
const font = new Uint8Array(fs.readFileSync(path.join(root, 'public/fonts/NotoSansSC-Trade.ttf')));
const data = { kind: 'equipment-pi', number: 'PI-TEST', date: '2026-10-18', validUntil: '2026-10-25', buyer: 'Example Customer 示例客户', buyerAddress: '100 Example Road, Sydney NSW Australia', buyerContact: 'Example Contact', buyerEmail: 'customer@example.test', buyerPhone: '', sellerContact: 'Sales', sellerEmail: 'sales@hotmail.com', sellerPhone: '', origin: 'Shenzhen', destination: 'Sydney', projectName: 'Test Playground', projectAddress: 'Test Address', description: 'Equipment', items: [{ description: 'Equipment 游乐设备', quantity: 2, price: 2.625, hsCode: '' }], deliveryDays: '60', appendix: 'A', installationOption: '1', guidanceDays: '15', guidanceFee: '3000', installationDays: '30', installationFee: '6000', includedCosts: ['Equipment Cost'] };

test('all four retained templates generate readable-sized PDFs with complete schedule pages', async () => {
  for (const [kind, template] of Object.entries(templates)) {
    if (kind === 'equipment-contract') assert.ok(template.fields.some(field => field.key === 'sellerPhone'));
    const output = await makeTradePdf({ ...data, kind }, template, font);
    assert.ok(output.byteLength < 2500000, kind + ' must fit a Graph mail attachment');
    const pdf = await PDFDocument.load(output);
    assert.equal(pdf.getPageCount(), kind === 'equipment-contract' ? 10 : 2);
    assert.equal(pdf.getTitle(), `PI-TEST - ${kind}`);
  }
});
test('long item schedules paginate without overwriting the template or dropping rows', async () => {
  const items = Array.from({ length: 70 }, (_, i) => ({ description: `Equipment line ${i + 1} — detail specification 游乐设备`, quantity: 2, price: 2.625, hsCode: '' }));
  const output = await makeTradePdf({ ...data, items }, templates['equipment-pi'], font);
  const pdf = await PDFDocument.load(output);
  assert.ok(pdf.getPageCount() >= 5);
  assert.ok(output.byteLength < 2500000);
});
test('unsupported glyphs and overlong fields fail visibly instead of disappearing or clipping', async () => {
  await assert.rejects(makeTradePdf({ ...data, buyer: 'Customer 😀' }, templates['equipment-pi'], font), /字体暂不支持/);
  await assert.rejects(makeTradePdf({ ...data, buyer: 'Customer '.repeat(200) }, templates['equipment-pi'], font), /超出模板空间/);
});
test('fractional unit prices and half-cent lines reconcile to displayed cent totals', () => {
  assert.equal(lineCents({ quantity: 1, price: 1.005 }), 101);
  assert.equal(tradeTotal({ items: [{ quantity: 2, price: 2.625 }, { quantity: 1, price: 1.005 }] }), 6.26);
  assert.equal(moneyWords(12595.67), 'twelve thousand five hundred ninety-five US dollars and 67/100');
});

test('contract installments validate percentages and conditions and reconcile the final cent', async () => {
  const contract = { ...data, kind: 'equipment-contract', tradeTerm: 'FOB', tradePlace: 'Shenzhen, China', payments: [{ percent: 40, condition: 'Deposit within three business days of signing.' }, { percent: 30, condition: 'Upon completion of production, before dispatch.' }, { percent: 30, condition: 'Within seven days after installation and acceptance.' }] };
  assert.equal(tradeError(contract), '');
  assert.deepEqual(paymentAmounts(246.91, contract.payments), [98.76, 74.08, 74.07]);
  assert.deepEqual(paymentAmounts(0.03, Array.from({ length: 5 }, () => ({ percent: 20, condition: 'Test' }))), [0.01, 0, 0.01, 0, 0.01]);
  assert.match(tradeError({ ...contract, payments: [{ percent: 40, condition: 'Deposit' }, { percent: 30, condition: 'Balance' }] }), /100%/);
  assert.match(tradeError({ ...contract, payments: [{ percent: 50, condition: '' }, { percent: 50, condition: 'Balance' }] }), /付款条件/);
  assert.match(tradeError({ ...contract, tradePlace: '' }), /装运港/);
  assert.match(tradeError({ ...contract, signatureRequired: true }), /签名/);
  assert.match(tradeError({ ...contract, sellerSignature: 'invalid' }), /签名/);
  const signature = process.env.TRADE_PDF_QA ? fs.readFileSync(path.join(root, 'tmp/trade-documents/test-signature.png')).toString('base64') : 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const signed = { ...contract, signatureRequired: true, sellerSignature: 'data:image/png;base64,' + signature };
  const output = await makeTradePdf(signed, templates['equipment-contract'], font);
  assert.equal((await PDFDocument.load(output)).getPageCount(), 11);
  assert.ok(output.byteLength < 2500000);
  if (process.env.TRADE_PDF_QA) {
    fs.writeFileSync(path.join(root, 'tmp/trade-documents/contract-40-30-30-fob.pdf'), output);
    fs.writeFileSync(path.join(root, 'tmp/trade-documents/contract-50-50-fob.pdf'), await makeTradePdf({ ...signed, payments: defaultPayments() }, templates['equipment-contract'], font));
    for (const kind of ['equipment-pi', 'equipment-ci', 'design-pi']) fs.writeFileSync(path.join(root, 'tmp/trade-documents/signed-' + kind + '.pdf'), await makeTradePdf({ ...signed, kind }, templates[kind], font));
  }
});

test('email text follows document type and actual contract payment schedule', () => {
  const { tradeEmailMessage } = load('lib/trade-document.ts');
  const emailData = { ...data, items: [{ description: 'Equipment', quantity: 2, price: 2.63, hsCode: '' }], validUntil: '2026-10-25' };
  const pi = tradeEmailMessage(emailData);
  assert.match(pi, /Equipment Proforma Invoice/);
  assert.match(pi, /USD 5\.26/);
  assert.doesNotMatch(pi, /Please sign|100% before commencement/);
  const design = tradeEmailMessage({ ...emailData, kind: 'design-pi' });
  assert.match(design, /Design Fee Proforma Invoice/);
  assert.match(design, /100% before commencement/);
  assert.match(design, /2026-10-25/);
  const ci = tradeEmailMessage({ ...emailData, kind: 'equipment-ci' });
  assert.match(ci, /Equipment Commercial Invoice/);
  assert.doesNotMatch(ci, /arrange payment|Please sign/);
  const contract = tradeEmailMessage({ ...emailData, kind: 'equipment-contract', payments: [{ percent: 30, condition: 'On signing.' }, { percent: 70, condition: 'Before dispatch.' }] });
  assert.match(contract, /30% \(USD 1\.58\): On signing\./);
  assert.match(contract, /70% \(USD 3\.68\): Before dispatch\./);
  assert.match(contract, /please sign and return/);
  assert.doesNotMatch(contract, /50%/);
});
