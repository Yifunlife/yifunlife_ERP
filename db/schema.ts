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
  factoryPrice: real("factory_price"),
  vipPrice: real("vip_price"),
  priceNote: text("price_note").notNull().default(""),
  usdPrice: real("usd_price"),
  unit: text("unit").notNull().default(""),
  specification: text("specification").notNull().default(""),
  brand: text("brand").notNull().default(""),
  material: text("material").notNull().default(""),
  note: text("note").notNull().default(""),
  imageKey: text("image_key").notNull().default(""),
});

export const workplaceProjects = sqliteTable("workplace_projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  customerName: text("customer_name").notNull(),
  allowedEmails: text("allowed_emails").notNull(),
  active: integer("active").notNull().default(1),
});

export const productOverrides = sqliteTable("product_overrides", {
  productId: text("product_id").primaryKey(),
  name: text("name"),
  price: text("price"),
  imageUrl: text("image_url"),
  volume: text("volume"),
  specification: text("specification"),
  unit: text("unit"),
  cost: real("cost"),
  branchPrice: real("branch_price"),
  supplyMethod: text("supply_method"),
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

export const productClassifications = sqliteTable("product_classifications", {
  id: text("id").primaryKey(),
  productId: text("product_id").notNull(),
  level1: text("level_1").notNull(),
  level2: text("level_2").notNull(),
  level3: text("level_3").notNull(),
  createdAt: text("created_at").notNull().default(""),
  updatedAt: text("updated_at").notNull().default(""),
});

export const productTags = sqliteTable(
  "product_tags",
  {
    productId: text("product_id").notNull(),
    tag: text("tag").notNull(),
  },
  (table) => [primaryKey({ columns: [table.productId, table.tag] })],
);

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

export const areaPairingRules = sqliteTable("area_pairing_rules", {
  area: text("area").primaryKey(),
  configJson: text("config_json").notNull(),
  updatedAt: text("updated_at").notNull().default(""),
});

export const loginSessions = sqliteTable("login_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  username: text("username").notNull(),
  expiresAt: text("expires_at").notNull(),
});

export const appUsers = sqliteTable("app_users", {
  username: text("username").notNull().unique(),
  employeeNo: text("employee_no").notNull().default(""),
  email: text("email").primaryKey(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt").notNull(),
  role: text("role").notNull().default("employee"),
  status: text("status").notNull().default("pending"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const passwordResetTokens = sqliteTable("password_reset_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  email: text("email").notNull(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
});

export const kitchenPackages = sqliteTable("kitchen_packages", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  configJson: text("config_json").notNull(),
  updatedAt: text("updated_at").notNull().default(""),
});

export const quotationHistory = sqliteTable("quotation_history", {
  id: text("id").primaryKey(),
  contractNo: text("contract_no").notNull(),
  projectName: text("project_name").notNull(),
  createdBy: text("created_by").notNull().default(""),
  snapshotJson: text("snapshot_json"),
  generatedAt: text("generated_at").notNull(),
  lineageId: text("lineage_id"),
  isFinalized: integer("is_finalized", { mode: "boolean" }).notNull().default(false),
  archivedAt: text("archived_at"),
  finalAmount: real("final_amount"),
  finalCurrency: text("final_currency"),
  confirmedAt: text("confirmed_at"),
  confirmedBy: text("confirmed_by").notNull().default(""),
  voidedAt: text("voided_at"),
  voidedBy: text("voided_by").notNull().default(""),
  voidReason: text("void_reason").notNull().default(""),
  projectStatus: text("project_status").notNull().default("quoted"),
  statusUpdatedAt: text("status_updated_at").notNull().default(""),
  customerName: text("customer_name").notNull().default(""),
  lastFollowUpAt: text("last_follow_up_at").notNull().default(""),
  quoteValidUntil: text("quote_valid_until").notNull().default(""),
  lossReason: text("loss_reason").notNull().default(""),
  lossNote: text("loss_note").notNull().default(""),
  nextFollowUpAt: text("next_follow_up_at").notNull().default(""),
});

export const toyMatchingDrafts = sqliteTable("toy_matching_drafts", {
  id: text("id").primaryKey(),
  createdBy: text("created_by").notNull(),
  name: text("name").notNull(),
  snapshotJson: text("snapshot_json").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const costingRuleVersions = sqliteTable("costing_rule_versions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  previousId: integer("previous_id").notNull().unique(),
  settingsJson: text("settings_json").notNull(),
  reason: text("reason").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
});

export const costingRecords = sqliteTable("costing_records", {
  id: text("id").primaryKey(),
  parentId: text("parent_id"),
  projectName: text("project_name").notNull(),
  productName: text("product_name").notNull(),
  sku: text("sku").notNull(),
  ruleVersion: integer("rule_version").notNull(),
  snapshotJson: text("snapshot_json").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
});
