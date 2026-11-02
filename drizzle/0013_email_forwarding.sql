CREATE TABLE "email_inboxes" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"verification_code" text,
	"verification_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_inboxes_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "email_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"outcome" text NOT NULL,
	"reason" text,
	"retailer" text,
	"item_count" integer
);
--> statement-breakpoint
ALTER TABLE "email_inboxes" ADD CONSTRAINT "email_inboxes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_log" ADD CONSTRAINT "email_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_log_user_date_idx" ON "email_log" USING btree ("user_id","received_at");