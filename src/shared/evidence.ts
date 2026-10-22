/**
 * What stands behind a line of a document (issue #110, S6): the facts its
 * block was written from, and where each fact came from.
 *
 * Shared between the Worker, which looks the facts up for the page it serves,
 * and the reader, which shows them under the line that cites them.
 */

/** One fact a line of the page cites, as the reader shows it. */
export interface FactEvidence {
  id: string;
  claim: string;
  /**
   * Never `generated`: a Generated fact never reaches a document, and a page
   * citing one is refused before anything is looked up.
   */
  provenance: "measured" | "attested";
  /** The employer the fact resolves to, named in the document's language. Null is no employer. */
  employer: string | null;
  /** The passage the fact was read from, verbatim. Null on a fact added by hand. */
  quote: string | null;
  /**
   * The imported document the passage is in, opened in Fact Review by
   * `importId`. Null on a fact added by hand on Quick capture, which has no
   * document behind it.
   */
  source: { importId: string; filename: string; lineNumber: number | null } | null;
}

/**
 * A fact's worth in plain words, the words Home uses: a figure behind it, or
 * the author's word and nothing more.
 */
export const WORTH_WORDS: Record<FactEvidence["provenance"], string> = {
  measured: "Backed by a number",
  attested: "Stated by you, no number behind it",
};

/** A fact saved on Quick capture, with no document to quote. */
export const BY_HAND = "Added by hand";

/** What to say about one fact: its worth, and whether it was added by hand. */
export function evidenceMarks(fact: Pick<FactEvidence, "provenance" | "source">): string[] {
  return [WORTH_WORDS[fact.provenance], ...(fact.source === null ? [BY_HAND] : [])];
}

/** Every fact id the page's blocks cite, once each, in the order they are first cited. */
export function citedOnPage(page: { sections: { blocks: { factIds?: string[] }[] }[] }): string[] {
  return [...new Set(page.sections.flatMap((section) => section.blocks.flatMap((block) => block.factIds ?? [])))];
}
