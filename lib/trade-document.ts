export const tradeTemplatesAvailable = false;
export const tradeTemplatesUnavailableMessage = "原有单据模板已下架，待重新导入内贸／外贸模板后开放生成。";
export const tradeKinds = {
  "equipment-pi": "设备 PI",
  "design-pi": "设计费 PI",
  "equipment-ci": "设备 CI",
  "equipment-contract": "设备合同",
} as const;
export type TradeKind = keyof typeof tradeKinds;
export type PaymentStage = { percent: number; condition: string };
export const defaultPayments = (): PaymentStage[] => [{ percent: 50, condition: "Within three (3) business days after execution of this Contract (deposit)." }, { percent: 50, condition: "Upon completion of production, before dispatch. Party B shall dispatch only after receipt of this payment." }];
export function paymentAmounts(total: number, stages: PaymentStage[]) {
  const cents = Math.round(total * 100);
  let paid = 0, percent = 0;
  return stages.map((stage, index) => {
    percent += stage.percent;
    const cumulative = index === stages.length - 1 ? cents : Math.round(cents * percent / 100);
    const amount = cumulative - paid; paid = cumulative; return amount / 100;
  });
}
export type TradeItem = { description: string; quantity: number; price: number; hsCode: string };
export type TradeData = {
  kind: TradeKind;
  number: string;
  date: string;
  validUntil: string;
  buyer: string;
  buyerAddress: string;
  buyerContact: string;
  buyerPhone: string;
  buyerEmail: string;
  sellerContact: string;
  sellerEmail: string;
  sellerPhone: string;
  origin: string;
  destination: string;
  projectName: string;
  projectAddress: string;
  description: string;
  items: TradeItem[];
  deliveryDays: string;
  appendix: string;
  installationOption: string;
  guidanceDays: string;
  guidanceFee: string;
  installationDays: string;
  installationFee: string;
  includedCosts: string[];
  sellerSignature?: string;
  signatureRequired?: boolean;
  payments?: PaymentStage[];
  tradeTerm?: "FOB" | "EXW";
  tradePlace?: string;
};
export function tradeTotal(data: Pick<TradeData, "items">) {
  return data.items.reduce((sum, item) => sum + lineCents(item), 0) / 100;
}
export function lineCents(item: Pick<TradeItem, "quantity" | "price">) {
  const amount = item.quantity * item.price * 100;
  return Math.round(amount + Number.EPSILON * Math.max(1, Math.abs(amount)));
}
export const validEmail = (email: string) => email.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email);
export function tradeError(data: TradeData) {
  if (!data || !Object.hasOwn(tradeKinds, data.kind)) return "请选择有效单据类型";
  for (const field of ["number", "date", "buyer", "buyerAddress", "buyerContact", "buyerEmail", "sellerContact", "sellerEmail", "description"] as const)
    if (typeof data[field] !== "string" || !data[field].trim()) return "请填写编号、日期、买方资料、卖方联系人和货物描述";
  if (!validEmail(data.buyerEmail) || !validEmail(data.sellerEmail)) return "请输入有效的买方和卖方邮箱";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date) || !Number.isFinite(Date.parse(data.date))) return "单据日期无效";
  if (data.kind === "design-pi" && (!/^\d{4}-\d{2}-\d{2}$/.test(data.validUntil) || data.validUntil < data.date)) return "设计 PI 有效期不能早于开票日期";
  if (!Array.isArray(data.includedCosts)) return "合同费用选项无效";
  if (!Array.isArray(data.items) || !data.items.length || data.items.length > 200) return "请填写 1–200 条明细";
  if (data.items.some(item => !item || typeof item.description !== "string" || !item.description.trim() || item.description.length > 1000 || !Number.isFinite(item.quantity) || item.quantity <= 0 || item.quantity > 1000000 || !Number.isFinite(item.price) || item.price < 0 || item.price > 100000000 || Math.abs(item.price * 1000000 - Math.round(item.price * 1000000)) > 0.1)) return "每条明细需填写名称、正数数量和有效单价（最多六位小数）";
  if (tradeTotal(data) <= 0 || tradeTotal(data) > 1000000000) return "单据总金额必须大于零且不超过 USD 1,000,000,000";
  if (data.kind === "equipment-contract" && (!data.projectName?.trim() || !data.projectAddress?.trim() || !/^\d{1,4}$/.test(data.deliveryDays) || Number(data.deliveryDays) < 1 || !data.appendix?.trim() || !["1", "2"].includes(data.installationOption) || !/^\d{1,4}$/.test(data.guidanceDays) || !/^\d{1,4}$/.test(data.installationDays) || !/^\d+(\.\d{1,2})?$/.test(data.guidanceFee) || !/^\d+(\.\d{1,2})?$/.test(data.installationFee))) return "请填写合同项目、交期、设计附件编号及两种安装方案的天数和费用，并选择安装方案";
  if (data.kind !== "design-pi" && data.tradeTerm !== undefined && (!["FOB", "EXW"].includes(data.tradeTerm) || typeof data.tradePlace !== "string" || !data.tradePlace.trim() || data.tradePlace.length > 100)) return "请填写有效的贸易条款及指定装运港／交货地点";
  if (data.kind === "equipment-contract" && data.payments !== undefined) {
    if (!Array.isArray(data.payments) || data.payments.length < 2 || data.payments.length > 6 || data.payments.some(stage => !stage || !Number.isFinite(stage.percent) || stage.percent <= 0 || stage.percent > 100 || Math.abs(stage.percent * 100 - Math.round(stage.percent * 100)) > 0.000001 || typeof stage.condition !== "string" || !stage.condition.trim() || stage.condition.length > 500)) return "请填写 2–6 期付款，每期比例大于零（最多两位小数），并填写付款条件（最多 500 字）";
    if (Math.abs(data.payments.reduce((sum, stage) => sum + stage.percent, 0) - 100) > 0.000001) return "各期付款比例合计必须为 100%";
  }
  if (data.signatureRequired && !data.sellerSignature) return "请先上传本人的授权签名图片，再生成 PDF";
  if (data.sellerSignature !== undefined && (typeof data.sellerSignature !== "string" || data.sellerSignature.length > 80000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(data.sellerSignature))) return "签名图片无效，请重新上传 PNG 或 JPG 图片";
  if (JSON.stringify(data).length > 200000) return "单据内容过长，请缩短说明";
  return "";
}
export const safePdfName = (kind: TradeKind, number: string) => `${kind}-${number.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, "_").slice(0, 80)}.pdf`;

