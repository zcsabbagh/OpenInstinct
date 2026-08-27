CREATE TABLE "web_monitors" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"owner_principal_id" text NOT NULL,
	"authenticator" text NOT NULL,
	"issuer" text,
	"linq_thread" text,
	"linq_thread_id" text,
	"owner_handle" text,
	"query" text NOT NULL,
	"exa_webset_id" text NOT NULL,
	"exa_monitor_id" text NOT NULL,
	"seen_item_ids" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "web_monitors_workspace_idx" ON "web_monitors" USING btree ("workspace_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "web_monitors_exa_webset_idx" ON "web_monitors" USING btree ("exa_webset_id");--> statement-breakpoint
CREATE INDEX "web_monitors_exa_monitor_idx" ON "web_monitors" USING btree ("exa_monitor_id");