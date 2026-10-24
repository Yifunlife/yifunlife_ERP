const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const zip = require('fflate');
const {createRuntime} = require('./support/runtime.cjs');
const runtime = createRuntime();
const {clearQuoteFeeSequenceErrors, repairQuoteSectionLayout, formatQuoteWorkbook} = runtime.load('lib/quote-excel-layout.ts');
runtime.close();

test('fee serial repair removes only broken references, including cached dependent errors', () => {
  const xml = '<row r="20"><c r="A20" s="3" t="e"><f>#REF!+1</f><v>23</v></c><c r="N20"><f>SUM(N2:N19)</f><v>123.45</v></c></row>' +
    '<row r="21"><c r="A21" s="3" t="e"><f>A20+1</f><v>#REF!</v></c></row>' +
    '<row r="22"><c r="A22"><f>A19+1</f><v>5</v></c></row><c r="A23" t="e"><v>7</v></c>' +
    '<c r="B20" t="e"><f>#REF!+1</f><v>23</v></c><c r="A19" t="e"><v>23</v></c>';
  const after = clearQuoteFeeSequenceErrors(xml, 0, [20,21,22,23]);
  assert.equal(after, xml.replace('<c r="A20" s="3" t="e"><f>#REF!+1</f><v>23</v></c>', '<c r="A20" s="3"/>').replace('<c r="A21" s="3" t="e"><f>A20+1</f><v>#REF!</v></c>', '<c r="A21" s="3"/>'));
  assert.equal(clearQuoteFeeSequenceErrors(xml, -1, [20]), xml);
});

function sectionFixture() {
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([['序号', '款号', '名称'], ['奶茶区'], [1,'SKU','奶茶长椅']]);
  XLSX.utils.book_append_sheet(book, sheet, 'Quote');
  const files = zip.unzipSync(XLSX.write(book, {type:'buffer',bookType:'xlsx'}));
  files['xl/styles.xml'] = zip.strToU8('<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="12"/><name val="宋体"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFE5D5"/></patternFill></fill></fills><borders count="1"><border/></borders><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="2" borderId="0"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0"/></cellXfs></styleSheet>');
  let xml = zip.strFromU8(files['xl/worksheets/sheet1.xml']);
  xml = xml.replace(/<row r="2">[\s\S]*?<\/row>/, '<row r="2" ht="127"><c r="A2" s="0" t="str"><v>奶茶区</v></c><c r="B2" s="0"/><c r="C2" s="0"/><c r="D2" s="1"><f>H2*K2</f><v>0</v></c><c r="E2" s="0"/></row>');
  return {files, sheet, xml};
}
test('section titles merge through blanks, never over formulas or existing subtotal merges', () => {
  const {files,sheet,xml} = sectionFixture();
  sheet.D2={t:'n',v:0,f:'H2*K2'};
  const result = repairQuoteSectionLayout(files, xml.replace('<f>H2*K2</f>','<f t="shared" si="2"/>'), sheet, new Set([3]), 1, 2, 4);
  assert.match(result, /ref="A2:C2"/);assert.match(result, /ht="42"/);
  assert.match(result, /<f>H2\*K2<\/f><v>0<\/v>/);
  const style = result.match(/r="D2"[^>]*s="(\d+)"/)[1];
  const styles = zip.strFromU8(files['xl/styles.xml']).match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)[1].match(/<xf[^>]*\/>/g);
  assert.match(styles[style], /fillId="2"/);assert.match(styles[style], /numFmtId="4"/);
  assert.equal(result.match(/<row r="3">[\s\S]*?<\/row>/)[0], xml.match(/<row r="3">[\s\S]*?<\/row>/)[0]);
  assert.equal(repairQuoteSectionLayout(files,result,sheet,new Set([3]),1,2,4),result);
  assert.equal(repairQuoteSectionLayout(files,xml,sheet,new Set([2,3]),1,2,4),xml);
});

test('consistent typography keeps amounts, formulas, media, rich text and revision emphasis', () => {
  const sheet = XLSX.utils.aoa_to_sheet([['Header'],['长文字 Long description requiring several lines'],[2,12.34]]);
  sheet.B3.f = 'A3*6.17'; sheet['!cols']=[{wch:12},{wch:12}];sheet['!rows']=[{hpt:20},{hpt:70},{hpt:70}];
  const book=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book,sheet,'Quote');
  const files=zip.unzipSync(XLSX.write(book,{type:'buffer',bookType:'xlsx'}));
  files['xl/media/image1.png']=new Uint8Array([1,2,3]);files['xl/_rels/cellimages.xml.rels']=zip.strToU8('preserve');
  let styles=zip.strFromU8(files['xl/styles.xml']);styles=styles.replace('<font>', '<font><b/><strike/>').replace('<cellXfs count="1">','<cellXfs count="1">');
  files['xl/styles.xml']=zip.strToU8(styles);
  files['xl/worksheets/sheet1.xml']=zip.strToU8(zip.strFromU8(files['xl/worksheets/sheet1.xml']).replace('<t>Header</t>', '<r><rPr><sz val="18"/><rFont val="Other"/><b/></rPr><t>Header</t></r>'));
  const source=zip.zipSync(files),original=Buffer.from(source);
  const out=zip.unzipSync(new Uint8Array(formatQuoteWorkbook(source.buffer)));
  assert.deepEqual(Buffer.from(source),original);
  assert.deepEqual(out['xl/media/image1.png'],files['xl/media/image1.png']);assert.deepEqual(out['xl/_rels/cellimages.xml.rels'],files['xl/_rels/cellimages.xml.rels']);
  const s=zip.strFromU8(out['xl/styles.xml']);assert.match(s, /<name val="微软雅黑"\/><sz val="11"/);assert.match(s, /<b\/><strike\/>/);
  const result=XLSX.read(zip.zipSync(out),{type:'array',cellStyles:true}).Sheets.Quote;
  assert.equal(result.A2.v,sheet.A2.v);assert.equal(result.B3.v,12.34);assert.equal(result.B3.f,'A3*6.17');assert.ok(result['!rows'][1].hpt>=70);
});

test('section repair keeps shared masters for other rows and does not overwrite subtotal merges', () => {
  const {files,sheet,xml}=sectionFixture();
  sheet.D2={t:'n',v:0,f:'H2*K2'};
  const source=xml.replace('<f>H2*K2</f>','<f t="shared" si="2" ref="D2:D4">H2*K2</f>').replace('</worksheet>','<mergeCells count="1"><mergeCell ref="D2:E2"/></mergeCells></worksheet>');
  const out=repairQuoteSectionLayout(files,source,sheet,new Set([3]),1,2,4);
  assert.match(out, /<f t="shared" si="2" ref="D2:D4">H2\*K2<\/f>/);
  assert.match(out, /ref="D2:E2"/);assert.match(out, /ref="A2:C2"/);
});

test('off-table notes and numeric footer links do not stretch the quotation title rows', () => {
  const sheet=XLSX.utils.aoa_to_sheet([['Title','','',''],['','','','Very long internal note '.repeat(40)],['No','SKU','Name',123],[1,'X','Product']]);
  sheet.D3.f='A4';sheet['!rows']=[{hpt:30},{hpt:20},{hpt:30},{hpt:70}];
  const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,sheet,'Quote');
  const result=XLSX.read(formatQuoteWorkbook(XLSX.write(book,{type:'array',bookType:'xlsx'})),{type:'array',cellStyles:true}).Sheets.Quote;
  assert.equal(result['!rows'][1].hpt,20);assert.equal(result.D2.v,sheet.D2.v);assert.equal(result.D3.f,'A4');
});
