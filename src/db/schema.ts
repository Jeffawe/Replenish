import {
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Single hard-coded demo user for now; every table still carries user_id so
// real auth can replace it without a schema change.
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// One row per thing a user tracks (e.g. "Charmin Ultra Soft Toilet Paper").
export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // Lowercased/trimmed name, used to match incoming purchase events.
    normalizedName: text("normalized_name").notNull(),
    brand: text("brand"),
    category: text("category"),
    unit: text("unit").notNull(), // "rolls", "gallon", "bottle"
    normalPurchaseQty: doublePrecision("normal_purchase_qty").notNull(),
    // With <2 purchases there is no interval to learn a rate from. This is the
    // user-supplied "one purchase lasts about N days" fallback.
    fallbackDaysPerPurchase: integer("fallback_days_per_purchase"),
    // Typical amount still at home when the user buys more (units). Learned
    // from their answers or set by the auto-buy trigger; null means unknown,
    // which prediction treats as 0.
    typicalLeftoverAtPurchase: doublePrecision("typical_leftover_at_purchase"),
    // Overrides the user-level low-stock threshold for this product.
    lowStockThresholdDays: integer("low_stock_threshold_days"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("products_user_name_idx").on(t.userId, t.normalizedName)],
);

// A wording a receipt or email used for a product ("gv whl mlk gl" for Whole
// Milk), learned when the user confirms a match, so the next one needs no help.
export const productAliases = pgTable(
  "product_aliases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    // Normalized like products.normalizedName.
    alias: text("alias").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("product_aliases_user_alias_idx").on(t.userId, t.alias)],
);

// A wording the user left out when reviewing a receipt (furniture, a gift
// card, a misread line), so it starts unticked the next time it appears.
export const ignoredWordings = pgTable(
  "ignored_wordings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Normalized like products.normalizedName.
    wording: text("wording").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("ignored_wordings_user_wording_idx").on(t.userId, t.wording)],
);

// Append-only ledger. Every ingestion source (receipt, email, manual, ...)
// ends up as a row here; inventory/prediction only ever reads this table.
export const purchaseEvents = pgTable(
  "purchase_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    // Plain text, validated by zod, so new sources don't need a migration.
    // "agent" = bought by the replenishment system (auto or user-approved).
    source: text("source").notNull(),
    // For source "agent": the replenishment order this purchase came from.
    // No FK yet; the orders table arrives with the replenishment block.
    orderId: uuid("order_id"),
    quantity: doublePrecision("quantity").notNull(),
    unit: text("unit").notNull(),
    priceCents: integer("price_cents"),
    // The brand bought this time; a product can be bought in several (see products.brand).
    brand: text("brand"),
    currency: text("currency").notNull().default("USD"),
    store: text("store"),
    purchasedAt: timestamp("purchased_at", { withTimezone: true }).notNull(),
    // Sender's own pointer back to the raw receipt/email. Passed through, never used by us.
    rawRef: text("raw_ref"),
    // Chosen by the sender per submission. With the line number it makes retries safe:
    // the same key + line can only be stored once. Null for rows that predate it.
    idempotencyKey: text("idempotency_key"),
    lineIndex: integer("line_index"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("purchase_events_product_date_idx").on(t.productId, t.purchasedAt),
    uniqueIndex("purchase_events_idempotency_idx").on(t.userId, t.idempotencyKey, t.lineIndex),
  ],
);

// "I actually have 2 left" - acts as a fresh anchor for the estimate.
export const inventoryCorrections = pgTable(
  "inventory_corrections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    remainingQuantity: doublePrecision("remaining_quantity").notNull(),
    // What we predicted at the moment the user corrected us. The gap between
    // this and remainingQuantity measures how accurate our estimates have been.
    estimatedAtTime: doublePrecision("estimated_at_time"),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
    note: text("note"),
  },
  (t) => [index("inventory_corrections_product_date_idx").on(t.productId, t.recordedAt)],
);

export type User = typeof users.$inferSelect;
export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type ProductAliasRow = typeof productAliases.$inferSelect;
export type PurchaseEventRow = typeof purchaseEvents.$inferSelect;
export type NewPurchaseEventRow = typeof purchaseEvents.$inferInsert;
export type InventoryCorrection = typeof inventoryCorrections.$inferSelect;
export type NewInventoryCorrection = typeof inventoryCorrections.$inferInsert;
