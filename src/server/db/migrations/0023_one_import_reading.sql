-- One document is read at a time, per author (#93). An author with two versions
-- already extracting would stop the index below from being built, so every one
-- but the oldest is failed first, with a reason, and is retried from Documents.
UPDATE "source_document_versions" AS "v" SET "import_status" = 'failed', "import_error" = 'This import stopped before it finished. Retry it.', "updated_at" = now() WHERE "v"."import_status" = 'extracting' AND EXISTS (SELECT 1 FROM "source_document_versions" AS "o" WHERE "o"."user_id" = "v"."user_id" AND "o"."import_status" = 'extracting' AND ("o"."imported_at", "o"."id") < ("v"."imported_at", "v"."id"));--> statement-breakpoint
CREATE UNIQUE INDEX "sdv_one_extracting_uq" ON "source_document_versions" USING btree ("user_id") WHERE "source_document_versions"."import_status" = 'extracting';
