const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const zip = require('fflate');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { clientFunction } = require('./support/client.cjs');
const { createRuntime } = require('./support/runtime.cjs');
const helperRuntime = createRuntime();
const { quotationTotals } = helperRuntime.load('lib/quotation.ts');
const {applyQuoteRevisions, excludedFromQuote, revisionLabels} = helperRuntime.load('lib/quote-revisions.ts');
const { embedQuoteImages, prepareQuoteTemplateImages } = helperRuntime.load('lib/quote-excel-images.ts');
helperRuntime.close();
const helpers = ['formatQuoteCurrencyCells', 'xmlText', 'normalizeTemplateCellOrder', 'restoreTemplatePriceStyles', 'updateTemplateCell', 'updateTemplateFormula', 'templateRow', 'updateTemplateRowCell', 'updateTemplateRowFormula', 'updateTemplateRowTextFormula'];
function fixture(quantity = 1) {
  const worksheet = XLSX.utils.aoa_to_sheet([
    ['SKU', '产品名称', '数量', '人民币单价', '合计金额人民币', '美元单价', '美元合计'],
    ['TEST', 'Test product', quantity, 100, quantity * 100, 20, quantity * 20],
    ['', '包装费', '', '', 50, '', 0],
    ['', '税额', '', '', 0, '', 0],
    ['', '总计含税', '', '', 150, '', 20],
  ]);
  const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, worksheet, 'Review');
  const files = zip.unzipSync(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
  files['xl/media/keep.png'] = new Uint8Array([137, 80, 78, 71]);
  const bytes = zip.zipSync(files);
  const product = { id: 'imported-1', sku: 'TEST', name: 'Test product', price: 100, usd: 20, importSourceRow: 2 };
  const template = { source: bytes.buffer, id: 'fixture', headerRow: 1, totalRow: 5, insertBeforeRow: 3, metadata: {}, feeRows: { packaging: 3, tax: 4 }, columns: { sequence: -1, sku: 0, name: 1, quantity: 2, cnyUnit: 3, cnyAmount: 4, usdUnit: 5, usdAmount: 6, areaSubtotal: -1, image: -1, brand: -1, specification: -1, unit: -1, color: -1, note: -1, volume: -1 } };
  return { bytes, product, template };
}
async function exportFixture(options = {}) {
  const f = options.fixture || fixture();
  let output;
  const ref = { current: { ...f.template, ...(options.remote ? { source: undefined } : {}) } };
  const scope = {
    quoteProducts: [f.product], applyQuoteRevisions, excludedFromQuote, billableQuantity:(p,q)=>excludedFromQuote(p)?0:q,
    authAccount: {role: options.role || "employee"}, XLSX, ...zip, quotationTotals, prepareQuoteTemplateImages, embedQuoteImages: options.embedQuoteImages || embedQuoteImages, quoteImportTemplateRef: ref, importedProducts: [f.product], quoteImportPreview: null,
    cart: { 'imported-1': 1 }, quoteItemsInOrder: [{ product: f.product, quantity: 1, area: 'Area' }, ...(options.items || [])],
    currency: options.currency || 'CNY', fees: { packaging: 50, formaldehyde: 0, shipping: 0, installation: 0, designDeduction: 0, ...options.fees }, includeTax: options.includeTax || false, showDesignDeduction: Boolean(options.deduct),
    designerName: '', salesName: '', needsEnglishTranslation: () => false, englishProductName: p => p.en || '', englishRemark: s => s,
    window: { location: { origin: 'https://example.test' } }, fetch: async () => new Response(f.bytes),
    translateQuoteWorkbook:async source=>source, downloadExcelFile: data => { output = data; },
  };
  const fn = clientFunction('exportImportedQuoteTemplate', helpers, scope);
  assert.equal(await fn('review'), true);
  assert.deepEqual(zip.unzipSync(output)['xl/media/keep.png'], zip.unzipSync(f.bytes)['xl/media/keep.png']);
  return { sheet: XLSX.read(output, { type: 'array' }).Sheets.Review, output, ref };
}

test('deleted and customer-supplied rows are excluded from cached Excel grand totals as well as formulas', async () => {
  for (const status of ['deleted','customer']) {
    const f=fixture();f.product.revision={status,changes:[]};
    const {sheet}=await exportFixture({fixture:f,currency:'USD',fees:{packaging:0}});
    assert.equal(sheet.G2.v,0);assert.equal(sheet.G5.v,0);
    assert.equal(sheet.E2.v,0);assert.equal(sheet.E5.v,50);
    assert.equal(sheet.G2.f,'0');assert.match(sheet.G5.f,/G2/);
  }
});

