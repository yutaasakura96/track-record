CREATE TYPE "public"."chunk_status" AS ENUM('pending', 'done', 'failed');--> statement-breakpoint
CREATE TABLE "import_chunks" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"source_document_version_id" text NOT NULL,
	"chunk_index" integer NOT NULL,
	"start_offset" integer NOT NULL,
	"end_offset" integer NOT NULL,
	"status" "chunk_status" DEFAULT 'pending' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "source_document_versions" ADD COLUMN "chunks_total" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "source_document_versions" ADD COLUMN "chunks_done" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "source_document_versions" ADD COLUMN "candidates_discarded" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "source_document_versions" ADD COLUMN "changed_region_share" double precision;--> statement-breakpoint
ALTER TABLE "import_chunks" ADD CONSTRAINT "import_chunks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_chunks" ADD CONSTRAINT "import_chunks_source_document_version_id_source_document_versions_id_fk" FOREIGN KEY ("source_document_version_id") REFERENCES "public"."source_document_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "import_chunks_sdv_index_uq" ON "import_chunks" USING btree ("source_document_version_id","chunk_index");--> statement-breakpoint
CREATE INDEX "import_chunks_user_idx" ON "import_chunks" USING btree ("user_id");