/**
 * BudouX wrapper (`docs/03-technical-design.md` §10, problem 1).
 *
 * Japanese has no inter-word spaces, so a character diff is unreadable and a
 * word diff needs a segmenter. `Intl.Segmenter` over-splits unusably
 * (そごう → そご / う). BudouX segments at 文節 scale in ~15 KB with no
 * dictionary, and jsdiff over its output produces phrase-level marks: a changed
 * figure is one phrase replaced, not a scatter of characters.
 */
import { loadDefaultJapaneseParser } from "budoux";

let parser: ReturnType<typeof loadDefaultJapaneseParser> | null = null;

/** Loaded on first use — the model is ~15 KB and most requests never need it. */
function japaneseParser() {
  parser ??= loadDefaultJapaneseParser();
  return parser;
}

/** 文節-scale phrases. Marks land on these spans and never on single characters. */
export function segmentJapanese(text: string): string[] {
  return japaneseParser()
    .parse(text)
    .filter((phrase) => phrase !== "");
}

/**
 * Words and punctuation runs, with the whitespace that follows each token kept
 * attached, so joining the tokens reproduces the input exactly.
 */
export function segmentLatin(text: string): string[] {
  return text.match(/\S+\s*/gu) ?? [];
}

export function segment(text: string, language: "en" | "ja"): string[] {
  return language === "ja" ? segmentJapanese(text) : segmentLatin(text);
}
