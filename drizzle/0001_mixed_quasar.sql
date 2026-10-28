ALTER TABLE "purchase_events" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "purchase_events" ADD COLUMN "line_index" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_events_idempotency_idx" ON "purchase_events" USING btree ("user_id","idempotency_key","line_index");