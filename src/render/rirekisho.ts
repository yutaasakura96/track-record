/**
 * The 履歴書, assembled.
 *
 * Three modules meet here. `./rirekisho-template.ts` knows the placeholders,
 * `./rirekisho-rows.ts` knows the wording of the three loops, and this file
 * knows everything that is neither: the identity block, the submission date the
 * age is computed against, and the unexplained-gap warning.
 * `docs/04-database-schema.md` §4 is the contract for all three.
 *
 * **This is the only module that reads the restricted PII columns** — `docs/04`
 * §3.2: `date_of_birth`, `phone`, `postal_code`, `address`, `contact_*` and
 * `photo` are readable by the 履歴書 spec and by nothing else.
 * `src/render/identity.ts` deliberately does not model 履歴書 for this reason,
 * and says so: the other four renders must never be able to reach these fields,
 * and a shared identity type that carried them is how one eventually would.
 *
 * **Almost nothing here is written by the model.** The identity block, both
 * dates and the three tables are read from the record; only 志望動機 and
 * 本人希望欄 are generated, and they arrive as `RenderContent` under the two
 * keys in {@link PROSE_SECTION_KEYS}.
 *
 * **The 写真 cell is not filled.** It is an anchored image and docxtemplater
 * cannot place one without an image module; the template ships with the cell
 * empty and this module leaves it that way (`docs/04` §4). A known gap, not a
 * silent one.
 */
import {
  fillRirekishoTemplate,
  type RirekishoTemplateData,
} from "./rirekisho-template";
import {
  rirekishoTables,
  type RirekishoCertification,
  type RirekishoEducation,
  type RirekishoEmployer,
} from "./rirekisho-rows";
import type { RenderContent } from "~/shared/render-content";

/**
 * The ideographic space the 名前 and ふりがな cells join on.
 *
 * §4 states the U+3000 rule for the rows of the three tables. It is applied to
 * the name for the same reason it is applied there — an ASCII space sits
 * visibly narrow in `MS Mincho`, and 名前 is the most-read cell on the page —
 * but the contract does not cover the identity block, so this is a decision
 * rather than a transcription.
 */
const SEP = "　";

/**
 * The profile columns the 履歴書 reads. A narrow projection rather than the
 * `profiles` row, which is what keeps `photo` — and the two `updated_at`s
 * nobody wants on a document — out of reach.
 */
export interface RirekishoProfile {
  familyNameKanji: string;
  givenNameKanji: string;
  familyNameKana: string;
  givenNameKana: string;
  /**
   * 生年月日. **The month-precision rule does not apply here.** Calendar columns
   * pin the day to `01` and never render it (CLAUDE.md); a date of birth
   * carries a real day and the identity block prints it, which is why the
   * template has a `{birthDay}` and the 年 / 月 tables have no day at all.
   */
  dateOfBirth: string;
  /** 性別 — optional under the 2024 JIS revision, so the cell may be empty. */
  gender: string | null;
  phone: string;
  email: string;
  postalCode: string;
  /** May carry a newline: the second line is a building name (`docs/04` §4). */
  address: string;
  addressKana: string;
  contactSameAsAddress: boolean;
  contactPostalCode: string | null;
  contactAddress: string | null;
}

/**
 * The fields generation is blocked without (`docs/04` §4). Blocking is the
 * point: a 履歴書 missing conventional fields is worse than no 履歴書 at all
 * (PRD §8), and `POST /api/renders/:kind/generate` names the ones it is missing
 * rather than producing a document with a hole in it.
 *
 * `address_kana` is **not** on the list, because §4 does not put it there. An
 * empty ふりがな over 現住所 is a blank line; an empty 現住所 is a defective
 * document.
 */
export const REQUIRED_PROFILE_FIELDS = [
  "familyNameKanji",
  "givenNameKanji",
  "familyNameKana",
  "givenNameKana",
  "dateOfBirth",
  "phone",
  "postalCode",
  "address",
] as const;

/**
 * The two generated blocks, by `RenderSection.key`. Stated here rather than in
 * the register so that `RIREKISHO_REGISTER` (`src/render/spec.ts`) and the
 * reader of the content agree by construction. A section under any other key is
 * discarded unread by {@link proseText}, which is why the register says so.
 */
export const PROSE_SECTION_KEYS = {
  /** 志望動機・特技・アピールポイントなど */
  motivation: "motivation",
  /** 本人希望欄, seeded from `profiles.desired_role_note`. */
  kibou: "kibou",
} as const;

