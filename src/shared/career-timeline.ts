/**
 * The career timeline (Screen 4, issue #113): what the record screen shows
 * beside the hand-entered rows themselves.
 *
 * The rows come from their own collections. This is what no collection holds:
 * how much each employer and project is backed by, and where the 履歴書 would
 * warn of a gap. Counts and months only, never a claim.
 */
import { RENDER_KINDS, RENDER_TITLE, type RenderKind } from "./render-content";
import type { CareerGap, GapNote } from "./career-gap";

export interface TimelineEmployer {
  id: string;
  /** Accepted facts that resolve to this employer (`docs/04` §3.12). */
  achievements: number;
  /** Of those, the ones filed under no project. */
  unfiled: number;
  /** Imported documents those facts came from. */
  documents: number;
}

export interface TimelineProject {
  id: string;
  /** Accepted facts filed under this project. */
  achievements: number;
}

/** One stretch the 履歴書 would warn about: months as `YYYY-MM`. */
export type TimelineGap = CareerGap;

/** An explanation as stored: months as `YYYY-MM-01`. */
export interface TimelineGapNote extends GapNote {
  id: string;
}

export interface CareerTimeline {
  employers: TimelineEmployer[];
  projects: TimelineProject[];
  /** The 履歴書's own gap warning, over the rows it would print: the gaps nobody has explained. */
  gaps: TimelineGap[];
  /** Each gap the author has explained, with the ※ row that explains it. */
  explained: { gap: TimelineGap; note: TimelineGapNote }[];
  /** Explanations whose gap has since moved or closed. Kept, and printed nowhere. */
  staleNotes: TimelineGapNote[];
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
 * exceptions: `In all 5 documents` or `Left out of: 履歴書`.
 */
export function inclusionSummary(excluded: ReadonlySet<RenderKind>): string {
  const left = RENDER_KINDS.filter((kind) => excluded.has(kind));
  if (left.length === 0) return `In all ${RENDER_KINDS.length} documents`;
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

/* ------------------------------------------------------- dates that clash */

/** A dated row filed under an employer: a role, or a project. */
export interface DatedUnder {
  name: string;
  startedOn: string | null;
  /** On a role, null is a role still held. On a project, null is an end not recorded. */
  endedOn: string | null;
}

/**
 * Why a role or project is dated outside its employer, or null when it is not
 * (issue #117, review §5 G5). Months only, compared as `YYYY-MM`.
 *
 * Shortening an employer's dates used to leave its roles and projects running
 * past the new end with nothing said anywhere, and the 職務経歴書 then printed
 * dates that contradict each other. A role with no end under an employer that
 * has ended is outside it: the role reads as held today. A project with no end
 * is not, because a project's end is often simply not recorded.
 */
export function outsideEmployer(
  employer: { startedOn: string; endedOn: string | null },
  row: DatedUnder & { kind: "role" | "project" },
): string | null {
  const month = (date: string) => date.slice(0, 7);
  const start = month(employer.startedOn);
  const end = employer.endedOn ? month(employer.endedOn) : null;
  if (row.startedOn && month(row.startedOn) < start) return `starts before this job did, ${start}`;
  if (end === null) return null;
  if (row.startedOn && month(row.startedOn) > end) return `starts after this job ended, ${end}`;
  if (row.endedOn ? month(row.endedOn) > end : row.kind === "role") return `runs past this job's end, ${end}`;
  return null;
}

/* -------------------------------------------------------------------- gaps */

/**
 * Where a gap sits among employer cards listed newest first: the index of the
 * card it goes above. That is the first card to start before the stretch that
 * follows the gap; `starts.length` puts it after the oldest, between the work
 * and the schooling.
 */
export function gapPosition(gap: Pick<TimelineGap, "before">, starts: string[]): number {
  const index = starts.findIndex((startedOn) => monthIndex(startedOn) < monthIndex(gap.before));
  return index === -1 ? starts.length : index;
}
