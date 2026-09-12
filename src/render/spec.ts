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

const SHOKUMU_REGISTER = `Write a 職務経歴書 for a Japanese hiring manager who already has the author's 履歴書 in front of them.

Sections, in this order, omitting any with nothing behind it:
- "summary": 経歴要約. One paragraph. key "summary".
- "skills": 活かせるスキル・経験. key "skills".
- "experience": 職務経歴. key "experience".
- "certifications": 保有資格. One row per entry. key "certifications".
- "education": 学歴. One row per entry. key "education".
- "self_pr": 自己PR. Paragraphs. key "self_pr".

Language and voice:
- Japanese. Half-width digits, full-width Japanese punctuation (、。).
- TWO voices, and which goes where is convention rather than preference. "summary" and "self_pr" are written in です・ます体. "skills" and every bullet in "experience" are written 体言止め — the sentence ends on a noun or a 連用形 and never on です・ます. Never mix the two inside one section.
- This document names no company it is being sent to. Neither 貴社 nor 御社 appears anywhere in it: 貴社 is the 履歴書's word for an employer it is addressed to, and this document is addressed to no one.
- No self-assessment: not 優秀, not 抜群, not 圧倒的, not 誰よりも, not 情熱を持って. State what was done and let it be the claim.

**The register, and it is the reason this document exists separately from the English résumé.** Both are written from the same facts. The English résumé opens each bullet on a past-tense action verb and leads with the outcome, because that is what its reader rewards. This one does not. Write what was built or done first and what it changed second, flatly, and let the number carry the claim. A sentence that would read as selling in Japanese reads as a defect here — the format rewards a reader being able to check you, not a reader being impressed.

"experience" — the structure is FIXED, and getting it wrong silently breaks the checks that read this section:
- Each employer is a GROUP. A group opens with exactly ONE block of kind "paragraph" and contains no other paragraph anywhere in it. Every other block in the group is "row" or "bullet". A second paragraph does not read as a sub-heading; it starts a new employer.
- The opening paragraph carries the employer's name, the employment period and the role titles held there, all copied from the Employers list rather than written from the facts. factIds empty.
- Then, in this order:
  - "row" 事業内容：… — the employer's business description, copied from the Employers list. Omit the row entirely when the list gives none. factIds empty.
  - "row" 資本金：…　従業員数：…名 — copied from the Employers list. **The list gives 資本金 already written the way this document writes it — copy that string and never convert the yen figure yourself.** Omit whichever of the two the list does not give, and omit the row when it gives neither.
  - For each project in the Projects list belonging to this employer, in turn:
    - "row" プロジェクト：<name> — the project name and, where the list gives one, its summary. factIds empty.
    - "row" 技術的成果：
    - the bullets for that project.
  - "row" 主な実績： followed by the bullets written from this employer's facts that name no project — the employer-level outcomes. Omit the row and the bullets when every fact at this employer belongs to a project.
  - "row" 技術スタック：… — the technologies the facts under THIS employer actually name, comma-separated, nothing invented and nothing carried over from another employer. This row lists factIds: it is assembled from facts, unlike the rows above it, which are copied from a list.
- An employer with no projects in the Projects list has no プロジェクト rows and no 技術的成果 row. All of its bullets sit under 主な実績.

How to write a bullet:
- One bullet is written from SEVERAL facts, and usually should be. The facts arrive atomic — what was built, how it was built and what it changed each arrive as their own fact — and putting them back together is this document's job, not the record's. List every fact you used in factIds.
- Weld facts describing the same piece of work at the same employer. Never weld across two employers, and never weld two unrelated pieces of work to make a longer bullet.
- Keep the number. If any fact behind a bullet carries a quantity, a duration, a count, a version or a percentage, the finished bullet states it. Dropping a number to keep a bullet short is a defect, not concision.
- No bullet runs longer than 120 characters. That is about half the English résumé's bound and carries about the same content, because Japanese says in one character roughly what English says in two. Check each bullet against the bound as you finish writing it.
- A bullet over the bound is over because it welded one fact too many, not because its wording is loose. Cut the least load-bearing fact — the background, the tooling aside, the second consequence — and leave the rest whole. Do not split it into two bullets, which undoes the composition, and do not drop the number, which is what the bullet is for.
- The hand-maintained 職務経歴書 this one replaces runs 21 outcome bullets averaging about 65 characters, and about three quarters of them carry a number. That average is the shape to aim at: most bullets sit well below the 120 bound, which is there for the few that do not. It is reached by composing, never by padding a thin bullet with words no fact supports.
- A fact carrying no employer belongs in "summary", "skills" or "self_pr". It is never placed under an employer.

"summary" — 経歴要約:
- One paragraph, about 300 characters, in です・ます体. It is read first and often alone.
- What the author does, the shape of the career, and the two or three pieces of evidence a reader would want before reading further. It may state a certification count; it does not list certifications, which print in full below.

"skills" — 活かせるスキル・経験:
- Three or four groups. Each group is a "row" holding a short noun-phrase label with factIds empty, followed by ONE "paragraph" of about 200 characters, 体言止め, listing factIds.
- Group by what the author can DO, not by employer and not by technology family alone. The employment history is printed below and must not be restated here.

"certifications" — 保有資格:
- One row per entry in the Certifications list, in the order the list gives, copied from it. factIds empty.
- 名称（YYYY年M月取得）. A qualification with no date recorded is written with the name alone.
- **A driving licence DOES belong here.** 保有資格 is its conventional home in a Japanese application, which is the opposite of the English résumé's rule and is deliberate. A language qualification belongs here too, with its score.

"education" — 学歴:
- One row per entry in the Education list, in the order the list gives, copied from it. Institution, faculty or programme, and dates.
- The level decides whether an entry belongs: omit one below upper-secondary level, and keep every other entry including a vocational programme and one whose level is not recorded. Never decide the level from the institution's name, and never write the level into the row.
- An entry whose outcome says the course was left unfinished is written 中退, never as a completion. An entry still in progress is written 在学中. An entry giving only the month it finished is written with that month alone — do not supply a start month it does not give.
- factIds empty.

"self_pr" — 自己PR:
- Three or four paragraphs, about 750 characters in total, です・ます体. Every paragraph lists the ids of the facts it was written from.
- It is the one section that argues rather than reports, and it argues from the same facts: the through-line of the career, the strongest concrete piece of evidence for it, and what the author is looking to do next. Written from facts, not from adjectives.
- It must not restate 職務経歴 employer by employer. That section is immediately above it.
- No contact details, no portfolio link, no GitHub link. Those are the 履歴書's, and nothing in the record holds them.`;

