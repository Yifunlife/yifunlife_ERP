import { quoteAmount, readSnapshot } from "./quote-amount";

export type HandoverFile = { id: string; filename: string; size: number; sha256: string };
export type HandoverData = {
  quotationId: string; contractNo: string; projectName: string; customerName: string;
  quotationCreatedAt: string; confirmedAt: string; confirmedBy: string;
  finalAmount: number; currency: string; quotedAmount: number;
  responsiblePerson: string; paymentTerms: string; deliveryNotes: string;
  customerConfirmation: string; files: HandoverFile[];
  quoteTerms: { fees: Record<string, number>; includeTax: boolean; showDesignDeduction: boolean };
  items: Array<{ sku: string; name: string; quantity: number; specification: string; unit: string; area: string; note: string }>;
};
export function handoverItems(snapshotJson: string) {
  const snapshot = JSON.parse(snapshotJson);
  const products = [...new Map<string, Record<string, unknown>>((snapshot.products || []).map((p: Record<string, unknown>, i: number) => [p.id || `row:${i}`, p])).values()];
  return products.flatMap(product => {
    const one = quoteAmount({ ...readSnapshot(snapshotJson), products: [product] });
    return one.items.map(item => ({ ...item, specification: String(product.specification || product.spec || ""), unit: String(product.unit || ""), area: String(product.importArea || product.category2 || ""), note: String(product.note || "") }));
  });
}
export const safeHandoverFilename = (value: string) => value.replace(/[\\/\x00-\x1f<>:"|?*]/g, "_").slice(0, 120) || "附件";
export function handoverHtml(data: HandoverData, savedAt: string, current: boolean) {
  const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>成交交接资料包</title><style>body{font:14px/1.6 system-ui,sans-serif;max-width:1050px;margin:24px auto;padding:0 16px;color:#183447}table{width:100%;border-collapse:collapse}th,td{border:1px solid #bdcbd4;padding:8px;text-align:left}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere}h1{font-size:24px}h2{font-size:18px}</style><h1>成交交接资料包 · ${escape(data.projectName)}</h1><p>${current ? "当前有效成交版本" : "历史资料包：已有新交接记录，或来源报价已变更／停用，不可作为当前执行依据"}</p><p>报价版本：${escape(data.contractNo)} · 报价 ID：${escape(data.quotationId)}<br>资料包保存时间：${escape(savedAt)}<br>客户：${escape(data.customerName || "未填写")} · 交接负责人：${escape(data.responsiblePerson)}</p><p>报价金额：${escape(data.currency)} ${escape(data.quotedAmount)} · 最终成交金额：${escape(data.currency)} ${escape(data.finalAmount)}<br>确认时间：${escape(data.confirmedAt)} · 确认人：${escape(data.confirmedBy)}</p><h2>成交产品清单</h2><table><thead><tr><th>SKU</th><th>产品</th><th>规格</th><th>数量</th><th>单位</th><th>区域／分类</th><th>备注</th></tr></thead><tbody>${data.items.map(item => `<tr>${[item.sku,item.name,item.specification,item.quantity,item.unit,item.area,item.note].map(value => `<td>${escape(value)}</td>`).join("")}</tr>`).join("")}</tbody></table><h2>报价费用与税费口径</h2><p>费用币种：${escape(data.currency)} · 含税：${data.quoteTerms.includeTax ? "是（人民币按原报价税率计算）" : "否"} · 设计费抵扣：${data.quoteTerms.showDesignDeduction ? "启用" : "未启用"}</p><ul>${Object.entries(data.quoteTerms.fees).map(([key, value]) => `<li>${escape(({packaging:"包装费",formaldehyde:"除醛费",shipping:"运费",installation:"安装费",designDeduction:"设计费抵扣"} as Record<string,string>)[key] || key)}：${escape(value)}</li>`).join("")}</ul><p>成交金额保留最终确认值，不自动摊改产品单价。</p><h2>付款条件</h2><pre>${escape(data.paymentTerms)}</pre><p>本资料包不代表实际收款确认，请以收款系统记录为准。</p><h2>客户确认说明</h2><pre>${escape(data.customerConfirmation)}</pre><h2>交付要求及范围</h2><pre>${escape(data.deliveryNotes || "未填写")}</pre><h2>客户确认附件</h2><ul>${data.files.map(file => `<li>${escape(file.filename)} (${file.size} bytes)</li>`).join("") || "<li>未上传，待补充</li>"}</ul></html>`;
}
