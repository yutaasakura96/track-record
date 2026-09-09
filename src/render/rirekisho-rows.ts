/**
 * The 履歴書 derived rows.
 *
 * `templates/rirekisho.blank.docx` carries three loops — `{#gakureki}`,
 * `{#shokureki}`, `{#shikaku}` — each a bare `{year}` / `{month}` / `{text}`.
 * This module turns the record into those rows and nothing else.
 * `src/render/rirekisho-template.ts` knows the placeholders; this file knows
 * the wording; `docs/04-database-schema.md` §4 is the contract for both.
 *
 * **Nothing here is stored.** A 学歴 record is two rows, a 職歴 record is one
 * or two, and the verb that ends every 免許・資格 row is composed at render
 * time. Storing the composed text would make the record a copy of the document
 * rather than its source (`docs/01` §2).
 *
 * ## What is furniture and what is derived
 *
 * The template already holds the column headers, the centred `学歴` and `職歴`
 * bands and the closing `以上`. They are not rows this module emits — a render
 * that emitted `以上` would print it twice. The loops carry entries only.
 *
 * ## The separator is U+3000
 *
 * Every row in the author's own file joins its parts with an ideographic space,
 * and a row assembled with an ASCII space sits visibly narrow beside the rest
 * in `MS Mincho`. The source is not perfectly consistent about this — two rows
 * use an ASCII space and one omits the separator after a full-width bracket —
 * and this module normalises rather than reproducing the inconsistency.
 */

/** The ideographic space every row joins its parts with. */
const SEP = "　";

/** One row of a 年 / 月 / 内容 table, matching `RirekishoRow` in the template seam. */
export interface DerivedRow {
  year: string;
  month: string;
  text: string;
}

export type EducationOutcome = "graduated" | "completed" | "withdrawn" | "expected";

export type EducationLevel =
  | "secondary_lower"
  | "secondary_upper"
  | "vocational"
  | "tertiary"
  | "postgraduate";

/**
 * The education columns a 履歴書 row may read. A narrow projection rather than
 * the `educations` row, for the reason `identity.ts` gives: a column that is
 * not on this type cannot reach the document by accident.
 *
 * `institutionJa` is preferred where it exists and `institution` is the
 * fallback — the record holds the institution as the author writes it, Latin
 * name and Japanese suffix together, and translating it here would be inventing.
 */
export interface RirekishoEducation {
  institution: string;
  institutionJa: string | null;
  /** 学部・学科・専攻, appended to the institution on both rows. */
  faculty: string | null;
  /** Null on a record the author holds only as a completion month. */
  startedOn: string | null;
  endedOn: string | null;
  outcome: EducationOutcome;
  level: EducationLevel | null;
}

/**
 * The employer columns a 職歴 row may read.
 *
 * `shokushuJa` is the 職種 of the role held **on entry** — the row reads
 * "…として入社", and the role that sentence names is the one the employment
 * started with, not the latest one. Picking it is the caller's job, because
 * only the caller has the roles.
 *
 * `businessDescription` is deliberately absent. `docs/04` §4 named it as the
 * third element of the 入社 row; the author's own file carries the 職種 there
 * and the column is empty on every employer in the record.
 */
export interface RirekishoEmployer {
  nameJa: string;
  /** e.g. 小売業. Omitted from the row when null. */
  industryJa: string | null;
  /** 職種 of the entry role. Omitted from the row when null. */
  shokushuJa: string | null;
  startedOn: string;
  /** Null = current employer, which contributes no 退社 row. */
  endedOn: string | null;
  /** 退職理由. Leads the 退社 row when present. */
  leavingReasonJa: string | null;
}

/** The certification columns a 免許・資格 row may read. */
export interface RirekishoCertification {
  name: string;
  nameJa: string | null;
  /** Null rows are omitted: the table is dated by construction (`docs/04` §4). */
  issuedOn: string | null;
}

/** The three loops, ready for `RirekishoTemplateData`. */
export interface RirekishoTables {
  gakureki: DerivedRow[];
  shokureki: DerivedRow[];
  shikaku: DerivedRow[];
}

/**
 * The closing verb for an education row. `outcome` decides it and nothing else
 * does — 履歴書 convention requires a withdrawal to read 中退, and rendering it
 * as 卒業 is a misrepresentation rather than a formatting slip
 * (`src/server/db/schema.ts`).
 *
 * `expected` has no entry here on purpose: an unfinished course has no closing
 * row at all, and `educationRows` marks its 入学 row 在学中 instead.
 */
const CLOSING_VERB: Record<Exclude<EducationOutcome, "expected">, string> = {
  graduated: "卒業",
  completed: "修了",
  withdrawn: "中退",
};

/**
 * Is this education a credential rather than a stage of schooling?
 *
 * A finished non-degree course is what the 履歴書 prints under 免許・資格
 * (`docs/06`, 2026-09-06), and the author's own file does exactly that. The
 * qualifier is *finished*: a vocational course left unfinished or still running
 * is career chronology and belongs in 学歴, because 免許・資格 is a list of
 * things held.
 */
function isCredentialCourse(e: RirekishoEducation): boolean {
  if (e.level !== "vocational") return false;
  if (e.endedOn === null) return false;
  return e.outcome === "completed" || e.outcome === "graduated";
}

/** `institution` (or its Japanese form) with the faculty appended. */
function institutionText(e: RirekishoEducation): string {
  return join(e.institutionJa ?? e.institution, e.faculty);
}