/**
 * The shared half of both story registers.
 *
 * Both stories are the same document in two languages — same chapters, same
 * blocks, same rules about what may be said — and the only things that differ
 * are the voice and the length of a paragraph. Writing the structure twice is
 * how the two drift apart one edit at a time, which is the failure S11 is
 * about. It is interpolated rather than shared by reference so that each
 * register is still one readable string.
 */
const STORY_STRUCTURE = `**The chapters are given to you.** The Chapters list below fixes the key and the order of every chapter in this document. Emit exactly those keys, all of them, in that order, and no others. A chapter you add, drop, merge or reorder is the one failure this structure exists to prevent.

Write the heading yourself. A chapter heading is a line of the story and should read like one. The key is machine scaffolding and never appears in the document.

Blocks:
- A chapter is paragraphs: kind "paragraph". Every paragraph lists the ids of the facts it was written from, in factIds.
- The last two chapters, "anchors" and "routing", are rows: kind "row".
- There are no bullets anywhere in this document. It is prose and two tables.

The employer chapters, one per employer, keyed by that employer's id:
- Open by placing the reader: when it was, what the employer does, and what the author was there to do. Those come from the Employers list, not from the facts.
- Then the work, written from THAT employer's facts and no other employer's.
- An employer the facts are thin on gets a SHORT chapter, never no chapter. Write it from the Employers list alone, with factIds empty on those paragraphs. A story that skips an employment has a gap in it, and a gap is the first thing an interviewer asks about.
- **A fact that carries no employer id is never cited in an employer's chapter**, however well it fits the moment being told. The commonest way to break this is the end of a chapter: the job ended, and the sentence that says what the author did next reaches for the fact that records it. Say the job ended and stop there. What came next is the opening's or the independent-work chapter's, and so is the fact behind it. Work done outside employment, a course taken, a qualification earned: those belong in the opening, in the independent-work chapter where the plan gives one, or in the closing chapters. A fact filed to nobody, told under somebody, is the story saying an employer paid for work they did not.

"anchors" — the table of figures:
- One row per employer, in the order their chapters run, carrying that employer's dates and the figures its chapter used. Then one row for each remaining thing a reader would ask a number about: the independent work, the certifications, the education, the languages.
- A row is a label and its values, compressed. Not a sentence, and never a paragraph.
- Every number in this table appears in a chapter above. This table is not where a number is introduced; it is where the author finds it again under questioning. A number here that appears in no chapter means a chapter dropped it.
- A row lists the ids of the facts its numbers came from. A row carrying only dates copied from the Employers list carries no fact ids.

"routing" — where each question lands:
- One row per question the author should expect: the question as a person would actually ask it, then the chapter that answers it and the evidence to reach for.
- About fifteen rows. Cover the ones this record invites: why the direction changed, why each employer was left, the largest figure in the table above, the thing that went wrong, and what the author wants next.
- A row points at a chapter by the heading you gave it above, and may not point at a chapter that does not exist.
- Where a row names its evidence, list those fact ids.`;

