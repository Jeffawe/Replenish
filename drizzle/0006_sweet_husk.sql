CREATE TABLE "dictionary_brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"terms" text[] DEFAULT '{}'::text[] NOT NULL,
	"implies_item_id" uuid,
	"source" text DEFAULT 'manual' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dictionary_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store" text NOT NULL,
	"code" text NOT NULL,
	"item_id" uuid NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"evidence" text[] DEFAULT '{}'::text[] NOT NULL,
	"conflict" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dictionary_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"category" text NOT NULL,
	"unit" text,
	"consumable" boolean DEFAULT true NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dictionary_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"text" text NOT NULL,
	"item_id" uuid NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"evidence" text[] DEFAULT '{}'::text[] NOT NULL,
	"conflict" boolean DEFAULT false NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dictionary_brands" ADD CONSTRAINT "dictionary_brands_implies_item_id_dictionary_items_id_fk" FOREIGN KEY ("implies_item_id") REFERENCES "public"."dictionary_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dictionary_codes" ADD CONSTRAINT "dictionary_codes_item_id_dictionary_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."dictionary_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dictionary_terms" ADD CONSTRAINT "dictionary_terms_item_id_dictionary_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."dictionary_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dictionary_brands_name_idx" ON "dictionary_brands" USING btree ("normalized_name");--> statement-breakpoint
CREATE UNIQUE INDEX "dictionary_codes_store_code_item_idx" ON "dictionary_codes" USING btree ("store","code","item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dictionary_items_name_idx" ON "dictionary_items" USING btree ("normalized_name");--> statement-breakpoint
CREATE UNIQUE INDEX "dictionary_terms_text_item_idx" ON "dictionary_terms" USING btree ("text","item_id");