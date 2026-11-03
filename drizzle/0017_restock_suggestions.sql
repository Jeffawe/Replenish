CREATE TABLE "restock_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"found" jsonb NOT NULL,
	"searched_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "restock_suggestions" ADD CONSTRAINT "restock_suggestions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restock_suggestions" ADD CONSTRAINT "restock_suggestions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "restock_suggestions_product_idx" ON "restock_suggestions" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "restock_suggestions_user_idx" ON "restock_suggestions" USING btree ("user_id");