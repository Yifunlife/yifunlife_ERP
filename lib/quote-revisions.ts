import {strFromU8, strToU8} from "fflate";
export type QuoteRevision = {status: "deleted" | "added" | "modified" | "customer"; changes: Array<{field: string; before: string; after: string; at: string}>};
export const revisionLabels = {deleted: "删除 / Deleted", added: "新增 / Added", modified: "修改 / Modified", customer: "客户自理 / By Customer"};
export const excludedFromQuote = (product: {revision?: QuoteRevision}) => product.revision?.status === "deleted" || product.revision?.status === "customer";
const escape = (value: unknown) => String(value ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
export function applyQuoteRevisions(files: Record<string, Uint8Array>, path: string, lines: Array<{row: number; product: {sku: string; name: string; revision?: QuoteRevision}}>, columns = {quantity: 7, specification: 5, amounts: [9,11,13]}) {
  const revised = lines.filter(line => line.product.revision);
  if (!revised.length) return;
  let styles = strFromU8(files['xl/styles.xml']);
  const fillCount = Number(styles.match(/<fills\b[^>]*count="(\d+)"/)?.[1]);
  const colors = ['FFFF0000','FF92D050','FF00B0F0','FFFFFF00'];
  styles = styles.replace(/<fills\b([^>]*)>([\s\S]*?)<\/fills>/, (_, attrs, body) => `<fills${attrs.replace(/count="\d+"/, `count="${fillCount+4}"`)}>${body}${colors.map(rgb=>`<fill><patternFill patternType="solid"><fgColor rgb="${rgb}"/><bgColor indexed="64"/></patternFill></fill>`).join('')}</fills>`);
  const originals = styles.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1].match(/<xf\b[^>]*\/>|<xf\b[^>]*>[\s\S]*?<\/xf>/g) || [];
  const extra: string[] = [], mapped = new Map<string,number>();
  const coloredStyle = (id: number, status: QuoteRevision['status']) => {
    const key=`${id}:${status}`; if(mapped.has(key)) return mapped.get(key)!;
    const index=originals.length+extra.length;
    const fill=fillCount+['deleted','added','modified','customer'].indexOf(status);
    let xf=(originals[id] || originals[0] || '<xf numFmtId="0" fontId="0" borderId="0" xfId="0"/>').replace(/\s(?:fillId|applyFill)="[^"]*"/g,'');
    xf=xf.replace(/^<xf\b/,`<xf fillId="${fill}" applyFill="1"`);
    extra.push(xf);mapped.set(key,index);return index;
  };
  let xml=strFromU8(files[path]);
  revised.forEach(({row,product})=>{
    const revision=product.revision!;
    xml=xml.replace(new RegExp(`<row\\b(?=[^>]*\\br="${row}")[^>]*>[\\s\\S]*?<\\/row>`), rowXml=>rowXml.replace(/<c\b[^>]*\/>|<c\b[^>]*>[\s\S]*?<\/c>/g, cell=>{
      const ref=cell.match(/\br="([A-Z]+)\d+"/)?.[1] || '';
      const column=[...ref].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)-1;
      const modified=revision.changes.some(change=>change.field==='数量' && column===columns.quantity || change.field==='规格/尺寸' && column===columns.specification);
      if(revision.status==='modified' && !modified) return cell;
      const id=Number(cell.match(/\bs="(\d+)"/)?.[1] || 0);
      cell=cell.replace(/\s+s="\d+"/,'').replace(/^<c\b/,`<c s="${coloredStyle(id,revision.status)}"`);
      if(excludedFromQuote(product) && columns.amounts.includes(column)) cell=cell.replace(/\s+t="[^"]*"/,'').replace(/(?:\/>|>[\s\S]*?<\/c>)$/, '><f>0</f><v>0</v></c>');
      return cell;
    }));
  });
  styles=styles.replace(/<cellXfs\b([^>]*)>([\s\S]*?)<\/cellXfs>/,(_,attrs,body)=>`<cellXfs${attrs.replace(/count="\d+"/,`count="${originals.length+extra.length}"`)}>${body}${extra.join('')}</cellXfs>`);
  files[path]=strToU8(xml);files['xl/styles.xml']=strToU8(styles);
  const records: unknown[][]=[['产品行','款号','产品名称','状态','字段','修改前','修改后','修改时间','修订数据']];
  revised.forEach(({row,product})=>product.revision!.changes.forEach(change=>records.push([row,product.sku,product.name,revisionLabels[product.revision!.status],change.field,change.before,change.after,change.at,JSON.stringify(product.revision)])));
  files['xl/worksheets/quoteRevisions.xml']=strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="2" width="18" customWidth="1"/><col min="3" max="8" width="30" customWidth="1"/><col min="9" max="9" hidden="1" width="10"/></cols><sheetData>${records.map((cells,r)=>`<row r="${r+1}">${cells.map((v,c)=>`<c r="${String.fromCharCode(65+c)}${r+1}" t="inlineStr"><is><t xml:space="preserve">${escape(v)}</t></is></c>`).join('')}</row>`).join('')}</sheetData></worksheet>`);
  let workbook=strFromU8(files['xl/workbook.xml']);
  if(!workbook.includes('rIdQuoteRevisions')) workbook=workbook.replace('</sheets>',`<sheet name="修改记录" sheetId="${Math.max(...[...workbook.matchAll(/sheetId="(\d+)"/g)].map(m=>Number(m[1])))+1}" r:id="rIdQuoteRevisions"/></sheets>`);
  files['xl/workbook.xml']=strToU8(workbook);
  let rels=strFromU8(files['xl/_rels/workbook.xml.rels']);if(!rels.includes('rIdQuoteRevisions')) rels=rels.replace('</Relationships>','<Relationship Id="rIdQuoteRevisions" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/quoteRevisions.xml"/></Relationships>');files['xl/_rels/workbook.xml.rels']=strToU8(rels);
  let types=strFromU8(files['[Content_Types].xml']);if(!types.includes('/xl/worksheets/quoteRevisions.xml')) types=types.replace('</Types>','<Override PartName="/xl/worksheets/quoteRevisions.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>');files['[Content_Types].xml']=strToU8(types);
}
