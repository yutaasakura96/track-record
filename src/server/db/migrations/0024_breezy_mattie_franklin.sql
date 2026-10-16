ALTER TABLE "source_document_versions" ADD COLUMN "batch_id" text;--> statement-breakpoint
ALTER TABLE "source_document_versions" ADD COLUMN "batch_order" integer DEFAULT 0 NOT NULL;