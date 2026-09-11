CREATE TYPE "public"."version_origin" AS ENUM('accepted', 'restored', 'edited');--> statement-breakpoint
ALTER TABLE "render_versions" RENAME COLUMN "restored_from_version_id" TO "source_version_id";--> statement-breakpoint
ALTER TABLE "render_versions" ADD COLUMN "origin" "version_origin" DEFAULT 'accepted' NOT NULL;
