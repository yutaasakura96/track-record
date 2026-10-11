-- Reverses 0017_applications.sql. Not run by anything: `drizzle-kit migrate`
-- and the suite read only the files beside the journal. It is here so that
-- taking Applications back out is a script that has been run, not one written
-- on the day (`tests/applications-migration.test.ts` runs it).
--
-- What it removes is what 0017 added and nothing else: the pointer on
-- "renders", the two tables and their type. Every tailored résumé is left as
-- it was before 0017, with its name, its job description and its versions.
-- Applications added since, and their dates, go with the tables.
DROP INDEX "renders_application_idx";--> statement-breakpoint
ALTER TABLE "renders" DROP COLUMN "application_id";--> statement-breakpoint
DROP TABLE "application_steps";--> statement-breakpoint
DROP TABLE "applications";--> statement-breakpoint
DROP TYPE "public"."application_status";
