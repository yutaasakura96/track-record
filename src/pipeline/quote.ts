/**
 * Quote anchoring (`docs/03-technical-design.md` §4.1).
 *
 * This inverts the trust relationship. The application does not trust a
 * model-reported offset; it requires a string that must ALREADY EXIST in a
 * document it holds, and checks — by exact string match, with no normalisation
 * of any kind.
 *
 * A quote that differs from the source by one space, by a full-width digit, or
 * by a repaired ellipsis is **not verbatim** and its candidate is discarded.
 * That strictness is the point: it is what makes "the model invents a plausible
 * fact absent from the source" mechanically impossible rather than merely
 * contained by the Generated default.
 *
 * Discarded candidates are COUNTED and never surfaced — not in a response, not
 * in a log line (`docs/03` §7 and §9).
 */

export interface Anchor {
  quote: string;
  /** Character offset into the version's `extracted_text`. */
  quoteStart: number;
  /** Exclusive. `text.slice(quoteStart, quoteEnd) === quote`, exactly. */
  quoteEnd: number;
  /** 1-based, counted over the same text. Rendered as the `L79` chip. */
  lineNumber: number;
}

/**
 * @returns the anchor, or `null` when the quote does not appear verbatim.
 *
 * When a quote appears more than once, **the first occurrence wins**, and it
 * wins deterministically — `indexOf` scans forward from 0 on every call, so the
 * same document and the same quote always produce the same offsets.
 */
export function anchorQuote(text: string, quote: string): Anchor | null {
  // An empty quote would "match" at offset 0 and anchor a claim to nothing.
  if (quote === "") return null;

  const quoteStart = text.indexOf(quote);
  if (quoteStart === -1) return null;

  const quoteEnd = quoteStart + quote.length;
  return { quote, quoteStart, quoteEnd, lineNumber: lineNumberAt(text, quoteStart) };
}

/**
 * The line the offset falls on, 1-based. A quote that spans a line break
 * therefore reports the line it STARTS on, which is the line the author's eye
 * goes to.
 */
export function lineNumberAt(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}

/**
 * The invariant `docs/04-database-schema.md` §3.7 states, in executable form.
 * A candidate failing it never reaches the database.
 */
export function anchorHolds(text: string, anchor: Anchor): boolean {
  return text.slice(anchor.quoteStart, anchor.quoteEnd) === anchor.quote;
}
