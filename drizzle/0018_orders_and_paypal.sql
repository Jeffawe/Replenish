CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"product_id" uuid,
	"product_name" text NOT NULL,
	"source" text NOT NULL,
	"status" text DEFAULT 'processing' NOT NULL,
	"payment_status" text DEFAULT 'none' NOT NULL,
	"failure_reason" text,
	"decision" text,
	"listing" jsonb NOT NULL,
	"packs" integer NOT NULL,
	"ceiling_cents" integer NOT NULL,
	"charged_cents" integer,
	"total_cents" integer,
	"refunded_cents" integer DEFAULT 0 NOT NULL,
	"paypal_order_id" text,
	"paypal_capture_id" text,
	"zinc_order_id" text,
	"merchant_order_id" text,
	"tracking" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"arrives_at" timestamp with time zone,
	"seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paypal_accounts" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"setup_token_id" text,
	"vault_id" text,
	"payer_email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "shipping_first_name" text;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "shipping_last_name" text;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "shipping_line1" text;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "shipping_line2" text;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "shipping_city" text;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "shipping_state" text;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "shipping_postal_code" text;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "shipping_phone" text;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paypal_accounts" ADD CONSTRAINT "paypal_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orders_user_idx" ON "orders" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_one_processing_idx" ON "orders" USING btree ("product_id") WHERE "orders"."status" = 'processing';