test('currency formatting preserves cents instead of rounding the displayed Excel total', async()=>{
  const f=fixture();const book=XLSX.read(f.bytes,{type:'array'});
  book.Sheets.Review.G5.z='"$"#,##0';book.Sheets.Review.F2.z='"$"#,##0.0';
  const files=zip.unzipSync(XLSX.write(book,{type:'buffer',bookType:'xlsx'}));files['xl/media/keep.png']=new Uint8Array([137,80,78,71]);
  f.bytes=zip.zipSync(files);f.template.source=f.bytes.buffer;f.product.usd=20.46;
  const {sheet}=await exportFixture({fixture:f,currency:'USD',fees:{packaging:0}});
  assert.equal(sheet.G5.w,'$20.46');assert.equal(sheet.F2.w,'$20.46');
});

test('updating an empty cell preserves the following price, formula and style', () => {
  const row = '<row r="140"><c r="K140" s="25"/><c r="L140" s="26"><f>H140*K140</f><v>255</v></c><c r="M140" s="25"/><c r="N140" s="26"><v>39.375</v></c></row>';
  const update = clientFunction('updateTemplateCell', ['xmlText'], { XLSX });
  const formula = clientFunction('updateTemplateFormula', ['xmlText'], { XLSX });
  const textFormula = clientFunction('updateTemplateRowTextFormula', ['xmlText'], { XLSX });
  for (const changed of [update(row, 'K140', 17), update(row, 'K140', '17'), formula(row, 'K140', '17', 17), textFormula(row, 140, 10, '=DISPIMG("ID_ABC",1)')]) {
    assert.ok(changed.includes('<c r="L140" s="26"><f>H140*K140</f><v>255</v></c>'));
    assert.ok(changed.includes('<c r="M140" s="25"/>'));
    assert.ok(changed.includes('<c r="N140" s="26"><v>39.375</v></c>'));
    assert.equal((changed.match(/<f>H140\*K140<\/f>/g) || []).length, 1);
  }
  assert.ok(update(row, 'K140', 17).includes('<c r="K140" s="25"><v>17</v></c>'));
});

test('cell ordering preserves empty rows, styles and every cell payload', () => {
  const normalize = clientFunction('normalizeTemplateCellOrder', [], { XLSX });
  const xml = '<sheetData><row r="139"/><row r="140" ht="60"><c r="N140"><v>39.375</v></c><c r="K140" s="25"/><c r="M140"><v>2.625</v></c></row></sheetData>';
  const expected = '<sheetData><row r="139"/><row r="140" ht="60"><c r="K140" s="25"/><c r="M140"><v>2.625</v></c><c r="N140"><v>39.375</v></c></row></sheetData>';
  assert.equal(normalize(xml), expected);
  assert.equal(normalize(expected), expected);
});

test('legacy price cells recover missing formatting from the same currency without changing values', () => {
  const restore = clientFunction('restoreTemplatePriceStyles', [], { XLSX });
  const row = '<row r="140"><c r="K140" s="25"><v>17</v></c><c r="L140"><f>H140*K140</f><v>255</v></c><c r="M140"><v>2.625</v></c><c r="N140" s="27"><v>39.375</v></c></row>';
  const fixed = restore(row, new Set([140]), [[10, 11], [12, 13]]);
  assert.equal(fixed.replace(/ s="(?:25|27)"/g, ''), row.replace(/ s="(?:25|27)"/g, ''));
  assert.ok(fixed.includes('<c r="L140" s="25">'));
  assert.ok(fixed.includes('<c r="M140" s="27">'));
  assert.equal(restore(fixed, new Set([140]), [[10, 11], [12, 13]]), fixed);
  assert.equal(restore(row, new Set([141]), [[10, 11], [12, 13]]), row);
});

test('export orders repaired and newly inserted cells without changing their content', async () => {
  const f = fixture();
  const files = zip.unzipSync(f.bytes);
  files['xl/worksheets/sheet1.xml'] = zip.strToU8(zip.strFromU8(files['xl/worksheets/sheet1.xml']).replace(/<row r="2"[^>]*>[\s\S]*?<\/row>/, '<row r="2"><c r="A2" t="inlineStr"><is><t>TEST</t></is></c><c r="G2"><v>20</v></c><c r="D2" s="0"/><c r="B2" t="inlineStr"><is><t>Test product</t></is></c></row>'));
  f.bytes = zip.zipSync(files); f.template.source = f.bytes.buffer;
  const result = await exportFixture({ fixture: f });
  const xml = zip.strFromU8(zip.unzipSync(result.output)['xl/worksheets/sheet1.xml']);
  const row = xml.match(/<row r="2"[^>]*>[\s\S]*?<\/row>/)[0];
  assert.deepEqual([...row.matchAll(/<c\b[^>]*\br="([A-Z]+)2"/g)].map(m => m[1]), ['A', 'B', 'C', 'D', 'E', 'F', 'G']);
  assert.equal(result.sheet.B2.v, 'Test product');
  assert.equal(result.sheet.D2.v, 100);
  assert.equal(result.sheet.F2.v, 20);
});

