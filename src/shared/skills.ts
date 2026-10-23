/**
 * The Skills curation's rules that the server and the screen both apply
 * (S9, issue #114), stated once.
 *
 * The screen previews the Skills section the next résumé prints, and the
 * preview is only worth having if it is the résumé's own rule rather than a
 * copy of it; the narrowing below is that rule. The fold and the moves are the
 * screen's, kept here so they are pure and read the same in a test.
 */

export interface CuratedGroup {
  name: string;
  skills: string[];
}

/** When a skill was last used: a year, `now` while something naming it is still going, or not known. */
export type LastUsed = number | "now" | null;

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

/** The later of two uses. Going on now is later than any year; a known year is later than none. */
export function laterUse(a: LastUsed, b: LastUsed): LastUsed {
  if (a === "now" || b === "now") return "now";
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

/** A suggestion backed by this much or less is folded once it is old. */
const FOLD_EVIDENCE = 1;
/** How many years back still counts as recent. */
export const FOLD_YEARS = 5;

/**
 * Whether a skill not yet listed is folded away under the suggestions: named
 * once, and not in the last five years, or never dated. Two achievements, or
 * one recent one, keep it in view. COBOL from a 2017 migration is still true,
 * but it is not what a reader of this year's résumé should be offered first.
 */
export function isFolded(
  candidate: { factCount: number; certificationCount: number; lastUsed: LastUsed },
  thisYear: number,
): boolean {
  if (candidate.factCount + candidate.certificationCount > FOLD_EVIDENCE) return false;
  if (candidate.lastUsed === "now") return false;
  return candidate.lastUsed === null || candidate.lastUsed < thisYear - FOLD_YEARS;
}

/* -------------------------------------------------------------- the moves */

/** Where a skill sits: its group's index and its index in that group. */
export interface SkillPlace {
  group: number;
  index: number;
}

export function placeOf(groups: CuratedGroup[], skill: string): SkillPlace | null {
  for (const [group, g] of groups.entries()) {
    const index = g.skills.indexOf(skill);
    if (index >= 0) return { group, index };
  }
  return null;
}

/**
 * A copy of `groups` with `skill` at `to`, taken from wherever it was (or from
 * the suggestions, when it was in no group). `to.index` past the end appends.
 */
export function placeSkill(groups: CuratedGroup[], skill: string, to: SkillPlace): CuratedGroup[] {
  const without = groups.map((g) => ({ name: g.name, skills: g.skills.filter((s) => s !== skill) }));
  return without.map((g, i) => {
    if (i !== to.group) return g;
    const skills = [...g.skills];
    skills.splice(Math.min(Math.max(to.index, 0), skills.length), 0, skill);
    return { name: g.name, skills };
  });
}

/**
 * One keyboard step for a skill that has been picked up. Left and right move it
 * one place in its group and stop at either end; up and down carry it to the
 * end of the group before or after, and stop at the first and last group.
 * `null` when the step goes nowhere.
 */
export function stepSkill(
  groups: CuratedGroup[],
  skill: string,
  step: "earlier" | "later" | "previous group" | "next group",
): CuratedGroup[] | null {
  const at = placeOf(groups, skill);
  if (at === null) return null;
  const size = groups[at.group]!.skills.length;
  switch (step) {
    case "earlier":
      return at.index === 0 ? null : placeSkill(groups, skill, { group: at.group, index: at.index - 1 });
    case "later":
      return at.index === size - 1 ? null : placeSkill(groups, skill, { group: at.group, index: at.index + 1 });
    case "previous group":
      return at.group === 0 ? null : placeSkill(groups, skill, { group: at.group - 1, index: Infinity });
    case "next group":
      return at.group === groups.length - 1 ? null : placeSkill(groups, skill, { group: at.group + 1, index: Infinity });
  }
}
