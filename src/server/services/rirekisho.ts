/**
 * What the 履歴書 reads out of the database.
 *
 * Kept apart from `./render.ts` because the two collect different things for
 * different reasons. `collectRenderInputs` assembles what is *sent to a model*
 * and filters Private and Generated facts out before the request is built; this
 * function assembles what is *printed on a form* — the record's own dated rows,
 * and the profile columns `docs/04` §3.2 restricts to this one document.
 *
 * **No fact reaches here.** The 学歴・職歴 and 免許・資格 tables are the record,
 * not claims about it, which is why the 履歴書 can be assembled from a stored
 * version whose only generated content is two prose blocks.
 */
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { certifications, educations, employers, profiles, roles } from "../db/schema";
import { preconditionFailed } from "../http/errors";
import type { RirekishoProfile, RirekishoRecord } from "~/render/rirekisho";

/**
 * The profile, narrowed to the columns the form has cells for.
 *
 * The select list is the enforcement: `photo` and every column the 履歴書 does
 * not print are never read, so they cannot reach a document by accident. This
 * is the one query in the codebase that may name `date_of_birth`, `phone`,
 * `postal_code`, `address` and `contact_*` (`docs/04` §3.2).
 */
export async function collectRirekishoProfile(
  db: Db,
  userId: string,
): Promise<RirekishoProfile> {
  const [profile] = await db
    .select({
      familyNameKanji: profiles.familyNameKanji,
      givenNameKanji: profiles.givenNameKanji,
      familyNameKana: profiles.familyNameKana,
      givenNameKana: profiles.givenNameKana,
      dateOfBirth: profiles.dateOfBirth,
      gender: profiles.gender,
      phone: profiles.phone,
      email: profiles.email,
      postalCode: profiles.postalCode,
      address: profiles.address,
      addressKana: profiles.addressKana,
      contactSameAsAddress: profiles.contactSameAsAddress,
      contactPostalCode: profiles.contactPostalCode,
      contactAddress: profiles.contactAddress,
    })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1);

  // Generation is blocked without these fields, so an accepted version implies
  // a profile. Its absence at download time means the row went away underneath
  // one — the same reasoning `renderIdentity` states for the English renders.
  if (!profile) {
    throw preconditionFailed(
      "That document cannot be assembled without your profile. Fill it in and download again.",
      ["profile"],
    );
  }
  return profile;
}

/**
 * The three tables' source rows, in the record's own order.
 *
 * The order is not load-bearing — `rirekishoTables` sorts every row ascending
 * across employers and education alike, because the 学歴・職歴 table is a
 * chronology rather than a grouping (`docs/04` §4) — but reading them ordered
 * keeps the tie-break between two rows in the same month stable.
 */
export async function collectRirekishoRecord(
  db: Db,
  userId: string,
): Promise<RirekishoRecord> {
  const educationRows = await db
    .select()
    .from(educations)
    .where(eq(educations.userId, userId))
    .orderBy(asc(educations.startedOn), asc(educations.id));

  const employerRows = await db
    .select()
    .from(employers)
    .where(eq(employers.userId, userId))
    .orderBy(asc(employers.startedOn), asc(employers.id));

  // Every role, ascending, so the FIRST one found for an employer is the one
  // held on entry — the 職種 the 入社 row names (`docs/04` §4). A later
  // promotion's 職種 in that sentence would be a misstatement about when.
  const roleRows = await db
    .select({
      employerId: roles.employerId,
      shokushuJa: roles.shokushuJa,
      startedOn: roles.startedOn,
    })
    .from(roles)
    .where(eq(roles.userId, userId))
    .orderBy(asc(roles.startedOn), asc(roles.id));

  const entryRole = new Map<string, string | null>();
  for (const role of roleRows) {
    if (!entryRole.has(role.employerId)) entryRole.set(role.employerId, role.shokushuJa);
  }

  const certificationRows = await db
    .select()
    .from(certifications)
    .where(and(eq(certifications.userId, userId)))
    .orderBy(asc(certifications.issuedOn), asc(certifications.id));

  return {
    educations: educationRows.map((e) => ({
      institution: e.institution,
      institutionJa: e.institutionJa,
      faculty: e.faculty,
      startedOn: e.startedOn,
      endedOn: e.endedOn,
      outcome: e.outcome,
      level: e.level,
    })),
    employers: employerRows.map((e) => ({
      nameJa: e.nameJa,
      industryJa: e.industryJa,
      // Null when the employer has no role recorded, or when the entry role
      // carries no 職種. Both drop the element rather than guessing one.
      shokushuJa: entryRole.get(e.id) ?? null,
      startedOn: e.startedOn,
      endedOn: e.endedOn,
      leavingReasonJa: e.leavingReasonJa,
    })),
    certifications: certificationRows.map((c) => ({
      name: c.name,
      nameJa: c.nameJa,
      issuedOn: c.issuedOn,
    })),
  };
}
