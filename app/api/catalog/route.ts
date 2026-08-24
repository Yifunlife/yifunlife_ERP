import { eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "../../../db";
import {
  areaPairingRules,
  catalogProducts,
  catalogCategories,
  kitchenPackages,
  productOverrides,
  productRecommendations,
} from "../../../db/schema";
import { getLoginSession } from "../../../lib/auth";
import { isPairableArea, pairedArea } from "../../../lib/area-pairing";

export const dynamic = "force-dynamic";

const imageUrl = (key: string) =>
  key ? `/api/catalog/image?key=${encodeURIComponent(key)}` : "";

async function requireAdmin(request: Request) {
  const session = await getLoginSession(request);
  return session?.role === "admin" ? session : null;
}

const recommendationForClient = (recommendation: {
  productId: string;
  relatedProductId: string;
  quantity: unknown;
}) => ({
  productId: recommendation.productId,
  relatedProductId: recommendation.relatedProductId,
  quantity: Math.max(1, Math.floor(Number(recommendation.quantity) || 1)),
});

const areaPairingRuleForClient = (rule: {
  area: string;
  configJson: string;
  updatedAt: string;
}) => {
  try {
    return {
      area: rule.area,
      rules: JSON.parse(rule.configJson),
      updatedAt: rule.updatedAt,
    };
  } catch {
    return { area: rule.area, rules: [], updatedAt: rule.updatedAt };
  }
};

async function ensureRecommendationQuantityColumn() {
  const columns = await env.DB
    .prepare("PRAGMA table_info(product_recommendations)")
    .all<{ name: string }>();
  if (columns.results.some((column) => column.name === "quantity")) return;

  try {
    await env.DB
      .prepare(
        "ALTER TABLE product_recommendations ADD COLUMN quantity integer NOT NULL DEFAULT 1",
      )
      .run();
  } catch {
    const checkedColumns = await env.DB
      .prepare("PRAGMA table_info(product_recommendations)")
      .all<{ name: string }>();
    if (!checkedColumns.results.some((column) => column.name === "quantity")) {
      throw new Error("Unable to add the product recommendation quantity column");
    }
  }
}

async function ensureAreaPairingRuleTable() {
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS area_pairing_rules (area text PRIMARY KEY NOT NULL, config_json text NOT NULL, updated_at text NOT NULL DEFAULT '')",
  ).run();
}

async function getStoredCatalogBackup() {
  const object = await env.PRODUCT_IMAGES.get("catalog/catalog.json");
  if (!object) return [];
  const products = (await object.json()) as Array<{
    id: string; sku: string; name: string; en: string; category: string;
    family: string; price: number | null; priceNote: string; usd: number | null;
    unit: string; spec: string; brand: string; material: string; note: string; image: string;
  }>;
  return products.map((product) => ({
    id: product.id,
    sku: product.sku,
    name: product.name,
    en: product.en,
    category: product.category,
    family: product.family,
    price: product.price,
    priceNote: product.priceNote,
    usd: product.usd,
    unit: product.unit,
    spec: product.spec,
    brand: product.brand,
    material: product.material,
    note: product.note,
    image: imageUrl(product.image.replace("/products/catalog/", "catalog/")),
  }));
}

export async function GET(request: Request) {
  if (!(await getLoginSession(request)))
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  await Promise.all([
    ensureRecommendationQuantityColumn(),
    ensureAreaPairingRuleTable(),
  ]);
  const db = getDb();
  const [products, overrides, categories, recommendations, packages, areaRules] = await Promise.all([
    db.select().from(catalogProducts),
    db.select().from(productOverrides),
    db.select().from(catalogCategories),
    db.select().from(productRecommendations),
    db.select().from(kitchenPackages),
    db.select().from(areaPairingRules),
  ]);
  const catalog = products.length
    ? products.map((product) => ({
        id: product.id,
        sku: product.sku,
        name: product.name,
        en: product.englishName,
        category: product.category,
        family: product.family,
        price: product.price,
        priceNote: product.priceNote,
        usd: product.usdPrice,
        unit: product.unit,
        spec: product.specification,
        brand: product.brand,
        material: product.material,
        note: product.note,
        image: imageUrl(product.imageKey),
      }))
    : await getStoredCatalogBackup();
  return Response.json({
    products: catalog,
    overrides,
    categories,
    recommendations: recommendations.map(recommendationForClient),
    packages,
    areaPairingRules: areaRules.map(areaPairingRuleForClient),
  });
}

