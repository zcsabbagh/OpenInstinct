CREATE TABLE IF NOT EXISTS "vault_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"label" text NOT NULL,
	"value" text NOT NULL,
	"category" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vault_notes_workspace_updated_idx" ON "vault_notes" USING btree ("workspace_id","updated_at" DESC NULLS FIRST);
