-- Re-raises the number flags 0031 settled that the noun-phrase rule now keeps (issue #115 follow-up,
-- `docs/06` 2026-10-25). 0032 compared only the words after the number it reads as the unit, so
-- `5 clinic reports` was sourced by `5 hospital reports`, `5% of all users` by `5% of all revenue`,
-- and `5 reports` by `2/5 reports`. `unsourcedNumber` (`src/pipeline/flags.ts`) now holds the other
-- words before the unit to the passage and reads a slash ratio as one figure; these functions port
-- it step for step, and are dropped at the end.
--
-- The set it reads is 0032's: a number flag the system settled and nobody touched since, so never
-- one the author checked (`routes/flags.ts` clears `system_settled_at`). Nothing is settled, no other
-- kind is read, and no fact is written; a re-raised flag has no settlement, so a second run finds
-- nothing to do. A claim with a number word or a kanji figure is kept flagged, as in 0032.
CREATE FUNCTION number_flag_plain(value text) RETURNS text LANGUAGE sql IMMUTABLE AS $fn$
  SELECT lower(regexp_replace(normalize(coalesce(value, ''), NFKC), '(?<=[0-9]),(?=[0-9]{3})', '', 'g'))
$fn$;
--> statement-breakpoint
-- `quantityAfter`: the phrase first, then the other words read before the unit.
CREATE FUNCTION number_flag_phrase(tail text) RETURNS text[] LANGUAGE plpgsql IMMUTABLE AS $fn$
DECLARE
  rest text := tail;
  first text;
  word text;
  counter text;
  phrase text := '';
  character text;
  descriptive text[] := '{}';
  rate text;
  percentage_quantity text[];
