ALTER TABLE "schedules" ADD COLUMN "repeat_kind" text;--> statement-breakpoint
ALTER TABLE "schedules" ADD COLUMN "timezone" text;--> statement-breakpoint
ALTER TABLE "schedules" ADD COLUMN "anchor_hour" integer;--> statement-breakpoint
ALTER TABLE "schedules" ADD COLUMN "anchor_minute" integer;--> statement-breakpoint
ALTER TABLE "schedules" ADD COLUMN "repeat_day_of_week" integer;--> statement-breakpoint
ALTER TABLE "schedules" ADD COLUMN "repeat_day_of_month" integer;--> statement-breakpoint
ALTER TABLE "schedules" ADD COLUMN "repeat_month" integer;--> statement-breakpoint
-- Backfill: every pre-existing recurring row used the old fixed-interval
-- representation (`every_minutes` = 1440, i.e. "daily"; nothing else was ever
-- writable through the tool). Re-express each as a `repeat_kind = 'daily'`
-- rule anchored to the wall-clock hour/minute it was already firing at, in the
-- timezone on file for its workspace, so the drift fix in `agent/lib/schedule-store.ts`
-- (anchor-based re-scheduling instead of accumulating off the actual fire
-- time) applies to them going forward with no behavior change at cutover.
--
-- Rows whose workspace never saved a timezone (`workspace_prefs` has no row,
-- or `timezone` is null) anchor to UTC instead: this preserves exactly the
-- instant they already fire at today, and still eliminates future drift for
-- them -- it does not regress anything, since those rows had no timezone
-- concept before this migration either.
UPDATE "schedules" AS s
SET
  "repeat_kind" = 'daily',
  "timezone" = COALESCE(wp."timezone", 'UTC'),
  "anchor_hour" = EXTRACT(HOUR FROM (s."next_run_at"::timestamptz AT TIME ZONE COALESCE(wp."timezone", 'UTC')))::integer,
  "anchor_minute" = EXTRACT(MINUTE FROM (s."next_run_at"::timestamptz AT TIME ZONE COALESCE(wp."timezone", 'UTC')))::integer,
  "every_minutes" = NULL
FROM (SELECT "workspace_id", "timezone" FROM "workspace_prefs") AS wp
WHERE wp."workspace_id" = s."workspace_id"
  AND s."every_minutes" IS NOT NULL;--> statement-breakpoint
-- Same backfill for rows whose workspace has no `workspace_prefs` row at all
-- (the LEFT-JOIN-shaped case the UPDATE ... FROM above cannot reach).
UPDATE "schedules" AS s
SET
  "repeat_kind" = 'daily',
  "timezone" = 'UTC',
  "anchor_hour" = EXTRACT(HOUR FROM s."next_run_at"::timestamptz)::integer,
  "anchor_minute" = EXTRACT(MINUTE FROM s."next_run_at"::timestamptz)::integer,
  "every_minutes" = NULL
WHERE s."every_minutes" IS NOT NULL
  AND s."repeat_kind" IS NULL;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_repeat_kind_check" CHECK ("schedules"."repeat_kind" IS NULL OR "schedules"."repeat_kind" IN ('daily', 'weekly', 'monthly', 'yearly'));--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_anchor_hour_check" CHECK ("schedules"."anchor_hour" IS NULL OR "schedules"."anchor_hour" BETWEEN 0 AND 23);--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_anchor_minute_check" CHECK ("schedules"."anchor_minute" IS NULL OR "schedules"."anchor_minute" BETWEEN 0 AND 59);--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_repeat_day_of_week_check" CHECK ("schedules"."repeat_day_of_week" IS NULL OR "schedules"."repeat_day_of_week" BETWEEN 0 AND 6);--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_repeat_day_of_month_check" CHECK ("schedules"."repeat_day_of_month" IS NULL OR "schedules"."repeat_day_of_month" BETWEEN 1 AND 31);--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_repeat_month_check" CHECK ("schedules"."repeat_month" IS NULL OR "schedules"."repeat_month" BETWEEN 1 AND 12);