import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { costingRecords, costingRuleVersions } from "../../../db/schema";
import { getLoginSession } from "../../../lib/auth";
import { calculate, canManageCosting, initialSettings, validInput, validSettings } from "../../../lib/costing";

import { assignResourceCodes, withLibraries } from "../../../lib/costing-library";

export const dynamic = "force-dynamic";
const reply = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
async function authorize(request: Request) {
  const session = await getLoginSession(request);
  if (!session) return reply({ error: "请先登录" }, 401);
  if (!canManageCosting(session.role)) return reply({ error: "仅管理员、老板和核算人员可以访问核算管理" }, 403);
  return session;
}
const latest = () => getDb().select().from(costingRuleVersions).orderBy(desc(costingRuleVersions.id)).get();
const formKey = sql<string>`case when json_extract(${costingRecords.snapshotJson}, '$.importBatch.id') is not null then 'batch:' || ${costingRecords.createdBy} || ':' || json_extract(${costingRecords.snapshotJson}, '$.importBatch.id') when json_extract(${costingRecords.snapshotJson}, '$.source') = 'quotation-import' then 'legacy:' || json_array(${costingRecords.createdBy}, ${costingRecords.projectName}) else 'record:' || ${costingRecords.id} end`;
const recordSummary = { id: costingRecords.id, parentId: costingRecords.parentId, projectName: costingRecords.projectName, productName: costingRecords.productName, sku: costingRecords.sku, ruleVersion: costingRecords.ruleVersion, createdBy: costingRecords.createdBy, createdAt: costingRecords.createdAt };
export async function GET(request: Request) {
  const session = await authorize(request);
  if (session instanceof Response) return session;
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (id) {
    const record = await getDb().select().from(costingRecords).where(eq(costingRecords.id, id)).get();
    return record ? reply({ record: { ...record, snapshot: JSON.parse(record.snapshotJson), snapshotJson: undefined } }) : reply({ error: "记录不存在" }, 404);
  }
  const form = url.searchParams.get("form");
  if (form) {
    const records = await getDb().select(recordSummary).from(costingRecords).where(eq(formKey, form)).orderBy(costingRecords.createdAt, costingRecords.id);
    return reply({ records });
  }
  const current = await latest();
  const records = await getDb().select({ id: costingRecords.id, parentId: costingRecords.parentId, projectName: costingRecords.projectName, productName: costingRecords.productName, sku: costingRecords.sku, ruleVersion: costingRecords.ruleVersion, createdBy: costingRecords.createdBy, createdAt: costingRecords.createdAt }).from(costingRecords).orderBy(desc(costingRecords.createdAt)).limit(100);
  const versions = await getDb().select({ id: costingRuleVersions.id, reason: costingRuleVersions.reason, createdBy: costingRuleVersions.createdBy, createdAt: costingRuleVersions.createdAt }).from(costingRuleVersions).orderBy(desc(costingRuleVersions.id)).limit(50);
  const forms = await getDb().select({
    id: formKey,
    name: sql<string>`coalesce(max(json_extract(${costingRecords.snapshotJson}, '$.importBatch.name')), max(${costingRecords.projectName}))`,
    projectName: sql<string>`max(${costingRecords.projectName})`,
    count: sql<number>`count(*)`, skuCount: sql<number>`count(distinct ${costingRecords.sku})`,
    createdBy: costingRecords.createdBy, createdAt: sql<string>`max(${costingRecords.createdAt})`,
    legacy: sql<number>`case when max(json_extract(${costingRecords.snapshotJson}, '$.importBatch.id')) is null then 1 else 0 end`,
  }).from(costingRecords).groupBy(formKey, costingRecords.createdBy).orderBy(desc(sql`max(${costingRecords.createdAt})`)).limit(100);
  return reply({ forms, version: current?.id || 0, settings: current ? JSON.parse(current.settingsJson) : initialSettings(), records, versions });
}
export async function POST(request: Request) {
  const session = await authorize(request);
  if (session instanceof Response) return session;
  const raw = await request.text();
  if (raw.length > 500000) return reply({ error: "提交内容过大" }, 413);
  let body;
  try { body = JSON.parse(raw); } catch { return reply({ error: "数据格式无效" }, 400); }
  if (!body || typeof body !== "object") return reply({ error: "数据格式无效" }, 400);
  const current = await latest();
  const version = current?.id || 0;
  if (body.baseVersion !== version) return reply({ error: "基础设置已更新，请重新加载最新设置后核算" }, 409);
  if (body.action === "settings") {
    if (!validSettings(body.settings) || typeof body.reason !== "string" || !body.reason.trim() || body.reason.length > 2000) return reply({ error: "请检查规则字段、数值、重复款号，并填写修改原因" }, 400);
    const previous = withLibraries(current ? JSON.parse(current.settingsJson) : initialSettings());
    body.settings = assignResourceCodes(body.settings, previous);
    if (!validSettings(body.settings)) return reply({ error: "材料或人工编码无效，请重新加载后保存" }, 400);
    try {
      const saved = await getDb().insert(costingRuleVersions).values({ previousId: version, settingsJson: JSON.stringify(body.settings), reason: body.reason.trim(), createdBy: session.email, createdAt: new Date().toISOString() }).returning().get();
      return reply({ version: saved.id }, 201);
    } catch (error) {
      if (((await latest())?.id || 0) !== version) return reply({ error: "另一位核算人员已更新设置，请重新加载后修改" }, 409);
      throw error;
    }
  }
  if (body.action !== "record" || !validInput(body.input)) return reply({ error: "核算数据格式或数值无效" }, 400);
  if (!current) return reply({ error: "请先保存基础设置" }, 400);
  if (!body.input.project.trim() || !body.input.name.trim()) return reply({ error: "请填写项目和产品编号／名称" }, 400);
  if (body.parentId != null) {
    if (typeof body.parentId !== "string" || !await getDb().select({ id: costingRecords.id }).from(costingRecords).where(eq(costingRecords.id, body.parentId)).get()) return reply({ error: "原核算记录不存在" }, 404);
  }
  const settings = JSON.parse(current.settingsJson);
  const result = calculate(body.input, settings);
  const id = crypto.randomUUID();
  await getDb().insert(costingRecords).values({ id, parentId: body.parentId || null, projectName: body.input.project.trim(), productName: body.input.name.trim(), sku: body.input.sku.trim().toUpperCase(), ruleVersion: version, snapshotJson: JSON.stringify({ input: body.input, settings, result, status: result.issues.length ? "pending" : "calculated" }), createdBy: session.email, createdAt: new Date().toISOString() });
  return reply({ id, result }, 201);
}