test('imported Excel totals match fees, tax switch, deductions and currency', async () => {
  let result = await exportFixture();
  assert.equal(result.sheet.E5.v, 150);
  assert.equal(result.sheet.E3.v, 50);
  assert.equal(result.sheet.E4.v, 0);
  result = await exportFixture({ includeTax: true, deduct: true, fees: { designDeduction: 10 } });
  assert.ok(Math.abs(result.sheet.E5.v - 159.5) < 1e-8);
  assert.equal(result.sheet.E4.v, 19.5);
  result = await exportFixture({ currency: 'USD', includeTax: true });
  assert.equal(result.sheet.G5.v, 70);
  assert.equal(result.sheet.G3.v, 50);
  assert.equal(result.sheet.G4.v, 0);
});

test('same SKU added from catalog retains every quantity and different SKU additions survive', async () => {
  const f = fixture();
  for (const sku of ['TEST', 'NEW-SKU']) {
    const result = await exportFixture({ items: [{ product: { ...f.product, id: 'catalog', sku, importSourceRow: undefined }, quantity: 2, area: 'Area' }] });
    const rows = XLSX.utils.sheet_to_json(result.sheet, { header: 1 });
    assert.equal(rows.filter(row => ['TEST', 'NEW-SKU'].includes(row[0])).reduce((sum, row) => sum + row[2], 0), 3);
    assert.equal(result.sheet.E6.v, 350);
  }
});

test('inserting rows does not double-shift cells after a self-closing shared formula', async () => {
  const f = fixture();
  const files = zip.unzipSync(f.bytes);
  files['xl/worksheets/sheet1.xml'] = zip.strToU8(zip.strFromU8(files['xl/worksheets/sheet1.xml']).replace('<c r="A3" t="str"><v></v></c>', '<c r="A3"><f t="shared" si="0"/><v>1</v></c>').replace('<c r="E4"><v>0</v></c>', '<c r="E4"><f>E3*0</f><v>0</v></c>'));
  assert.ok(zip.strFromU8(files['xl/worksheets/sheet1.xml']).includes('<f t="shared"'));
  f.bytes = zip.zipSync(files); f.template.source = f.bytes.buffer;
  const result = await exportFixture({ fixture: f, items: [{ product: { ...f.product, id: 'added', importSourceRow: undefined }, quantity: 2, area: 'Area' }] });
  const xml = zip.strFromU8(zip.unzipSync(result.output)['xl/worksheets/sheet1.xml']);
  for (const match of xml.matchAll(/<row\b[^>]*\br="(\d+)"[^>]*>[\s\S]*?<\/row>/g)) {
    for (const ref of match[0].matchAll(/<c\b[^>]*\br="[A-Z]+(\d+)"/g)) assert.equal(ref[1], match[1]);
  }
});

test('stored template reloads its original bytes and metadata before export', async () => {
  const result = await exportFixture({ remote: true });
  assert.ok(result.ref.current.source instanceof ArrayBuffer);
  assert.equal(result.sheet.E5.v, 150);
  const store = clientFunction('storedQuoteTemplate', [], { quoteImportTemplateRef: result.ref });
  const serialized = JSON.parse(JSON.stringify(store()));
  assert.equal(serialized.id, 'fixture');
  assert.equal(serialized.source, undefined);
  assert.equal(serialized.feeRows.packaging, 3);
});

test('inserting four rows preserves image IDs, URLs and quoted text while moving cell references', () => {
  const shift = clientFunction('shiftReference', [], { insertionRow: 816, addedRowCount: 4 });
  for (const formula of [
    '_xlfn.DISPIMG("ID_3DFEEE1F604F4D2EA202645EA7F64B24",1)',
    '_xlfn.DISPIMG(&quot;ID_A088C2EBC0D64032AA6EEA815F9C0853&quot;,1)',
    'IMAGE("https://example.test/Y40382-699.webp","A900 ""B901""",1)',
  ]) assert.equal(shift(formula), formula);
  assert.equal(shift('SUM(A815:A816,$B$820)+IF(C816="A900",D816,0)'), 'SUM(A815:A820,$B$824)+IF(C820="A900",D820,0)');
  assert.equal(shift("'Area A900'!B816"), "'Area A900'!B820");
});

