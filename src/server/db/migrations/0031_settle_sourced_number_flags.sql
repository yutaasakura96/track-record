WITH eligible AS (
  SELECT flag.id,
    lower(regexp_replace(translate(fact.claim, '０１２３４５６７８９，', '0123456789,'), ',(?=[0-9]{3}([^0-9]|$))', '', 'g')) AS claim_text,
    lower(regexp_replace(translate(coalesce(fact.quote, ''), '０１２３４５６７８９，', '0123456789,'), ',(?=[0-9]{3}([^0-9]|$))', '', 'g')) AS quote_text,
    '(^|[^A-Za-z0-9_.])([¥$€£]?[0-9]+(\.[0-9]+)?)([[:space:]]+(hundred|thousand|million|billion)|[万億])?([[:space:]]+([A-Za-z]+)|[[:space:]]*([^A-Za-z0-9[:space:]]))?(?![A-Za-z0-9_]|[.,][0-9])'::text AS pattern
  FROM fact_flags AS flag
  JOIN facts AS fact ON fact.id = flag.fact_id AND fact.user_id = flag.user_id
  WHERE flag.kind = 'number'
    AND flag.checked_at IS NULL
    AND flag.system_settled_at IS NULL
    AND flag.explanation IS NULL
    AND flag.updated_at = flag.created_at
), counted AS (
  SELECT eligible.*,
    (SELECT count(*) FROM regexp_matches(claim_text, '[0-9]+(\.[0-9]+)?', 'g')) AS digit_runs,
    (SELECT count(*) FROM regexp_matches(claim_text, pattern, 'g')) AS complete_runs
  FROM eligible
)
UPDATE fact_flags AS flag
SET checked_at = now(), system_settled_at = now(), updated_at = now()
FROM counted AS fact
WHERE flag.id = fact.id
  AND fact.digit_runs > 0
  AND fact.digit_runs = fact.complete_runs
  AND fact.claim_text !~ '[〇一二三四五六七八九十百千万億]+(割|倍|名|人|件|年|ヶ月|か月|カ月|週間|時間|秒|社|台|円|回|％|%)'
  AND fact.claim_text !~ '\m(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundreds|thousands|millions)\M'
  AND NOT EXISTS (
    SELECT 1
    FROM regexp_matches(fact.claim_text, fact.pattern, 'g') AS claim_part(parts)
    WHERE NOT (
      (
        claim_part.parts[2] ~ '^(19|20)[0-9]{2}$'
        AND (claim_part.parts[1] = '' OR claim_part.parts[1] ~ '^[[:space:]]$')
        AND claim_part.parts[4] IS NULL
        AND claim_part.parts[7] IS NULL
        AND (
          claim_part.parts[8] IS NULL
          OR claim_part.parts[8] ~ '^[.,;:!?。、「」『』()（）]$'
          OR (claim_part.parts[8] = '年' AND fact.claim_text !~ '年[一-龥ァ-ヴ0-9%％×]')
        )
      )
      OR EXISTS (
        SELECT 1
        FROM regexp_matches(fact.quote_text, fact.pattern, 'g') AS quote_part(parts)
        WHERE claim_part.parts[2] = quote_part.parts[2]
          AND coalesce(btrim(claim_part.parts[4]), '') = coalesce(btrim(quote_part.parts[4]), '')
          AND coalesce(claim_part.parts[7], CASE WHEN claim_part.parts[8] ~ '^[[:punct:]]$' AND claim_part.parts[8] NOT IN ('%', '％', '×') THEN '' ELSE claim_part.parts[8] END, '')
            = coalesce(quote_part.parts[7], CASE WHEN quote_part.parts[8] ~ '^[[:punct:]]$' AND quote_part.parts[8] NOT IN ('%', '％', '×') THEN '' ELSE quote_part.parts[8] END, '')
      )
    )
  );
