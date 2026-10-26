/**
 * The record an English résumé's file is built from (issue #107).
 *
 * Read on every download, like the 履歴書's tables (`./rirekisho.ts`): the job
 * headers, the skills, the education, the certifications and the languages are
 * data, and a correction to any of them reaches the next file without a
 * regeneration with nothing to review.
 *
 * It is read through `collectRenderInputs` rather than beside it, so the file
 * and the prompt see one record: the same exclusions, the same English names,
 * the same order, and the same Private and Generated filters. None of the
 * restricted PII columns is read; the paper size is the one profile field
 * selected here, and it is not PII.
 */
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { profiles } from "../db/schema";
import { collectRenderInputs } from "./render";
import { curatedGroups } from "./skills";
import { rankedSkills, resumeSkills, type ResumeRecord } from "~/render/resume";
import type { PaperSize } from "~/render/resume-docx";

export async function collectResumeRecord(db: Db, userId: string): Promise<ResumeRecord & { paper: PaperSize }> {
  const { facts, spec } = await collectRenderInputs(db, userId, "english_resume", "");
  const [profile] = await db
    .select({ paperSize: profiles.paperSize })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1);

  return {
    employers: spec.employers,
    projects: spec.projects,
    educations: spec.educations,
    certifications: spec.certifications,
    skills: await skillsFor(db, userId, facts, spec.certifications),
    paper: profile?.paperSize ?? "a4",
  };
}

/**
 * The résumé's skills (S9): the curation, or with nothing curated every
 * technology the résumé's facts and certifications name (`resumeSkills`).
 */
async function skillsFor(
  db: Db,
  userId: string,
  facts: { technologies: string[] }[],
  certifications: { technologies: string[] }[],
): Promise<ResumeRecord["skills"]> {
  return resumeSkills(await curatedGroups(db, userId), rankedSkills([...facts, ...certifications]));
}

/**
 * What the English résumé may name in its Skills section today, ranked as its
 * uncurated line is: read through `collectRenderInputs`, as the file is, so the
 * Skills screen's preview leaves out what the résumé leaves out (issue #114).
 */
export async function resumeSkillPool(db: Db, userId: string): Promise<string[]> {
  const { facts, spec } = await collectRenderInputs(db, userId, "english_resume", "");
  return rankedSkills([...facts, ...spec.certifications]);
}
