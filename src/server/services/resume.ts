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
import { curatedGroups, curationForRender } from "./skills";
import type { ResumeRecord } from "~/render/resume";
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
 * The author's curation, narrowed to what this résumé may name — the skills a
 * fact it is given or a certification still names (S9). A curation that leaves
 * nothing is no skills section, never a fallback.
 *
 * With nothing curated, one ungrouped line of every technology those facts and
 * certifications name, the best-evidenced first: the list the Skills screen
 * offers to curate from, in the order it offers it.
 */
async function skillsFor(
  db: Db,
  userId: string,
  facts: { technologies: string[] }[],
  certifications: { technologies: string[] }[],
): Promise<ResumeRecord["skills"]> {
  const tally = new Map<string, number>();
  for (const row of [...facts, ...certifications]) {
    for (const name of new Set(row.technologies)) tally.set(name, (tally.get(name) ?? 0) + 1);
  }

  const curation = await curatedGroups(db, userId);
  if (curation.length > 0) return curationForRender(curation, new Set(tally.keys()));

  const ranked = [...tally.entries()]
    .sort(([a, x], [b, y]) => y - x || (a < b ? -1 : a > b ? 1 : 0))
    .map(([name]) => name);
  return ranked.length > 0 ? [{ name: "", skills: ranked }] : [];
}