test('re-export repairs a previously damaged template only from an embedded, resolvable original ID', async () => {
  const original = 'ID_3DFEEE1F604F4D2EA202645EA7F64B24';
  const damaged = 'ID_3DFEEE1F604F4D2EA202649EA7F64B24';
  const files = {
    'xl/cellimages.xml': zip.strToU8(`<etc:cellImages><etc:cellImage><xdr:cNvPr name="${original}"/><a:blip r:embed="rId1"/></etc:cellImage></etc:cellImages>`),
    'xl/_rels/cellimages.xml.rels': zip.strToU8('<Relationships><Relationship Id="rId1" Target="media/original.png"/></Relationships>'),
    'xl/media/original.png': new Uint8Array([137, 80, 78, 71]),
    'xl/worksheets/sheet1.xml': zip.strToU8(`<worksheet><sheetData><row r="5"><c r="C5"/><c r="D5" t="str"><f>_xlfn.DISPIMG("${damaged}",1)</f><v>=DISPIMG("${original}",1)</v></c><c r="K5"><v>76000</v></c></row></sheetData></worksheet>`),
  };
  const xml = await prepareQuoteTemplateImages(files, 'xl/worksheets/sheet1.xml');
  assert.ok(xml.includes(`<f>_xlfn.DISPIMG("${original}",1)</f>`));
  assert.ok(xml.includes('<c r="K5"><v>76000</v></c>'));
  files['xl/worksheets/sheet1.xml'] = zip.strToU8(xml);
  assert.equal(await prepareQuoteTemplateImages(files, 'xl/worksheets/sheet1.xml'), xml);
  delete files['xl/media/original.png'];
  await assert.rejects(prepareQuoteTemplateImages(files, 'xl/worksheets/sheet1.xml'), /D5 图片引用损坏/);
});

test('imported export keeps original image formulas and embeds added images with resolvable relationships', async () => {
  const f = fixture();
  const files = zip.unzipSync(f.bytes);
  const originalFormula = '_xlfn.DISPIMG("ID_3DFEEE1F604F4D2EA202645EA7F64B24",1)';
  files['xl/cellimages.xml'] = zip.strToU8('<etc:cellImages xmlns:etc="http://www.wps.cn/officeDocument/2017/etCustomData" xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><etc:cellImage><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="1" name="ID_3DFEEE1F604F4D2EA202645EA7F64B24"/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId1"/></xdr:blipFill></xdr:pic></etc:cellImage></etc:cellImages>');
  files['xl/_rels/cellimages.xml.rels'] = zip.strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="media/keep.png"/></Relationships>');
  files['xl/worksheets/sheet1.xml'] = zip.strToU8(zip.strFromU8(files['xl/worksheets/sheet1.xml']).replace(/(<row r="2"[^>]*>[\s\S]*?)(<\/row>)/, `$1<c r="H2" t="str"><f>${originalFormula}</f><v>=${originalFormula}</v></c>$2`));
  f.bytes = zip.zipSync(files);
  f.template.source = f.bytes.buffer;
  f.template.columns.image = 7;
  const bytes = Buffer.from('image-fixture');
  const revoked = [];
  const embed = clientFunction('embedQuoteImages', [], {
    ...zip, fetch: async () => new Response(bytes),
    Image: class { naturalWidth = 100; naturalHeight = 80; async decode() {} },
    document: { createElement: () => ({ getContext: () => ({ fillRect() {}, drawImage() {} }), toBlob: done => done(new Blob([bytes], { type: 'image/jpeg' })) }) },
    URL: { createObjectURL: () => 'blob:fixture', revokeObjectURL: url => revoked.push(url) },
  }, 'lib/quote-excel-images.ts');
  const added = { id: 'new-image', sku: 'NEW', name: 'Added image', price: 20, usd: 3, image: 'https://example.test/picture.webp' };
  const result = await exportFixture({ fixture: f, embedQuoteImages: embed, items: [{ product: added, quantity: 1, area: 'Area' }] });
  assert.equal(result.sheet.H2.f.replace('_xlfn.', ''), originalFormula.replace('_xlfn.', ''));
  assert.match(result.sheet.H3.f, /^DISPIMG\("ID_[A-F0-9]+",1\)$/);
  const output = zip.unzipSync(result.output);
  const id = result.sheet.H3.f.match(/ID_[A-F0-9]+/)[0];
  const images = zip.strFromU8(output['xl/cellimages.xml']);
  assert.ok(images.includes(`name="${id}"`));
  const relationship = images.match(new RegExp(`name="${id}"[\\s\\S]*?r:embed="([^"]+)"`))[1];
  const rels = zip.strFromU8(output['xl/_rels/cellimages.xml.rels']);
  assert.ok(rels.includes(`Id="${relationship}"`));
  const media = rels.match(new RegExp(`Id="${relationship}"[^>]*Target="([^"]+)"`))[1];
  assert.deepEqual(Buffer.from(output[`xl/${media}`]), bytes);
  assert.ok(zip.strFromU8(output['xl/_rels/workbook.xml.rels']).includes('Target="cellimages.xml"'));
  assert.ok(zip.strFromU8(output['[Content_Types].xml']).includes('/xl/cellimages.xml'));
  const extract = clientFunction('extractWorkbookImages', ['imageMimeType'], { XLSX });
  assert.ok(extract(result.output).has(id));
  assert.deepEqual(revoked, ['blob:fixture']);
  const failingEmbed = clientFunction('embedQuoteImages', [], { ...zip, fetch: async () => new Response('', { status: 503 }) }, 'lib/quote-excel-images.ts');
  await assert.rejects(failingEmbed(files, [added]), /图片读取失败/);
});

