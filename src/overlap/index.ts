/**
 * The overlap matcher: which existing facts a candidate likely restates, and
 * which of those restate it with a different number (`docs/03` §5, PRD §8,
 * `docs/06` 2026-09-28).
 *
 * **Lexical, and computed on read.** It compares CLAIMS, never quotes. Both
 * sides of a pair were written by the same extraction prompt, which states a
 * claim plainly in one sentence, so most of the distance between a first-person
 * retelling and a portfolio is gone before this sees them. Nothing it returns is
 * stored: what a candidate is compared with moves with every accept, reject,
 * edit and employer pick, which are exactly the actions that settle the flag.
 *
 * **Pure.** It is given one employer's facts and knows nothing about users,
 * employers or the database; `src/server/services/overlap.ts` does the scoping.
 *
 * **It returns no score.** A score would be a confidence, and confidences are
 * absent from the contract so they cannot be rendered (`docs/07` §6). The
 * thresholds below decide what is shown and in what order; nothing more leaves.
 *
 * Known limit: a restatement in another language shares only its numbers and
 * technology names, and is not found.
 */

export interface OverlapFact {
  id: string;
  claim: string;
  technologies: readonly string[];
}

export interface LikelyMatch {
  id: string;
  /** Both claims carry numbers, and neither's numbers contain the other's. */
  conflict: boolean;
}

/** More than this on one card stops being a flag and becomes a list. */
export const MAX_MATCHES = 3;

/**
 * Weighted Dice over the two claims' words. Tuned on invented pairs toward
 * showing a match: the flag is advisory, so a wrong match costs the author a
 * glance and a missed one costs a duplicate.
 */
const MATCH_AT = 0.45;
/** Two claims at one employer sharing a figure need less wording in common. */
const MATCH_AT_WITH_SHARED_NUMBER = 0.25;

/**
 * Builds a matcher over one employer's existing facts. Rarity weights come from
 * that pool, so a word every claim at the employer uses ("system", 基盤) counts
 * for little and a word only two claims share counts for a lot.
 */
export function overlapMatcher(existing: readonly OverlapFact[]) {
  const pool = existing.map((fact) => ({ id: fact.id, ...features(fact) }));
  const documentFrequency = new Map<string, number>();
  for (const fact of pool) {
    for (const token of fact.tokens) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }
  // Plus one for the candidate, which is in the comparison but not the pool.
  const size = pool.length + 1;
  const weight = (token: string) => Math.log(1 + size / ((documentFrequency.get(token) ?? 0) + 1));
  const total = (tokens: ReadonlySet<string>) => {
    let sum = 0;
    for (const token of tokens) sum += weight(token);
    return sum;
  };
  const pooled = pool.map((fact) => ({ ...fact, total: total(fact.tokens) }));

  return (candidate: OverlapFact): LikelyMatch[] => {
    const own = features(candidate);
    const ownTotal = total(own.tokens);
    if (ownTotal === 0) return [];

    const scored: { id: string; score: number; conflict: boolean }[] = [];
    for (const other of pooled) {
      if (other.id === candidate.id || other.total === 0) continue;
      let shared = 0;
      for (const token of own.tokens) if (other.tokens.has(token)) shared += weight(token);
      const score = (2 * shared) / (ownTotal + other.total);
      const threshold = sharesFigure(own.numbers, other.numbers) ? MATCH_AT_WITH_SHARED_NUMBER : MATCH_AT;
      if (score < threshold) continue;
      scored.push({ id: other.id, score, conflict: numbersConflict(own.numbers, other.numbers) });
    }
    return scored
      .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1))
      .slice(0, MAX_MATCHES)
      .map(({ id, conflict }) => ({ id, conflict }));
  };
}

/**
 * A conflict is two figures for one thing. One claim naming fewer of the same
 * figures ("to 90 minutes" beside "from 6 hours to 90 minutes") is not one.
 */
function numbersConflict(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size === 0 || b.size === 0) return false;
  return !isSubset(a, b) && !isSubset(b, a);
}

const isSubset = (a: ReadonlySet<string>, b: ReadonlySet<string>) => [...a].every((n) => b.has(n));

