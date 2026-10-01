ALTER TABLE "facts" ADD COLUMN "employer_set_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "source_documents" ADD COLUMN "employer_id" text;--> statement-breakpoint
ALTER TABLE "source_documents" ADD CONSTRAINT "source_documents_employer_id_employers_id_fk" FOREIGN KEY ("employer_id") REFERENCES "public"."employers"("id") ON DELETE restrict ON UPDATE no action;