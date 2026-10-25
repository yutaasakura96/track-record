/**
 * Sorting — what replaced reviewing every fact by hand (issue #57, `docs/06`
 * 2026-10-08).
 *
 * A fact is accepted as it is extracted, with the importer's grade, and
 * anything worth the author's attention is FLAGGED with the reason. Three
 * things hold whatever the importer says:
 *
 *   - **Nothing is rejected here.** A fact the importer is unsure of, or gave
 *     no grade at all, is kept and flagged. The only candidates that never
 *     become facts are the ones `quote.ts` cannot find in the document.
 *   - **The scrub is a floor.** A shape match is Private whatever the importer
 *     read; the importer can only add to what is kept Private.
 *   - **Nothing imported is Public.** Restricted or Private, and the author
 *     promotes from there, one fact at a time.
 */
import type { FactGrade } from "~/model/types";
import { scrub } from "./scrub";

export type FlagKind = "confidential" | "number" | "unsure" | "repeat";

export interface Flag {
  kind: FlagKind;
  /** Short, always present, and never a repeat of the identifier it is about. */
  reason: string;
}

export interface Sorted {
  provenance: FactGrade["provenance"];
  disclosure: "restricted" | "private";
  isClientIdentifying: boolean;
  flags: Flag[];
}

const KEPT_PRIVATE = "It is kept Private and out of every document.";
const KEPT_GENERATED = "It is kept as Generated and out of every document until you grade it.";

export function sortFact(
  fact: { claim: string; quote: string | null; technologies: string[] },
  grade: FactGrade | null,
): Sorted {
  const { shape, flags: claimFlags } = classifyClaim(fact);
  const note = grade?.note.trim() ?? "";
  const flags: Flag[] = [];

  // The strongest tier cannot be claimed without a passage that proves it
  // (`routes/facts.ts`); the importer is held to the rule the author is.
  const provenance =
    grade === null ? "generated" : grade.provenance === "measured" && fact.quote === null ? "attested" : grade.provenance;

  if (shape) {
    flags.push(claimFlags.find((flag) => flag.kind === "confidential")!);
  } else if (grade?.confidential) {
    flags.push({
      kind: "confidential",
      reason: sentences(
        note ? "The importer read it as confidential." : "The importer read it as naming a client, a person or an internal system.",
        note,
        KEPT_PRIVATE,
      ),
    });
  }

  flags.push(...claimFlags.filter((flag) => flag.kind === "number"));

  if (grade === null) {
    flags.push({ kind: "unsure", reason: `The importer gave it no grade. ${KEPT_GENERATED}` });
  } else if (provenance === "generated") {
    flags.push({
      kind: "unsure",
      reason: sentences("The importer could not find it stated in the passage.", grade.confidential ? "" : note, KEPT_GENERATED),
    });
  } else if (grade.unsure) {
    flags.push({ kind: "unsure", reason: sentences("The importer was not sure about it.", grade.confidential ? "" : note) });
  }

  const confidential = shape !== null || grade?.confidential === true;
  return {
    provenance,
    disclosure: confidential ? "private" : "restricted",
    isClientIdentifying: confidential,
    flags,
  };
}

export function classifyClaim(fact: { claim: string; quote: string | null; technologies: string[] }): { shape: string | null; flags: Flag[] } {
  const { shape } = scrub({ claim: fact.claim, quote: fact.quote ?? "" });
  return {
    shape,
    flags: [
      ...(shape ? [{ kind: "confidential" as const, reason: `It contains what looks like ${shape}. ${KEPT_PRIVATE}` }] : []),
      ...(unsourcedNumber(fact.claim, fact.quote, fact.technologies)
        ? [{ kind: "number" as const, reason: "It states a number the passage it was read from does not. Check where the number came from." }]
        : []),
    ],
  };
}

/**
 * A fact that likely restates one already in the record (`src/overlap/`). The
 * check a card made while facts were reviewed one by one (`docs/06`,
 * 2026-09-28), kept now that they are not: the pair is still shown on the
 * card, and this is what puts it on the list.
 */
export const repeatFlag = (conflict: boolean): Flag => ({
  kind: "repeat",
  reason: conflict
    ? "It likely restates a fact already in your record, and the number differs. Open it to see both, and reject the one that is wrong."
    : "It likely restates a fact already in your record. Open it to see both, and reject one if they say the same thing.",
});

/** A note is the model's sentence and may arrive without its full stop. */
const sentences = (...parts: string[]) =>
  parts
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => (/[.!?。]$/.test(part) ? part : `${part}.`))
    .join(" ");

