import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import { catalogProducts, costingRuleVersions, productOverrides } from "../db/schema";

import { usdFromCny } from "./currency";

export async function sharedExchangeRate() {
  const current = await getDb().select({ settings: costingRuleVersions.settingsJson }).from(costingRuleVersions).orderBy(desc(costingRuleVersions.id)).get();
  return current ? JSON.parse(current.settings).exchangeRate ?? 6.7 : 6.7;
}

// Capture the product library prices at import time; historical quotes keep this snapshot.
export async function catalogCostingSale(sku: string, quantity: number, exchangeRate: number) {
  const products = await getDb().select().from(catalogProducts).where(sql`upper(trim(${catalogProducts.sku})) = ${sku.trim().toUpperCase()}`).limit(2);
  const product = products.length === 1 ? products[0] : undefined;
  const override = product ? await getDb().select().from(productOverrides).where(eq(productOverrides.productId, product.id)).get() : undefined;
  const validPrice = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value * quantity <= 1e12 ? value : null;
  const price = validPrice(override?.price != null && override.price !== "" ? Number(override.price) : product?.vipPrice ?? product?.price);
  const factory = validPrice(product?.factoryPrice), usd = validPrice(usdFromCny(factory, exchangeRate));
  const issues = !product ? [products.length ? "产品库存在重复款号，请先核实售价来源" : "产品库尚未导入该款号的售价"] : [price, factory, usd].every(v => v === null) ? ["产品库售价待填写"] : [];
  const total = (unit: number | null) => unit === null ? null : Math.round(unit * quantity * 100) / 100;
  return { source: "catalog" as const, catalogProductId: product?.id ?? null, unitPrices: { price, factory, usd }, total: total(price), usd: total(usd), factoryTotal: total(factory), exchangeRate, saleMultiplier: null, items: [], issues };
}
