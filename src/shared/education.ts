/**
 * Which education rows each document leaves out by its level, stated once.
 *
 * The English résumé applies this in code when the file is assembled
 * (`src/render/resume.ts`); the 職務経歴書 register states the same rule in
 * prose; the career timeline's chip names the documents from it. Two copies of
 * the rule were how a chip could say one thing while a document did another.
 *
 * `vocational` is kept everywhere. It is post-secondary, and a finished
 * programme is a credential an English reader screens on as much as the
 * 履歴書's 免許・資格 prints it (`docs/06`, 2026-09-06). A row whose level is
 * not recorded is kept everywhere too: losing a real education to a missing
 * classification is the worse failure.
 */
import { RENDER_KINDS, type RenderKind } from "./render-content";

export type EducationLevel = "secondary_lower" | "secondary_upper" | "vocational" | "tertiary" | "postgraduate";

const LEFT_OUT: Record<RenderKind, readonly EducationLevel[]> = {
  english_resume: ["secondary_lower", "secondary_upper"],
  rirekisho: [],
  shokumu_keirekisho: ["secondary_lower"],
  career_story_en: [],
  career_story_ja: [],
};

/** Whether `kind` leaves out an education at `level`. An unstated level prints. */
export const leavesOutEducation = (kind: RenderKind, level: EducationLevel | null): boolean =>
  level !== null && LEFT_OUT[kind].includes(level);

/** The documents that leave out an education at `level`, in document order. */
export const educationLeftOutOf = (level: EducationLevel | null): RenderKind[] =>
  RENDER_KINDS.filter((kind) => leavesOutEducation(kind, level));
