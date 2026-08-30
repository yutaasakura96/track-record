/**
 * Step 8 — drop candidates matching an already-judged fact
 * (`docs/04-database-schema.md` §3.7).
 *
 * `dedupe_hash` is `sha256(normalise(quote) + NUL + normalise(claim))`, and the
 * partial unique index on `(user_id, dedupe_hash)` turns the check into one
 * lookup. Rejected facts are retained forever precisely so this suppresses them
 * on a re-import.
 */

/**
 * Normalisation for the hash ONLY. It is deliberately more forgiving than quote
 * anchoring, which is exact: anchoring decides whether a quote is real, and this
 * decides whether two candidates are the same claim about the same passage.
 * Trailing whitespace and full-width punctuation should not defeat that.
 */
export function normalise(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLowerCase();
}

/** The separator is NUL so that no claim/quote pair can forge another's hash. */
const SEPARATOR = "\u0000";

export async function dedupeHash(quote: string, claim: string): Promise<string> {
  const input = `${normalise(quote)}${SEPARATOR}${normalise(claim)}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
