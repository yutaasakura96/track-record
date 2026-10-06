-- The staleness number now counts only the facts a document may use: accepted,
-- and neither Private nor Generated (docs/06, 2026-10-05). Every stored count
-- was taken over ALL accepted facts, and left as it is each would stand above
-- the new count by the unusable facts it included, hiding that many new facts.
--
-- One-time restatement: each stored count loses the accepted facts that are
-- unusable today and were resolved by the era the count describes. APPROXIMATE,
-- as 0008's backfill was: a fact re-graded or re-disclosed since is judged by
-- what it is now, not by what it was on the day.
--
-- A version's era is its own accepted_at, except a restored one, which carries
-- the era of the version it restored, through a restore of a restore.
WITH RECURSIVE "era" AS (
  SELECT v."id", v."accepted_at" AS "at" FROM "render_versions" AS v
  WHERE v."origin" <> 'restored' OR v."source_version_id" IS NULL
  UNION ALL
  SELECT v."id", e."at" FROM "render_versions" AS v
  INNER JOIN "era" AS e ON e."id" = v."source_version_id"
  WHERE v."origin" = 'restored'
)
UPDATE "renders" AS r SET "stale_since_fact_count" = greatest(0, r."stale_since_fact_count" - (
  SELECT count(*)::int FROM "facts" AS f
  WHERE f."user_id" = r."user_id"
    AND f."status" = 'accepted'
    AND (f."disclosure" = 'private' OR f."provenance" = 'generated')
    AND (f."resolved_at" IS NULL OR f."resolved_at" <= "era"."at")
))
FROM "era"
-- An edit leaves the render's count alone, so the count is that of the newest
-- version that is not an edit.
WHERE "era"."id" = (
  SELECT v."id" FROM "render_versions" AS v
  WHERE v."render_id" = r."id" AND v."origin" <> 'edited'
  ORDER BY v."version_no" DESC LIMIT 1
);--> statement-breakpoint
WITH RECURSIVE "era" AS (
  SELECT v."id", v."accepted_at" AS "at" FROM "render_versions" AS v
  WHERE v."origin" <> 'restored' OR v."source_version_id" IS NULL
  UNION ALL
  SELECT v."id", e."at" FROM "render_versions" AS v
  INNER JOIN "era" AS e ON e."id" = v."source_version_id"
  WHERE v."origin" = 'restored'
)
UPDATE "render_versions" AS v SET "fact_count_at" = greatest(0, v."fact_count_at" - (
  SELECT count(*)::int FROM "facts" AS f
  WHERE f."user_id" = v."user_id"
    AND f."status" = 'accepted'
    AND (f."disclosure" = 'private' OR f."provenance" = 'generated')
    AND (f."resolved_at" IS NULL OR f."resolved_at" <= "era"."at")
))
FROM "era" WHERE "era"."id" = v."id";