/** Full-width digits read as digits, and thousands commas taken out: `１，２００` and `1,200` are `1200`. */
const plain = (text: string) => text.normalize("NFKC").replace(/(?<=\d),(?=\d{3})/g, "").toLowerCase();

/**
 * Does the claim state a number its passage does not (issue #115)?
 *
 * A figure is read much as the career record reads one (`figures`,
 * `src/shared/master-document.ts`), with patterns of its own: a year alone, a
 * digit inside a word, a version or address, and a technology's own digits
 * (`S3`, `Java 17`) are not figures, but a year followed by a word or a counter
 * is a quantity (`2023 tickets`), and a scale belongs to its word number
 * (`five hundred engineers`). A figure counts as sourced only when the quote
 * holds the same complete quantity: the same number on its own, the same scale
 * or none, and the same following phrase. A plain descriptive word
 * may stand before the unit on either side (`5 million active users`); a word
 * that changes the quantity never does. Any other word before the unit is the
 * claim's only if the passage uses it too (`five clinic reports`), and never
 * the passage's alone. A ratio (`one in 5`, `2/5`) is one figure, and neither
 * of its numbers sources a plain count. Anything less certain stays flagged.
 * With no quote there is nothing to check a figure against, and any figure
 * counts.
 *
 * Flagging every claim with a digit in it flagged half the record, a talk
 * given "in 2023" among them, and a list where almost everything is flagged
 * points nowhere. This flag says one thing: the number has no source.
 */
export function unsourcedNumber(claim: string, quote: string | null, technologies: string[]): boolean {
  const passage = plain(quote ?? "");
  const text = plain(claim);
  return numberFigures(text, technologies.map(plain)).some(([start, end]) => !sourcedFigure(text.slice(start, end), text.slice(end), passage));
}

/**
 * Words that say what is counted without changing how many: `5 million active
 * users` is `5 million users`. A
 * scale, a comparison (`more`, `over`) or an amount (`additional`, `dozen`) is
 * never one.
 */
const MODIFIER = "(?:active|senior)";
const TENS = "(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)";
const SCALE = "(?:hundred|thousand|million|billion)";
const WORD_NUMBER =
  `(?:(?:${TENS}-(?:one|two|three|four|five|six|seven|eight|nine)|one|two|three|four|five|six|seven|eight|nine|ten|eleven|` +
  `twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|${TENS})(?: ${SCALE})?|hundreds|thousands|millions)`;
/** `one in 5`, `3 out of 5`, `2/5`: one figure, never a plain count. */
const RATIO = `(?:${WORD_NUMBER}|\\d+) (?:in|of|out of) (?:${WORD_NUMBER}|\\d+)|\\d+/\\d+`;
const COUNTER = "(?:%|×|倍|割|名|人|件|社|台|万円|億円|円|万|億|回|時間|日|週間|ヶ月|か月|カ月|年間|年|分|秒)";
const NUMBER_FIGURE = new RegExp(
  [
    RATIO,
    `\\b${WORD_NUMBER}\\b`,
    `[¥$€£]?\\d+(?:\\.\\d+)?(?:(?:bn|[kmb])(?![\\p{L}\\d])|\\s?${COUNTER}|x(?![\\p{L}]))?(?: ${SCALE})?`,
    "[〇一二三四五六七八九十百千万億]+(?:割|倍|名|人|件|年|[ヶヵカか](?:月|国|所)|箇所|週間|時間|秒|社|台|円|回|%)",
  ].join("|"),
  "gu",
);
const YEAR = /^(?:19|20)\d{2}年?$/u;
const QUANTITY_AFTER_YEAR = new RegExp(`^(?:\\s+[a-z]|${COUNTER})`, "u");
/** What a ratio's denominator follows, and what its numerator precedes. */
const RATIO_BEFORE = new RegExp(`(?:(?:\\b${WORD_NUMBER}|\\b\\d+)\\s+(?:in|of|out of)\\s+|\\d/)$`, "u");
const RATIO_AFTER = new RegExp(`^(?:\\s+(?:in|of|out of)\\s+(?:${WORD_NUMBER}|\\d+)\\b|/\\d)`, "u");

/** The figures of a plain claim, as `[start, end]`, with a technology's own digits left out. */
function numberFigures(text: string, technologies: string[]): [number, number][] {
  const named: [number, number][] = [];
  for (const name of technologies) {
    const trimmed = name.trim();
    if (trimmed === "" || !/\d/u.test(trimmed)) continue;
    for (const match of text.matchAll(new RegExp(escapePattern(trimmed), "g"))) named.push([match.index, match.index + match[0].length]);
  }
  const found: [number, number][] = [];
  for (const match of text.matchAll(NUMBER_FIGURE)) {
    const start = match.index;
    const end = start + match[0].length;
    if (/[a-z0-9_]/u.test(text[start - 1] ?? "") || /[a-z0-9_]/u.test(text[end] ?? "")) continue;
    if (/^[.:]\d/u.test(text.slice(end, end + 2)) || /(?:\d[.:]|[a-z]-)$/u.test(text.slice(Math.max(0, start - 2), start))) continue;
    if (YEAR.test(match[0]) && !QUANTITY_AFTER_YEAR.test(text.slice(end))) continue;
    if (named.some(([from, to]) => start < to && end > from)) continue;
    found.push([start, end]);
  }
  return found;
}

