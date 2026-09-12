/**
 * The chapter plan of a career story (`docs/02` S11).
 *
 * S11 asks for two stories whose chapters "correspond one-to-one between
 * languages". Every other register in this project names its sections and lets
 * the model write them; that cannot produce this. Two independent generations
 * asked to invent their own chapters will not correspond, and a check run
 * afterwards could only report that they did not — after both were paid for.
 *
 * So the chapters are COMPUTED HERE, from the record, and handed to both
 * prompts. The English story and the Japanese one receive the same keys in the
 * same order, and correspondence holds by construction rather than by luck. It
 * is the same move the Employers list already makes for names and dates: the
 * thing that has to be exact is data the app supplies, not prose the model is
 * asked to get right.
 *
 * It does NOT make the Japanese story a translation. The plan carries keys and
 * a scope, never a sentence of the story; each story is written from the facts
 * into the same plan, which is what S11 asks for in as many words.
 *
 * The keys also do a second job. `attribution.ts` resolves an employer group by
 * matching its heading against the record's employer names, because the
 * 職務経歴書's experience section carries no ids. A chapter planned here knows
 * its employer id, so {@link employerChapterKey} carries it and the check
 * resolves the employer exactly — no name matching, no `unresolved-heading`,
 * and invariants 2 and 3 covering the story chapters that would otherwise be
 * the one place in a render nobody checks.
 *
 * This module has no imports, so that plain Node can load it the way it loads
 * `attribution.ts` and `metrics.ts`. The kind names are repeated here rather
 * than imported for that reason, and a test asserts they stay in step with
 * `RENDER_KINDS`.
 */

/** A chapter, before a word of it is written. */
export interface PlannedChapter {
  /** The section key. Machine scaffolding: it never appears in the document. */
  key: string;
  /** The employer this chapter is about, or null for a framing chapter. */
  employerId: string | null;
  /**
   * What the chapter covers, written into the prompt verbatim. In English for
   * both stories, like every register in this project: it is an instruction to
   * the model, not a line of the document.
   */
  scope: string;
}

/** The two kinds that are chaptered. Kept in step with `RENDER_KINDS` by test. */
const STORY_KINDS = new Set(["career_story_en", "career_story_ja"]);

export const isChapteredStory = (kind: string): boolean => STORY_KINDS.has(kind);

export const EMPLOYER_CHAPTER_PREFIX = "employer:";

export const employerChapterKey = (employerId: string): string =>
  `${EMPLOYER_CHAPTER_PREFIX}${employerId}`;

/** The employer a chapter key names, or null when the key names no employer. */
export function employerIdOfChapter(key: string): string | null {
  if (!key.startsWith(EMPLOYER_CHAPTER_PREFIX)) return null;
  const id = key.slice(EMPLOYER_CHAPTER_PREFIX.length);
  return id === "" ? null : id;
}

/** Only the two fields the plan reads. The spec carries far more. */
export interface PlannedEmployer {
  id: string;
  name: string;
}

/**
 * The chapters of one story, in order.
 *
 * Empty for a kind that is not a story, which is how the prompt and the check
 * both know to leave every other render alone.
 *
 * The shape is: an opening, one chapter per employer in the order the document
 * reads them, the work done outside employment, where the career is going, and
 * then the two closing tables. Only two of those are conditional, and both are
 * conditional on the record rather than on a judgement: the independent-work
 * chapter exists when the record holds work outside employment, and an employer
 * chapter exists for every employer the record holds.
 *
 * **What counts as work outside employment is a FACT with no employer, not only
 * a project row.** The first story generated put six facts about a personal
 * project into the current employer's chapter, and the attribution check
 * reported all six as unfiled facts used under an employer. The register was
 * missing the rule, and the plan was missing the chapter to send them to: the
 * condition read the Projects list, and this record holds that work as facts
 * and no project row at all (`docs/06`, 2026-09-13). A rule with nowhere to
 * send a fact is a rule a model will break.
 *
 * **Every employer gets a chapter, including one with no facts behind it.** A
 * story that skips an employment is a story with a gap in it, and a gap is the
 * first thing an interviewer asks about. The chapter for an employer the facts
 * are thin on is short and written from the Employers list, which is what the
 * 職務経歴書's opening paragraph already does.
 */
export function chapterPlan(
  kind: string,
  employers: readonly PlannedEmployer[],
  workOutsideEmployment: boolean,
): PlannedChapter[] {
  if (!isChapteredStory(kind)) return [];

  const chapters: PlannedChapter[] = [
    {
      key: "opening",
      employerId: null,
      scope:
        "How the career began and the turn into this work, and the through-line the rest of the story is about. State the through-line once, here. The work done at an employer belongs in that employer's chapter and is not told twice.",
    },
  ];

  for (const employer of employers) {
    chapters.push({
      key: employerChapterKey(employer.id),
      employerId: employer.id,
      scope: `The time at ${employer.name} (employer id ${employer.id}): what was walked into, what was built, what changed because of it, and what was carried out of it into the next chapter. Only this employer's facts.`,
    });
  }

  if (workOutsideEmployment) {
    chapters.push({
      key: "independent",
      employerId: null,
      scope:
        "The work done outside employment: the facts that carry no employer and the projects on the Projects list that belong to none, what they were for, and what they demonstrate that the employed work does not. Facts filed to no employer belong here or in the opening, and never inside an employer's chapter.",
    });
  }

  chapters.push(
    {
      key: "ahead",
      employerId: null,
      scope:
        "Where the author is going, argued from the record and from the author's own stated preference where this prompt gives one. Nothing here may rest on an ambition no fact and no stated preference supports.",
    },
    {
      key: "anchors",
      employerId: null,
      scope:
        "The anchor-facts table: the figures a reader will ask the author to defend, gathered in one place. Rows, not prose.",
    },
    {
      key: "routing",
      employerId: null,
      scope:
        "The question-to-chapter routing map: the questions this career invites, each pointed at the chapter that answers it. Rows, not prose.",
    },
  );

  return chapters;
}

/**
 * The keys the plan expects, in order, as one line per chapter for the prompt.
 */
export function chapterPlanForPrompt(chapters: readonly PlannedChapter[]): string {
  return chapters.map((chapter) => `- key "${chapter.key}" · ${chapter.scope}`).join("\n");
}

/**
 * Does a generated document's section keys match the plan exactly?
 *
 * Exactly, in order, nothing missing and nothing extra. A story with a chapter
 * more or a chapter fewer than its counterpart is the one failure S11 names,
 * and it is not repairable after the fact: which chapter went missing is a
 * question about prose nobody has read yet. Rejecting the generation costs one
 * call; accepting it costs a pair of stories that silently do not correspond,
 * and the diff gate would show the author a document that looks finished.
 */
export function chaptersMatchPlan(
  keys: readonly string[],
  chapters: readonly PlannedChapter[],
): boolean {
  if (keys.length !== chapters.length) return false;
  return chapters.every((chapter, i) => chapter.key === keys[i]);
}
