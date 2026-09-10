/**
 * The BudouX wrapper (`docs/03-technical-design.md` §3, §6.1).
 *
 * Japanese has no inter-word spaces, so a character diff is unreadable and a
 * word diff needs a segmenter. `Intl.Segmenter` over-splits unusably — `そごう`
 * becomes `そご` / `う` — and a dictionary-based morphological analyser is a
 * far heavier tool than a diff needs. BudouX splits at 文節 scale from a small
 * bundled model (`docs/06`, 2026-08-12).
 *
 * **The whole contract is that the pieces concatenate back to the input**, the
 * same contract `tokenize` holds for English. The diff joins runs of tokens to
 * build the text it marks up, so a segmenter that dropped or normalised a
 * character would silently rewrite the document on the review screen.
 *
 * **`Parser`, not `loadDefaultJapaneseParser`.** The convenience loader returns
 * an `HTMLProcessingParser`, whose module imports a DOM implementation —
 * `linkedom` outside a browser build — for a capability this codebase never
 * uses. `new Parser(jaModel)` is the same segmenter without that edge of the
 * graph: verified to produce identical output, and it keeps the Worker bundle
 * free of a DOM library it would otherwise carry to segment a sentence.
 */
import { Parser, jaModel } from "budoux";

/**
 * One parser, built on first use. Constructing it compiles the model into the
 * parser's lookup structure, which is worth doing once per isolate rather than
 * once per diff — and not at import time, because a module that does work on
 * import does it in every entry point that transitively imports it.
 */
let parser: Parser | undefined;

/**
 * Japanese text as 文節-scale phrases. Empty in, empty out — the same shape
 * `tokenize` returns for an empty English string.
 */
export function segmentJapanese(text: string): string[] {
  if (text === "") return [];
  parser ??= new Parser(jaModel);
  return parser.parse(text);
}
