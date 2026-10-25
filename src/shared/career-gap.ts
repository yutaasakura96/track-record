/**
 * A gap in the 学歴・職歴 chronology, as every screen and document words it
 * (issue #117, review §5 G1–G3).
 *
 * `src/render/rirekisho.ts` finds the gaps; this module only says them. It is
 * shared so the 履歴書's review, View, Home, the career timeline and the
 * career stories' prompt cannot word one gap four ways.
 *
 * **A gap is named by the months nobody covers**, not by the months either side
 * of it: 「2020年2月〜6月（5か月）」, never "between 2020-01 and 2020-07", which
 * is the stretch a reader has to subtract to find.
 */

/** One stretch covered by no 学歴 or 職歴 entry. Months are `YYYY-MM`. */
export interface CareerGap {
  /** The month the covered stretch ended. */
  after: string;
  /** The month the next one begins. */
  before: string;
  /** The first uncovered month. */
  from: string;
  /** The last uncovered month. */
  to: string;
  /** Whole months covered by no entry: `from` to `to`, both counted. */
  months: number;
}

/**
 * The author's own explanation of a gap: the ※ row the 履歴書 prints under the
 * 退社 line (doda's convention). Months are `YYYY-MM-01`, as every month column
 * is stored and sent.
 *
 * It explains the gap whose months it names **exactly**. Its months are printed
 * on a signed document, so a note whose gap has since moved or closed is not
 * printed at all rather than printed with months that are no longer true.
 */
export interface GapNote {
  fromOn: string;
  toOn: string;
  text: string;
}

/** What naming a gap needs: its uncovered months, and how many. */
type GapMonths = Pick<CareerGap, "from" | "to" | "months">;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const parts = (month: string) => ({ year: Number(month.slice(0, 4)), month: Number(month.slice(5, 7)) });

/** `2020年2月〜6月`, with the year repeated only when it changes. */
export function gapMonthsJa(gap: Pick<CareerGap, "from" | "to">): string {
  const from = parts(gap.from);
  const to = parts(gap.to);
  const end = from.year === to.year ? `${to.month}月` : `${to.year}年${to.month}月`;
  return `${from.year}年${from.month}月〜${end}`;
}

/** `February–June 2020`, or `November 2019–February 2020` across a year. */
export function gapMonthsEn(gap: Pick<CareerGap, "from" | "to">): string {
  const from = parts(gap.from);
  const to = parts(gap.to);
  const start = MONTH_NAMES[from.month - 1];
  const end = `${MONTH_NAMES[to.month - 1]} ${to.year}`;
  return from.year === to.year ? `${start}–${end}` : `${start} ${from.year}–${end}`;
}

/** `2020年2月〜6月（5か月）`: the gap as a Japanese reader names it. */
export const gapLabelJa = (gap: GapMonths) => `${gapMonthsJa(gap)}（${gap.months}か月）`;

/** `February–June 2020 (5 months)`. */
export const gapLabelEn = (gap: GapMonths) => `${gapMonthsEn(gap)} (${gap.months} months)`;

/**
 * The warning, in both languages: the 履歴書 is read by a Japanese reader and
 * the interface is English, and the author needs both to act on it.
 */
export const gapWarningJa = (gap: GapMonths) => `${gapLabelJa(gap)}は、学歴・職歴のどの行にも含まれていません。`;
export const gapWarningEn = (gap: GapMonths) => `${gapLabelEn(gap)} is covered by no 学歴・職歴 entry.`;

/** Both, as one line, for the places that carry warnings as strings. */
export const gapWarning = (gap: GapMonths) => `${gapWarningJa(gap)} ${gapWarningEn(gap)}`;

/**
 * The ※ row's text: `※2020年2月〜2020年6月　<text>`. Both years are written,
 * as the convention's examples write them, and the parts are joined with the
 * ideographic space every other row joins on.
 */
export function gapNoteRow(note: GapNote): string {
  const from = parts(note.fromOn);
  const to = parts(note.toOn);
  return `※${from.year}年${from.month}月〜${to.year}年${to.month}月　${note.text.trim()}`;
}

/** Does this note explain this gap? Only when it names the same months. */
export const explains = (note: Pick<GapNote, "fromOn" | "toOn">, gap: Pick<CareerGap, "from" | "to">) =>
  note.fromOn.slice(0, 7) === gap.from && note.toOn.slice(0, 7) === gap.to;

/**
 * The longest explanation a ※ row takes. About two lines of the 学歴・職歴
 * column: a note is a reason, like 「資格取得のため学習」, not an account.
 */
export const GAP_NOTE_MAX = 80;
