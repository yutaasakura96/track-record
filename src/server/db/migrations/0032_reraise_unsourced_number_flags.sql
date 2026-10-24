-- Re-raises the number flags 0031 settled that the stricter rule keeps (issue #115 follow-up,
-- `docs/06` 2026-10-23). 0031 matched a number and the single token after it, so `3カ月` was
-- sourced by `3カ国`; `unsourcedNumber` (`src/pipeline/flags.ts`) now asks for the same complete
-- quantity. These functions port it step for step, and are dropped at the end.
--
-- Only a flag 0031 settled and nobody touched since is re-evaluated: system-settled, no
-- explanation, and not updated after the settlement. An author check clears `system_settled_at`
-- (`routes/flags.ts`), so a flag the author checked is never in that set. Nothing is settled here,
-- no other kind is read, and no fact is written. A re-raised flag has no settlement, so a second
-- run finds nothing to do.
--
-- 0031 never settled a claim holding a number word or a kanji figure, so these read digits only
-- and keep any such claim flagged: anything they cannot read the way the code does stays on the list.
-- A kanji scale after digits (`3万人`) is the digits' scale, read with them.
CREATE FUNCTION number_flag_plain(value text) RETURNS text LANGUAGE sql IMMUTABLE AS $fn$
  SELECT lower(regexp_replace(normalize(coalesce(value, ''), NFKC), '(?<=[0-9]),(?=[0-9]{3})', '', 'g'))
