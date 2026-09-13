/**
 * Skills curation (S9, `docs/04` `skill_curations`).
 *
 * There is one candidate pool and nothing hand-authors a skill: a candidate is
 * a technology named on an accepted, render-eligible fact or on a certification.
 * The author chooses, groups and orders from it.
 *
 * Staleness is DERIVED here on every read and never written. A stored flag is a
 * second copy of "does any fact still name this", and every accept, undo,
 * disclosure change and certification edit would have to remember to refresh
 * it; the one that forgot would show a skill as live that no render may use
 * (`docs/06`, 2026-09-13). `skill_curations.is_stale` is therefore unread.
 */
import { and, asc, eq, ne } from "drizzle-orm";
import type { Db } from "../db/client";
import { certifications, facts, skillCurations } from "../db/schema";

export interface SkillCandidate {
  name: string;
  factCount: number;
  certificationCount: number;
}

export interface CuratedGroup {
  name: string;
  skills: string[];
}

/**
 * Most facts first, then by name. The same eligibility the render collector
 * applies — Private and Generated facts never reach a document, so a skill only
 * they name is not a skill a document could list.
 */
export async function skillCandidates(db: Db, userId: string): Promise<SkillCandidate[]> {
  const factRows = await db
    .select({ technologies: facts.technologies })
    .from(facts)
    .where(
      and(
        eq(facts.userId, userId),
        eq(facts.status, "accepted"),
        ne(facts.disclosure, "private"),
        ne(facts.provenance, "generated"),
      ),
    );
  const certificationRows = await db
    .select({ technologies: certifications.technologies })
    .from(certifications)
    .where(eq(certifications.userId, userId));

  const pool = new Map<string, SkillCandidate>();
  const tally = (rows: { technologies: string[] }[], field: "factCount" | "certificationCount") => {
    for (const row of rows) {
      // A fact naming one technology twice is one fact behind it.
      for (const name of new Set(row.technologies)) {
        const entry = pool.get(name) ?? { name, factCount: 0, certificationCount: 0 };
        entry[field] += 1;
        pool.set(name, entry);
      }
    }
  };
  tally(factRows, "factCount");
  tally(certificationRows, "certificationCount");

  return [...pool.values()].sort(
    (a, b) =>
      b.factCount - a.factCount ||
      b.certificationCount - a.certificationCount ||
      (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );
}

/** The stored curation, grouped in the order its rows were saved. Empty when nothing is curated. */
export async function curatedGroups(db: Db, userId: string): Promise<CuratedGroup[]> {
  const rows = await db
    .select({ skillName: skillCurations.skillName, groupName: skillCurations.groupName })
    .from(skillCurations)
    .where(eq(skillCurations.userId, userId))
    .orderBy(asc(skillCurations.sortOrder));

  const groups: CuratedGroup[] = [];
  for (const row of rows) {
    const name = row.groupName ?? "";
    const last = groups.at(-1);
    if (last && last.name === name) last.skills.push(row.skillName);
    else groups.push({ name, skills: [row.skillName] });
  }
  return groups;
}

/**
 * The curation one render is given: only the skills something that render
 * receives still names, and no group left empty. `available` is built by the
 * collector AFTER the inclusion filter, so a skill whose only facts sit under
 * an employer this render leaves out is not written into it.
 */
export function curationForRender(groups: CuratedGroup[], available: Set<string>): CuratedGroup[] {
  return groups
    .map((g) => ({ name: g.name, skills: g.skills.filter((s) => available.has(s)) }))
    .filter((g) => g.skills.length > 0);
}
