CREATE TABLE "login_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "purchase_recorded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "tracking_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "restock_none_found_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "low_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "restock_suggestions" ADD COLUMN "snoozed_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "preferred_stores" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
CREATE INDEX "login_attempts_key_date_idx" ON "login_attempts" USING btree ("key","created_at");--> statement-breakpoint
CREATE INDEX "inventory_corrections_user_idx" ON "inventory_corrections" USING btree ("user_id");--> statement-breakpoint
UPDATE "restock_suggestions" SET "status" = 'open', "snoozed_until" = now() + interval '3 days' WHERE "status" = 'dismissed';
