import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { paymentAmounts, lineCents, tradeError, tradeTotal, type TradeData } from "./trade-document";

type Overlay = { key: string; rect: number[]; page: number; size: number; text?: string };
type Template = { pdf: string; fields: Overlay[] };
const hkAddress = "Unit 07, 6/F, Tower 1, Silvercord, 30 Canton Road, Tsim Sha Tsui, Kowloon, Hong Kong";
const formatMoney = (value: number) => value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const small = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
function words(value: number): string {
  if (value < 20) return small[value];
  if (value < 100) return `${tens[Math.floor(value / 10)]}${value % 10 ? `-${small[value % 10]}` : ""}`;
  for (const [unit, name] of [[1000000000, "billion"], [1000000, "million"], [1000, "thousand"], [100, "hundred"]] as const)
    if (value >= unit) return `${words(Math.floor(value / unit))} ${name}${value % unit ? ` ${words(value % unit)}` : ""}`;
  return "";
}
export function moneyWords(value: number) {
  const cents = Math.round(value * 100);
  return `${words(Math.floor(cents / 100))} US dollars and ${String(cents % 100).padStart(2, "0")}/100`;
}
function wrap(text: string, font: PDFFont, size: number, width: number) {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const token of paragraph.match(/[\u2e80-\uffff]|[^\s\u2e80-\uffff]+\s*|\s+/gu) || [""]) {
      if (font.widthOfTextAtSize(line + token, size) <= width) { line += token; continue; }
      if (line.trim()) lines.push(line.trimEnd());
      line = "";
      for (const char of token) {
        if (font.widthOfTextAtSize(line + char, size) > width && line) { lines.push(line); line = ""; }
        line += char;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}
function fitText(page: PDFPage, font: PDFFont, text: string, field: Overlay) {
  if (!text) return;
  const [x0, y0, x1, y1] = field.rect;
  const width = x1 - x0 - 3, height = y1 - y0;
  let size = field.size, lines = wrap(text, font, size, width);
  while (size > 5.5 && lines.length * size * 1.15 > height) {
    size -= 0.25;
    lines = wrap(text, font, size, width);
  }
  if (lines.length * size * 1.15 > height) {
    const labels: Record<string, string> = { buyer: "客户名称", buyerAddress: "客户地址", buyerContact: "客户联系人", buyerEmail: "客户邮箱", description: "货物概述", number: "单据编号", projectName: "项目名称", projectAddress: "项目地址", sellerContact: "业务员姓名", sellerEmail: "业务联系邮箱" };
    throw new Error(`「${labels[field.key] || "单据填写内容"}」内容超出模板空间，请缩短后重新预览`);
  }
  // The exact retained PDF is the background, including tables, signatures and
  // terms. Draw only the mapped editable regions; never recreate the contract.
  page.drawRectangle({ x: x0, y: page.getHeight() - y1, width: x1 - x0, height, color: rgb(1, 1, 1) });
  lines.forEach((line, index) => page.drawText(line, { x: x0 + 1.5, y: page.getHeight() - y0 - size - index * size * 1.15, font, size, color: rgb(0, 0, 0) }));
}
export async function makeTradePdf(data: TradeData, template: Template, fontBytes: Uint8Array) {
  const error = tradeError(data);
  if (error) throw new Error(error);
  const doc = await PDFDocument.load(Uint8Array.from(atob(template.pdf), char => char.charCodeAt(0)));
  doc.registerFontkit(fontkit);
  // Ship a pre-subset, static font. Runtime subsetting CJK fonts can produce
  // PDFs whose text extracts correctly but whose glyphs disappear in viewers.
  const font = await doc.embedFont(fontBytes, { subset: false });
  const supported = new Set(font.getCharacterSet());
  const unsupported = [...new Set([...JSON.stringify(data)].filter(char => char.charCodeAt(0) > 31 && !supported.has(char.codePointAt(0)!)))];
  if (unsupported.length) throw new Error(`PDF 字体暂不支持这些字符：${unsupported.slice(0, 10).join(" ")}。请改用英文拼写后重新预览。`);
  const total = tradeTotal(data);
  // The retained equipment templates contain a single package summary row.
  // An itemised schedule is always appended, with matching cent-rounded totals.
  const values: Record<string, string> = {
    ...Object.fromEntries(Object.entries(data).filter(([, value]) => typeof value === "string")),
    unitPriceLabel: `${data.tradeTerm || "EXW"} 单价`,
    sellerName: "HONG KONG YIFUN LIFE LIMITED", sellerAddress: hkAddress,
    summaryQuantity: "1", summaryPrice: formatMoney(total), total: formatMoney(total),
    summaryHs: data.items.length === 1 ? data.items[0].hsCode : "See schedule",
    guidanceDays: `Estimated ${data.guidanceDays} calendar days`, installationDays: `Estimated ${data.installationDays} calendar days`,
    guidanceFee: `USD ${formatMoney(Number(data.guidanceFee || 0))}`, installationFee: `USD ${formatMoney(Number(data.installationFee || 0))}`,
  };
  for (const field of template.fields) {
    let text = values[field.key] || "";
    if (field.text) {
      text = field.text.replace(/\s+/g, " ");
      if (field.key === "appendixParagraph") text = text.replace("[●]", data.appendix);
      if (["priceParagraph", "depositParagraph", "balanceParagraph"].includes(field.key)) {
        const amount = field.key === "priceParagraph" ? total : field.key === "depositParagraph" ? Math.round(total * 50) / 100 : (Math.round(total * 100) - Math.round(total * 50)) / 100;
        text = text.replace("[●]", formatMoney(amount)).replace("[●]", moneyWords(amount));
        for (const cost of ["Equipment Cost", "Freight", "Installation", "Unloading", "Special Invoice"]) text = text.replace(`□ ${cost}`, `${data.includedCosts.includes(cost) ? "[X]" : "□"} ${cost}`);
      }
      if (field.key === "deliveryParagraph") text = text.replace("______", data.deliveryDays);
      if (field.key === "installationParagraph") text = text.replace("__________", `Option ${data.installationOption}`);
    }
    if (data.kind === "equipment-contract" && data.payments) {
      if (field.key === "depositParagraph") text = "4.1 Party A shall pay the contract price in installments in accordance with the PAYMENT SCHEDULE attached to this Contract, which forms an integral part hereof.";
      if (field.key === "balanceParagraph") text = "4.2 The attached PAYMENT SCHEDULE specifies each installment percentage, amount and payment condition, including the conditions applicable before dispatch.";
      if (field.key === "dispatchParagraph") text = "";
    }
    if (data.kind === "equipment-contract" && data.tradeTerm) {
      if (field.key === "priceParagraph") text = text.replace("EXW (Ex Works)", `${data.tradeTerm} ${data.tradePlace}, Incoterms® 2020`);
      if (data.tradeTerm === "FOB") {
        if (field.key === "transportParagraph") text = `Delivery shall be FOB ${data.tradePlace}, Incoterms® 2020. Party B shall arrange and bear the costs and risks of delivery on board the vessel nominated by Party A at the named port of shipment, including export clearance.`;
        if (field.key === "logisticsParagraph") text = "Risk transfers to Party A when the goods are on board the nominated vessel at the named port of shipment. Party A shall nominate the vessel and provide shipping instructions in time, and shall arrange and bear the costs of main carriage, insurance if required, import clearance and onward transport, in accordance with FOB Incoterms® 2020.";
        if (field.key === "unloadingParagraph") text = "Party A shall arrange receipt of the goods and provide sufficient personnel and equipment for unloading at destination and moving the goods to the installation site. The number of unloading personnel shall be determined by Party A based on the volume, weight and nature of the goods.";
      }
    }
    fitText(doc.getPage(field.page), font, text, field);
  }
  if (data.kind !== "design-pi" && data.tradeTerm) {
    const first = doc.getPage(0);
    const rect = data.kind === "equipment-pi" ? [54, 252, 748, 266] : data.kind === "equipment-ci" ? [54, 420, 533, 434] : [54, 735, 540, 760];
    fitText(first, font, `Trade term: ${data.tradeTerm} ${data.tradePlace}, Incoterms® 2020`, { key: "tradePlace", rect, page: 0, size: data.kind === "equipment-contract" ? 10 : 8 });
  }
  if (data.kind === "equipment-contract" && data.payments) {
    const paymentPage = doc.addPage([595.28, 841.89]);
    paymentPage.drawText("PAYMENT SCHEDULE", { x: 42, y: 792, font, size: 16 });
    paymentPage.drawText(`${data.number} | USD | ${data.date}`, { x: 42, y: 770, font, size: 10 });
    paymentPage.drawText("Integral part of this Contract - Clause 4", { x: 42, y: 749, font, size: 10 });
    const amounts = paymentAmounts(total, data.payments);
    let paymentY = 710;
    data.payments.forEach((stage, index) => {
      const lines = wrap(stage.condition, font, 10, 505);
      const amountWords = wrap(`In words: ${moneyWords(amounts[index])}`, font, 9, 505);
      if (paymentY - 32 - (lines.length + amountWords.length) * 13 < 75) throw new Error("付款条件内容超出一页，请缩短后重新预览");
      paymentPage.drawText(`${index + 1}. ${stage.percent}% - USD ${formatMoney(amounts[index])}`, { x: 42, y: paymentY, font, size: 11 });
      paymentY -= 19;
      for (const line of amountWords) { paymentPage.drawText(line, { x: 42, y: paymentY, font, size: 9 }); paymentY -= 13; }
      for (const line of lines) { paymentPage.drawText(line, { x: 42, y: paymentY, font, size: 10 }); paymentY -= 13; }
      paymentY -= 18;
    });
    paymentPage.drawText(`TOTAL: 100% - USD ${formatMoney(total)}`, { x: 42, y: paymentY, font, size: 12 });
    paymentPage.drawText(`Payment schedule | ${data.number}`, { x: 42, y: 28, font, size: 8 });
  }
  if (data.sellerSignature) {
    const image = await doc.embedPng(data.sellerSignature);
    const placement = data.kind === "equipment-contract" ? { page: 8, x: 185, top: 494, width: 130, height: 30 } : data.kind === "equipment-pi" ? { page: 0, x: 55, top: 523, width: 165, height: 48 } : { page: 0, x: 55, top: 450, width: 165, height: 48 };
    const signaturePage = doc.getPage(placement.page);
    const scale = Math.min(placement.width / image.width, placement.height / image.height);
    if (data.kind === "design-pi" || data.kind === "equipment-ci") signaturePage.drawText("Seller authorized signature", { x: placement.x, y: signaturePage.getHeight() - placement.top + 8, font, size: 9 });
    signaturePage.drawImage(image, { x: placement.x, y: signaturePage.getHeight() - placement.top - image.height * scale, width: image.width * scale, height: image.height * scale });
  }
  let page!: PDFPage;
  let y = 0, sheet = 0;
  const start = () => {
    page = doc.addPage([595.28, 841.89]);
    sheet += 1;
    page.drawText("GOODS / SERVICE SCHEDULE", { x: 42, y: 792, font, size: 16 });
    page.drawText(`${data.number}  |  USD  |  ${data.date}`, { x: 42, y: 770, font, size: 10 });
    const buyerLines = wrap(`Buyer: ${data.buyer} | ${data.buyerEmail}`, font, 9, 510);
    if (buyerLines.length > 3) throw new Error("买方名称或邮箱过长，请缩短后重新预览");
    buyerLines.forEach((line, index) => page.drawText(line, { x: 42, y: 751 - index * 12, font, size: 9 }));
    page.drawText("Description / HS Code", { x: 42, y: 700, font, size: 10 });
    page.drawText("Qty", { x: 332, y: 700, font, size: 10 });
    page.drawText("Unit USD", { x: 390, y: 700, font, size: 10 });
    page.drawText("Amount USD", { x: 480, y: 700, font, size: 10 });
    page.drawLine({ start: { x: 42, y: 690 }, end: { x: 553, y: 690 }, thickness: 0.7 });
    page.drawText(`Schedule ${sheet} | ${data.number}`, { x: 42, y: 28, font, size: 8 });
    y = 675;
  };
  start();
  for (const item of data.items) {
    const lines = wrap(`${item.description}${item.hsCode ? `\nHS: ${item.hsCode}` : ""}`, font, 9, 274);
    const height = Math.max(30, lines.length * 12 + 12);
    if (height > 590) throw new Error("单条明细过长，请拆成多条后重新生成");
    if (y - height < 70) start();
    lines.forEach((line, index) => page.drawText(line, { x: 42, y: y - index * 12, font, size: 9 }));
    page.drawText(String(item.quantity), { x: 332, y, font, size: 9 });
    page.drawText(item.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 }), { x: 390, y, font, size: 9 });
    const amount = formatMoney(lineCents(item) / 100);
    page.drawText(amount, { x: 553 - font.widthOfTextAtSize(amount, 9), y, font, size: 9 });
    y -= height;
    page.drawLine({ start: { x: 42, y: y + 8 }, end: { x: 553, y: y + 8 }, thickness: 0.25 });
  }
  if (y < 100) start();
  page!.drawText(`TOTAL USD ${formatMoney(total)}`, { x: 355, y: y - 15, font, size: 12 });
  doc.setTitle(`${data.number} - ${data.kind}`);
  doc.setAuthor(data.sellerContact);
  doc.setSubject("Customer document");
  return doc.save();
}
