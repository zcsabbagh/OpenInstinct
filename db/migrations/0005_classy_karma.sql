CREATE TABLE "invites" (
	"code" text PRIMARY KEY NOT NULL,
	"issuer_workspace_id" text NOT NULL,
	"issuer_principal_id" text NOT NULL,
	"created_at" text NOT NULL,
	"redeemed_at" text,
	"redeemed_by_handle" text
);
--> statement-breakpoint
ALTER TABLE "workspace_prefs" ADD COLUMN "introduced_at" text;--> statement-breakpoint
CREATE INDEX "invites_issuer_idx" ON "invites" USING btree ("issuer_workspace_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "invites_redeemed_by_idx" ON "invites" USING btree ("redeemed_by_handle");