$fn$;
--> statement-breakpoint
CREATE FUNCTION number_flag_unit(tail text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $fn$
DECLARE
  rest text := tail;
  first text;
  word text;
  counter text;
BEGIN
  LOOP
    first := regexp_replace(regexp_replace(rest, '^\s+', ''), '^-(?=[a-z])', '');
    IF first ~ '^(?:(?:(?:per|a|an)\s+|/)(?:seconds?|minutes?|hours?|days?|weeks?|months?|quarters?|years?)\M|/?(?:毎日|毎週|毎月|毎年|日間|週間|月間|年間))' THEN
      RETURN btrim(substring(first from '^(?:(?:(?:per|a|an)\s+|/)(?:seconds?|minutes?|hours?|days?|weeks?|months?|quarters?|years?)\M|/?(?:毎日|毎週|毎月|毎年|日間|週間|月間|年間))'));
    END IF;
    word := substring(first from '^[a-z]+(?:-[a-z]+)*');
    IF word = 'active'
      AND substr(first, length(word) + 1) ~ '^\s' THEN
      rest := substr(first, length(word) + 1);
      CONTINUE;
    END IF;
    IF word IS NOT NULL THEN
      RETURN word || coalesce(btrim(substring(substr(first, length(word) + 1) from '^(?:\s*(?:(?:per|a|an)\s+|/)(?:seconds?|minutes?|hours?|days?|weeks?|months?|quarters?|years?)\M|\s*/?(?:毎日|毎週|毎月|毎年|日間|週間|月間|年間))')), '');
    END IF;
    counter := coalesce(
      substring(first from '^(?:[ヶヵカか](?:月|国|所)|箇所|人月|人日|週間|時間|年間|年度|千円|名|人|件|社|台|回|倍|割|円|年|月|日|週|分|秒|本|個)'),
      substring(first from '^[㐀-䶿一-鿿々゠-ヿ]+'));
    IF counter IS NOT NULL THEN
      RETURN counter || coalesce(btrim(substring(substr(first, length(counter) + 1) from '^(?:\s*(?:(?:per|a|an)\s+|/)(?:seconds?|minutes?|hours?|days?|weeks?|months?|quarters?|years?)\M|\s*/?(?:毎日|毎週|毎月|毎年|日間|週間|月間|年間))')), '');
    END IF;
    IF first = '' OR strpos('.,;:!?''"()[]{}<>/\|~_-。、・「」『』【】〔〕…‥〜—–‐“”‘’', left(first, 1)) > 0 THEN
      RETURN coalesce(btrim(substring(first from '^(?:\s+(?:per|a|an)\s+(?:seconds?|minutes?|hours?|days?|weeks?|months?|quarters?|years?)\M|\s*/?(?:毎日|毎週|毎月|毎年|日間|週間|月間|年間))')), '');
    END IF;
    RETURN left(first, 1);
  END LOOP;
END
$fn$;
--> statement-breakpoint
CREATE FUNCTION number_flag_unsourced(claim text, quote text, technologies text[]) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $fn$
DECLARE
  claim_text text := number_flag_plain(claim);
  passage text := number_flag_plain(quote);
  letter constant text := '[a-zÀ-ɏͰ-ϿЀ-ӿ぀-ヿ㐀-䶿一-鿿가-힯]';
  unit_word constant text := '(?:percent|ms|milliseconds?|seconds?|secs?|s|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|quarters?|years?|kb|mb|gb|tb|pb|requests?|users?|people|engineers?|developers?|members?|services?|teams?|squads?|clients?|customers?|participants?|countries|languages|releases?|times)';
  counter constant text := '(?:%|×|倍|割|名|人|件|社|台|万円|億円|円|万|億|回|時間|日|週間|ヶ月|か月|カ月|年間|年|分|秒)';
  figure_pattern text;
  figure text;
  figure_start int;
  figure_end int;
  named boolean;
  technology text;
  name text;
  search_from int;
  found_at int;
  head text;
  rest text;
  scale text;
  claim_tail text;
  unit text;
  occurrence_pattern text;
  occurrence int;
  quote_rest text;
  quote_scale text;
  sourced boolean;
BEGIN
  IF claim_text ~ '\m(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundreds|thousands|millions)\M'
    OR claim_text ~ '(?<![0-9〇一二三四五六七八九十百千万億])[〇一二三四五六七八九十百千万億]+(?:割|倍|名|人|件|年|[ヶヵカか](?:月|国|所)|箇所|週間|時間|秒|社|台|円|回|%)' THEN
    RETURN true;
  END IF;

  figure_pattern := '[0-9]+ in [0-9]+|[¥$€£]?[0-9]+(?:\.[0-9]+)?(?:(?:bn|[kmb])(?![0-9]|' || letter || ')|\s?' || counter
    || '|x(?!' || letter || '))?(?: (?:hundred|thousand|million|billion))?(?: ?' || unit_word || '(?!' || letter || '))?';

  FOR n IN 1..regexp_count(claim_text, figure_pattern) LOOP
    figure := regexp_substr(claim_text, figure_pattern, 1, n);
    figure_start := regexp_instr(claim_text, figure_pattern, 1, n);
    figure_end := figure_start + length(figure);

    -- Not a figure: inside a word, a version or address, a name after a hyphen, a year alone.
    CONTINUE WHEN substr(claim_text, figure_start - 1, 1) ~ '[a-z0-9_]' AND figure_start > 1;
    CONTINUE WHEN substr(claim_text, figure_end, 1) ~ '[a-z0-9_]';
    CONTINUE WHEN substr(claim_text, figure_end, 2) ~ '^[.:][0-9]';
    CONTINUE WHEN figure_start > 2 AND substr(claim_text, figure_start - 2, 2) ~ '^(?:[0-9][.:]|[a-z]-)$';
    CONTINUE WHEN figure ~ '^(?:19|20)[0-9]{2}年?$' AND substr(claim_text, figure_end) !~ ('^(?:\s+[a-z]|' || counter || ')');

    -- A technology's own digits (`S3`, `Java 17`).
    named := false;
    FOREACH technology IN ARRAY coalesce(technologies, '{}') LOOP
      name := regexp_replace(number_flag_plain(technology), '^\s+|\s+$', '', 'g');
      CONTINUE WHEN name = '' OR name !~ '[0-9]';
      search_from := 1;
      LOOP
        found_at := strpos(substr(claim_text, search_from), name);
        EXIT WHEN found_at = 0;
        found_at := search_from + found_at - 1;
        IF figure_start < found_at + length(name) AND figure_end > found_at THEN named := true; END IF;
        search_from := found_at + length(name);
      END LOOP;
    END LOOP;
    CONTINUE WHEN named;

    -- The same complete quantity in the quote, or the figure is unsourced.
    head := coalesce(substring(figure from '^[0-9]+ in [0-9]+'), substring(figure from '^[¥$€£]?[0-9]+(?:\.[0-9]+)?'));
    rest := substr(figure, length(head) + 1) || substr(claim_text, figure_end);
    scale := coalesce(substring(rest from '^(?: (?:hundred|thousand|million|billion)|[万億]|bn|[kmb])(?=$|[^a-z])'), '');
    claim_tail := substr(rest, length(scale) + 1);
    scale := btrim(scale);
    unit := number_flag_unit(claim_tail);
    occurrence_pattern := '(?<![a-z0-9_.¥$€£])(?<![a-z]-)(?<!(?:one|[0-9]) in )'
      || regexp_replace(head, '([^0-9a-z ])', '\\\1', 'g') || '(?![0-9]|[.,][0-9])';
    sourced := false;
    FOR occurrence IN 1..regexp_count(passage, occurrence_pattern) LOOP
      quote_rest := substr(passage, regexp_instr(passage, occurrence_pattern, 1, occurrence) + length(head));
      quote_scale := coalesce(substring(quote_rest from '^(?: (?:hundred|thousand|million|billion)|[万億]|bn|[kmb])(?=$|[^a-z])'), '');
      quote_rest := substr(quote_rest, length(quote_scale) + 1);
      CONTINUE WHEN btrim(quote_scale) <> scale;
      CONTINUE WHEN claim_tail ~ '^\s+[a-z]' AND quote_rest ~ '^[a-z]';
      IF number_flag_unit(quote_rest) = unit THEN
        sourced := true;
        EXIT;
      END IF;
    END LOOP;
    IF NOT sourced THEN RETURN true; END IF;
  END LOOP;
  RETURN false;
END
$fn$;
--> statement-breakpoint
UPDATE fact_flags AS flag
SET checked_at = NULL, system_settled_at = NULL, updated_at = now()
FROM facts AS fact
WHERE fact.id = flag.fact_id
  AND fact.user_id = flag.user_id
  AND flag.kind = 'number'
  AND flag.checked_at IS NOT NULL
  AND flag.system_settled_at IS NOT NULL
  AND flag.explanation IS NULL
  AND flag.updated_at = flag.system_settled_at
  AND number_flag_unsourced(fact.claim, fact.quote, fact.technologies);
--> statement-breakpoint
DROP FUNCTION number_flag_unsourced(text, text, text[]);
--> statement-breakpoint
DROP FUNCTION number_flag_unit(text);
--> statement-breakpoint
DROP FUNCTION number_flag_plain(text);
