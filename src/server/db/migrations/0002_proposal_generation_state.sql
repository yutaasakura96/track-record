CREATE TYPE "public"."generation_status" AS ENUM('generating', 'ready', 'failed');--> statement-breakpoint
ALTER TABLE "render_proposals" ADD COLUMN "generation_status" "generation_status" DEFAULT 'generating' NOT NULL;--> statement-breakpoint
ALTER TABLE "render_proposals" ADD COLUMN "generation_error" text;