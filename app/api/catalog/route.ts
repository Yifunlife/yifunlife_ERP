import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import {
  catalogProducts,
  catalogCategories,
  kitchenPackages,
  productOverrides,
  productRecommendations,
} from "../../../db/schema";
import { getLoginSession } from "../../../lib/auth";

export const dynamic = "force-dynamic";

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
  return Response.json({
    products: products.map((product) => ({
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
      image: product.imageKey
        ? `/api/catalog/image?key=${encodeURIComponent(product.imageKey)}`
        : "",
    })),
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
    action: "category" | "recommendations" | "kitchenPackage";
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
  return Response.json({ error: "invalid action" }, { status: 400 });
}