export function tradeEmailMessage(data: TradeData) {
  const titles = { "equipment-pi": "Equipment Proforma Invoice", "design-pi": "Design Fee Proforma Invoice", "equipment-ci": "Equipment Commercial Invoice", "equipment-contract": "Equipment Supply Contract" };
  const amount = (value: number) => `USD ${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const lines = [
    `Dear ${data.buyerContact.trim() || "Customer"},`,
    "",
    `Please find attached the ${titles[data.kind]}${data.number ? ` (${data.number})` : ""} for your review.`,
    "",
    ...(data.buyer ? [`Customer: ${data.buyer}`] : []),
    ...(data.date ? [`Document date: ${data.date}`] : []),
    ...(data.projectName && data.kind === "equipment-contract" ? [`Project: ${data.projectName}`] : []),
    ...(data.description ? [`Goods / services: ${data.description}`] : []),
    `Total amount: ${amount(tradeTotal(data))}`,
  ];
  if (data.kind === "design-pi") {
    lines.push("Payment terms: 100% before commencement of design work.", ...(data.validUntil ? [`Valid until: ${data.validUntil}`] : []));
  } else if (data.tradeTerm && data.tradePlace?.trim()) {
    lines.push(`Trade terms: ${data.tradeTerm} ${data.tradePlace} (Incoterms® 2020).`);
  }
  if (data.kind === "equipment-contract") {
    const stages = data.payments || defaultPayments();
    const amounts = paymentAmounts(tradeTotal(data), stages);
    lines.push("", "Payment schedule:", ...stages.map((stage, index) => `${index + 1}. ${stage.percent}% (${amount(amounts[index])}): ${stage.condition}`));
    lines.push("", "Please review the project details, scope of supply, delivery and installation terms, and payment schedule in the attached contract. If everything is in order, please sign and return a copy. Please let us know if any changes are required.");
  } else if (data.kind === "equipment-ci") {
    lines.push("", "Please check the buyer details, item descriptions, quantities and invoice amount against your order. Please let us know if any corrections are required.");
  } else {
    lines.push("", data.kind === "design-pi" ? "Please review the design service details and invoice amount. Once confirmed, please arrange payment in accordance with the attached invoice and share the payment advice with us." : "Please review the item details, quantities, prices and trade terms. Once confirmed, please arrange payment in accordance with the payment terms and bank details shown in the attached invoice, and share the payment advice with us.");
  }
  lines.push("", "Thank you. Please contact us if you have any questions.", "", "Kind regards,", data.sellerContact || "Yifun Life", ...[data.sellerEmail, data.sellerPhone].filter(Boolean));
  return lines.join("\n");
}