export interface RirekishoRecord {
  educations: RirekishoEducation[];
  employers: RirekishoEmployer[];
  certifications: RirekishoCertification[];
}

export interface RirekishoInputs {
  profile: RirekishoProfile;
  record: RirekishoRecord;
  /** `YYYY-MM-DD` in Japan Standard Time. See {@link tokyoToday}. */
  submittedOn: string;
  /** The accepted version's content. The two prose blocks are read from it. */
  content?: RenderContent | null;
}

/* ------------------------------------------------------------------ dates */

/**
 * Today in Japan, as `YYYY-MM-DD`.
 *
 * The Worker's clock is UTC, and a 履歴書 stamped from it carries **yesterday's
 * date in Tokyo for nine hours of every day**. The submission date is the date
 * the applicant hands the document over; it is a Japanese document read in
 * Japan, so the zone is fixed rather than taken from the runtime.
 */
export function tokyoToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * 満N歳 on a given date — the age the identity block states, computed against
 * the **submission date** rather than stored (`docs/04` §4).
 *
 * The ordinary calendar rule: the age increases on the birthday. Japanese law
 * increments it at the end of the preceding day, which differs on exactly one
 * day a year and is a rule about statutory deadlines rather than about how this
 * document is filled in.
 */
export function ageOn(dateOfBirth: string, on: string): number {
  const birth = ymd(dateOfBirth);
  const at = ymd(on);
  const hadBirthday =
    at.month > birth.month || (at.month === birth.month && at.day >= birth.day);
  return at.year - birth.year - (hadBirthday ? 0 : 1);
}

/** `YYYY年 M月 D日` in three pieces, each without a leading zero. */
export function submissionStamp(on: string) {
  const { year, month, day } = ymd(on);
  return { submitYear: String(year), submitMonth: String(month), submitDay: String(day) };
}

/* ------------------------------------------------------------------- gaps */

/** One dated stretch of the record. Either bound may be missing. */
export interface CareerSpan {
  startedOn: string | null;
  endedOn: string | null;
}

export interface UnexplainedGap {
  /** `YYYY-MM` the covered stretch ended. */
  after: string;
  /** `YYYY-MM` the next one begins. */
  before: string;
  /** Whole months covered by no entry. */
  months: number;
}

/**
 * How many uncovered months make a gap.
 *
 * Not one: 3月卒業 followed by 4月入社 is the ordinary Japanese transition and
 * leaves zero uncovered months by this count, but leaving a job in June and
 * starting in September leaves two and is an ordinary job change. Three is
 * where a reader starts to read the space as something to ask about.
 *
 * **A judgement, not a transcription.** §4 requires a warning for an
 * unexplained gap and does not say how wide one is.
 */
export const GAP_MONTHS = 3;

/**
 * The stretches of the record covered by no 学歴 or 職歴 entry.
 *
 * A gap **warns and never blocks** (`docs/04` §4): the convention treats one as
 * a defect, but the defect may be the truth, and a document the author cannot
 * produce is worse than one they have to explain.
 *
 * An entry with no end covers everything after it — a course still running or
 * the current employer — so the scan stops at the first one.
 */
export function unexplainedGaps(record: {
  educations: CareerSpan[];
  employers: CareerSpan[];
}): UnexplainedGap[] {
  const spans = [...record.educations, ...record.employers]
    // A row with only an end month is a point in time, not a stretch: it is
    // the one the author holds as a graduation month alone (`docs/04` §4).
    .map((s) => ({ from: s.startedOn ?? s.endedOn, to: s.endedOn }))
    .filter((s): s is { from: string; to: string | null } => s.from !== null)
    .sort((a, b) => monthIndex(a.from) - monthIndex(b.from));

  const gaps: UnexplainedGap[] = [];
  const [first, ...rest] = spans;
  if (!first) return gaps;

  let coveredUntil = first.to;
  for (const span of rest) {
    if (coveredUntil === null) break;
    const uncovered = monthIndex(span.from) - monthIndex(coveredUntil) - 1;
    if (uncovered >= GAP_MONTHS) {
      gaps.push({ after: month(coveredUntil), before: month(span.from), months: uncovered });
    }
    if (span.to === null) break;
    if (monthIndex(span.to) > monthIndex(coveredUntil)) coveredUntil = span.to;
  }

  return gaps;
}