test('zero quantities survive import and failed template upload prevents an incomplete import', async () => {
  for (const fail of [false, true]) {
    const f = fixture(0);
    let preview, error;
    const scope = { costingInputFromRow: (...args) => { const r = createRuntime(); try { return r.load('lib/costing-import.ts').costingInputFromRow(...args); } finally { r.close(); } }, XLSX, quoteImportPriceMode: 'vip', products: [], quoteImportTemplateRef: { current: null }, translateQuoteWorkbook:async source=>source, extractWorkbookImages: () => new Map(),
      setQuoteImporting() {}, setQuoteImportError: value => { error = value; }, setQuoteImportPreview: value => { preview = value; },
      fetch: async url => url === '/api/quote-costing' ? Response.json({ results: [] }) : Response.json(fail ? { error: 'Template upload failed' } : { id: 'fixture' }, { status: fail ? 503 : 201 }),
    };
    const reader = clientFunction('readQuoteImport', ['uploadQuoteTemplate', 'importedSkuCodes', 'importCellText', 'importCellNumber', 'findImportColumn', 'findImportMeta', 'findImportMetaLocation', 'inferImportProjectName'], scope);
    await reader(new File([f.bytes], 'zero.xlsx'));
    if (fail) { assert.equal(preview, null); assert.equal(error, 'Template upload failed'); }
    else { assert.equal(error, ''); assert.equal(preview.rows[0].quantity, 0); assert.equal(scope.quoteImportTemplateRef.current.id, 'fixture'); }
  }
});

test('local draft storage is account-specific and sign-out clears the page context', async () => {
  const key = clientFunction('activeQuotationKey', [], {});
  assert.notEqual(key('alice@example.test'), key('bob@example.test'));
  assert.equal(key('ALICE@example.test'), key('alice@example.test'));
  let destination;
  const logout = clientFunction('logout', [], { fetch: async () => new Response('{}'), window: { location: { assign: value => { destination = value; } } } });
  await logout();
  assert.equal(destination, '/');
});

test('product editor sends explicit changed fields and retains input if the atomic save fails', async () => {
  const editor = { id: 'p1', name: 'Before', price: 100, image: '', volume: '', spec: '10x20', unit: '个', cost: null, branchPrice: null, supplyMethod: '', stock: null, majorCategory: 'A', category1: 'B', category2: 'C', category3: '主设备', colorTag: '蓝', hasScreen: false, isRecommended: false, en: '', classifications: [{ id: 'c1', productId: 'p1', level1: 'A', level2: 'B', level3: 'C' }], relatedIds: ['toy1'] };
  for (const fail of [false, true]) {
    let sent, closed = false, alerted = false;
    const save = clientFunction('save', [], { editor, draft: { ...editor, name: 'After' }, tagDraftText: '主设备', relations: [{ productId: 'p1', relatedProductId: 'toy1', quantity: 5 }], isSpaceTheme: () => false, normalizeColorTag: s => s,
      fetch: async (_url, options) => { sent = JSON.parse(options.body); return Response.json(fail ? { error: 'Save failed' } : { classifications: editor.classifications, tags: ['主设备'] }, { status: fail ? 503 : 200 }); },
      setOverrides() {}, setProductClassifications() {}, setProductTags() {}, setRelations() {}, setEditor: () => { closed = true; }, window: { alert: () => { alerted = true; } },
    });
    await save();
    assert.deepEqual(sent.patch, { name: 'After' });
    assert.equal(sent.relatedProducts[0].quantity, 5);
    assert.equal(closed, !fail);
    assert.equal(alerted, fail);
  }
});

