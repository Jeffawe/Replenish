CREATE TABLE "user_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"autobuy_min_confidence" double precision DEFAULT 0.8 NOT NULL,
	"autobuy_min_price_cents" integer,
	"autobuy_max_price_cents" integer,
	"autobuy_monthly_cap_cents" integer,
	"autobuy_lead_days" integer DEFAULT 3 NOT NULL,
	"low_stock_threshold_days" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "autobuy_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "autobuy_min_price_cents" integer;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "autobuy_max_price_cents" integer;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "bought_from" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "bought_from_by_user" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;