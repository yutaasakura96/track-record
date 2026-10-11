/**
 * Where an application stands (issue #70).
 *
 * The rules here are one set of rules, read by the routes that change an
 * application and by the screens that show one: which steps there are, what a
 * change does to their dates, and what "gone quiet" and "how long since" mean.
 * No figure here is stored. Each is worked out on read, so correcting a date
 * corrects every figure that depends on it.
 *
 * Two clocks, on purpose. "How long since" a step counts from the day the step
 * HAPPENED, which the author can correct. Gone quiet counts from the last time
 * the author CHANGED the application, so a step entered three weeks late does
 * not arrive already marked as silent.
 *
 * DAY PRECISION, unlike the career record. A step's date is the day it
 * happened, because "16 days since the first interview" needs days. The month
 * rule in `./calendar.ts` is about the record and does not apply here.
 */

/** The steps an application moves through, in order. */
export const APPLICATION_STEPS = [
  "not_applied",
  "applied",
  "resume_passed",
  "interview_1",
  "interview_2",
  "interview_final",
  "offer",
] as const;
export type ApplicationStep = (typeof APPLICATION_STEPS)[number];

/** How an application ends without an offer. It is closed AT a step, not moved off it. */
export const CLOSED_KINDS = ["rejected", "withdrawn"] as const;
export type ClosedKind = (typeof CLOSED_KINDS)[number];

/** The fixed list of statuses: the seven steps and the two ways of closing. */
export const APPLICATION_STATUSES = [...APPLICATION_STEPS, ...CLOSED_KINDS] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const STATUS_LABEL: Record<ApplicationStatus, string> = {
  not_applied: "Not applied",
  applied: "Applied",
  resume_passed: "Résumé passed",
  interview_1: "First interview",
  interview_2: "Second interview",
  interview_final: "Final interview",
  offer: "Offer",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

/** Waiting to hear back. Only these can go quiet. */
const WAITING: readonly ApplicationStep[] = ["applied", "resume_passed", "interview_1", "interview_2", "interview_final"];

/** Days with no change before a waiting application is marked as gone quiet. */
export const QUIET_DAYS = 14;

export const stepIndex = (step: ApplicationStep) => APPLICATION_STEPS.indexOf(step);
export const isStep = (value: string): value is ApplicationStep =>
  (APPLICATION_STEPS as readonly string[]).includes(value);
export const isClosedKind = (value: string): value is ClosedKind =>
  (CLOSED_KINDS as readonly string[]).includes(value);
export const isWaiting = (step: ApplicationStep) => WAITING.includes(step);

/**
 * An application's step, whether it is closed, and the date of each status
 * that has one. The date under `not_applied` is the day the job was added. A
 * step that was passed over has no entry.
 */
export interface Standing {
  step: ApplicationStep;
  closedAs: ClosedKind | null;
  dates: Partial<Record<ApplicationStatus, string>>;
}

/** `YYYY-MM-DD`, and a real day: `2026-02-30` is refused. */
export function isDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Whole days from one `YYYY-MM-DD` to another. */
export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** What the list filters by: the three interview steps are one filter. */
export type StatusBucket = "not_applied" | "applied" | "resume_passed" | "interviews" | "offer" | ClosedKind;
export const bucketOf = (standing: Pick<Standing, "step" | "closedAs">): StatusBucket =>
  standing.closedAs ?? (standing.step.startsWith("interview") ? "interviews" : (standing.step as StatusBucket));

/** The one status an application is shown with: how it closed, or the step it is at. */
export const statusOf = (standing: Pick<Standing, "step" | "closedAs">): ApplicationStatus =>
  standing.closedAs ?? standing.step;

export interface Figures {
  /** Null when that step was not reached, or was passed over with no date. */
  daysSinceResumePassed: number | null;
  daysSinceFirstInterview: number | null;
  /** Null unless it is closed. */
  daysSinceClosed: number | null;
  /** Since the author last changed the application, not since anything happened to it. */
  daysSinceLastActivity: number;
  /** The same count as `daysSinceLastActivity`, and set only once it has gone quiet. */
  quietDays: number | null;
}

/** `lastActivityOn` and `today` are days in the same time zone. */
export function figures(standing: Standing, lastActivityOn: string, today: string): Figures {
  const since = (date: string | undefined) => (date ? daysBetween(date, today) : null);
  const daysSinceLastActivity = daysBetween(lastActivityOn, today);
  const quiet = standing.closedAs === null && isWaiting(standing.step) && daysSinceLastActivity >= QUIET_DAYS;
  return {
    daysSinceResumePassed: since(standing.dates.resume_passed),
    daysSinceFirstInterview: since(standing.dates.interview_1),
    daysSinceClosed: standing.closedAs ? since(standing.dates[standing.closedAs]) : null,
    daysSinceLastActivity,
    quietDays: quiet ? daysSinceLastActivity : null,
  };
}

/** A change that cannot be made, in words the screen can show. */
export class StandingRefused extends Error {}

const without = (dates: Standing["dates"], gone: readonly ApplicationStatus[]) =>
  Object.fromEntries(Object.entries(dates).filter(([status]) => !gone.includes(status as ApplicationStatus)));

/**
 * Sets a step. It saves today's date under it; `not_applied` keeps the day the
 * job was added. A step passed over on the way gets no date, and moving back
 * drops the dates of the steps after the one moved to.
 */
export function moveTo(standing: Standing, step: ApplicationStep, today: string): Standing {
  if (standing.closedAs) throw new StandingRefused("This application is closed. Reopen it first.");
  if (step === standing.step) return standing;
  const dates = without(standing.dates, APPLICATION_STEPS.slice(stepIndex(step) + 1));
  return { step, closedAs: null, dates: step === "not_applied" ? dates : { ...dates, [step]: today } };
}

/** Closes it where it stands, with today's date. The step it was at is kept. */
export function close(standing: Standing, as: ClosedKind, today: string): Standing {
  if (standing.closedAs) throw new StandingRefused("This application is already closed.");
  return { ...standing, closedAs: as, dates: { ...standing.dates, [as]: today } };
}

/** Back to the step it was closed at. */
export function reopen(standing: Standing): Standing {
  if (!standing.closedAs) throw new StandingRefused("This application is not closed.");
  return { step: standing.step, closedAs: null, dates: without(standing.dates, CLOSED_KINDS) };
}

/** Corrects a date, or gives one to a step that was passed over. */
export function setDate(standing: Standing, status: ApplicationStatus, date: string): Standing {
  const reached = isStep(status) ? stepIndex(status) <= stepIndex(standing.step) : status === standing.closedAs;
  if (!reached) throw new StandingRefused("That step has not been reached, so it has no date to set.");
  return { ...standing, dates: { ...standing.dates, [status]: date } };
}

/**
 * Whether a standing is one the changes above could have produced. Undo sends
 * back the standing from before a change, and this is what it must satisfy.
 */
export function standingProblem(standing: Standing, today: string): string | null {
  const { step, closedAs, dates } = standing;
  for (const [status, date] of Object.entries(dates) as [ApplicationStatus, string][]) {
    if (!isDay(date)) return "A date must be a real day, as YYYY-MM-DD.";
    if (date > today) return "A date cannot be in the future.";
    const reached = isStep(status) ? stepIndex(status) <= stepIndex(step) : status === closedAs;
    if (!reached) return "A step that has not been reached cannot carry a date.";
  }
  if (!dates.not_applied) return "The day the job was added is missing.";
  if (!dates[step]) return "The step it is at needs a date.";
  if (closedAs && !dates[closedAs]) return "A closed application needs the date it was closed.";
  return null;
}