test('currency ledgers keep USD-project costs in CNY and hide costs from non-CEO users', () => {
  const CurrencyLedger = clientFunction('CurrencyLedger', ['formatMoney'], {}, 'app/ceo-dashboard/page.tsx');
  const groups = [{ label: '已确定金额', projects: [{ currency: 'USD', amount: 40, costAmount: 80, hasCost: true }] }];
  const html = renderToStaticMarkup(React.createElement(CurrencyLedger, { currency: 'USD', groups, canViewCosts: true }));
  assert.match(html, /成本 CNY/);
  assert.match(html, /美元毛利待确认汇率/);
  assert.doesNotMatch(html, /-40/);
  const hidden = renderToStaticMarkup(React.createElement(CurrencyLedger, { currency: 'USD', groups, canViewCosts: false }));
  assert.doesNotMatch(hidden, /80|成本|毛利/);
  const incomplete = renderToStaticMarkup(React.createElement(CurrencyLedger, { currency: 'CNY', groups: [{ label: '报价', projects: [{ currency: 'CNY', amount: 100, costAmount: 0, hasCost: false }] }], canViewCosts: true }));
  assert.match(incomplete, /待补充/);
  assert.doesNotMatch(incomplete, /毛利 CNY/);
});

test('employee imports XLS and XLSX through template storage and can reopen both', async () => {
  const runtime = createRuntime();
  const route = runtime.load('app/api/quote-template/route.ts');
  try {
    for (const extension of ['xls', 'xlsx']) {
      const original = fixture(2);
      const bytes = extension === 'xls'
        ? XLSX.write(XLSX.read(original.bytes), { type: 'buffer', bookType: 'biff8' })
        : original.bytes;
      let preview, error, uploaded;
      const scope = { costingInputFromRow: (...args) => { const r = createRuntime(); try { return r.load('lib/costing-import.ts').costingInputFromRow(...args); } finally { r.close(); } }, XLSX, quoteImportPriceMode: 'vip', products: [], quoteImportTemplateRef: { current: null }, translateQuoteWorkbook:async source=>source, extractWorkbookImages: () => new Map(),
        setQuoteImporting() {}, setQuoteImportError: value => { error = value; }, setQuoteImportPreview: value => { preview = value; },
        fetch: async (url, options) => {
          if (url === '/api/quote-costing') return runtime.load('app/api/quote-costing/route.ts').POST(new Request('https://example.test' + url, { method: 'POST', headers: { 'x-test-email': 'employee@example.test' }, body: options.body }));
          uploaded = options.body.get('file');
          return route.POST(new Request('https://example.test' + url, { method: 'POST', headers: { 'x-test-email': 'employee@example.test', 'x-test-role': 'employee' }, body: options.body }));
        },
      };
      const reader = clientFunction('readQuoteImport', ['uploadQuoteTemplate', 'importedSkuCodes', 'importCellText', 'importCellNumber', 'findImportColumn', 'findImportMeta', 'findImportMetaLocation', 'inferImportProjectName'], scope);
      await reader(new File([bytes], 'employee.' + extension));
      assert.equal(error, '');
      assert.equal(preview.rows[0].quantity, 2);
      assert.equal(uploaded.name, 'employee.xlsx');
      const template = scope.quoteImportTemplateRef.current;
      assert.equal(template.fileName, 'employee.xlsx');
      const response = await route.GET(new Request('https://example.test/api/quote-template?id=' + template.id, { headers: { 'x-test-email': 'employee@example.test' } }));
      assert.equal(response.status, 200);
      const stored = new Uint8Array(await response.arrayBuffer());
      const sheet = XLSX.read(stored).Sheets.Review;
      assert.equal(sheet.A2.v, 'TEST');
      assert.equal(sheet.C2.v, 2);
      assert.equal(sheet.E2.v, 200);
      assert.ok(zip.unzipSync(stored)['xl/worksheets/sheet1.xml']);
      if (extension === 'xlsx') assert.deepEqual(Buffer.from(stored), Buffer.from(bytes));
    }
  } finally { runtime.close(); }
});

test('admin CEO and accountant export CNY costs in original templates, including USD quotes',async()=>{for(const role of ['admin','ceo','cost_accountant']){const f=fixture();f.product.cost=734.03;const {sheet}=await exportFixture({fixture:f,role,currency:'USD'});assert.equal(sheet.H1.v,'成本单价（人民币） / Unit Cost (CNY)');assert.equal(sheet.H2.v,734.03);assert.equal(sheet.I2.v,734.03);assert.equal(sheet.I2.f,'C2*H2');}for(const role of ['employee','management']){const f=fixture();f.product.cost=734.03;const {sheet}=await exportFixture({fixture:f,role});assert.equal(sheet.H2,undefined);}});

