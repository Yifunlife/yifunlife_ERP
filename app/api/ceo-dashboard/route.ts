import { and, desc, isNull } from "drizzle-orm";
import { getDb } from "../../../db";
import { quotationHistory } from "../../../db/schema";
import { getLoginSession } from "../../../lib/auth";
import { quotationProjectKey } from "../../../lib/quotation";

import { quoteAmount, readSnapshot } from "../../../lib/quote-amount";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getLoginSession(request);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!["admin", "ceo", "management"].includes(session.role))
    return Response.json({ error: "仅管理层可查看 CEO 看板" }, { status: 403 });

  const records = await getDb()
    .select()
    .from(quotationHistory)
    .where(and(isNull(quotationHistory.archivedAt), isNull(quotationHistory.voidedAt)))
    .orderBy(desc(quotationHistory.generatedAt), desc(quotationHistory.id));

  const groups = new Map<string, Array<(typeof records)[number]>>();
  records.forEach((record) => {
    const key = quotationProjectKey(record);
    groups.set(key, [...(groups.get(key) || []), record]);
  });

  const projects = [...groups.entries()].map(([key, versions]) => {
    const current = versions[0];
    const selectedVersion = versions.find((record) => record.isFinalized) || current;
    const amount = quoteAmount(readSnapshot(selectedVersion.snapshotJson));
    return {
      key,
      id: selectedVersion.id,
      contractNo: selectedVersion.contractNo,
      projectName: selectedVersion.projectName,
      createdBy: selectedVersion.createdBy,
      generatedAt: selectedVersion.generatedAt,
      isFinalized: selectedVersion.isFinalized,
      projectStatus: selectedVersion.projectStatus,
      statusUpdatedAt: selectedVersion.statusUpdatedAt,
      lossReason: selectedVersion.lossReason,
      lossNote: selectedVersion.lossNote,
      nextFollowUpAt: selectedVersion.nextFollowUpAt,
      customerName: selectedVersion.customerName,
      lastFollowUpAt: selectedVersion.lastFollowUpAt,
      quoteValidUntil: selectedVersion.quoteValidUntil,
      currency: amount.currency,
      quotedAmount: amount.hasAmount ? amount.amount : null,
      finalAmount: selectedVersion.finalAmount,
      amount: selectedVersion.isFinalized && selectedVersion.finalAmount !== null ? selectedVersion.finalAmount : amount.amount,
      hasAmount: selectedVersion.isFinalized && selectedVersion.finalAmount !== null || amount.hasAmount,
      costAmount: session.role === "ceo" ? amount.costAmount : null,
      hasCost: session.role === "ceo" && amount.hasCost,
      costCurrency: "CNY",
      skuCount: amount.skuCount,
      salesName: amount.salesName || selectedVersion.createdBy || "待补充",
      items: amount.items,
      versions: versions.map((record) => {
        const versionAmount = quoteAmount(readSnapshot(record.snapshotJson));
        return {
          id: record.id,
          contractNo: record.contractNo,
          generatedAt: record.generatedAt,
          isFinalized: record.isFinalized,
          currency: versionAmount.currency,
          amount: versionAmount.amount,
          hasAmount: versionAmount.hasAmount,
          skuCount: versionAmount.skuCount,
        };
      }),
    };
  });

  return Response.json({
    canViewCosts: session.role === "ceo",
    quotationCount: records.length,
    projects,
    generatedAt: new Date().toISOString(),
  });
}
