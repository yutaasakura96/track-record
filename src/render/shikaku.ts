/**
 * How a Japanese document states a certification: the verb after its name,
 * and whether it is still held.
 *
 * One module because two documents print the same list — the 履歴書's
 * 免許・資格 rows (`./rirekisho-rows.ts`) and the 職務経歴書's 保有資格 — and a
 * certification that reads 合格 on one and 取得 on the other, or that is listed
 * on one after it lapsed, is a disagreement a reader sees when the two are sent
 * together.
 *
 * ## The verb is read from the name
 *
 * Convention is 合格 for an examination or a 検定 and 取得 for a licence, a
 * score or a vendor certification (`docs/04` §4). `certifications.kind` is
 * technical / language / other and cannot tell an examination from a licence,
 * but the name a Japanese reader sees can: 試験 and 検定 are in it. A name the
 * author already ended in a verb gets no second one — 「応用情報技術者試験
 * 合格　取得」 was the defect this module exists to remove.
 */

/** A verb the author already wrote. The record's name is then printed as given. */
const ENDS_IN_VERB = /(合格|取得|登録)$/;

/**
 * A score is 取得 even when the test calls itself one: 「TOEIC … 865点　取得」.
 * Checked before {@link EXAMINATION}, which a score's name may also match.
 */
const SCORE = /\d\s*点|スコア|\bscore\b/i;

/** An examination or a 検定 is passed, not obtained. */
const EXAMINATION = /試験|検定|英検|(?:^|[^A-Za-z])JLPT\s*N[1-5](?![A-Za-z0-9])|\bexam(ination)?\b/i;

export type CertificationVerb = "合格" | "取得";

/**
 * The verb a Japanese document puts after this name, or null when the name
 * already ends in one.
 */
export function certificationVerb(name: string): CertificationVerb | null {
  const trimmed = name.trim();
  if (ENDS_IN_VERB.test(trimmed)) return null;
  if (SCORE.test(trimmed)) return "取得";
  if (EXAMINATION.test(trimmed)) return "合格";
  return "取得";
}

/**
 * A certification whose expiry month has passed is left out. One expiring this
 * month is still held this month. The English résumé's rule, and the Japanese
 * documents take it too: a lapsed certification listed under 免許・資格 is a
 * claim to hold something the author no longer holds.
 */
export const isExpired = (expiresOn: string | null, today: string): boolean =>
  expiresOn !== null && expiresOn.slice(0, 7) < today.slice(0, 7);
