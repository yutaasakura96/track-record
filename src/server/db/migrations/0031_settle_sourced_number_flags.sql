UPDATE fact_flags AS flag
SET checked_at = now(), system_settled_at = now(), updated_at = now()
FROM facts AS fact
WHERE flag.fact_id = fact.id
  AND flag.user_id = fact.user_id
  AND flag.kind = 'number'
  AND flag.checked_at IS NULL
  AND flag.system_settled_at IS NULL
  AND flag.explanation IS NULL
  AND flag.updated_at = flag.created_at
  AND (
    (
      fact.claim ~ '(^|[^A-Za-z0-9])(19|20)[0-9]{2}年?($|[^A-Za-z0-9])'
      AND regexp_replace(fact.claim, '(19|20)[0-9]{2}年?', '', 'g') !~ '[0-9０-９]'
      AND fact.claim !~* '(^|[^A-Za-z])(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundreds|thousands|millions)[ -]'
      AND fact.claim !~ '[〇一二三四五六七八九十百千万億]+(割|倍|名|人|件|年|ヶ月|か月|カ月|週間|時間|秒|社|台|円|回|％|%)'
    )
    OR (
      fact.quote IS NOT NULL
      AND length(fact.claim) > 1
      AND fact.claim !~ '^[0-9０-９]'
      AND fact.claim !~ '[0-9０-９]$'
      AND position(fact.claim in fact.quote) > 0
    )
  );
