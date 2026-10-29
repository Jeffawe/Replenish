CREATE TABLE "question_snoozes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"until" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "question_snoozes" ADD CONSTRAINT "question_snoozes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_snoozes" ADD CONSTRAINT "question_snoozes_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "question_snoozes_user_product_kind_idx" ON "question_snoozes" USING btree ("user_id","product_id","kind");--> statement-breakpoint
-- Products that exist before this change were set up by hand or by earlier testing: count them as checked, so only new ones are asked about.
UPDATE "products" SET "confirmed_at" = now() WHERE "confirmed_at" IS NULL;
