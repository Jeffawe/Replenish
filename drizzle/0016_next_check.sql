ALTER TABLE "products" ADD COLUMN "next_check_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "products_next_check_idx" ON "products" USING btree ("next_check_at");