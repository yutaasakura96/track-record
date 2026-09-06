/**
 * Render specifications.
 *
 * The register lives here rather than in the data: the same fact renders as an
 * action-verb bullet in the English résumé and in the flat factual voice
 * 職務経歴書 expects. That is a prompt difference, not a data difference
 * (`docs/03-technical-design.md` §4.2).
 *
 * M1 builds the English résumé only. The other four are declared so the
 * overview can show them as never generated, which is distinct from up to date.
 */
import { RENDER_LANGUAGE, type RenderKind } from "~/shared/render-content";

export interface RenderDefinition {
  kind: RenderKind;
  language: "en" | "ja";
  /** Built in M1? The rest are listed on the overview and cannot be generated. */
  buildable: boolean;
  register: string;
  /** Profile fields generation is blocked without (`docs/07` §7). */
  requiredProfileFields: string[];
}

const RESUME_REGISTER = `Write a résumé for a technical audience reading in English.

Sections, in this order, omitting any with nothing behind it:
- "summary": one short paragraph. key "summary".
- "experience": one section per employer in the Employers list, in the order that list gives, and no employer that is not on it. The heading carries the employer's name, the role titles held there and the employer's dates, all copied from the list rather than written from the facts. Blocks are bullets. key "experience".
- "projects": independent projects only — projects with no employer. key "projects".
- "education": one row per entry in the Education list, in the order that list gives. Institution, qualification, outcome and dates are copied from the list. Each entry states its level, and the level decides whether the entry belongs here: omit one whose level is below university level, keep every other entry including one whose level is not recorded. Never decide the level from the institution's name. The level is a selector and is never written into the row. An entry whose outcome says the course was left unfinished is written as unfinished, never as a completion. An entry that gives only the month it finished is written with that month alone — do not supply a start month it does not give. key "education".
- "certifications": technical certifications only, one row each, in the order the Certifications list gives. Name, issuer and date are copied from the list. A driving licence is not a technical certification and does not appear here; a language qualification belongs in "summary" if anywhere. One qualification appearing in both the Education list and the Certifications list is the same qualification recorded twice, not two achievements: write it once, under "education", and leave it out here. key "certifications".
- "skills": one paragraph listing the technologies the facts and the Certifications list actually name. key "skills".

Register:
- Bullets open with a past-tense action verb and state the outcome. "Reduced nightly batch runtime from 6 hours to 90 minutes."
- No adjectives of self-assessment: no "successfully", "expertly", "cutting-edge", "passionate".
- No first-person pronouns.

How to compose a bullet:
- One bullet is written from SEVERAL facts, and usually should be. The facts arrive atomic — what was built, how it was built and what it changed each arrive as their own fact. Putting them back together is this document's job, not the record's.
- Weld facts that describe the same piece of work at the same employer, and list every fact you used in factIds. Never weld across two employers, and never weld two unrelated pieces of work merely to make a longer bullet.
- Keep the number. If any fact behind a bullet carries a quantity, a duration, a count, a version or a percentage, the finished bullet states it. Dropping a number to keep a bullet short is a defect, not concision.
- A bullet is one sentence. A second sentence is permitted only when the result will not fit in the first, and it is the exception rather than the habit: across the whole document expect two or three bullets to need one, not most of them. Never three sentences.
- No bullet runs longer than 240 characters — about 36 words. This bounds the whole bullet, not the sentence inside it: one sentence has no natural stopping point, and left unbounded these reach 400. Check each bullet against the bound as you finish writing it.
- A bullet over the bound is over because it welded one fact too many, not because its wording is loose. Cut the least load-bearing fact — the background, the tooling aside, the second consequence — and leave the rest whole. Do not split it into two bullets, which undoes the composition. Do not drop the number, which is what the bullet is for.
- The hand-maintained résumé this one replaces runs about 30 experience bullets averaging about 190 characters — about 28 words. That average is the shape to aim at: most bullets sit comfortably below the 240 bound, which is there for the few that do not. It is reached by composing — never by padding a thin bullet with words no fact supports. If you have written two bullets about one piece of work, that was one bullet.
- A fact that carries no employer belongs in summary, projects, education or certifications. It is never placed under an employer.`;

export const RENDER_DEFINITIONS: Record<RenderKind, RenderDefinition> = {
  english_resume: {
    kind: "english_resume",
    language: RENDER_LANGUAGE.english_resume,
    buildable: true,
    register: RESUME_REGISTER,
    requiredProfileFields: ["nameLatin"],
  },
  rirekisho: {
    kind: "rirekisho",
    language: RENDER_LANGUAGE.rirekisho,
    buildable: false,
    register: "",
    requiredProfileFields: ["dateOfBirth", "address", "addressKana"],
  },
  shokumu_keirekisho: {
    kind: "shokumu_keirekisho",
    language: RENDER_LANGUAGE.shokumu_keirekisho,
    buildable: false,
    register: "",
    requiredProfileFields: [],
  },
  career_story_en: {
    kind: "career_story_en",
    language: RENDER_LANGUAGE.career_story_en,
    buildable: false,
    register: "",
    requiredProfileFields: [],
  },
  career_story_ja: {
    kind: "career_story_ja",
    language: RENDER_LANGUAGE.career_story_ja,
    buildable: false,
    register: "",
    requiredProfileFields: [],
  },
};
