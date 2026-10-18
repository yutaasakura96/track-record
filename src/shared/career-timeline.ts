/**
 * The career timeline (Screen 4, issue #113): what the record screen shows
 * beside the hand-entered rows themselves.
 *
 * The rows come from their own collections. This is what no collection holds:
 * how much each employer and project is backed by, and where the 履歴書 would
 * warn of a gap. Counts and months only, never a claim.
 */
import { RENDER_KINDS, RENDER_TITLE, type RenderKind } from "./render-content";

export interface TimelineEmployer {
  id: string;
  /** Accepted facts that resolve to this employer (`docs/04` §3.12). */
  achievements: number;
  /** Of those, the ones filed under no project. */
  unfiled: number;
  /** Imported documents those facts came from. */
  documents: number;
  /** Of those facts, the ones added by quick capture. */
  captures: number;
}

export interface TimelineProject {
  id: string;
  /** Accepted facts filed under this project. */
  achievements: number;
}

/** One stretch the 履歴書 would warn about: months as `YYYY-MM`. */
export interface TimelineGap {
  after: string;
  before: string;
  months: number;
}

export interface CareerTimeline {
  employers: TimelineEmployer[];
  projects: TimelineProject[];
  /** The 履歴書's own gap warning, over the rows it would print. */
  gaps: TimelineGap[];
}

/* ---------------------------------------------------------------- duration */

/** `YYYY-MM…` → a month count, for arithmetic only. */
const monthIndex = (date: string) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;

/**
 * `3 yrs 6 mos`: how long a stretch lasted, both end months counted, as a
 * résumé reader counts them. An open end runs to `today`. Null without a start.
 */
export function duration(startedOn: string | null, endedOn: string | null, today: string): string | null {
  if (!startedOn) return null;
  const months = monthIndex(endedOn ?? today) - monthIndex(startedOn) + 1;
  if (months < 1) return null;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const parts = [
    years ? `${years} ${years === 1 ? "yr" : "yrs"}` : null,
    rest ? `${rest} ${rest === 1 ? "mo" : "mos"}` : null,
  ];
  return parts.filter(Boolean).join(" ");
}

/* --------------------------------------------------------------- inclusion */

/**
 * One line for an entry's per-render setting (S13), naming only the
 * exceptions: `In all 5 documents`, `Left out of: 履歴書`, or, when most are
 * off, `Only in: 履歴書`.
 */
export function inclusionSummary(excluded: ReadonlySet<RenderKind>): string {
  const left = RENDER_KINDS.filter((kind) => excluded.has(kind));
  const kept = RENDER_KINDS.filter((kind) => !excluded.has(kind));
  if (left.length === 0) return `In all ${RENDER_KINDS.length} documents`;
  if (kept.length === 0) return "Left out of every document";
  if (kept.length < left.length) return `Only in: ${kept.map((kind) => RENDER_TITLE[kind]).join(", ")}`;
  return `Left out of: ${left.map((kind) => RENDER_TITLE[kind]).join(", ")}`;
}

/* ------------------------------------------------------------------ expiry */

/** How far ahead an expiry is called out. */
export const EXPIRY_NOTICE_MONTHS = 3;

/**
 * `expired 2022-04`, `expires this month`, `expires in 2 months`, or null when
 * the certification does not expire or not soon. Month precision, so a
 * certification expiring this month is still held.
 */
export function expiry(expiresOn: string | null, today: string): { text: string; expired: boolean } | null {
  if (!expiresOn) return null;
  const ahead = monthIndex(expiresOn) - monthIndex(today);
  if (ahead < 0) return { text: `expired ${expiresOn.slice(0, 7)}`, expired: true };
  if (ahead === 0) return { text: "expires this month", expired: false };
  if (ahead <= EXPIRY_NOTICE_MONTHS) return { text: `expires in ${ahead} ${ahead === 1 ? "month" : "months"}`, expired: false };
  return null;
}

/* -------------------------------------------------------------------- gaps */

/**
 * Where a gap sits among employer cards listed newest first: the index of the
 * card it goes above. That is the first card to start before the stretch that
 * follows the gap; `starts.length` puts it after the oldest, between the work
 * and the schooling.
 */
export function gapPosition(gap: TimelineGap, starts: string[]): number {
  const index = starts.findIndex((startedOn) => monthIndex(startedOn) < monthIndex(gap.before));
  return index === -1 ? starts.length : index;
}

/** The 履歴書's sentence for a gap, as its warning words it. */
export const gapText = (gap: TimelineGap) =>
  `${gap.months} months between ${gap.after} and ${gap.before} are covered by no 学歴・職歴 entry. The 履歴書 will warn about it.`;
