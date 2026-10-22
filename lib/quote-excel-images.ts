import { strFromU8, strToU8 } from "fflate";

export async function prepareQuoteTemplateImages(files: Record<string, Uint8Array>, worksheetPath: string) {
  let xml = strFromU8(files[worksheetPath]);
  const images = files["xl/cellimages.xml"] ? strFromU8(files["xl/cellimages.xml"]) : "";
  const rels = files["xl/_rels/cellimages.xml.rels"] ? strFromU8(files["xl/_rels/cellimages.xml.rels"]) : "";
  const targets = new Map([...rels.matchAll(/<Relationship\b[^>]*>/g)].map(([tag]) => [tag.match(/\bId="([^"]+)"/)?.[1], tag.match(/\bTarget="([^"]+)"/)?.[1]]));
  const validIds = new Set([...images.matchAll(/<etc:cellImage>[\s\S]*?<\/etc:cellImage>/g)].flatMap(([entry]) => {
    const id = entry.match(/\bname="(ID_[A-F0-9]+)"/i)?.[1];
    const relationship = entry.match(/\br:embed="([^"]+)"/)?.[1];
    const target = targets.get(relationship);
    const path = target?.startsWith("/") ? target.slice(1) : `xl/${target?.replace(/^\.\//, "")}`;
    return id && files[path] ? [id] : [];
  }));
  const links: Array<{ id: string; sku: string; image: string }> = [];
  const decode = (value: string) => value.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  xml = xml.replace(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g, (cell) => {
    const formula = cell.match(/<f\b[^>]*>([\s\S]*?)<\/f>/)?.[1] || "";
    const ref = cell.match(/\br="([A-Z]+\d+)"/)?.[1] || "";
    if (/DISPIMG\(/i.test(formula)) {
      const currentId = formula.match(/ID_[A-F0-9]+/i)?.[0];
      if (currentId && validIds.has(currentId)) return cell;
      const cached = cell.match(/<v>([\s\S]*?)<\/v>/)?.[1] || "";
      const cachedId = /DISPIMG\(/i.test(cached) ? cached.match(/ID_[A-F0-9]+/i)?.[0] : undefined;
      if (!currentId || !cachedId || !validIds.has(cachedId)) throw new Error(`${ref} 图片引用损坏，无法从原表恢复`);
      // Older exports changed digits inside image IDs but retained the original in <v>.
      return cell.replace(/(<f\b[^>]*>)([\s\S]*?)(<\/f>)/, (_all, start, body, end) => start + body.replace(currentId, cachedId) + end);
    }
    const url = decode(formula).match(/^(?:_xlfn\.)?IMAGE\("(https?:\/\/[^\"]+)"/i)?.[1];
    if (url) links.push({ id: ref, sku: ref, image: url });
    return cell;
  });
  const embedded = await embedQuoteImages(files, links);
  return xml.replace(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g, (cell) => {
    const ref = cell.match(/\br="([A-Z]+\d+)"/)?.[1] || "";
    const formula = embedded.get(ref);
    if (!formula) return cell;
    return cell.replace(/(<f\b[^>]*>)[\s\S]*?(<\/f>)/, `$1${formula.slice(1)}$2`)
      .replace(/<v>[\s\S]*?<\/v>/, `<v>${formula}</v>`);
  });
}

// Keep added product pictures inside the workbook, just like the imported pictures.
export async function embedQuoteImages(
  files: Record<string, Uint8Array>,
  products: Array<{ id: string; sku: string; image?: string | null }>,
) {
  const formulas = new Map<string, string>();
  const unique = [...new Map(products.filter((product) => product.image).map((product) => [product.id, product])).values()];
  if (!unique.length) return formulas;
  const imagePath = "xl/cellimages.xml";
  const relsPath = "xl/_rels/cellimages.xml.rels";
  let images = files[imagePath] ? strFromU8(files[imagePath]) : '<etc:cellImages xmlns:etc="http://www.wps.cn/officeDocument/2017/etCustomData" xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"></etc:cellImages>';
  let rels = files[relsPath] ? strFromU8(files[relsPath]) : '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
  let nextId = Math.max(0, ...[...images.matchAll(/<xdr:cNvPr\b[^>]*\bid="(\d+)"/g)].map((match) => Number(match[1]))) + 1;
  for (let offset = 0; offset < unique.length; offset += 4) {
    const batch = await Promise.all(unique.slice(offset, offset + 4).map(async (product) => {
      const response = await fetch(product.image!, { signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`${product.sku} 图片读取失败，请重试`);
      const url = URL.createObjectURL(await response.blob());
      try {
        const image = new Image();
        image.src = url;
        await image.decode();
        const scale = Math.min(1, 360 / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext("2d");
        if (!context) throw new Error("无法处理产品图片");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
        if (!blob) throw new Error(`${product.sku} 图片处理失败`);
        return { product, bytes: new Uint8Array(await blob.arrayBuffer()) };
      } finally {
        URL.revokeObjectURL(url);
      }
    }));
    for (const { product, bytes } of batch) {
      const token = crypto.randomUUID().replaceAll("-", "").toUpperCase();
      const name = `ID_${token}`;
      const relationship = `rIdQuote${token}`;
      const media = `quote-${token}.jpeg`;
      files[`xl/media/${media}`] = bytes;
      images = images.replace('</etc:cellImages>', `<etc:cellImage><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${nextId++}" name="${name}"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="${relationship}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1800000" cy="1800000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic></etc:cellImage></etc:cellImages>`);
      rels = rels.replace('</Relationships>', `<Relationship Id="${relationship}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${media}"/></Relationships>`);
      formulas.set(product.id, `=DISPIMG("${name}",1)`);
    }
  }
  files[imagePath] = strToU8(images);
  files[relsPath] = strToU8(rels);
  let types = strFromU8(files['[Content_Types].xml']);
  if (!/Extension="jpeg"/i.test(types)) types = types.replace('</Types>', '<Default Extension="jpeg" ContentType="image/jpeg"/></Types>');
  if (!types.includes('/xl/cellimages.xml')) types = types.replace('</Types>', '<Override PartName="/xl/cellimages.xml" ContentType="application/vnd.wps-officedocument.cellimage+xml"/></Types>');
  files['[Content_Types].xml'] = strToU8(types);
  const workbookRelsPath = 'xl/_rels/workbook.xml.rels';
  let workbookRels = strFromU8(files[workbookRelsPath]);
  if (!/Type="[^"]*\/cellImage"/.test(workbookRels)) {
    workbookRels = workbookRels.replace('</Relationships>', `<Relationship Id="rIdQuoteImages${crypto.randomUUID().replaceAll('-', '')}" Type="http://www.wps.cn/officeDocument/2020/cellImage" Target="cellimages.xml"/></Relationships>`);
    files[workbookRelsPath] = strToU8(workbookRels);
  }
  return formulas;
}
