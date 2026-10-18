CREATE TYPE "public"."certification_kind" AS ENUM('technical', 'language', 'other');--> statement-breakpoint
CREATE TYPE "public"."paper_size" AS ENUM('a4', 'letter');--> statement-breakpoint
ALTER TABLE "certifications" ADD COLUMN "kind" "certification_kind";--> statement-breakpoint
ALTER TABLE "employers" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "paper_size" "paper_size" DEFAULT 'a4' NOT NULL;