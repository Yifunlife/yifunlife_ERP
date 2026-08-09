import { env } from "cloudflare:workers";
import { catalogProducts as catalogSource } from "../../../catalog-data";
import { getDb } from "../../../../db";
import { catalogProducts } from "../../../../db/schema";

export const dynamic = "force-dynamic";

const imageKeyFor = (image: string) =>
  image.startsWith("/products/catalog/")
    ? `catalog/${image.slice("/products/catalog/".length)}`
    : "";

async function ensureSchema() {
  await env.DB.exec(`
    CREATE TABLE IF NOT EXISTS catalog_products (
      id text PRIMARY KEY NOT NULL, sku text NOT NULL, name text NOT NULL,
      english_name text DEFAULT '' NOT NULL, category text DEFAULT '' NOT NULL,
      family text DEFAULT '' NOT NULL, price real, price_note text DEFAULT '' NOT NULL,
      usd_price real, unit text DEFAULT '' NOT NULL, specification text DEFAULT '' NOT NULL,
      brand text DEFAULT '' NOT NULL, material text DEFAULT '' NOT NULL,
      note text DEFAULT '' NOT NULL, image_key text DEFAULT '' NOT NULL
    );
    CREATE TABLE IF NOT EXISTS product_overrides (
      product_id text PRIMARY KEY NOT NULL, name text, price text, image_url text,
      volume text, stock integer, major_category text, category_1 text, category_2 text,
      category_3 text, color_tag text, has_screen integer DEFAULT false NOT NULL,
      is_recommended integer DEFAULT false NOT NULL, updated_at text DEFAULT '' NOT NULL
    );
    CREATE TABLE IF NOT EXISTS catalog_categories (
      id text PRIMARY KEY NOT NULL, level integer NOT NULL,
      parent_key text DEFAULT '' NOT NULL, name text NOT NULL, created_at text DEFAULT '' NOT NULL
    );
    CREATE TABLE IF NOT EXISTS product_recommendations (
      product_id text NOT NULL, related_product_id text NOT NULL,
      PRIMARY KEY(product_id, related_product_id)
    );
    CREATE TABLE IF NOT EXISTS kitchen_packages (
      id text PRIMARY KEY NOT NULL, name text NOT NULL, description text DEFAULT '' NOT NULL,
      config_json text NOT NULL, updated_at text DEFAULT '' NOT NULL
    );
  `);
}

export async function GET() {
  return Response.json({ sourceProducts: catalogSource.length, hasDatabaseBinding: Boolean(env.DB) });
}

export async function POST() {
  try {
    await ensureSchema();
    const db = getDb();
    for (let start = 0; start < catalogSource.length; start += 100) {
      await db.batch(
        catalogSource.slice(start, start + 100).map((product) =>
          db
            .insert(catalogProducts)
            .values({
              id: product.id, sku: product.sku, name: product.name,
              englishName: product.en, category: product.category, family: product.family,
              price: product.price, priceNote: product.priceNote, usdPrice: product.usd,
              unit: product.unit, specification: product.spec, brand: product.brand,
              material: product.material, note: product.note, imageKey: imageKeyFor(product.image),
            })
            .onConflictDoNothing(),
        ),
      );
    }
    return Response.json({ migrated: catalogSource.length });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
