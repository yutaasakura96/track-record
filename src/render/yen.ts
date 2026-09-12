/**
 * Yen as a 職務経歴書 writes it.
 *
 * This lived in `model/generate.ts` until the copied-row check needed it too.
 * It sits in its own module for the reason `attribution.ts` has no imports: the
 * checker is run by plain Node against `src/`, so anything it reaches must not
 * pull in a path alias or the Anthropic SDK. One definition, two callers, no
 * second copy of the arithmetic to drift.
 */

/**
 * 400万円, 1億円, 1億5000万円.
 *
 * A figure that does not divide evenly into 万 is written out in full yen
 * instead. Rounding a capital figure to the nearest 万円 would be a
 * misstatement of a published number rather than a formatting choice, and a
 * company whose capital is not a round 万 is a company whose exact figure is
 * the interesting part.
 */
export function capitalInJapanese(yen: number): string {
  if (!Number.isInteger(yen) || yen <= 0 || yen % 10_000 !== 0) return `${yen}円`;
  const oku = Math.floor(yen / 100_000_000);
  const man = (yen % 100_000_000) / 10_000;
  if (oku === 0) return `${man}万円`;
  return man === 0 ? `${oku}億円` : `${oku}億${man}万円`;
}
