import * as XLSX from "xlsx";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

// Only invalid fee-row serials are removed; amounts and their formulas are untouched.
export function clearQuoteFeeSequenceErrors(xml: string, column: number, rows: number[]) {
  if (column < 0) return xml;
  const refs = new Set(rows.map(row => XLSX.utils.encode_cell({ r: row - 1, c: column })));
  return xml.replace(/<c\b[^>]*\br="([A-Z]+\d+)"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g, (cell, ref) => {
    if (!refs.has(ref) || !(/<f\b[^>]*>[^<]*#REF!/.test(cell) || /\bt="e"/.test(cell) && /<v>(?:23|#REF!)<\/v>/.test(cell))) return cell;
    return cell.replace(/\s+t="[^"]*"/, "").replace(/>[\s\S]*$/, "/>");
  });
}

export function repairQuoteSectionLayout(
  files: Record<string, Uint8Array>, xml: string, sheet: XLSX.WorkSheet,
  productRows: Set<number>, headerRow: number, nameColumn: number, lastColumn: number,
) {
  if (!files["xl/styles.xml"] || nameColumn < 1 || !productRows.size) return xml;
  let styles = strFromU8(files["xl/styles.xml"]);
  const xfs: string[] = styles.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1].match(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g) || [];
  const initialCount = xfs.length;
  const merges = [...xml.matchAll(/<mergeCell\b[^>]*\bref="([^"]+)"/g)].map(match => XLSX.utils.decode_range(match[1]));
  const additions: string[] = [];
  const clones = new Map<string, number>();
  const lastProductRow = Math.max(...productRows);
  xml = xml.replace(/<row\b[^>]*\br="(\d+)"[^>]*>[\s\S]*?<\/row>/g, (rowXml, rowNumber) => {
    const row = Number(rowNumber);
    if (row <= headerRow || row >= lastProductRow || productRows.has(row)) return rowXml;
    const cells = [...rowXml.matchAll(/<c\b[^>]*\br="([A-Z]+)\d+"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)];
    const title = cells.find(cell => {
      const col = XLSX.utils.decode_col(cell[1]);
      const value = sheet[`${cell[1]}${row}`];
      return col < nameColumn && value?.t === "s" && !value.f && String(value.v || "").trim();
    });
    if (!title) return rowXml;
    const start = XLSX.utils.decode_col(title[1]);
    // A section has no product description, quantity, picture or free-text notes.
    if (cells.some(cell => {
      const col = XLSX.utils.decode_col(cell[1]), value = sheet[`${cell[1]}${row}`];
      return col >= nameColumn && col <= lastColumn && value && !value.f && value.v !== undefined && value.v !== "" && value.v !== 0;
    })) return rowXml;
    if (merges.some(merge => merge.s.r <= row - 1 && merge.e.r >= row - 1 && merge.s.c <= start && merge.e.c > start)) return rowXml;
    const titleStyle = xfs[Number(title[0].match(/\bs="(\d+)"/)?.[1] || 0)];
    const fill = titleStyle?.match(/\bfillId="(\d+)"/)?.[1];
    if (!fill || Number(fill) < 2) return rowXml;
    const neighbor = cells.find(cell => XLSX.utils.decode_col(cell[1]) === start + 1);
    const bandStyle = xfs[Number(neighbor?.[0].match(/\bs="(\d+)"/)?.[1] || 0)];
    if (bandStyle?.match(/\bfillId="(\d+)"/)?.[1] !== fill) return rowXml;
    let end = start;
    for (let col = start + 1; col <= lastColumn; col++) {
      const cell = cells.find(cell => XLSX.utils.decode_col(cell[1]) === col);
      if ((cell && /<(?:f|v|is)\b/.test(cell[0])) || merges.some(merge => merge.s.r <= row - 1 && merge.e.r >= row - 1 && merge.s.c <= col && merge.e.c >= col)) break;
      end = col;
    }
    if (end <= start) return rowXml;
    additions.push(XLSX.utils.encode_range({ s: { r: row - 1, c: start }, e: { r: row - 1, c: end } }));
    rowXml = rowXml.replace(/^<row\b[^>]*>/, (tag: string) => tag.replace(/\s+(?:ht|customHeight)="[^"]*"/g, "").replace(/>$/, ' ht="42" customHeight="1">'));
    // Product updates may replace a shared master. Keep section followers explicit for WPS.
    rowXml = rowXml.replace(/<c\b[^>]*\br="([A-Z]+\d+)"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g, (cell: string, ref: string) => {
      const formula = sheet[ref]?.f;
      return formula && /<f\b[^>]*\bt="shared"/.test(cell) && !/<f\b[^>]*\bref=/.test(cell)
        ? cell.replace(/<f\b[^>]*?(?:\/>|>[\s\S]*?<\/f>)/, `<f>${formula.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</f>`)
        : cell;
    });
    // Continue the section band through formula cells without merging over any value.
    return rowXml.replace(/<c\b[^>]*\br="([A-Z]+)\d+"[^>]*>/g, (tag: string, letter: string) => {
      const col = XLSX.utils.decode_col(letter);
      if (col <= start || col >= lastColumn) return tag;
      const style = Number(tag.match(/\bs="(\d+)"/)?.[1] || 0), original = xfs[style];
      if (!original) return tag;
      const border = bandStyle.match(/\bborderId="(\d+)"/)?.[1] || "0";
      const key = `${style}:${fill}:${border}`;
      if (!clones.has(key)) {
        const clone = original.replace(/\bfillId="\d+"/, `fillId="${fill}"`).replace(/\bborderId="\d+"/, `borderId="${border}"`);
        clones.set(key, xfs.length); xfs.push(clone);
      }
      return tag.replace(/\s+s="\d+"/, "").replace(/\/?>$/, ending => ` s="${clones.get(key)}"${ending}`);
    });
  });
  if (xfs.length > initialCount) {
    styles = styles.replace(/<cellXfs\b[^>]*>[\s\S]*?<\/cellXfs>/, `<cellXfs count="${xfs.length}">${xfs.join("")}</cellXfs>`);
    files["xl/styles.xml"] = strToU8(styles);
  }
  if (additions.length) {
    const extra = additions.map(ref => `<mergeCell ref="${ref}"/>`).join("");
    if (/<mergeCells\b/.test(xml)) xml = xml.replace(/<mergeCells\b[^>]*>([\s\S]*?)<\/mergeCells>/, (_, body) => `<mergeCells count="${merges.length + additions.length}">${body}${extra}</mergeCells>`);
    else xml = xml.replace("</sheetData>", `</sheetData><mergeCells count="${additions.length}">${extra}</mergeCells>`);
  }
  return xml;
}

// Format only the exported package; keep every value, formula, image and relationship.
export function formatQuoteWorkbook(source: ArrayBuffer): ArrayBuffer {
  const files = unzipSync(new Uint8Array(source));
  const book = XLSX.read(source, { type: "array", cellStyles: true });
  const font = (body: string, rich = false) => body
    .replace(/<(?:sz|name|rFont|scheme|charset)\b[^>]*\/>/g, "") + `<${rich ? "rFont" : "name"} val="微软雅黑"/><sz val="11"/><charset val="134"/>`;
  if (files["xl/styles.xml"]) {
    let styles = strFromU8(files["xl/styles.xml"]);
    styles = styles.replace(/<font>([\s\S]*?)<\/font>/g, (_, body) => `<font>${font(body)}</font>`)
      .replace(/<alignment\b([^>]*?)\/>/g, (_, attributes) => {
        const attrs = attributes.replace(/\s*(?:vertical|wrapText|shrinkToFit|indent|relativeIndent|justifyLastLine)="[^"]*"/g, "").replace(/horizontal="(?:distributed|justify|fill)"/, 'horizontal="left"');
        return `<alignment${attrs} vertical="center" wrapText="1"/>`;
      });
    files["xl/styles.xml"] = strToU8(styles);
  }
  for (const path of Object.keys(files).filter(path => path === "xl/sharedStrings.xml" || /^xl\/worksheets\/sheet\d+\.xml$/.test(path))) {
    files[path] = strToU8(strFromU8(files[path]).replace(/<rPr>([\s\S]*?)<\/rPr>/g, (_, body) => `<rPr>${font(body, true)}</rPr>`));
  }
  book.SheetNames.forEach((name, index) => {
    const path = `xl/worksheets/sheet${index + 1}.xml`, sheet = book.Sheets[name];
    if (!files[path]) return;
    const heights = new Map<number, number>();
    const header = Object.entries(sheet).find(([ref, cell]) => !ref.startsWith("!") && /款号|item\s*number|^sku$/i.test(String(cell.v || "")));
    const headerRow = header ? XLSX.utils.decode_cell(header[0]).r : -1;
    const lastColumn = header ? Math.max(...Object.entries(sheet).filter(([ref, cell]) => !ref.startsWith("!") && XLSX.utils.decode_cell(ref).r === headerRow && cell.t === "s" && !cell.f && String(cell.v || "").trim()).map(([ref]) => XLSX.utils.decode_cell(ref).c)) : Infinity;
    const imageRows = new Set(Object.entries(sheet).filter(([ref, cell]) => !ref.startsWith("!") && /(?:DISPIMG|IMAGE)\(/i.test(cell.f || "")).map(([ref]) => XLSX.utils.decode_cell(ref).r));
    for (const [ref, cell] of Object.entries(sheet)) {
      if (ref.startsWith("!") || cell.f || cell.t !== "s" || !String(cell.v || "").trim()) continue;
      const pos = XLSX.utils.decode_cell(ref);
      if (pos.c > lastColumn) continue;
      const merge = sheet["!merges"]?.find(range => range.s.r <= pos.r && range.e.r >= pos.r && range.s.c <= pos.c && range.e.c >= pos.c);
      if (merge && (merge.s.r !== pos.r || merge.s.c !== pos.c)) continue;
      let width = 0;
      for (let col = pos.c; col <= (merge?.e.c ?? pos.c); col++) width += (sheet["!cols"]?.[col]?.wpx || 64) * .75;
      const capacity = Math.max(2, (width - 10) / 5.5);
      const lines = String(cell.v).split(/\r?\n/).reduce((sum, line) => sum + Math.max(1, Math.ceil([...line].reduce((length, char) => length + (/[^\x00-\xff]/.test(char) ? 2 : 1), 0) / capacity * 1.1)), 0);
      const span = (merge?.e.r ?? pos.r) - pos.r + 1;
      const current = Array.from({ length: span }, (_, offset) => sheet["!rows"]?.[pos.r + offset]?.hpt || 15).reduce((sum, height) => sum + height, 0);
      const base = sheet["!rows"]?.[pos.r]?.hpt || 15;
      const required = span > 1 ? base + Math.max(0, lines * 15 + 10 - current) : lines * 15 + 10;
      heights.set(pos.r + 1, Math.max(heights.get(pos.r + 1) || 25, imageRows.has(pos.r) ? base : 25, required));
    }
    files[path] = strToU8(strFromU8(files[path]).replace(/<row\b[^>]*\br="(\d+)"[^>]*>/g, (tag, row) => {
      if (/\bhidden="1"/.test(tag) || !heights.has(Number(row))) return tag;
      return tag.replace(/\s+(?:ht|customHeight)="[^"]*"/g, "").replace(/>$/, ` ht="${Math.min(409, Math.ceil(heights.get(Number(row))!))}" customHeight="1">`);
    }));
  });
  return zipSync(files, { level: 6 }).buffer as ArrayBuffer;
}
