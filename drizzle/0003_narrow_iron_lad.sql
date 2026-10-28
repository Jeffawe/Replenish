CREATE TABLE "ignored_wordings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"wording" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "purchase_events" ADD COLUMN "brand" text;--> statement-breakpoint
ALTER TABLE "ignored_wordings" ADD CONSTRAINT "ignored_wordings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ignored_wordings_user_wording_idx" ON "ignored_wordings" USING btree ("user_id","wording");