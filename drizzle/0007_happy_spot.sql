CREATE TABLE "code_lookups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"found" boolean NOT NULL,
	"name" text,
	"brand" text,
	"categories" text,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "code_lookups_code_idx" ON "code_lookups" USING btree ("code");