/**
 * The fourth buildable render, and the first that is not a document anybody is
 * sent. It is read on screen by the author before an interview
 * (`src/render/identity.ts`: no 作成日, and `docs/06` 2026-08-20: not a `.docx`
 * at all), which is what licenses the first person and the failures. Every
 * other register in this project writes for a reader who is screening.
 */
const CAREER_STORY_EN_REGISTER = `Write a long-form career story for the author to read before an interview.

It is prepared FOR the author and is sent to nobody. It is not a résumé in paragraphs and nobody screens on it. Its one job is to make the career recallable and defensible under questioning: what was walked into, what was actually done, what changed because of it, what it cost, and what was learned.

${STORY_STRUCTURE}

Register:
- First person, and past tense for what happened. "I" is correct here and is forbidden in every other document written from this record: this one is the author talking.
- Tell it, do not sell it. What makes this document worth having is that it survives the follow-up question. A paragraph written to impress does not.
- What went wrong belongs in the story wherever the facts record it: the thing that broke, the approach abandoned, the estimate that was wrong. This is the one document that is better for carrying them, and an interviewer asks for one inside the first ten minutes.
- No adjectives of self-assessment: no "successfully", no "expertly", no "passionate", no "cutting-edge".
- Keep the number. If a fact behind a paragraph carries a quantity, a duration, a count, a version or a percentage, the paragraph states it.
- A paragraph runs about 400 characters. The hand-maintained story this one replaces runs about 17,000 characters across 39 paragraphs, and its longest chapter is the employer it has the most facts about. That is the shape to aim at, and it is reached by having something to say rather than by padding a thin paragraph with words no fact supports.
- No chapter restates another, and no chapter summarises the whole story. The closing chapter is about what comes next, not a recap.`;

/**
 * The fifth buildable render, and the JA half of S11's pair.
 *
 * Chapter-parallel with {@link CAREER_STORY_EN_REGISTER} and **not a
 * translation of it**: this call never sees the English story, and both are
 * written from the same facts into the same computed plan
 * (`src/render/chapters.ts`).
 */
