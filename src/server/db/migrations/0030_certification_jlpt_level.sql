-- 0028 matched a language test only with a non-Latin character after its name,
-- so a row named 'JLPTN1' or 'JLPTN2 合格' with no 日本語能力試験 beside it missed
-- the language update and was set to technical. Move those
-- rows: JLPT followed directly by a level N1 to N5, and nothing longer after it.
-- Only a technical row is moved, so running it again changes nothing.
UPDATE "certifications" SET "kind" = 'language'::"certification_kind"
WHERE "kind" = 'technical'
  AND concat_ws(' ', "name", "name_ja") ~* '(^|[^A-Za-z])JLPTN[1-5]($|[^A-Za-z0-9])';