BEGIN
  LOOP
    first := regexp_replace(regexp_replace(rest, '^\s+', ''), '^-(?=[a-z])', '');
    rate := substring(first from '^(?:per\s+|a\s+|an\s+|/)[a-z]+(?:-[a-z]+)*');
    IF rate IS NOT NULL AND phrase = '' THEN RETURN ARRAY[rate] || descriptive; END IF;
    word := substring(first from '^[a-z]+(?:-[a-z]+)*');
    IF word IS NOT NULL THEN
      EXIT WHEN word ~ '^(?:and|or|but|in|on|at|by|from|to|for|with|after|before|during|across|into|onto|was|were|is|are|has|have|had|overall)$'
        OR (word ~ 'ing$' AND substr(first, length(word) + 1) ~ '^\s+(?:a|an|the)\M');
      IF word ~ '^(?:[a-z]+s|person|people|percent|ms|kb|mb|gb|tb|pb|second|minute|hour|day|week|month|quarter|year|engineer|developer|member|client|customer|user|request|report|ticket|order|payment|service|team|release|country|language)$'
        OR btrim(tail) LIKE '-' || word || '%' THEN
        IF right(word, 3) = 'ies' THEN word := left(word, length(word) - 3) || 'y';
        ELSIF word <> 'ms' AND right(word, 1) = 's' AND right(word, 2) <> 'ss' THEN word := left(word, length(word) - 1);
        END IF;
        phrase := concat_ws(' ', nullif(phrase, ''), word);
        rest := substr(first, length(substring(first from '^[a-z]+(?:-[a-z]+)*')) + 1);
        rate := coalesce(
          btrim(substring(rest from '^(?:\s+per\s+|\s+a\s+|\s+an\s+|/)[a-z]+(?:-[a-z]+)*')),
          btrim(substring(rest from '^\s+(?:daily|weekly|monthly|yearly|unique|distinct|new|concurrent)\M')));
        IF rate IS NOT NULL THEN phrase := phrase || ' ' || rate; END IF;
        RETURN ARRAY[phrase] || descriptive;
      END IF;
      IF word ~ '^(?:daily|weekly|monthly|yearly|unique|distinct|new|concurrent|more|over|less|under|additional)$' OR strpos(word, '-') > 0 THEN
        phrase := concat_ws(' ', nullif(phrase, ''), word);
      ELSIF word !~ '^(?:active|senior)$' THEN descriptive := descriptive || word;
      END IF;
      rest := substr(first, length(word) + 1);
      CONTINUE;
    END IF;
    counter := coalesce(
      substring(first from '^(?:[ヶヵカか](?:月|国|所)|箇所|人月|人日|週間|時間|年間|年度|千円|名|人|件|社|台|回|倍|割|円|年|月|日|週|分|秒|本|個)'),
      substring(first from '^[㐀-䶿一-鿿々゠-ヿ]+'));
    IF counter IS NOT NULL THEN
      phrase := concat_ws(' ', nullif(phrase, ''), counter);
      rest := substr(first, length(counter) + 1);
      word := substring(rest from '^(?:/?(?:毎日|毎週|毎月|毎年|日間|週間|月間|年間)|以上|以下)');
      IF word IS NOT NULL THEN phrase := phrase || ' ' || word; END IF;
      IF word IS NULL AND left(rest, 1) = '/' THEN
        word := coalesce(
          substring(substr(rest, 2) from '^(?:[ヶヵカか](?:月|国|所)|箇所|人月|人日|週間|時間|年間|年度|千円|名|人|件|社|台|回|倍|割|円|年|月|日|週|分|秒|本|個)'),
          substring(substr(rest, 2) from '^[㐀-䶿一-鿿々゠-ヿ]+'));
        IF word IS NOT NULL THEN phrase := phrase || ' /' || word; END IF;
      END IF;
      RETURN ARRAY[phrase] || descriptive;
    END IF;
    character := left(first, 1);
    IF character = '/' AND substr(first, 2, 1) ~ '^[a-z]' THEN
      phrase := concat_ws(' ', nullif(phrase, ''), '/');
      rest := substr(first, 2);
      CONTINUE;
    END IF;
    IF character IN ('+', '%', '×', 'x') THEN
      phrase := concat_ws(' ', nullif(phrase, ''), character);
      rest := substr(first, 2);
      IF character = '%' THEN
        rate := substring(rest from '^\s+of\s+(?:(?:the|a|an|all|our|their|its|his|her|my|your|this|that|these|those|each|every|both|some|any|active|senior)\s+)*');
        IF rate IS NOT NULL AND substr(rest, length(rate) + 1, 1) ~ '^[a-z]' THEN
          percentage_quantity := number_flag_phrase(substr(rest, length(rate) + 1));
          phrase := phrase || ' ' || btrim(regexp_replace(rate, '\m(?:active|senior)\M\s+', '', 'g')) || ' ' || percentage_quantity[1];
          RETURN ARRAY[phrase] || descriptive || percentage_quantity[2:];
        END IF;
        EXIT;
      END IF;
      CONTINUE;
    END IF;
    IF character <> '' AND strpos('.,;:!?''"()[]{}<>/\|~_-。、・「」『』【】〔〕…‥〜—–‐“”‘’', character) = 0 THEN
      RETURN ARRAY[concat_ws(' ', nullif(phrase, ''), character)] || descriptive;
    END IF;
    EXIT;
  END LOOP;
  -- With no unit, the first other word stands for it.
  IF phrase <> '' THEN RETURN ARRAY[phrase]; END IF;
  RETURN ARRAY[coalesce(descriptive[1], '')];
END
$fn$;
--> statement-breakpoint
-- `sameQuantity`: the same phrase; the passage adds no other word the claim lacks, and one the claim
-- adds is a whole word the passage uses.
CREATE FUNCTION number_flag_same(claim_quantity text[], quote_quantity text[], passage text) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $fn$
DECLARE
  word text;
BEGIN
  IF claim_quantity[1] <> quote_quantity[1] THEN RETURN false; END IF;
  FOREACH word IN ARRAY quote_quantity[2:] LOOP
    IF NOT word = ANY(claim_quantity[2:]) THEN RETURN false; END IF;
  END LOOP;
  FOREACH word IN ARRAY claim_quantity[2:] LOOP
    IF NOT (word = ANY(quote_quantity[2:]) OR passage ~ ('(?<![a-z0-9-])' || word || '(?![a-z0-9-])')) THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END
