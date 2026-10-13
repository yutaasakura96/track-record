-- Reverses 0020_application_documents.sql. Not run by anything, like the 0017
-- script beside it, and run before that one: `tests/applications-migration.test.ts`
-- runs both, in that order.
--
-- What it removes is what 0019 added and nothing else: the two tables, and the
-- rule of one tailored résumé an application, which goes back to the plain
-- index 0017 made. Every document, version and application is left as it was.
-- The sent copies recorded since go with their table: the files are not kept
-- anywhere else.
DROP TABLE "application_sent_copies";--> statement-breakpoint
DROP TABLE "application_documents";--> statement-breakpoint
DROP INDEX "renders_application_uq";--> statement-breakpoint
CREATE INDEX "renders_application_idx" ON "renders" USING btree ("application_id") WHERE "renders"."application_id" is not null;
