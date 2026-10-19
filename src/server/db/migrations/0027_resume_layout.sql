CREATE TYPE "public"."certification_kind" AS ENUM('technical', 'language', 'other');--> statement-breakpoint
CREATE TYPE "public"."paper_size" AS ENUM('a4', 'letter');--> statement-breakpoint
ALTER TABLE "certifications" ADD COLUMN "kind" "certification_kind";--> statement-breakpoint
UPDATE "certifications" SET "kind" = CASE
  WHEN concat_ws(' ', "name", "name_ja") ~* '(TOEIC|TOEFL|IELTS|JLPT|Eiken|英検|Cambridge English|英語検定|日本語能力試験|DELE|DELF|DALF|HSK)' THEN 'language'::"certification_kind"
  ELSE 'technical'::"certification_kind"
END;--> statement-breakpoint
ALTER TABLE "employers" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "paper_size" "paper_size" DEFAULT 'a4' NOT NULL;
