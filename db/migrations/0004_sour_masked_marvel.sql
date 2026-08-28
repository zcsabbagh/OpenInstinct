CREATE TABLE "workspace_prefs" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"timezone" text,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
DROP INDEX "web_monitors_exa_webset_idx";--> statement-breakpoint
DROP INDEX "web_monitors_exa_monitor_idx";--> statement-breakpoint
ALTER TABLE "web_monitors" ADD COLUMN "next_check_at" text NOT NULL;--> statement-breakpoint
ALTER TABLE "web_monitors" ADD COLUMN "lease_token" text;--> statement-breakpoint
ALTER TABLE "web_monitors" ADD COLUMN "lease_expires_at" text;--> statement-breakpoint
ALTER TABLE "web_monitors" ADD COLUMN "last_checked_at" text;--> statement-breakpoint
CREATE INDEX "web_monitors_due_idx" ON "web_monitors" USING btree ("next_check_at");--> statement-breakpoint
ALTER TABLE "web_monitors" DROP COLUMN "linq_thread_id";--> statement-breakpoint
ALTER TABLE "web_monitors" DROP COLUMN "exa_webset_id";--> statement-breakpoint
ALTER TABLE "web_monitors" DROP COLUMN "exa_monitor_id";