const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const KANJI_NUMBER = "〇一二三四五六七八九十百千万億";

const MODIFIER_WORD = new RegExp(`^${MODIFIER}$`, "u");
const STOP_WORD = /^(?:and|or|but|in|on|at|by|from|to|for|with|after|before|during|across|into|onto|was|were|is|are|has|have|had|overall)$/u;
const SCOPE_WORD = /^(?:daily|weekly|monthly|yearly|unique|distinct|new|concurrent|more|over|less|under|additional)$/u;
const UNIT_WORD = /^(?:[a-z]+s|person|people|percent|ms|kb|mb|gb|tb|pb|second|minute|hour|day|week|month|quarter|year|engineer|developer|member|client|customer|user|request|report|ticket|order|payment|service|team|release|country|language)$/u;
const JAPANESE_RATE = /^\/?(?:毎日|毎週|毎月|毎年|日間|週間|月間|年間)/u;
/** Longest first, so `カ月` is never read as `カ`, and `人月` never as `人`. */
const COUNTER_UNIT = /^(?:[ヶヵカか](?:月|国|所)|箇所|人月|人日|週間|時間|年間|年度|千円|名|人|件|社|台|回|倍|割|円|年|月|日|週|分|秒|本|個)/u;
/** Han and katakana, written out so migrations 0032 and 0033 read the same characters. */
const COUNTER_RUN = /^[㐀-䶿一-鿿々゠-ヿ]+/u;
/** What ends a quantity without being part of it. Any other character after a number is its unit. */
const PUNCTUATION = ".,;:!?'\"()[]{}<>/\\|~_-。、・「」『』【】〔〕…‥〜—–‐“”‘’";
const SCALE_AFTER = /^(?: (?:hundred|thousand|million|billion)|[万億]|bn|[kmb])(?=$|[^a-z])/u;

/** Before a percentage's noun: `5% of all users` is of users, and not of revenue. */
const DETERMINER = "(?:the|a|an|all|our|their|its|his|her|my|your|this|that|these|those|each|every|both|some|any)";
const PERCENTAGE_OF_PREFIX = new RegExp(`^\\s+of\\s+(?:(?:${DETERMINER}|${MODIFIER})\\s+)*`, "u");

/**
 * A number's quantity: the phrase compared as it is, and the other words read
 * before its unit (`five clinic reports` has `clinic`), which `sameQuantity`
 * holds to the passage.
 */
interface Quantity {
  phrase: string;
  descriptive: string[];
}

