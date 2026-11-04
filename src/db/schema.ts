import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
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
  // When the owner let this account use the app. Only checked while REQUIRE_APPROVAL is on.
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  // Receipt photos this user may read per calendar month. Null = the RECEIPT_LIMIT default. Edit freely in Neon.
  receiptLimit: integer("receipt_limit"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// One row per receipt photo sent to Google Vision, to keep each user inside their monthly limit.
// Charged before the call and taken back if Google fails, so it counts calls that cost quota.
export const receiptReads = pgTable(
  "receipt_reads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("receipt_reads_user_date_idx").on(t.userId, t.createdAt)],
);

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

// A failed sign-in, kept for a short while so password guessing can be slowed down. `key` is a hash
// of the email, so this table can't be used to find out who has tried to sign in. Cleared on success.
export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("login_attempts_key_date_idx").on(t.key, t.createdAt)],
);

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
    // Buy this automatically when it runs low (and meets the user's limits). Off until the user
    // turns it on, and only for a confirmed product. Off still means we find it and ask.
    autobuyEnabled: boolean("autobuy_enabled").notNull().default(false),
    // This product's own price range (cents), replacing the user's when either is set.
    autobuyMinPriceCents: integer("autobuy_min_price_cents"),
    autobuyMaxPriceCents: integer("autobuy_max_price_cents"),
    // Where it is usually bought. Filled from the store on receipts and orders (the latest one)
    // until the user types their own, which receipts then leave alone.
    boughtFrom: text("bought_from"),
    boughtFromByUser: boolean("bought_from_by_user").notNull().default(false),
    // When this product is next worth checking for running low (src/core/next-check.ts), so the
    // scheduled check only looks at products that are due. Kept up to date by refreshNextCheck
    // whenever a purchase, count, answer or setting changes; null = nothing to wait for.
    nextCheckAt: timestamp("next_check_at", { withTimezone: true }),
    // When a search last found nothing usable. There is no suggestion row to remember that in, and
    // without this a product nothing is found for is searched (and paid for) on every run.
    restockNoneFoundAt: timestamp("restock_none_found_at", { withTimezone: true }),
    // When the low-stock check last looked at it, so a run with more due than it can take works
    // through all of them instead of the same ones (a low product stays due until it is handled).
    lowCheckedAt: timestamp("low_checked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("products_user_name_idx").on(t.userId, t.normalizedName),
    index("products_next_check_idx").on(t.nextCheckAt),
  ],
);

