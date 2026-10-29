import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { quotationHistory } from "../db/schema";
import { quotationProjectKey } from "./quotation";
import { env } from "cloudflare:workers";
import { sharedQuotation } from "./crm-collaboration";

export async function accessibleQuotation(id: string, session: { email: string; role: string }) {
  return getDb().select().from(quotationHistory).where(and(eq(quotationHistory.id, id),
    ["admin", "ceo", "management"].includes(session.role) ? undefined : eq(quotationHistory.createdBy, session.email))).get();
}

export async function readableQuotation(id: string, session: { email: string; role: string }) {
  const owned = await accessibleQuotation(id, session);
  if (owned) return owned;
  if (!await sharedQuotation(env.DB, id, session.email)) return undefined;
  return getDb().select().from(quotationHistory).where(eq(quotationHistory.id, id)).get();
}

export async function quotationSourceError(id: unknown, session: { email: string; role: string }) {
  if (id === undefined) return ""; // Existing/manual documents retain their original workflow.
  if (typeof id !== "string" || !id.trim()) return "来源报价版本无效";
  const quote = await readableQuotation(id, session);
  if (!quote) return "来源报价不存在或无权查看";
  if (quote.voidedAt || quote.archivedAt || quote.projectStatus === "lost") return "来源报价已作废、归档或失单，请重新选择有效版本";
  const records = await getDb().select().from(quotationHistory)
    .where(quote.lineageId ? eq(quotationHistory.lineageId, quote.lineageId) : eq(quotationHistory.createdBy, quote.createdBy))
    .orderBy(desc(quotationHistory.generatedAt), desc(quotationHistory.id));
  const versions = records.filter(record => !record.voidedAt && !record.archivedAt && quotationProjectKey(record) === quotationProjectKey(quote));
  const current = versions.find(record => record.isFinalized) || versions[0];
  if (current?.id !== quote.id) return "来源报价已被其他版本替代，请重新带入并预览单据";
  return "";
}
