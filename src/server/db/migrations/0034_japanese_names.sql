-- The 職務経歴書 printed English where the record held nothing in Japanese: a
-- project's summary and a curated skill group's name (issue #117). Both are
-- optional, and a row without one is written in Japanese by the model or left out.
ALTER TABLE "projects" ADD COLUMN "summary_ja" text;--> statement-breakpoint
ALTER TABLE "skill_curations" ADD COLUMN "group_name_ja" text;