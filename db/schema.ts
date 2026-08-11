import {
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const catalogProducts = sqliteTable("catalog_products", {
  id: text("id").primaryKey(),
  sku: text("sku").notNull(),
  name: text("name").notNull(),
  englishName: text("english_name").notNull().default(""),
  category: text("category").notNull().default(""),
  family: text("family").notNull().default(""),
  price: real("price"),
  priceNote: text("price_note").notNull().default(""),
  usdPrice: real("usd_price"),
  unit: text("unit").notNull().default(""),
  specification: text("specification").notNull().default(""),
  brand: text("brand").notNull().default(""),
  material: text("material").notNull().default(""),
  note: text("note").notNull().default(""),
  imageKey: text("image_key").notNull().default(""),
});

export const productOverrides = sqliteTable("product_overrides", {
  productId: text("product_id").primaryKey(),
  name: text("name"),
  price: text("price"),
  imageUrl: text("image_url"),
  volume: text("volume"),
  stock: integer("stock"),
  majorCategory: text("major_category"),
  category1: text("category_1"),
  category2: text("category_2"),
  category3: text("category_3"),
  colorTag: text("color_tag"),
  hasScreen: integer("has_screen", { mode: "boolean" })
    .notNull()
    .default(false),
  isRecommended: integer("is_recommended", { mode: "boolean" })
    .notNull()
    .default(false),
  updatedAt: text("updated_at").notNull().default(""),
});

export const catalogCategories = sqliteTable("catalog_categories", {
  id: text("id").primaryKey(),
  level: integer("level").notNull(),
  parentKey: text("parent_key").notNull().default(""),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull().default(""),
});

export const productRecommendations = sqliteTable(
  "product_recommendations",
  {
    productId: text("product_id").notNull(),
    relatedProductId: text("related_product_id").notNull(),
    quantity: integer("quantity").notNull().default(1),
  },
  (table) => [
    primaryKey({ columns: [table.productId, table.relatedProductId] }),
  ],
);

export const loginSessions = sqliteTable("login_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  username: text("username").notNull(),
  expiresAt: text("expires_at").notNull(),
});

export const kitchenPackages = sqliteTable("kitchen_packages", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  configJson: text("config_json").notNull(),
  updatedAt: text("updated_at").notNull().default(""),
});
