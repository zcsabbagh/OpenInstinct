CREATE TABLE "channel_state" (
	"namespace" text NOT NULL,
	"key" text NOT NULL,
	"value" text,
	"created_at" text NOT NULL,
	"expires_at" text,
	CONSTRAINT "channel_state_pkey" PRIMARY KEY("namespace","key")
);
--> statement-breakpoint
CREATE INDEX "channel_state_expires_idx" ON "channel_state" USING btree ("expires_at");