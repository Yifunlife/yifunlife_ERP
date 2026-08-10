import { eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "../../../db";
import {
  catalogProducts,
  catalogCategories,
  kitchenPackages,
  productOverrides,
  productRecommendations,
} from "../../../db/schema";
import { getLoginSession } from "../../../lib/auth";
import { pairedArea } from "../../../lib/area-pairing";

export const dynamic = "force-dynamic";

const imageUrl = (key: string) =>
  key ? `/api/catalog/image?key=${encodeURIComponent(key)}` : "";

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
  const db = getDb();
  const [products, overrides, categories, recommendations, packages] = await Promise.all([
    db.select().from(catalogProducts),
    db.select().from(productOverrides),
    db.select().from(catalogCategories),
    db.select().from(productRecommendations),
    db.select().from(kitchenPackages),
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
    recommendations,
    packages,
  });
}

export async function PATCH(request: Request) {
  if (!(await getLoginSession(request)))
    return Response.json({ error: "Unauthorized" }, { status: 401 });
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
  if (!(await getLoginSession(request)))
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const payload = (await request.json()) as {
    action:
      | "category"
      | "recommendations"
      | "kitchenPackage"
      | "organizeToyTiers"
      | "organizePairedAreas";
    category?: typeof catalogCategories.$inferInsert;
    productId?: string;
    relatedIds?: string[];
    package?: typeof kitchenPackages.$inferInsert;
  };
  const db = getDb();
  if (payload.action === "category" && payload.category) {
    await db.insert(catalogCategories).values(payload.category);
    return Response.json({ category: payload.category }, { status: 201 });
  }
  if (payload.action === "recommendations" && payload.productId) {
    await db
      .delete(productRecommendations)
      .where(eq(productRecommendations.productId, payload.productId));
    if (payload.relatedIds?.length)
      await db
        .insert(productRecommendations)
        .values(
          payload.relatedIds.map((relatedProductId) => ({
            productId: payload.productId!,
            relatedProductId,
          })),
        );
    return Response.json({ ok: true });
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
      if (product.family !== "小玩具" && product.family !== "模拟设备") return [];
      const area = pairedArea(product.category, product.name);
      return area ? [{ product, area }] : [];
    });
    const unresolvedAreas = [
      ...new Set(
        products
          .filter(
            (product) =>
              (product.family === "小玩具" || product.family === "模拟设备") &&
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
