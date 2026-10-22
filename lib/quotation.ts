export type QuoteFees = Partial<Record<"packaging" | "formaldehyde" | "shipping" | "installation" | "designDeduction", number>>;

export function quotationTotals(subtotal: number, currency: string, fees: QuoteFees, includeTax: boolean, showDesignDeduction: boolean) {
  const value = (amount: number | undefined) => Number.isFinite(amount) ? Number(amount) : 0;
  const preTax = subtotal + value(fees.packaging) + value(fees.formaldehyde) + value(fees.shipping) + value(fees.installation);
  const tax = currency === "CNY" && includeTax ? preTax * 0.13 : 0;
  return { preTax, tax, totalWithTax: preTax + tax - (showDesignDeduction ? value(fees.designDeduction) : 0) };
}

export const baseContractNo = (value: string) => value.replace(/-R\d+$/i, "");

export const quotationProjectKey = (record: { lineageId?: string | null; createdBy: string; contractNo: string; projectName: string }) =>
  record.lineageId || JSON.stringify([record.createdBy, baseContractNo(record.contractNo), record.projectName]);
