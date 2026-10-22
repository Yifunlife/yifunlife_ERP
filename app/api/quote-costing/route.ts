import { desc } from "drizzle-orm";
import { getDb } from "../../../db";
import { costingRecords, costingRuleVersions } from "../../../db/schema";
import { getLoginSession } from "../../../lib/auth";
import { calculate, calculateSale, canManageCosting, initialSettings, validInput, type Settings } from "../../../lib/costing";

import { catalogCostingSale } from "../../../lib/costing-catalog";

export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
export async function POST(request: Request) {
  const session = await getLoginSession(request);
  if (!session) return reply({ error: "请先登录" }, 401);
  const text = await request.text();
  if (text.length > 1000000) return reply({ error: "核算数据过大，请拆分清单" }, 413);
  let body;
  try { body = JSON.parse(text); } catch { return reply({ error: "数据格式无效" }, 400); }
  if (!Array.isArray(body?.items) || body.items.length > 500) return reply({ error: "每批最多核算500项" }, 400);
  if (body.items.some((item: { id?: unknown; input?: { sku?: unknown } }) => !item || typeof item.id !== "string" || item.id.length > 200 || typeof item.input?.sku !== "string")) return reply({ error: "产品信息无效" }, 400);
  if (body.importBatch !== undefined && (!body.importBatch || typeof body.importBatch.id !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(body.importBatch.id) || typeof body.importBatch.name !== "string" || body.importBatch.name.length > 500)) return reply({ error: "清单标识无效" }, 400);
  const importBatch = body.importBatch || { id: crypto.randomUUID(), name: "导入清单" };
  const current = await getDb().select().from(costingRuleVersions).orderBy(desc(costingRuleVersions.id)).get();
  const settings: Settings = current ? JSON.parse(current.settingsJson) : initialSettings();
  const results = [];
  for (const item of body.items) {
    if (!item || typeof item.id !== "string" || item.id.length > 200 || typeof item.input?.sku !== "string") return reply({ error: "产品信息无效" }, 400);
    const mapping = settings.mappings.find(m => m.sku === item.input.sku.trim().toUpperCase());
    if (!mapping) { results.push(/^FB000[13](?:-|$)/i.test(item.input.sku) ? { id: item.id, matched: true, costing: { recordId: null, version: current?.id || 0, saleUnit: null, status: "pending", issues: ["款号尚未匹配核算难度，请核算人员配置"] } } : { id: item.id, matched: false }); continue; }
    if (!validInput(item.input) || !Number.isFinite(item.quoteQuantity) || item.quoteQuantity <= 0 || item.quoteQuantity > 1e9 || item.input.adjustments.length) {
      results.push({ id: item.id, matched: true, costing: { recordId: null, version: current?.id || 0, saleUnit: null, status: "pending", issues: ["尺寸或数量无效，请核实原清单；不能通过报价入口修改成本规则"] } }); continue;
    }
    const result = calculate(item.input, settings);
    const fromCatalog = settings.recipes?.find(r => r.sku === mapping.sku)?.saleSource === "catalog";
    const catalogSale = fromCatalog ? await catalogCostingSale(mapping.sku, item.quoteQuantity, settings.exchangeRate ?? 6.7) : null;
    const sale = catalogSale ?? calculateSale(item.input, settings);
    const recordId = crypto.randomUUID();
    const version = current?.id || 0;
    await getDb().insert(costingRecords).values({ id: recordId, projectName: item.input.project.trim() || "未命名项目", productName: item.input.name.trim() || item.input.sku, sku: item.input.sku, ruleVersion: version, createdBy: session.email, createdAt: new Date().toISOString(), snapshotJson: JSON.stringify({ importBatch, input: item.input, settings, result, sale, quoteQuantity: item.quoteQuantity, source: "quotation-import", status: result.issues.length ? "pending" : "calculated" }) });
    const costing = { ...(catalogSale ? { saleSource: "catalog", factorySaleUnit: catalogSale.unitPrices.factory } : {}), recordId, version, saleUnit: catalogSale ? catalogSale.unitPrices.price : sale.total === null ? null : sale.total / item.quoteQuantity, usdSaleUnit: catalogSale ? catalogSale.unitPrices.usd : sale.usd === null ? null : sale.usd / item.quoteQuantity, status: catalogSale ? (catalogSale.issues.length ? "pending" : "ready") : sale.total === null ? "pending" : "ready", issues: sale.issues };
    results.push({ id: item.id, matched: true, costing, ...(canManageCosting(session.role) ? { cost: result.total === null ? null : result.total / item.quoteQuantity } : {}) });
  }
  return reply({ results });
}
