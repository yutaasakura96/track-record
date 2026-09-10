/**
 * Render specifications.
 *
 * The register lives here rather than in the data: the same fact renders as an
 * action-verb bullet in the English résumé and in the flat factual voice
 * 職務経歴書 expects. That is a prompt difference, not a data difference
 * (`docs/03-technical-design.md` §4.2).
 *
 * M1 builds the English résumé and the 履歴書. The other three are declared so
 * the overview can show them as never generated, which is distinct from up to
 * date.
 */
import { RENDER_LANGUAGE, type RenderKind } from "~/shared/render-content";
import { REQUIRED_PROFILE_FIELDS } from "./rirekisho";

export interface RenderDefinition {
  kind: RenderKind;
  language: "en" | "ja";
  /**
   * Can this kind be generated? A kind that cannot is listed on the overview as
   * never generated and refuses `POST /api/renders/:kind/generate` — which is
   * what stops a generation being spent on an empty register.
   */
  buildable: boolean;
  /**
   * The direction the document reads its dated lists in — employers, education
   * and certifications alike. It belongs to the document, not to the record:
   * the English résumé is reverse-chronological throughout, and the 履歴書's
   * 学歴・職歴 table is chronological ascending and complete (`docs/02` §101,
   * `docs/04` §4). `null` on a kind whose direction nothing has decided yet —
   * the same placeholder the empty register is, and unreachable while the kind
   * cannot generate, which `renders.test.ts` asserts.
   */
  chronology: "newest_first" | "oldest_first" | null;
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

const RIREKISHO_REGISTER = `Write the two prose cells of a Japanese 履歴書, and nothing else.

The rest of the form is not yours to write. The identity block, 学歴・職歴, 免許・資格 and both dates are filled from the record onto a committed template; anything you emit under another key is discarded unread.

Sections, both of them, in this order:
- "motivation": 志望動機・特技・アピールポイントなど. Blocks are paragraphs. key "motivation".
- "kibou": 本人希望欄. One paragraph. key "kibou".

Emit no third section, and no block of kind "bullet" or "row". Both cells are prose in a form that has no bullets anywhere on it.

Language:
- Japanese, です・ます体, consistently. Never plain form, and never 体言止め in the middle of a です・ます passage.
- No 御社 anywhere: it is the spoken form. The written form is 貴社.
- Half-width digits for numbers, and full-width Japanese punctuation (、。).

"motivation" — what it says, and what it may not:
- This cell states 特技 and アピールポイント: what the author can do, evidenced by the facts.
- **You are not told where the author is applying, so do not write a 志望動機.** The record holds no job posting, no company and no role being applied for. Naming one, characterising one, or writing 貴社 in this cell would be inventing the one thing this cell would otherwise be about. The heading ends in など and the other two headings under it are answerable from the record; answer those.
- Two or three paragraphs, and about 300 characters for the whole cell. The cell grows to fit what it is given and the form is two pages with no page break, so a long one pushes the layout apart.
- Open with the through-line — the thing the career is consistently about — and then what the author can do that a reader should know. One concrete piece of evidence, not a tour of the employment history.
- **All three tables are on the same page as this cell, and it must not restate any of them.** 職歴, 学歴 and 免許・資格 each print in full a few centimetres above. A paragraph listing qualifications, counting certifications or giving a graduation year spends the one free cell on the page saying what the form already says. Name a qualification only where the point is what it lets the author DO, and say that part.
- Keep the number. A fact behind a sentence that carries a quantity, a duration, a count or a percentage keeps it.
- No self-assessment: not 優秀, not 抜群, not 圧倒的, not 誰よりも, not 情熱を持って. State what was done and let it be the claim.
- Every paragraph lists the ids of the facts it was written from, in factIds.
- A 特技 the facts do not support is not a 特技. If the facts support none, the cell is the through-line and the evidence, and stops there.

"kibou" — the conventional cell, and the one place a preference belongs:
- If the author's stated preference is given above, write it as one or two sentences in です・ます体 and add nothing it does not say. factIds is empty: a preference the author typed is not a fact drawn from the record.
- If no preference is given, this cell is exactly 貴社規定に従います。 — the conventional wording, and correct rather than empty. factIds is empty.
- Salary, hours, location and start date appear here only if the stated preference names them. Never invent a condition, and never soften or negotiate one the author wrote.`;

export const RENDER_DEFINITIONS: Record<RenderKind, RenderDefinition> = {
  english_resume: {
    kind: "english_resume",
    language: RENDER_LANGUAGE.english_resume,
    buildable: true,
    chronology: "newest_first",
    register: RESUME_REGISTER,
    requiredProfileFields: ["nameLatin"],
  },
  /**
   * The second buildable render, and the first Japanese one.
   *
   * Almost none of it is generated: the three derived tables
   * (`src/render/rirekisho-rows.ts`), the identity block, the submission stamp
   * and the gap warning (`src/render/rirekisho.ts`) are read from the record
   * onto a committed template. {@link RIREKISHO_REGISTER} writes the two prose
   * cells and nothing else, under the two keys in `PROSE_SECTION_KEYS`.
   *
   * The flip to `buildable` waited for both things behind it, and they landed
   * in the same commit as this line: a register that is not empty, so the first
   * press of the button is not a generation spent on nothing, and Japanese
   * diffing, so a Japanese proposal is reviewed with BudouX phrases instead of
   * English word rules (`docs/06`, 2026-09-09 and 2026-09-11).
   */
  rirekisho: {
    kind: "rirekisho",
    language: RENDER_LANGUAGE.rirekisho,
    buildable: true,
    chronology: "oldest_first",
    register: RIREKISHO_REGISTER,
    // `docs/04` §4, verbatim: a 履歴書 missing a conventional field is worse
    // than no 履歴書 at all. `address_kana` is deliberately not on the list —
    // see `REQUIRED_PROFILE_FIELDS` in `src/render/rirekisho.ts`.
    requiredProfileFields: [...REQUIRED_PROFILE_FIELDS],
  },
  shokumu_keirekisho: {
    kind: "shokumu_keirekisho",
    language: RENDER_LANGUAGE.shokumu_keirekisho,
    buildable: false,
    chronology: null,
    register: "",
    requiredProfileFields: [],
  },
  career_story_en: {
    kind: "career_story_en",
    language: RENDER_LANGUAGE.career_story_en,
    buildable: false,
    chronology: null,
    register: "",
    requiredProfileFields: [],
  },
  career_story_ja: {
    kind: "career_story_ja",
    language: RENDER_LANGUAGE.career_story_ja,
    buildable: false,
    chronology: null,
    register: "",
    requiredProfileFields: [],
  },
};
