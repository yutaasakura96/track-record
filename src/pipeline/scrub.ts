/**
 * The ingestion scrub — enforcement point 1 of four
 * (`docs/03-technical-design.md` §7).
 *
 * Shape-based, and deliberately so: it recognises identifiers by their form,
 * not by knowing who anyone is. It is a DEFAULT and not a guarantee — review is
 * the real control, which is why the review interface makes unreviewed material
 * obvious.
 *
 * The asymmetry governs every judgement call here: an over-cautious résumé
 * costs a sentence; a leaked client identifier costs a career.
 */
import type { CandidateFact } from "~/model/types";

const SHAPES: RegExp[] = [
  // GUID / UUID
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
  // IPv4, including the private ranges an internal network address lives in
  /\b(?:\d{1,3}\.){3}\d{1,3}\b/,
  // IPv6, in its common compressed forms
  /\b(?:[0-9a-f]{1,4}:){2,7}[0-9a-f]{1,4}\b/i,
  // Email address
  /\b[^\s@]+@[^\s@]+\.[a-z]{2,}\b/i,
  // Internal hostname or UNC path
  /\\\\[A-Za-z0-9._-]+\\/,
  // Employee / staff / badge numbers, in the shapes they are usually written
  /\b(?:emp(?:loyee)?|staff|badge|社員)\s*(?:no\.?|number|id|番号)?\s*[:#]?\s*\d{3,}\b/i,
  // Bare long identifier runs — ticket keys, account numbers, system codes
  /\b[A-Z]{2,}[-_]\d{4,}\b/,
];

export interface ScrubResult {
  /**
   * Imported material comes out of NDA-bound case studies, so it never defaults
   * to Public. A shape match is Private and never renders; everything else is
   * Restricted, which renders in generalised form with the client not named.
   * The author promotes from there, one card at a time.
   */
  disclosure: "restricted" | "private";
  isClientIdentifying: boolean;
}

export function scrub(candidate: Pick<CandidateFact, "claim" | "quote">): ScrubResult {
  const subject = `${candidate.claim}\n${candidate.quote}`;
  const identifying = SHAPES.some((shape) => shape.test(subject));
  return {
    disclosure: identifying ? "private" : "restricted",
    isClientIdentifying: identifying,
  };
}
