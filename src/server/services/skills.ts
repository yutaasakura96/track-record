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
import { certifications, employers, facts, projects, skillCurations } from "../db/schema";
import { laterUse, type CuratedGroup, type LastUsed } from "~/shared/skills";
import { effectiveEmployerId } from "./employer";

export type { CuratedGroup } from "~/shared/skills";

export interface SkillCandidate {
  name: string;
  factCount: number;
  certificationCount: number;
  /** The latest a fact or certification naming it reaches (issue #114). */
  lastUsed: LastUsed;
}

/** What one eligible fact names, deduplicated, and the employer it resolves to. */
export interface FactNames {
  names: string[];
  employerId: string | null;
}

/** The candidates, and what each eligible fact names together. */
export interface SkillPool {
  candidates: SkillCandidate[];
  /** One entry per fact. Read for which group a candidate goes with. */
  together: FactNames[];
}

const yearOf = (isoDate: string) => Number(isoDate.slice(0, 4));

/**
 * The latest a fact's work reaches, as far as the record says: the month it
 * was captured with, else the end of its project, else the end of its
 * employer's tenure. A project or tenure not yet ended is going on now — but a
 * project left open at an employer the author has since left ended with it.
 */
function factUse(row: {
  occurredOn: string | null;
  projectStartedOn: string | null;
  projectEndedOn: string | null;
  employerStartedOn: string | null;
  employerEndedOn: string | null;
}): LastUsed {
  if (row.occurredOn) return yearOf(row.occurredOn);
  if (row.projectEndedOn) return yearOf(row.projectEndedOn);
  if (row.projectStartedOn) return row.employerEndedOn ? yearOf(row.employerEndedOn) : "now";
  if (row.employerEndedOn) return yearOf(row.employerEndedOn);
  if (row.employerStartedOn) return "now";
  return null;
}

/**
 * Most facts first, then by name. The same eligibility the render collector
 * applies — Private and Generated facts never reach a document, so a skill only
 * they name is not a skill a document could list.
 */
export async function skillCandidates(db: Db, userId: string): Promise<SkillCandidate[]> {
  return (await skillPool(db, userId)).candidates;
}

export async function skillPool(db: Db, userId: string): Promise<SkillPool> {
  const factRows = await db
    .select({
      technologies: facts.technologies,
      employerId: effectiveEmployerId,
      occurredOn: facts.occurredOn,
      projectStartedOn: projects.startedOn,
      projectEndedOn: projects.endedOn,
      employerStartedOn: employers.startedOn,
      employerEndedOn: employers.endedOn,
    })
    .from(facts)
    .leftJoin(projects, and(eq(projects.id, facts.projectId), eq(projects.userId, userId)))
    .leftJoin(employers, and(eq(employers.id, effectiveEmployerId), eq(employers.userId, userId)))
    .where(
      and(
        eq(facts.userId, userId),
        eq(facts.status, "accepted"),
        ne(facts.disclosure, "private"),
        ne(facts.provenance, "generated"),
      ),
    );
  const certificationRows = await db
    .select({ technologies: certifications.technologies, issuedOn: certifications.issuedOn })
    .from(certifications)
    .where(eq(certifications.userId, userId));

  const pool = new Map<string, SkillCandidate>();
  const tally = (names: Set<string>, field: "factCount" | "certificationCount", used: LastUsed) => {
    // A fact naming one technology twice is one fact behind it.
    for (const name of names) {
      const entry = pool.get(name) ?? { name, factCount: 0, certificationCount: 0, lastUsed: null };
      entry[field] += 1;
      entry.lastUsed = laterUse(entry.lastUsed, used);
      pool.set(name, entry);
    }
  };
  const together: FactNames[] = [];
  for (const row of factRows) {
    const names = new Set(row.technologies);
    tally(names, "factCount", factUse(row));
    together.push({ names: [...names], employerId: row.employerId });
  }
  for (const row of certificationRows) {
    tally(new Set(row.technologies), "certificationCount", row.issuedOn ? yearOf(row.issuedOn) : null);
  }

  const candidates = [...pool.values()].sort(
    (a, b) =>
      b.factCount - a.factCount ||
      b.certificationCount - a.certificationCount ||
      (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );
  return { candidates, together };
}

/**
 * The group a skill not yet listed most likely belongs in: the one whose
 * skills it is named beside on the most facts; failing that, the one whose
 * skills' facts share the most employers with its own; failing that, the
 * largest. The earlier group wins every tie. None only while there is no group.
 */
export function suggestedGroup(skill: string, groups: CuratedGroup[], together: FactNames[]): string | null {
  const groupOf = new Map(groups.flatMap((g) => g.skills.map((s) => [s, g.name] as const)));
  const beside = new Map<string, number>();
  const employersOf = new Map<string, Set<string>>();
  const ownEmployers = new Set<string>();
  for (const { names, employerId } of together) {
    const named = new Set(names.flatMap((name) => groupOf.get(name) ?? []));
    if (employerId) {
      for (const group of named) employersOf.set(group, (employersOf.get(group) ?? new Set()).add(employerId));
    }
    if (!names.includes(skill)) continue;
    if (employerId) ownEmployers.add(employerId);
    for (const group of named) beside.set(group, (beside.get(group) ?? 0) + 1);
  }
  const sharedEmployers = (g: CuratedGroup) =>
    [...(employersOf.get(g.name) ?? [])].filter((id) => ownEmployers.has(id)).length;
  return (
    highest(groups, (g) => beside.get(g.name) ?? 0) ??
    highest(groups, sharedEmployers) ??
    highest(groups, (g) => g.skills.length)
  );
}

/** The first group with the highest score above zero. */
function highest(groups: CuratedGroup[], score: (group: CuratedGroup) => number): string | null {
  let best: string | null = null;
  let top = 0;
  for (const g of groups) {
    const s = score(g);
    if (s > top) [best, top] = [g.name, s];
  }
  return best;
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