/**
 * The 学歴 rows: **two per record**, ascending.
 *
 * - An 入学 row from `startedOn`, and a closing row from `endedOn` whose verb
 *   follows `outcome`.
 * - A record with no `startedOn` contributes **the closing row alone**. It does
 *   not get an 入学 row with a guessed month, and it is not dropped — the
 *   author's file opens 学歴 with exactly such a row (`docs/04` §4).
 * - A record whose outcome is `expected` contributes **the 入学 row alone**,
 *   marked （在学中）. Its `endedOn` is an expectation rather than an event, and
 *   the author's file prints no closing row against it.
 * - A finished vocational course contributes nothing here; see `shikakuRows`.
 */
export function educationRows(educations: RirekishoEducation[]): DerivedRow[] {
  const rows: DerivedRow[] = [];

  for (const e of educations) {
    if (isCredentialCourse(e)) continue;
    const where = institutionText(e);

    if (e.startedOn !== null) {
      const entry = e.outcome === "expected" ? "入学（在学中）" : "入学";
      rows.push(row(e.startedOn, join(where, entry)));
    }
    if (e.outcome !== "expected" && e.endedOn !== null) {
      rows.push(row(e.endedOn, join(where, CLOSING_VERB[e.outcome])));
    }
  }

  return ascending(rows);
}

/**
 * The 職歴 rows, ascending — one 入社 row per employer and one 退社 row per
 * employer that has ended.
 *
 * The rows are sorted by date **across** employers rather than grouped by
 * employer. Two employments that overlap interleave, which is what the author's
 * file does and what the convention requires: the table is a chronology.
 *
 * The 入社 row is `employer　industry　職種として入社`, with the industry and
 * the 職種 each omitted when the record has none. The 退社 row leads with the
 * reason — `一身上の都合により` + employer + `を退社` — because that is the
 * order the convention puts it in, and reads `employer + を退社` when the
 * record holds no reason. It never invents one: `一身上の都合により` asserts a
 * voluntary departure, and asserting that about a contract that simply ended is
 * a misstatement on a document that is signed.
 */
export function employmentRows(employers: RirekishoEmployer[]): DerivedRow[] {
  const rows: DerivedRow[] = [];

  for (const e of employers) {
    const entry = e.shokushuJa === null ? "入社" : `${e.shokushuJa}として入社`;
    rows.push(row(e.startedOn, join(e.nameJa, e.industryJa, entry)));

    if (e.endedOn !== null) {
      rows.push(row(e.endedOn, `${e.leavingReasonJa ?? ""}${e.nameJa}を退社`));
    }
  }

  return ascending(rows);
}

/**
 * The 免許・資格 rows, ascending — every certification with an issue date, plus
 * every finished vocational course.
 *
 * **Every row ends in a verb.** The name alone is not a row: a render that
 * emits bare names is the failure `docs/03` §12 describes, invisible to the
 * author and obvious to a Japanese reader. `取得` is the default and `修了` is
 * used for a course — an examination or licence is 取得, a completed course of
 * study is 修了 — which is why the two sources are distinguishable here and
 * why the verb is not a column on `certifications`.
 */
export function shikakuRows(
  certifications: RirekishoCertification[],
  educations: RirekishoEducation[] = [],
): DerivedRow[] {
  const rows: DerivedRow[] = [];

  for (const c of certifications) {
    if (c.issuedOn === null) continue;
    rows.push(row(c.issuedOn, join(c.nameJa ?? c.name, "取得")));
  }

  for (const e of educations) {
    if (!isCredentialCourse(e)) continue;
    // `endedOn` is non-null on every row `isCredentialCourse` accepts.
    rows.push(row(e.endedOn!, join(institutionText(e), "修了")));
  }

  return ascending(rows);
}

/** The three loops in one call — what a 履歴書 render actually wants. */
export function rirekishoTables(record: {
  educations: RirekishoEducation[];
  employers: RirekishoEmployer[];
  certifications: RirekishoCertification[];
}): RirekishoTables {
  return {
    gakureki: educationRows(record.educations),
    shokureki: employmentRows(record.employers),
    shikaku: shikakuRows(record.certifications, record.educations),
  };
}

/**
 * A calendar column is a `date` with the day pinned to `01` and the day is
 * never rendered (CLAUDE.md). The month is printed without a leading zero,
 * which is how the template's narrow 月 column is set.
 */
function row(date: string, text: string): DerivedRow {
  return { year: date.slice(0, 4), month: String(Number(date.slice(5, 7))), text };
}

/** Join the parts that exist with the ideographic space, dropping the blanks. */
function join(...parts: (string | null)[]): string {
  return parts
    .map((part) => part?.trim() ?? "")
    .filter((part) => part !== "")
    .join(SEP);
}

/**
 * Ascending by year then month, stable — two rows in the same month keep the
 * order the record gave them, which is the only ordering information left once
 * the day is pinned to `01`.
 */
function ascending(rows: DerivedRow[]): DerivedRow[] {
  return rows
    .map((value, index) => ({ value, index }))
    .sort((a, b) => {
      const year = Number(a.value.year) - Number(b.value.year);
      if (year !== 0) return year;
      const month = Number(a.value.month) - Number(b.value.month);
      if (month !== 0) return month;
      return a.index - b.index;
    })
    .map(({ value }) => value);
}
