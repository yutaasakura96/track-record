-- Classify every certification again before the column becomes required
-- (docs/06, 2026-10-22). 0027 called each non-language row technical, a driving
-- licence included, so the English résumé printed it under Certifications; and a
-- row added since without a kind printed there too, a TOEIC score among them.
-- Only an unset or technical row is moved: technical is the one value 0027 wrote
-- without reading the name, and neither a licence nor a language score is one.
-- A row the author already called language or other keeps its kind.
UPDATE "certifications" SET "kind" = 'other'::"certification_kind"
WHERE ("kind" IS NULL OR "kind" = 'technical')
  AND concat_ws(' ', "name", "name_ja") ~* '(driv(er|ing)\S* +licen[cs]e|運転免許|自動車免許)';--> statement-breakpoint
UPDATE "certifications" SET "kind" = 'language'::"certification_kind"
WHERE ("kind" IS NULL OR "kind" = 'technical')
  AND concat_ws(' ', "name", "name_ja") ~* '(TOEIC|TOEFL|IELTS|JLPT|Eiken|英検|Cambridge English|英語検定|英語技能検定|日本語能力試験|Duolingo English Test|Versant|TOPIK|DELE|DELF|DALF|HSK)';--> statement-breakpoint
UPDATE "certifications" SET "kind" = 'technical'::"certification_kind" WHERE "kind" IS NULL;--> statement-breakpoint
ALTER TABLE "certifications" ALTER COLUMN "kind" SET NOT NULL;
