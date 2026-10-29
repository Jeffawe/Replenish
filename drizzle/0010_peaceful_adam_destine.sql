CREATE TABLE "receipt_reads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "receipt_limit" integer;--> statement-breakpoint
ALTER TABLE "receipt_reads" ADD CONSTRAINT "receipt_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "receipt_reads_user_date_idx" ON "receipt_reads" USING btree ("user_id","created_at");