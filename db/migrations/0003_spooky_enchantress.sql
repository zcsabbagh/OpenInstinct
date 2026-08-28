CREATE TABLE "schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"owner_principal_id" text NOT NULL,
	"authenticator" text NOT NULL,
	"issuer" text,
	"linq_thread" text,
	"owner_handle" text,
	"task" text NOT NULL,
	"next_run_at" text NOT NULL,
	"every_minutes" integer,
	"enabled" integer DEFAULT 1 NOT NULL,
	"lease_token" text,
	"lease_expires_at" text,
	"last_run_at" text,
	"created_at" text NOT NULL,
	CONSTRAINT "schedules_enabled_check" CHECK ("schedules"."enabled" IN (0, 1)),
	CONSTRAINT "schedules_every_minutes_check" CHECK ("schedules"."every_minutes" IS NULL OR "schedules"."every_minutes" >= 1)
);
--> statement-breakpoint
CREATE INDEX "schedules_due_idx" ON "schedules" USING btree ("enabled","next_run_at");--> statement-breakpoint
CREATE INDEX "schedules_workspace_idx" ON "schedules" USING btree ("workspace_id","created_at" DESC NULLS FIRST);