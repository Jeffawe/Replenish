ALTER TABLE "users" ADD COLUMN "approved_at" timestamp with time zone;
--> statement-breakpoint
-- Everyone who already has an account keeps using the app when approval is switched on.
UPDATE "users" SET "approved_at" = now();
