ALTER TABLE "orders" ADD COLUMN "fees_cents" integer;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "skip_buy_confirm" boolean DEFAULT false NOT NULL;