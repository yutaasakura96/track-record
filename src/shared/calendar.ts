/**
 * Calendar values are MONTH PRECISION: a date with the day pinned to `01`, and
 * the day is never displayed (`docs/04-database-schema.md` §0).
 *
 * Shared, because the rule is one rule. It was previously restated wherever a
 * form or a route happened to need it, which is how two copies drift.
 */

/** The wire and storage form: `YYYY-MM-01`. */
export const MONTH_DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-01$/;

/** `2024-09-01` → `2024-09`, which is what a `<input type="month">` holds. */
export const toMonth = (isoDate: string | null | undefined) =>
  isoDate ? isoDate.slice(0, 7) : "";

/** `2024-09` → `2024-09-01`. The day the author never sees is added here. */
export const fromMonth = (month: string) => (month ? `${month}-01` : "");
