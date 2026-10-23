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
import { figures } from "~/shared/master-document";
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
 * A figure is what the career record sets apart (`figures`): a year alone, a
 * digit inside a word, a version or address, and a technology's own digits
 * (`S3`, `Java 17`) are not figures. A figure counts as sourced when each of
 * its number, scale and next token stand in the quote on their own. With
 * no quote there is nothing to check a figure against, and any figure counts.
 *
 * Flagging every claim with a digit in it flagged half the record, a talk
 * given "in 2023" among them, and a list where almost everything is flagged
 * points nowhere. This flag says one thing: the number has no source.
 */
export function unsourcedNumber(claim: string, quote: string | null, technologies: string[]): boolean {
  const passage = plain(quote ?? "");
  const parts = figures(claim, technologies);
  return parts.some((part, index) => part.figure && !sourcedFigure(plain(part.text), plain(parts[index + 1]?.text ?? ""), passage));
}

const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const KANJI_NUMBER = "〇一二三四五六七八九十百千万億";

function nextToken(tail: string): string {
  const first = tail.trimStart();
  const word = first.match(/^[a-z]+/u);
  if (word) return word[0];
  const character = [...first][0] ?? "";
  return character === "%" || character === "×" || (character !== "" && !/[\p{P}\p{S}]/u.test(character)) ? character : "";
}

function sourcedFigure(figure: string, following: string, passage: string): boolean {
  const head = figure.match(/^(?:one|\d+) in (?:[a-z-]+|\d+)/u)
    ?? figure.match(/^[¥$€£]?\d+(?:\.\d+)?/u)
    ?? figure.match(new RegExp(`^[${KANJI_NUMBER}]+`, "u"))
    ?? figure.match(/^[a-z]+(?:-[a-z]+)?/u);
  if (!head) return false;
  let number = head[0];
  let tail = figure.slice(number.length);
  if (/^[¥$€£]?\d/u.test(number) || /^[a-z]/u.test(number)) {
    const scale = tail.match(/^(?: (?:hundred|thousand|million|billion)|[万億])(?=$|[^a-z])/u);
    if (scale) {
      number += scale[0];
      tail = tail.slice(scale[0].length);
    }
  }
  const claimTail = tail + following;
  const expected = nextToken(claimTail);
  const before = new RegExp(`^[${KANJI_NUMBER}]`, "u").test(number) ? `(?<![${KANJI_NUMBER}])` : "(?<![A-Za-z0-9_.])";
  const pattern = new RegExp(`${before}${escapePattern(number)}(?!\\d|[.,]\\d)`, "gu");
  for (const match of passage.matchAll(pattern)) {
    const quoteTail = passage.slice(match.index + match[0].length);
    if (/^\s+[a-z]/u.test(claimTail) && /^[a-z]/u.test(quoteTail)) continue;
    if (nextToken(quoteTail) === expected) return true;
  }
  return false;
}