function quantityAfter(tail: string): Quantity {
  let rest = tail;
  const words: string[] = [];
  const descriptive: string[] = [];
  for (;;) {
    const first = rest.trimStart().replace(/^-(?=[a-z])/u, "");
    const bareRate = first.match(/^(?:per\s+|a\s+|an\s+|\/)[a-z]+(?:-[a-z]+)*/u)?.[0];
    if (bareRate && words.length === 0) return { phrase: bareRate, descriptive };
    const word = first.match(/^[a-z]+(?:-[a-z]+)*/u)?.[0];
    if (word) {
      if (STOP_WORD.test(word) || (/ing$/u.test(word) && /^\s+(?:a|an|the)\b/u.test(first.slice(word.length)))) break;
      if (UNIT_WORD.test(word) || tail.trimStart().startsWith(`-${word}`)) {
        const unit = word === "ms" ? word : word.endsWith("ies") ? `${word.slice(0, -3)}y` : word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word;
        words.push(unit);
        rest = first.slice(word.length);
        const rate = rest.match(/^(?:\s+per\s+|\s+a\s+|\s+an\s+|\/)[a-z]+(?:-[a-z]+)*/u)?.[0].trim()
          ?? rest.match(/^\s+(?:daily|weekly|monthly|yearly|unique|distinct|new|concurrent)\b/u)?.[0].trim();
        if (rate) words.push(rate);
        break;
      }
      if (SCOPE_WORD.test(word) || word.includes("-")) words.push(word);
      else if (!MODIFIER_WORD.test(word)) descriptive.push(word);
      rest = first.slice(word.length);
      continue;
    }
    const counter = first.match(COUNTER_UNIT)?.[0] ?? first.match(COUNTER_RUN)?.[0];
    if (counter) {
      words.push(counter);
      rest = first.slice(counter.length);
      const rate = rest.match(JAPANESE_RATE)?.[0] ?? rest.match(/^(?:以上|以下)/u)?.[0];
      if (rate) words.push(rate);
      else if (rest.startsWith("/")) {
        const divisor = rest.slice(1).match(COUNTER_UNIT)?.[0] ?? rest.slice(1).match(COUNTER_RUN)?.[0];
        if (divisor) words.push(`/${divisor}`);
      }
      break;
    }
    const character = [...first][0] ?? "";
    if (character === "/" && /^[a-z]/u.test(first.slice(1))) {
      words.push("/");
      rest = first.slice(1);
      continue;
    }
    if (character === "+" || character === "%" || character === "×" || character === "x") {
      words.push(character);
      rest = first.slice(character.length);
      if (character === "%") {
        const prefix = rest.match(PERCENTAGE_OF_PREFIX)?.[0] ?? "";
        const noun = rest.slice(prefix.length);
        if (prefix && /^[a-z]/u.test(noun)) {
          const quantity = quantityAfter(noun);
          const keptPrefix = prefix.replace(/\b(?:active|senior)\s+/gu, "").trim();
          return { phrase: [...words, keptPrefix, quantity.phrase].join(" "), descriptive: [...descriptive, ...quantity.descriptive] };
        }
        break;
      }
      continue;
    }
    if (character && !PUNCTUATION.includes(character)) words.push(character);
    break;
  }
  // With no unit, the first other word stands for it.
  return words.length ? { phrase: words.join(" "), descriptive } : { phrase: descriptive[0] ?? "", descriptive: descriptive.slice(1) };
}

/**
 * The same phrase, and no other word that only one side has: the passage may
 * add none the claim lacks (`5 hospital reports` is not `5 reports`), and the
 * claim may add one only when the passage uses it elsewhere as a whole word.
 */
function sameQuantity(claim: Quantity, quote: Quantity, passage: string): boolean {
  if (claim.phrase !== quote.phrase) return false;
  if (quote.descriptive.some((word) => !claim.descriptive.includes(word))) return false;
  return claim.descriptive.every(
    (word) => quote.descriptive.includes(word) || new RegExp(`(?<![a-z0-9-])${escapePattern(word)}(?![a-z0-9-])`, "u").test(passage),
  );
}

/** A number's scale (`million`, `万`, `k`) and the text after it; a kanji number carries its own. */
function splitScale(tail: string, scaled: boolean): [string, string] {
  const scale = scaled ? tail.match(SCALE_AFTER)?.[0] ?? "" : "";
  return [scale.trim(), tail.slice(scale.length)];
}

function sourcedFigure(figure: string, following: string, passage: string): boolean {
  const head = figure.match(new RegExp(`^(?:${RATIO})`, "u"))
    ?? figure.match(/^[¥$€£]?\d+(?:\.\d+)?/u)
    ?? figure.match(new RegExp(`^[${KANJI_NUMBER}]+`, "u"))
    ?? figure.match(/^[a-z]+(?:-[a-z]+)?/u);
  if (!head) return false;
  const number = head[0];
  const kanji = new RegExp(`^[${KANJI_NUMBER}]`, "u").test(number);
  const [scale, claimTail] = splitScale(figure.slice(number.length) + following, !kanji);
  const quantity = quantityAfter(claimTail);
  // On its own: not inside a longer number or word, not after a currency sign
  // the claim does not have, and not either number of a ratio (`one in 5`, `2/5`).
  const pattern = kanji
    ? new RegExp(`(?<![${KANJI_NUMBER}])${escapePattern(number)}(?![${KANJI_NUMBER}])`, "gu")
    : new RegExp(`(?<![a-z0-9_.¥$€£])(?<![a-z]-)${escapePattern(number)}${/[a-z]$/u.test(number) ? "(?![a-z])" : ""}(?!\\d|[.,]\\d)`, "gu");
  for (const match of passage.matchAll(pattern)) {
    if (RATIO_BEFORE.test(passage.slice(0, match.index))) continue;
    if (RATIO_AFTER.test(passage.slice(match.index + match[0].length))) continue;
    const [quoteScale, quoteTail] = splitScale(passage.slice(match.index + match[0].length), !kanji);
    if (quoteScale !== scale) continue;
    if (/^\s+[a-z]/u.test(claimTail) && /^[a-z]/u.test(quoteTail)) continue;
    if (sameQuantity(quantity, quantityAfter(quoteTail), passage)) return true;
  }
  return false;
}