/**
 * A shared figure is evidence two claims are about one thing; a shared year is
 * not, since every claim about one year of work carries it. A year still counts
 * toward a conflict: "launched in 2022" beside "launched in 2023" is one.
 */
const sharesFigure = (a: ReadonlySet<string>, b: ReadonlySet<string>) =>
  [...a].some((n) => b.has(n) && !YEAR.test(n));
const YEAR = /^(19|20)\d\d$/;

/* ------------------------------------------------------------- features */

interface Features {
  tokens: Set<string>;
  numbers: Set<string>;
}

/**
 * A figure, with an optional scale after it. Not preceded by a letter or a
 * digit, so `EC2`, `S3` and `v2` stay words. `億` may carry a `万` part
 * (`1億2000万`), which is one figure and not two.
 */
const NUMBER =
  /(?<![a-z\d.,])(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:(億)(?:(\d+(?:\.\d+)?)万)?|(万|千|thousand\b|million\b|billion\b|k\b))?/gu;

const SCALE: Record<string, number> = {
  千: 1e3,
  万: 1e4,
  億: 1e8,
  thousand: 1e3,
  million: 1e6,
  billion: 1e9,
  k: 1e3,
};

/** Kanji and katakana runs, with the marks that live inside them. */
const CJK_RUN = /[\p{Script=Han}\p{Script=Katakana}\p{Script=Hiragana}ー々]+/gu;
const HIRAGANA = /\p{Script=Hiragana}/u;
const LATIN_WORD = /[a-z][a-z0-9+#]*/g;

/**
 * Words that carry no claim. Short on purpose: rarity weighting already
 * discounts what is common at the employer, and this only removes what is
 * common in any English sentence.
 */
const STOP = new Set(
  (
    "a an and as at be been by for from in into is it its of on onto or our over per so " +
    "than that the their them then this those to up was we were which while with within " +
    "i my me he she they his her"
  ).split(" "),
);

function features(fact: OverlapFact): Features {
  const numbers = new Set<string>();
  const text = fact.claim
    .normalize("NFKC")
    .toLowerCase()
    .replace(NUMBER, (_match, digits: string, oku?: string, man?: string, scale?: string) => {
      let value = Number(digits.replaceAll(",", ""));
      if (oku) value = value * 1e8 + (man ? Number(man) * 1e4 : 0);
      else if (scale) value *= SCALE[scale] ?? 1;
      numbers.add(String(Math.round(value * 1e6) / 1e6));
      return " ";
    });

  const tokens = new Set<string>();
  addWords(tokens, text);
  // Named technologies are the part of a claim that reads the same in both
  // languages, so they are words of the claim even when the prose does not
  // spell them.
  addWords(tokens, fact.technologies.join(" ").normalize("NFKC").toLowerCase());
  return { tokens, numbers };
}

function addWords(tokens: Set<string>, text: string) {
  for (const [word] of text.matchAll(LATIN_WORD)) {
    if (word.length < 2 || STOP.has(word)) continue;
    tokens.add(stem(word));
  }
  // Japanese has no spaces to split on. Character pairs find shared words
  // without a dictionary; a pair with kana in it is mostly a particle or an
  // inflection (から, した, の所), so only pairs of kanji and katakana count.
  for (const [run] of text.matchAll(CJK_RUN)) {
    const chars = [...run];
    if (chars.length === 1) {
      if (!HIRAGANA.test(run)) tokens.add(run);
      continue;
    }
    for (let i = 0; i < chars.length - 1; i++) {
      const pair = chars[i]! + chars[i + 1]!;
      if (!HIRAGANA.test(pair)) tokens.add(pair);
    }
  }
}

/**
 * Enough stemming that "reduced", "reduces" and "reducing" meet, and
 * "migration" meets "migrated". Crude, and applied to both sides alike, which
 * is all a comparison needs.
 */
const SUFFIXES: [string, string][] = [
  ["ies", "y"],
  ["ions", ""],
  ["ion", ""],
  ["ings", ""],
  ["ing", ""],
  ["ed", ""],
  ["es", ""],
  ["s", ""],
  ["e", ""],
];

function stem(word: string): string {
  for (const [suffix, replacement] of SUFFIXES) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 3) {
      return word.slice(0, -suffix.length) + replacement;
    }
  }
  return word;
}
