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
  /** The name a Japanese document prints. Null = none given, and the model writes one (issue #117). */
  nameJa: string | null;
  skills: string[];
}

/* --------------------------------------------- one skill, however spelled */

/**
 * How many skills a document lists when the author has curated none. The
 * first real record named about 800 technologies across its facts, and the
 * résumé printed every one of them: `grep` and `Notepad` beside the stack the
 * career is built on. A hand-kept résumé lists about twenty.
 */
export const AUTO_SKILL_CAP = 20;

/**
 * Names the record holds under more than one spelling, each folded to the one
 * a document prints. Keyed by {@link foldSkill}, so a case or punctuation
 * difference needs no entry of its own: only a genuinely different name does.
 */
const SKILL_ALIASES: Record<string, string> = {
  s3: "Amazon S3",
  awss3: "Amazon S3",
  amazons3: "Amazon S3",
  ec2: "Amazon EC2",
  awsec2: "Amazon EC2",
  amazonec2: "Amazon EC2",
  rds: "Amazon RDS",
  awsrds: "Amazon RDS",
  amazonrds: "Amazon RDS",
  dynamodb: "Amazon DynamoDB",
  awsdynamodb: "Amazon DynamoDB",
  amazondynamodb: "Amazon DynamoDB",
  awslambda: "AWS Lambda",
  amazonwebservices: "AWS",
  gcp: "Google Cloud",
  googlecloud: "Google Cloud",
  googlecloudplatform: "Google Cloud",
  azure: "Azure",
  microsoftazure: "Azure",
  nodejs: "Node.js",
  reactjs: "React",
  vuejs: "Vue.js",
  golang: "Go",
  postgres: "PostgreSQL",
  postgresql: "PostgreSQL",
  k8s: "Kubernetes",
  mssql: "SQL Server",
  sqlserver: "SQL Server",
  microsoftsqlserver: "SQL Server",
  cicd: "CI/CD",
};

/** Width, case, spaces and the punctuation names differ by (`Node.js`, `NodeJS`, `node js`) folded away. */
const foldSkill = (name: string): string => name.normalize("NFKC").toLowerCase().replace(/[\s._/-]+/gu, "");

/** The key two spellings of one skill share: `zod` and `Zod`, `S3` and `AWS S3`. */
export function skillKey(name: string): string {
  const folded = foldSkill(name);
  const alias = SKILL_ALIASES[folded];
  return alias === undefined ? folded : foldSkill(alias);
}

/** The name a document prints for a skill: the alias table's, else the spelling given. */
export function skillDisplayName(name: string): string {
  return SKILL_ALIASES[foldSkill(name)] ?? name.trim();
}

/**
 * `names` with every later spelling of a skill already listed removed, in
 * order. The first spelling is the one kept, so a list ranked by evidence keeps
 * the best-evidenced spelling.
 */
export function dedupeSkills(names: readonly string[]): string[] {
  const seen = new Set<string>();
  return names.filter((name) => {
    const key = skillKey(name);
    if (key === "" || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** A curation with each skill listed once: a later repeat, in its group or another, is dropped, and so is a group left empty. */
export function dedupeCuration<G extends { skills: string[] }>(groups: readonly G[]): G[] {
  const seen = new Set<string>();
  return groups
    .map((g) => ({
      ...g,
      skills: g.skills.filter((name) => {
        const key = skillKey(name);
        if (key === "" || seen.has(key)) return false;
        seen.add(key);
        return true;
      }),
    }))
    .filter((g) => g.skills.length > 0);
}

/**
 * The list a document prints when the author has curated none: `ranked`
 * (`rankedSkills`, best evidenced first) with each skill once, in its printed
 * name, cut to {@link AUTO_SKILL_CAP}.
 */
export function autoCuratedSkills(ranked: readonly string[], cap = AUTO_SKILL_CAP): string[] {
  return dedupeSkills(ranked).slice(0, cap).map(skillDisplayName);
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
  return dedupeCuration(groups.map((g) => ({ ...g, skills: g.skills.filter((s) => available.has(s)) })));
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
  const without = groups.map((g) => ({ ...g, skills: g.skills.filter((s) => s !== skill) }));
  return without.map((g, i) => {
    if (i !== to.group) return g;
    const skills = [...g.skills];
    skills.splice(Math.min(Math.max(to.index, 0), skills.length), 0, skill);
    return { ...g, skills };
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