test('existing hidden cost columns are updated for authorized roles and stripped for others',async()=>{const f=fixture();const w=XLSX.read(f.bytes,{type:'array'});const sh=w.Sheets.Review;sh.H1={t:'s',v:'成本单价'};sh.I1={t:'s',v:'成本合计'};sh.H2={t:'n',v:999};sh.I2={t:'n',v:999};sh.I5={t:'n',v:999};sh['!ref']='A1:I5';sh['!cols']=Array.from({length:9},(_,i)=>({hidden:i>=7}));const files=zip.unzipSync(XLSX.write(w,{type:'buffer',bookType:'xlsx'}));files['xl/media/keep.png']=new Uint8Array([137,80,78,71]);f.bytes=zip.zipSync(files);f.template.source=f.bytes.buffer;f.product.cost=50;const allowed=await exportFixture({fixture:f,role:'cost_accountant'});assert.equal(allowed.sheet.H2.v,50);assert.equal(allowed.sheet.I2.v,50);assert.equal(allowed.sheet.I5.v,50);for(const role of ['employee','management']){const result=await exportFixture({fixture:f,role});assert.equal(result.sheet.H2,undefined);assert.equal(result.sheet.I2,undefined);assert.equal(result.sheet.I5,undefined);}});

test('cost export preserves styled blank cells and adjacent headers and USD values', async () => {
  const f = fixture();
  const w = XLSX.read(f.bytes, {type:'array'});
  const sh = w.Sheets.Review;
  sh.H1 = {t:'s',v:'成本单价'}; sh.I1 = {t:'s',v:'成本合计'}; sh['!ref']='A1:J5';
  const files = zip.unzipSync(XLSX.write(w,{type:'buffer',bookType:'xlsx'}));
  let xml = zip.strFromU8(files['xl/worksheets/sheet1.xml']);
  xml = xml.replace('<c r="H1"', '<c s="0" r="H1"').replace('<c r="I1"', '<c s="0" r="I1"');
  xml = xml.replace(/(<row r="2"[^>]*>)([\s\S]*?)(<\/row>)/, '$1$2<c r="H2" s="0"/><c r="I2" s="0"/><c r="J2" t="inlineStr"><is><t>保留内容</t></is></c>$3');
  files['xl/worksheets/sheet1.xml']=zip.strToU8(xml);
  files['xl/media/keep.png']=new Uint8Array([137,80,78,71]);
  f.bytes=zip.zipSync(files); f.template.source=f.bytes.buffer; f.product.cost=50;
  const result=await exportFixture({fixture:f,role:'ceo'});
  const out=zip.strFromU8(zip.unzipSync(result.output)['xl/worksheets/sheet1.xml']);
  for (const ref of ['H1','I1']) assert.match(out, new RegExp('<c\\b(?=[^>]*r="'+ref+'")[^>]*s="0"'));
  const formatted=XLSX.read(result.output,{type:'array',cellStyles:true}).Sheets.Review;
  assert.equal(formatted.H2.z,'#,##0.00');assert.equal(formatted.I2.z,'#,##0.00');
  assert.equal(result.sheet.J2.v,'保留内容');
  assert.equal(result.sheet.F2.v,20); assert.equal(result.sheet.G2.v,20);
  assert.equal(result.sheet.H2.v,50); assert.equal(result.sheet.I2.v,50);
  assert.equal(result.sheet.H1.v,'成本单价');
});

test('missing USD price clears old instruction text and avoids a text multiplication formula', async () => {
  const f=fixture(); f.product.usd=null;
  const w=XLSX.read(f.bytes,{type:'array'}); w.Sheets.Review.F2={t:'s',v:'若标准品请按核算表报价'};
  const files=zip.unzipSync(XLSX.write(w,{type:'buffer',bookType:'xlsx'}));
  files['xl/media/keep.png']=new Uint8Array([137,80,78,71]);
  f.bytes=zip.zipSync(files);f.template.source=f.bytes.buffer;
  const {sheet}=await exportFixture({fixture:f});
  assert.equal(sheet.F2.v,''); assert.equal(sheet.G2.v,''); assert.equal(sheet.G2.f,undefined);
});