/**
 * What the 履歴書 deliberately does not write, told to the author rather than
 * left for them to notice.
 *
 * The register writes 特技 and アピールポイント and refuses to write a 志望動機,
 * because the record holds no company and no posting to write one against and
 * inventing the target is the one thing that cell must not do. Silence about
 * that would read as a model that forgot half its instruction; a warning is a
 * known gap rather than a silent one, and it travels the same channel a gap in
 * the 学歴・職歴 table does.
 */
export const MOTIVATION_NOTICE =
  "志望動機 is not generated: the record holds no company or posting to write one against. " +
  "The cell states 特技 and アピールポイント; the 志望動機 sentence is yours to add.";

/** The gaps as sentences. Never blocking. */
export function gapWarnings(record: {
  educations: CareerSpan[];
  employers: CareerSpan[];
}): string[] {
  return unexplainedGaps(record).map(
    (gap) =>
      `${gap.months} months between ${gap.after} and ${gap.before} are covered by no 学歴・職歴 entry.`,
  );
}

/**
 * Everything advisory a 履歴書 has to say, in one list.
 *
 * Two callers need it and must not drift: `POST /api/renders/:kind/generate`
 * answers with it, and the proposal the author actually reviews carries it too
 * — the generation response is a 202 the author may never see, and the review
 * screen is where the decision is taken.
 *
 * The gaps come first because a gap is a finding about THIS record and may not
 * be there next time; the notice is unconditional and true of every 履歴書 this
 * tool will ever produce.
 */
export function rirekishoWarnings(record: {
  educations: CareerSpan[];
  employers: CareerSpan[];
}): string[] {
  return [...gapWarnings(record), MOTIVATION_NOTICE];
}

/* -------------------------------------------------------------- assembly */

/** Every placeholder the template carries, filled. */
export function rirekishoTemplateData(inputs: RirekishoInputs): RirekishoTemplateData {
  const { profile, record, submittedOn, content } = inputs;
  const birth = ymd(profile.dateOfBirth);
  const tables = rirekishoTables(record);

  return {
    ...submissionStamp(submittedOn),
    nameKana: `${profile.familyNameKana}${SEP}${profile.givenNameKana}`.trim(),
    nameKanji: `${profile.familyNameKanji}${SEP}${profile.givenNameKanji}`.trim(),
    birthYear: String(birth.year),
    birthMonth: String(birth.month),
    birthDay: String(birth.day),
    age: String(ageOn(profile.dateOfBirth, submittedOn)),
    gender: profile.gender ?? "",
    phone: profile.phone,
    email: profile.email,
    addressKana: profile.addressKana,
    postalCode: profile.postalCode,
    address: profile.address,
    // 同上 is the whole cell when the contact address repeats the current one,
    // and the 〒 cell beside it is left empty rather than repeated too.
    contactPostalCode: profile.contactSameAsAddress ? "" : (profile.contactPostalCode ?? ""),
    contactLine: profile.contactSameAsAddress ? "同上" : (profile.contactAddress ?? ""),
    ...tables,
    motivation: proseText(content, PROSE_SECTION_KEYS.motivation),
    kibou: proseText(content, PROSE_SECTION_KEYS.kibou),
  };
}

/** The filled `.docx` bytes. Assembled on every download and never stored. */
export function buildRirekisho(inputs: RirekishoInputs): Uint8Array {
  return fillRirekishoTemplate(rirekishoTemplateData(inputs));
}

/* -------------------------------------------------------------- internals */

/**
 * One generated section as text. Blocks are joined with newlines, which the
 * template renders as line breaks (`linebreaks: true`). A section that was
 * never generated is an empty cell, not a missing placeholder.
 */
function proseText(content: RenderContent | null | undefined, key: string): string {
  const section = content?.sections.find((s) => s.key === key);
  if (!section) return "";
  return section.blocks
    .map((block) => block.text.trim())
    .filter((text) => text !== "")
    .join("\n");
}

function ymd(date: string) {
  return {
    year: Number(date.slice(0, 4)),
    month: Number(date.slice(5, 7)),
    day: Number(date.slice(8, 10)),
  };
}

/** Months since year 0, so two calendar months can be subtracted. */
function monthIndex(date: string): number {
  const { year, month } = ymd(date);
  return year * 12 + month;
}

const month = (date: string) => date.slice(0, 7);