// One row per user who has changed a setting (a missing row means all defaults). The rules
// and defaults are in src/core/user-settings.ts; the module is src/modules/settings.
export const userSettings = pgTable("user_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  autobuyMinConfidence: doublePrecision("autobuy_min_confidence").notNull().default(0.8),
  autobuyMinPriceCents: integer("autobuy_min_price_cents"),
  autobuyMaxPriceCents: integer("autobuy_max_price_cents"),
  autobuyMonthlyCapCents: integer("autobuy_monthly_cap_cents"),
  autobuyLeadDays: integer("autobuy_lead_days").notNull().default(3),
  // Null = the default in src/core/predict.ts.
  lowStockThresholdDays: integer("low_stock_threshold_days"),
  // The stores the user wants to buy from, most wanted first. Empty = no preference.
  preferredStores: text("preferred_stores").array().notNull().default(sql`'{}'::text[]`),
  // "Don't show me this again" on the Buy for me confirmation. Settings > Payment & delivery turns it back on.
  skipBuyConfirm: boolean("skip_buy_confirm").notNull().default(false),
  // Where orders are delivered (Settings > Payment & delivery). All filled in or all empty.
  shippingFirstName: text("shipping_first_name"),
  shippingLastName: text("shipping_last_name"),
  shippingLine1: text("shipping_line1"),
  shippingLine2: text("shipping_line2"),
  shippingCity: text("shipping_city"),
  shippingState: text("shipping_state"),
  shippingPostalCode: text("shipping_postal_code"),
  shippingPhone: text("shipping_phone"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// A user's saved PayPal account, set up once so orders can be paid without them being there.
// We keep only PayPal's reference to it (the "vault id"), never card or account details.
// "pending": sent to PayPal to approve and not back yet (setup_token_id); "active": usable (vault_id).
export const paypalAccounts = pgTable("paypal_accounts", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  setupTokenId: text("setup_token_id"),
  vaultId: text("vault_id"),
  payerEmail: text("payer_email"),
  // The shipping address PayPal had on file when they connected: only fills in the delivery form for
  // them to check. Never used to ship anything until they save it.
  suggestedAddress: jsonb("suggested_address"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// What Replenish bought (or tried to) for a user: one row per attempt, from "Buy for me" or
// auto-buy. Each moves through payment (PayPal) and the purchase (Zinc); see src/modules/orders.
// status: "processing" -> "placed", "failed" or "cancelled" (the user stopped it). payment_status: "none"
// (nothing charged), "charged", "refunded" (all of it back), "part-refunded" (the unused part of the
// ceiling back) or "unknown" (PayPal never answered, so we can't say whether it took the money).
// Money is in cents. `listing` and `tracking` are read back through schemas (they come from outside).
export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Kept (as null) if the product is deleted, so the order history survives.
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    productName: text("product_name").notNull(),
    // "buy-now" (the user pressed Buy for me) or "auto" (auto-buy).
    source: text("source").notNull(),
    status: text("status").notNull().default("processing"),
    paymentStatus: text("payment_status").notNull().default("none"),
    failureReason: text("failure_reason"),
    // Why it was bought without asking, in words ("Auto-buy: 86% sure, within your price range").
    decision: text("decision"),
    listing: jsonb("listing").notNull(),
    // How many packs were ordered.
    packs: integer("packs").notNull(),
    // The most Zinc may spend on the item, tax and shipping (its max_price).
    ceilingCents: integer("ceiling_cents").notNull(),
    // Zinc's fee and ours on this order, fixed when it started. Null on orders from before this was stored.
    feesCents: integer("fees_cents"),
    // What PayPal was charged up front: the ceiling plus Zinc's fee and ours.
    chargedCents: integer("charged_cents"),
    // What it really cost, once Zinc has bought it: the retailer's total plus the fees.
    totalCents: integer("total_cents"),
    refundedCents: integer("refunded_cents").notNull().default(0),
    paypalOrderId: text("paypal_order_id"),
    paypalCaptureId: text("paypal_capture_id"),
    zincOrderId: text("zinc_order_id"),
    merchantOrderId: text("merchant_order_id"),
    tracking: jsonb("tracking").notNull().default(sql`'[]'::jsonb`),
    arrivesAt: timestamp("arrives_at", { withTimezone: true }),
    // The order was recorded as a purchase. Until then it is retried, and the product isn't bought again.
    purchaseRecordedAt: timestamp("purchase_recorded_at", { withTimezone: true }),
    // When Zinc was last asked about the parcel, so tracking is checked every few hours, not on every poll.
    trackingCheckedAt: timestamp("tracking_checked_at", { withTimezone: true }),
    // When the user saw how it turned out; null means "tell them next time they open the app".
    seenAt: timestamp("seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("orders_user_idx").on(t.userId, t.createdAt),
    // One order in flight per product, so pressing Buy twice (or auto-buy racing a click) can't buy twice.
    uniqueIndex("orders_one_processing_idx").on(t.productId).where(sql`${t.status} = 'processing'`),
  ],
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

// The private address a user forwards order emails to (o-<token>@EMAIL_DOMAIN). The token is
// the whole secret: unguessable, one per user, replaced to retire the address. The Gmail
// confirmation code is kept only briefly, so the setup page can show it.
export const emailInboxes = pgTable("email_inboxes", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  verificationCode: text("verification_code"),
  // Gmail's "confirm" link from the same email (a Google address), so the user can click it instead of typing the code.
  verificationLink: text("verification_link"),
  verificationAt: timestamp("verification_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// What happened to each forwarded email, so the user can check what we did with their mail.
// Deliberately holds no sender, subject or text: only the outcome and why.
export const emailLog = pgTable(
  "email_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    // "accepted" | "dropped" | "verification"
    outcome: text("outcome").notNull(),
    reason: text("reason"),
    // The store it was recognised as (from our own list), when it was.
    retailer: text("retailer"),
    itemCount: integer("item_count"),
  },
  (t) => [index("email_log_user_date_idx").on(t.userId, t.receivedAt)],
);

// An order line the user rejected, so the same order arriving again (the shipping
// and delivery emails repeat it) isn't brought back. Same key as purchase_events.
export const rejectedLines = pgTable(
  "rejected_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull(),
    lineIndex: integer("line_index").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("rejected_lines_idx").on(t.userId, t.idempotencyKey, t.lineIndex)],
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
    // "pending" = stored by an automatic source (email) and waiting for the user to approve it.
    // Pending purchases count in estimates like any other; rejecting one deletes it.
    status: text("status").notNull().default("approved"),
    // When a pending purchase stops asking and counts as approved (an order for a product the
    // user already had). Null on a pending purchase means no limit: it made a new product and
    // waits for an answer. See core/pending.ts.
    pendingUntil: timestamp("pending_until", { withTimezone: true }),
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
  (t) => [index("inventory_corrections_product_date_idx").on(t.productId, t.recordedAt), index("inventory_corrections_user_idx").on(t.userId)],
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

// What the restock check found for a low product, kept so the user can be asked about it the next
// time they log in (src/modules/restock). One row per product: `found` is the search's result
// (the best listing and up to two others), read back through a schema because it comes from outside.
// `snoozed_until`: the user said "not now", so it isn't shown or bought until then.
export const restockSuggestions = pgTable(
  "restock_suggestions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("open"),
    found: jsonb("found").notNull(),
    searchedAt: timestamp("searched_at", { withTimezone: true }).notNull(),
    snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("restock_suggestions_product_idx").on(t.productId), index("restock_suggestions_user_idx").on(t.userId)],
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
export type RestockSuggestionRow = typeof restockSuggestions.$inferSelect;
export type OrderRow = typeof orders.$inferSelect;
export type PaypalAccountRow = typeof paypalAccounts.$inferSelect;