test('18-column source headers and layout stay unchanged for every export role', async () => {
  const headers = ['序号\nNo.', '款号\nItem Number', '产品名称\nProduct Name', '图片展示\nProduct Name', '玩具品牌\nToy Brands', '规格/尺寸\nSpecifications\n/Dimensions', '单位\nUnit', '数量\nQuantity', '成本单价\nRMB', '成本价\nRMB', '单价\nRMB', '合计金额\nRMB', '美元单价\nUnit Price\n(USD)', '美元合计total\n(USD)', '区域小计\nSubtotal\n(USD)', '备注\nNotes\n客户知晓', '材质/工艺做法\n仅内部知晓', '体积\nVolume'];
  const sheet = XLSX.utils.aoa_to_sheet([headers, [1, 'TEST', 'Test product', '', 'Brand', '1*2*3', '套', 1, 999, 999, 100, 100, 20, 20, '', '客户备注', '原始工艺', 6], [], [], ['', '', '总计含税']]);
  sheet['!merges'] = [{s:{r:2,c:0},e:{r:2,c:17}}];
  sheet.A3={t:'s',v:'原表说明，完整保留'};
  sheet['!cols']=headers.map((_,index)=>({wch: index+10}));
  const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,'Review');
  const files=zip.unzipSync(XLSX.write(book,{type:'buffer',bookType:'xlsx'}));files['xl/media/keep.png']=new Uint8Array([137,80,78,71]);
  for(const role of ['admin','ceo','cost_accountant','employee','management']) {
    const f=fixture();f.bytes=zip.zipSync(files);f.product.cost=50;
    f.template={...f.template,source:f.bytes.buffer,feeRows:{},columns:{sequence:0,sku:1,name:2,image:3,brand:4,specification:5,unit:6,quantity:7,cnyUnit:10,cnyAmount:11,usdUnit:12,usdAmount:13,areaSubtotal:14,note:15,material:16,volume:17,color:-1}};
    const result=await exportFixture({fixture:f,role,currency:'USD'});
    assert.deepEqual(headers.map((_,index)=>result.sheet[XLSX.utils.encode_cell({r:0,c:index})]?.v),headers);
    assert.equal(XLSX.utils.decode_range(result.sheet['!ref']).e.c,17);
    assert.equal(result.sheet.A3.v,'原表说明，完整保留');
    assert.equal(result.sheet.P2.v,'客户备注');assert.equal(result.sheet.Q2.v,'原始工艺');
    const xml=zip.strFromU8(zip.unzipSync(result.output)['xl/worksheets/sheet1.xml']);
    const original=zip.strFromU8(files['xl/worksheets/sheet1.xml']);
    for(const tag of ['cols','mergeCells']) assert.equal(xml.match(new RegExp('<'+tag+'\\b[^>]*>[\\s\\S]*?</'+tag+'>'))?.[0],original.match(new RegExp('<'+tag+'\\b[^>]*>[\\s\\S]*?</'+tag+'>'))?.[0]);
    if(['admin','ceo','cost_accountant'].includes(role)){assert.equal(result.sheet.I2.v,50);assert.equal(result.sheet.J2.v,50);}
    else {assert.equal(result.sheet.I2,undefined);assert.equal(result.sheet.J2,undefined);}
  }
});


test('merged source sections and footer instructions stay out of product rows', async () => {
  const sheet=XLSX.utils.aoa_to_sheet([
    ['亦玩集团+地区+品牌名&报价清单'],
    ['序号','款号','产品名称','图片展示','玩具品牌','规格/尺寸','单位','数量','成本单价 RMB','成本价 RMB','单价 RMB','合计金额 RMB','美元单价','美元合计','区域小计','备注','材质/工艺做法','体积'],
    ['', 'XX区'], ['1','TEST1','产品1','','','','套',1],
    ['', 'XX区'], ['2','TEST2','产品2','','','','套',1],
    ['', '公共区'], ['3','TEST3','产品3','','','','套',1],
    ['不够的情况下，请在此行以上插入新行'],
    ['', '', '包装费'], ['', '', '总计（含税）'], ['合计金额（大写）','','0'],
    ['此报价有效期为30天'],
  ]);
  sheet['!merges']=[2,4,6].map(r=>({s:{r,c:1},e:{r,c:13}})).concat([{s:{r:8,c:0},e:{r:8,c:17}}]);
  const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,'Review');
  let preview,error;
  const scope={XLSX,products:[],quoteImportPriceMode:'usd',quoteImportTemplateRef:{current:null},translateQuoteWorkbook:async source=>source,extractWorkbookImages:()=>new Map(),costingInputFromRow:()=>null,setQuoteImporting(){},setQuoteImportError:value=>{error=value;},setQuoteImportPreview:value=>{preview=value;},fetch:async url=>Response.json(url==='/api/quote-costing'?{results:[]}:{id:'fixture'})};
  await clientFunction('readQuoteImport',['uploadQuoteTemplate','importedSkuCodes','importCellText','importCellNumber','findImportColumn','findImportMeta','findImportMetaLocation','inferImportProjectName'],scope)(new File([XLSX.write(book,{type:'buffer',bookType:'xlsx'})],'source.xlsx'));
  assert.equal(error,'');assert.equal(preview.sourceRows,3);
  assert.deepEqual(preview.rows.map(row=>row.product.importArea),['XX区','XX区','公共区']);
  assert.deepEqual(preview.rows.map(row=>row.product.importSection),[2,4,6]);
  assert.deepEqual(preview.rows.map(row=>row.product.importSequence),['1','2','3']);
  assert.deepEqual(scope.quoteImportTemplateRef.current.footerNotes,['此报价有效期为30天']);
});
