import {
  boolean,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Every other table carries user_id. `password_hash` is null for an account
// nobody can sign in to (the scripts' seeded demo user).
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  passwordHash: text("password_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// A signed-in browser. Only the hash of the cookie's token is stored, so a
// leaked table can't be used to sign in.
export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
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
    // When the user said yes, keep track of this. Null means a product a
    // receipt created that nobody has checked yet, so the app asks about it.
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    // When the user said not to track it. Hidden from the dashboard and from
    // matching, never deleted; buying it again brings it back.
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    // Whether receipts are matched to this product by its name. The user can
    // rename a product to something only they use ("Mom's coffee") and turn
    // this off; wordings it was matched by before still count (product_aliases).
    matchByName: boolean("match_by_name").notNull().default(true),
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

// "Not now" on a question: that kind of question about that product stays
// quiet until `until`. The questions themselves are never stored; they are
// worked out from the data each time.
export const questionSnoozes = pgTable(
  "question_snoozes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    until: timestamp("until", { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("question_snoozes_user_product_kind_idx").on(t.userId, t.productId, t.kind)],
);

// The shared dictionary: what receipt wordings mean, for everyone. Read by
// receipt matching; grows from what users confirm and from edits by hand or by
// an agent (see src/modules/dictionary and docs/dictionary.md). `source` is
// "seed" (the starter list), "learned", "manual" or "lookup"; `status` is
// "active" (used), "pending" (waiting for approval or more confirmations) or
// "off" (switched off, never used or re-learned).
export const dictionaryItems = pgTable(
  "dictionary_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    // Lowercased/trimmed, like products.normalizedName.
    normalizedName: text("normalized_name").notNull(),
    category: text("category").notNull(),
    unit: text("unit"),
    // False for things that don't get used up; their name is their category.
    consumable: boolean("consumable").notNull().default(true),
    source: text("source").notNull().default("manual"),
    status: text("status").notNull().default("active"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("dictionary_items_name_idx").on(t.normalizedName)],
);

export const dictionaryTerms = pgTable(
  "dictionary_terms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Lowercased wording, matched as whole words (see engine.ts).
    text: text("text").notNull(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => dictionaryItems.id, { onDelete: "cascade" }),
    source: text("source").notNull().default("manual"),
    status: text("status").notNull().default("active"),
    // The receipts (idempotency keys) whose saves confirmed it, capped; its length is the confirmations.
    evidence: text("evidence").array().notNull().default(sql`'{}'::text[]`),
    // The same wording was confirmed for a different item too, so it needs a person's decision.
    conflict: boolean("conflict").notNull().default(false),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("dictionary_terms_text_item_idx").on(t.text, t.itemId)],
);

export const dictionaryBrands = pgTable(
  "dictionary_brands",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    terms: text("terms").array().notNull().default(sql`'{}'::text[]`),
    // The item a brand on its own means, when it only makes one thing.
    impliesItemId: uuid("implies_item_id").references(() => dictionaryItems.id, { onDelete: "set null" }),
    source: text("source").notNull().default("manual"),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("dictionary_brands_name_idx").on(t.normalizedName)],
);

// A store's own code for an item (a UPC, a Costco number).
export const dictionaryCodes = pgTable(
  "dictionary_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Normalized store name (letters and digits only).
    store: text("store").notNull(),
    code: text("code").notNull(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => dictionaryItems.id, { onDelete: "cascade" }),
    source: text("source").notNull().default("manual"),
    status: text("status").notNull().default("active"),
    evidence: text("evidence").array().notNull().default(sql`'{}'::text[]`),
    conflict: boolean("conflict").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("dictionary_codes_store_code_item_idx").on(t.store, t.code, t.itemId)],
);

// What the Open Food Facts lookup said about a product code, kept so a code is
// looked up once, ever (a code it didn't know is looked up again after a while).
export const codeLookups = pgTable(
  "code_lookups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    found: boolean("found").notNull(),
    name: text("name"),
    brand: text("brand"),
    // The database's category tags, joined with commas, most specific last.
    categories: text("categories"),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("code_lookups_code_idx").on(t.code)],
);

export type User = typeof users.$inferSelect;
export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type ProductAliasRow = typeof productAliases.$inferSelect;
export type PurchaseEventRow = typeof purchaseEvents.$inferSelect;
export type NewPurchaseEventRow = typeof purchaseEvents.$inferInsert;
export type InventoryCorrection = typeof inventoryCorrections.$inferSelect;
export type NewInventoryCorrection = typeof inventoryCorrections.$inferInsert;
export type QuestionSnooze = typeof questionSnoozes.$inferSelect;