$fn$;
--> statement-breakpoint
CREATE FUNCTION number_flag_unsourced(claim text, quote text, technologies text[]) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $fn$
DECLARE
  claim_text text := number_flag_plain(claim);
  passage text := number_flag_plain(quote);
  letter constant text := '[a-zÀ-ɏͰ-ϿЀ-ӿ぀-ヿ㐀-䶿一-鿿가-힯]';
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
  claim_quantity text[];
  occurrence_pattern text;
  occurrence int;
  quote_rest text;
  quote_scale text;
  quote_prefix text;
  quote_start int;
  sourced boolean;
BEGIN
  IF claim_text ~ '\m(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundreds|thousands|millions)\M'
    OR claim_text ~ '(?<![0-9〇一二三四五六七八九十百千万億])[〇一二三四五六七八九十百千万億]+(?:割|倍|名|人|件|年|[ヶヵカか](?:月|国|所)|箇所|週間|時間|秒|社|台|円|回|%)' THEN
    RETURN true;
  END IF;

  figure_pattern := '[0-9]+ (?:in(?!\s+(?:19|20)[0-9]{2}(?![0-9]))|of|out of) [0-9]+|[0-9]+/[0-9]+|[¥$€£]?[0-9]+(?:\.[0-9]+)?(?:(?:bn|[kmb])(?![0-9]|' || letter || ')|\s?' || counter
    || '|x(?!' || letter || '))?(?: (?:hundred|thousand|million|billion))?';

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
    head := coalesce(substring(figure from '^(?:[0-9]+ (?:in(?!\s+(?:19|20)[0-9]{2}(?![0-9]))|of|out of) [0-9]+|[0-9]+/[0-9]+)'), substring(figure from '^[¥$€£]?[0-9]+(?:\.[0-9]+)?'));
    rest := substr(figure, length(head) + 1) || substr(claim_text, figure_end);
    scale := coalesce(substring(rest from '^(?: (?:hundred|thousand|million|billion)|[万億]|bn|[kmb])(?=$|[^a-z])'), '');
    claim_tail := substr(rest, length(scale) + 1);
    scale := btrim(scale);
    claim_quantity := number_flag_phrase(claim_tail);
    occurrence_pattern := '(?<![a-z0-9_.¥$€£])(?<![a-z]-)'
      || regexp_replace(head, '([^0-9a-z ])', '\\\1', 'g') || '(?![0-9]|[.,][0-9])';
    sourced := false;
    FOR occurrence IN 1..regexp_count(passage, occurrence_pattern) LOOP
      -- Neither number of a ratio (`one in 5`, `2/5`).
      quote_start := regexp_instr(passage, occurrence_pattern, 1, occurrence);
      quote_prefix := left(passage, quote_start - 1);
      quote_rest := substr(passage, quote_start + length(head));
      CONTINUE WHEN quote_prefix ~ '(?:\m(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundreds|thousands|millions|[0-9]+)\M\s+(?:in|of|out of)\s+|[0-9]/)$';
      CONTINUE WHEN quote_rest ~ '^(?:\s+(?:in(?!\s+(?:19|20)[0-9]{2}(?![0-9]))|of|out of)\s+(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundreds|thousands|millions|[0-9]+)\M|/[0-9])';
      quote_scale := coalesce(substring(quote_rest from '^(?: (?:hundred|thousand|million|billion)|[万億]|bn|[kmb])(?=$|[^a-z])'), '');
      quote_rest := substr(quote_rest, length(quote_scale) + 1);
      CONTINUE WHEN btrim(quote_scale) <> scale;
      CONTINUE WHEN claim_tail ~ '^\s+[a-z]' AND quote_rest ~ '^[a-z]';
      IF number_flag_same(claim_quantity, number_flag_phrase(quote_rest), passage) THEN
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
DROP FUNCTION number_flag_same(text[], text[], text);
--> statement-breakpoint
DROP FUNCTION number_flag_phrase(text);
--> statement-breakpoint
DROP FUNCTION number_flag_plain(text);
