/**
 * Quick capture's limits, read by the route and the screen alike (issue #95),
 * so the screen refuses what the server would.
 */

/** A sentence or two is the use. This is room for a paragraph, not a document. */
export const CAPTURE_TEXT_MAX = 2_000;

/** One claim as saved. Longer than any one sentence about one outcome. */
export const CLAIM_MAX = 1_000;

/** How many claims one save takes: more than a sentence or two ever splits into. */
export const CAPTURED_CLAIMS_MAX = 8;