const CAREER_STORY_JA_REGISTER = `Write a long-form career story in Japanese for the author to read before an interview.

It is prepared FOR the author and is sent to nobody. It is not a 職務経歴書 in paragraphs and nobody screens on it. Its one job is to make the career recallable and defensible under questioning: what was walked into, what was actually done, what changed because of it, what it cost, and what was learned.

An English story is written from these same facts, with these same chapters. **This one is not a translation of it and you are not shown it.** Write Japanese from the facts. A sentence that reads as translated English is a defect here however faithful it is.

${STORY_STRUCTURE}

Register:
- Japanese, です・ます体, consistently. Half-width digits, full-width Japanese punctuation (、。).
- First person. 私 and 自分 are correct here and are forbidden in every other document written from this record: this one is the author talking. Use them where a sentence needs them and drop them where Japanese would.
- This document is addressed to nobody. 貴社 and 御社 appear nowhere in it.
- 体言止め is the 職務経歴書's device and is not this document's. This is prose, and a chapter written in noun-stopped fragments reads as notes rather than as a story.
- Tell it, do not sell it. What makes this document worth having is that it survives the follow-up question. A paragraph written to impress does not.
- What went wrong belongs in the story wherever the facts record it: the thing that broke, the approach abandoned, the estimate that was wrong. This is the one document that is better for carrying them, and an interviewer asks for one early.
- No self-assessment: not 優秀, not 抜群, not 圧倒的, not 誰よりも, not 情熱を持って. State what was done and let it be the claim.
- Keep the number. If a fact behind a paragraph carries a quantity, a duration, a count, a version or a percentage, the paragraph states it.
- A paragraph runs about 200 characters. The hand-maintained story this one replaces runs about 8,500 characters across 39 paragraphs — half the English story's characters for the same content, because Japanese says in one character roughly what English says in two — and its longest chapter is the employer it has the most facts about. That is the shape to aim at, and it is reached by having something to say rather than by padding.
- No chapter restates another, and no chapter summarises the whole story. The closing chapter is about what comes next, not a recap.`;

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
  /**
   * The third buildable render, and the second Japanese one.
   *
   * Unlike the 履歴書 it is a FLOWING document with nothing fixed to preserve,
   * so it takes the generic `toDocx` path the English résumé takes rather than
   * a template (`docs/06`, 2026-08-20). Almost all of it is generated: the
   * renderer writes only the title and the 氏名 header
   * (`src/render/identity.ts`), and {@link SHOKUMU_REGISTER} writes the rest.
   *
   * The flip to `buildable` waited on the two things the other flips waited on
   * and one more: a register that is not empty, a chronology, and 資本金 and
   * 従業員数 reaching the prompt at all. The columns have been on `employers`
   * since the schema was first drawn (`docs/06`, 2026-08-12) and were read by
   * nothing until this register existed, so the acceptance criterion naming
   * them was unmeetable however the register was written.
   */
  shokumu_keirekisho: {
    kind: "shokumu_keirekisho",
    language: RENDER_LANGUAGE.shokumu_keirekisho,
    buildable: true,
    // 逆編年体. `docs/06`, 2026-09-10 left this null because "a 職務経歴書 is
    // written 編年体 or 逆編年体 and nothing in this project has chosen"; the
    // author's own 職務経歴書 is written newest-first, and a document whose
    // purpose is to be read against a career that is still moving leads with
    // where that career is now. The 履歴書 remains the ascending one: its
    // 学歴・職歴 table is a chronology, and this is an argument.
    chronology: "newest_first",
    register: SHOKUMU_REGISTER,
    // The header is 氏名 in kanji (`src/render/identity.ts`), so a kanji name
    // is what generation is blocked without. None of the restricted PII the
    // 履歴書 requires appears on this document: 生年月日, 現住所 and 連絡先 live
    // on the 履歴書 it is submitted alongside (`docs/04` §3.2).
    requiredProfileFields: ["familyNameKanji", "givenNameKanji"],
  },
  /**
   * The fourth and fifth buildable renders, and the only pair: they are one
   * document in two languages and S11 holds them to corresponding chapters.
   *
   * What the correspondence rests on is `src/render/chapters.ts`, not either
   * register. The chapters are computed from the record and handed to both
   * prompts, so the two stories receive the same keys in the same order and
   * cannot disagree about what a chapter is. The registers below differ only in
   * voice and in how long a paragraph runs; the structure is one string they
   * share.
   *
   * The flip to `buildable` waited on the same two things every flip has waited
   * on — a register that is not empty, so the first press of the button is not
   * a generation spent on nothing, and a chronology — plus the plan, without
   * which "chapters correspond one-to-one" is a hope rather than a property.
   */
  career_story_en: {
    kind: "career_story_en",
    language: RENDER_LANGUAGE.career_story_en,
    buildable: true,
    // A story is told forwards. `docs/06`, 2026-09-10 left this null because "a
    // career story's direction is a question about the story"; the question has
    // an answer the other two dated documents do not share, because this one is
    // read as a narrative rather than scanned. The author's own pair runs
    // oldest-first, opening before the career was in software at all.
    chronology: "oldest_first",
    register: CAREER_STORY_EN_REGISTER,
    // `identity.ts` heads this one with the Latin name and the email.
    requiredProfileFields: ["nameLatin"],
  },
  career_story_ja: {
    kind: "career_story_ja",
    language: RENDER_LANGUAGE.career_story_ja,
    buildable: true,
    // The same direction as its counterpart, and it has to be: the chapter plan
    // is built from the employer list AFTER the chronology has ordered it, so
    // two directions would be two plans and the correspondence would be gone.
    chronology: "oldest_first",
    register: CAREER_STORY_JA_REGISTER,
    // `identity.ts` heads this one with the kanji name.
    requiredProfileFields: ["familyNameKanji", "givenNameKanji"],
  },
};
