ALTER TABLE "render_versions" ADD COLUMN "fact_count_at" integer;--> statement-breakpoint
-- One-time backfill for rows created before this column existed (docs/06,
-- 2026-09-12). The count is derived from when each fact was resolved, which is
-- APPROXIMATE and deliberately so: a fact accepted then returned to candidate,
-- or one whose resolved_at is null, is not counted the way it was counted on
-- the day. Deriving at read time would carry the same inexactness forever and
-- force every reader to handle a null; writing it back lazily would put a write
-- on a read path, in a table whose rows are immutable. One UPDATE over a
-- handful of rows, recorded here, is the cheapest honest answer.
UPDATE "render_versions" AS v SET "fact_count_at" = (
  SELECT count(*)::int FROM "facts" AS f
  WHERE f."user_id" = v."user_id"
    AND f."status" = 'accepted'
    AND f."resolved_at" IS NOT NULL
    AND f."resolved_at" <= v."accepted_at"
) WHERE v."fact_count_at" IS NULL;--> statement-breakpoint
ALTER TABLE "render_versions" ALTER COLUMN "fact_count_at" SET NOT NULL;