export async function PATCH(request: Request) {
  if (!(await requireAdmin(request)))
    return Response.json({ error: "仅管理员可修改产品资料" }, { status: 403 });
  const { productId, patch } = (await request.json()) as {
    productId: string;
    patch: Record<string, unknown>;
  };
  if (!productId)
    return Response.json({ error: "productId is required" }, { status: 400 });
  const values = {
    productId,
    ...patch,
    updatedAt: new Date().toISOString(),
  } as typeof productOverrides.$inferInsert;
  await getDb()
    .insert(productOverrides)
    .values(values)
    .onConflictDoUpdate({ target: productOverrides.productId, set: values });
  return Response.json({ override: values });
}

export async function POST(request: Request) {
  if (!(await requireAdmin(request)))
    return Response.json({ error: "仅管理员可修改系统设置" }, { status: 403 });
  await ensureRecommendationQuantityColumn();
  const payload = (await request.json()) as {
    action:
      | "category"
      | "recommendations"
      | "kitchenPackage"
      | "organizeToyTiers"
      | "organizePairedAreas"
      | "areaPairingRules"
      | "catalogImport";
    category?: typeof catalogCategories.$inferInsert;
    productId?: string;
    relatedIds?: string[];
    relatedProducts?: Array<{ relatedProductId: string; quantity: number }>;
    area?: string;
    rules?: unknown[];
    package?: typeof kitchenPackages.$inferInsert;
    products?: Array<typeof catalogProducts.$inferInsert>;
    supplements?: Array<{
      productId: string;
      productPatch?: Partial<typeof catalogProducts.$inferInsert>;
      overridePatch?: Partial<typeof productOverrides.$inferInsert>;
      replaceExisting?: boolean;
    }>;
  };
  const db = getDb();
  await ensureAreaPairingRuleTable();
  if (payload.action === "areaPairingRules" && payload.area && payload.rules) {
    const values = {
      area: payload.area,
      configJson: JSON.stringify(payload.rules),
      updatedAt: new Date().toISOString(),
    };
    await db
      .insert(areaPairingRules)
      .values(values)
      .onConflictDoUpdate({ target: areaPairingRules.area, set: values });
    return Response.json({ rule: areaPairingRuleForClient(values) });
  }
  if (payload.action === "catalogImport") {
    const products = payload.products || [];
    const supplements = payload.supplements || [];
    const [existingProducts, existingOverrides] = await Promise.all([
      db.select().from(catalogProducts),
      db.select().from(productOverrides),
    ]);
    const productById = new Map(existingProducts.map((product) => [product.id, product]));
    const overrideByProductId = new Map(
      existingOverrides.map((override) => [override.productId, override]),
    );
    const isEmpty = (value: unknown) => value === null || value === undefined || value === "";
    let added = 0;
    let supplemented = 0;

    for (const product of products) {
      if (productById.has(product.id)) continue;
      await db.insert(catalogProducts).values(product).onConflictDoNothing();
      productById.set(product.id, product);
      added += 1;
    }

    for (const supplement of supplements) {
      const current = productById.get(supplement.productId);
      if (!current) continue;
      const productPatch = Object.fromEntries(
        Object.entries(supplement.productPatch || {}).filter(
          ([key, value]) =>
            !isEmpty(value) &&
            (supplement.replaceExisting ||
              isEmpty(current[key as keyof typeof current])),
        ),
      );
      if (Object.keys(productPatch).length) {
        await db
          .update(catalogProducts)
          .set(productPatch)
          .where(eq(catalogProducts.id, supplement.productId));
        Object.assign(current, productPatch);
        supplemented += 1;
      }

      const currentOverride = overrideByProductId.get(supplement.productId);
      const overridePatch = Object.fromEntries(
        Object.entries(supplement.overridePatch || {}).filter(
          ([key, value]) =>
            key !== "productId" &&
            key !== "updatedAt" &&
            !isEmpty(value) &&
            (supplement.replaceExisting ||
              isEmpty(
                currentOverride?.[
                  key as keyof typeof productOverrides.$inferSelect
                ],
              )),
        ),
      );
      if (Object.keys(overridePatch).length) {
        const values = {
          productId: supplement.productId,
          ...overridePatch,
          updatedAt: new Date().toISOString(),
        } as typeof productOverrides.$inferInsert;
        await db
          .insert(productOverrides)
          .values(values)
          .onConflictDoUpdate({ target: productOverrides.productId, set: values });
        overrideByProductId.set(supplement.productId, values as typeof productOverrides.$inferSelect);
        supplemented += 1;
      }
    }
    return Response.json({ ok: true, added, supplemented });
  }
  if (payload.action === "category" && payload.category) {
    await db.insert(catalogCategories).values(payload.category);
    return Response.json({ category: payload.category }, { status: 201 });
  }
  if (payload.action === "recommendations" && payload.productId) {
    const relatedProducts = payload.relatedProducts ||
      (payload.relatedIds || []).map((relatedProductId) => ({
        relatedProductId,
        quantity: 1,
      }));
    await db
      .delete(productRecommendations)
      .where(eq(productRecommendations.productId, payload.productId));
    for (let index = 0; index < relatedProducts.length; index += 25) {
      await db
        .insert(productRecommendations)
        .values(
          relatedProducts.slice(index, index + 25).map(({ relatedProductId, quantity }) => ({
            productId: payload.productId!,
            relatedProductId,
            quantity: Math.max(1, Math.floor(Number(quantity) || 1)),
          })),
        );
    }
    const savedRecommendations = await db
      .select()
      .from(productRecommendations)
      .where(eq(productRecommendations.productId, payload.productId));
    return Response.json({
      ok: true,
      recommendations: savedRecommendations.map(recommendationForClient),
    });
  }
  if (payload.action === "kitchenPackage" && payload.package) {
    const values = { ...payload.package, updatedAt: new Date().toISOString() };
    await db
      .insert(kitchenPackages)
      .values(values)
      .onConflictDoUpdate({ target: kitchenPackages.id, set: values });
    return Response.json({ package: values }, { status: 201 });
  }
  if (payload.action === "organizeToyTiers") {
    const [products, overrides] = await Promise.all([
      db.select().from(catalogProducts),
      db.select().from(productOverrides),
    ]);
    const overrideByProductId = new Map(
      overrides.map((override) => [override.productId, override]),
    );
    const toyProducts = products.filter(
      (product) =>
        (overrideByProductId.get(product.id)?.category1 || product.family) ===
        "小玩具",
    );
    const toyAreas = [
      ...new Set(
        toyProducts.map(
          (product) =>
            overrideByProductId.get(product.id)?.category2 || product.category,
        ),
      ),
    ];
    const now = new Date().toISOString();

    await env.DB.batch(
      toyAreas.flatMap((area) =>
        ["必配", "选配"].map((name) =>
          env.DB.prepare(
            "INSERT OR IGNORE INTO catalog_categories (id, level, parent_key, name, created_at) VALUES (?, ?, ?, ?, ?)",
          ).bind(`toy-tier-${area}-${name}`, 3, `小玩具/${area}`, name, now),
        ),
      ),
    );

    for (let index = 0; index < toyProducts.length; index += 100) {
      await env.DB.batch(
        toyProducts.slice(index, index + 100).map((product) =>
          env.DB.prepare(
            "INSERT INTO product_overrides (product_id, category_3, updated_at) VALUES (?, ?, ?) ON CONFLICT(product_id) DO UPDATE SET category_3 = excluded.category_3, updated_at = excluded.updated_at",
          ).bind(product.id, "选配", now),
        ),
      );
    }
    return Response.json({
      ok: true,
      optionalSkuCount: toyProducts.length,
      areaCount: toyAreas.length,
    });
  }
  if (payload.action === "organizePairedAreas") {
    const products = await db.select().from(catalogProducts);
    const pairedProducts = products.flatMap((product) => {
      if (
        (product.family !== "小玩具" && product.family !== "模拟设备") ||
        !isPairableArea(product.category)
      )
        return [];
      const area = pairedArea(product.category, product.name);
      return area ? [{ product, area }] : [];
    });
    const unresolvedAreas = [
      ...new Set(
        products
          .filter(
            (product) =>
              (product.family === "小玩具" || product.family === "模拟设备") &&
              isPairableArea(product.category) &&
              !pairedArea(product.category, product.name),
          )
          .map((product) => product.category),
      ),
    ];
    const now = new Date().toISOString();
    for (let index = 0; index < pairedProducts.length; index += 100) {
      await env.DB.batch(
        pairedProducts.slice(index, index + 100).map(({ product, area }) =>
          env.DB.prepare(
            "INSERT INTO product_overrides (product_id, category_2, updated_at) VALUES (?, ?, ?) ON CONFLICT(product_id) DO UPDATE SET category_2 = excluded.category_2, updated_at = excluded.updated_at",
          ).bind(product.id, area, now),
        ),
      );
    }
    return Response.json({
      ok: true,
      updatedSkuCount: pairedProducts.length,
      unresolvedAreas,
    });
  }
  return Response.json({ error: "invalid action" }, { status: 400 });
}
