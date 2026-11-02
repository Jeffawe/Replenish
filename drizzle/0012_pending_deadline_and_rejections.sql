CREATE TABLE "rejected_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"line_index" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "purchase_events" ADD COLUMN "pending_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rejected_lines" ADD CONSTRAINT "rejected_lines_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rejected_lines_idx" ON "rejected_lines" USING btree ("user_id","idempotency_key","line_index");