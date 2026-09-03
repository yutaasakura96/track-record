ALTER TABLE "import_chunks" ADD COLUMN "input_tokens" integer;--> statement-breakpoint
ALTER TABLE "import_chunks" ADD COLUMN "output_tokens" integer;--> statement-breakpoint
ALTER TABLE "import_chunks" ADD COLUMN "cache_creation_input_tokens" integer;--> statement-breakpoint
ALTER TABLE "import_chunks" ADD COLUMN "cache_read_input_tokens" integer;--> statement-breakpoint
ALTER TABLE "render_proposals" ADD COLUMN "input_tokens" integer;--> statement-breakpoint
ALTER TABLE "render_proposals" ADD COLUMN "output_tokens" integer;--> statement-breakpoint
ALTER TABLE "render_proposals" ADD COLUMN "cache_creation_input_tokens" integer;--> statement-breakpoint
ALTER TABLE "render_proposals" ADD COLUMN "cache_read_input_tokens" integer;