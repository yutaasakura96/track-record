/**
 * Interview entries (issue #72).
 *
 * One entry is the author's note of one real interview: the day, the round,
 * who it was with, how it went and the questions asked, each its own item in
 * the order given. These rules are read by the route that saves an entry and
 * by the form that writes one, like the rules in `./application`.
 *
 * An entry and the status say overlapping things, and one being behind the
 * other is a small lie the page tells. So saving an entry for a LATER round
 * moves the status to that round, with the entry's day as the step's date. One
 * for an EARLIER round that was skipped gives that step the entry's day and
 * leaves the status where it is.
 */
import { moveTo, stepIndex, type ApplicationStep, type Standing } from "./application";

/** The three interview steps, under their step names, and a conversation that is not a round. */
export const INTERVIEW_ROUNDS = ["interview_1", "interview_2", "interview_final", "other"] as const;
export type InterviewRound = (typeof INTERVIEW_ROUNDS)[number];

export const ROUND_LABEL: Record<InterviewRound, string> = {
  interview_1: "First interview",
  interview_2: "Second interview",
  interview_final: "Final interview",
  other: "Other conversation",
};

export const WHO_MAX = 200;
export const HOW_IT_WENT_MAX = 10_000;
export const QUESTION_MAX = 1_000;
export const QUESTIONS_MAX = 100;

/** What an entry must hold to be worth saving. */
export const EMPTY_ENTRY = "Write how it went, or add at least one question.";

/** An entry as it is read back. */
export interface Interview {
  id: string;
  /** `YYYY-MM-DD`, a real day. */
  date: string;
  round: InterviewRound;
  who: string;
  howItWent: string;
  questions: { id: string; text: string }[];
}

/**
 * Where an application stands once an entry is saved. A closed application and
 * a conversation that is not a round are left as they were, and so is a round
 * at or before the status that already has a date.
 */
export function standingAfterInterview(standing: Standing, round: InterviewRound, date: string): Standing {
  if (standing.closedAs || round === "other") return standing;
  if (stepIndex(round) > stepIndex(standing.step)) return moveTo(standing, round, date);
  if (standing.dates[round]) return standing;
  return { ...standing, dates: { ...standing.dates, [round]: date } };
}

/** The round a new entry starts on: the earliest at or after the status with no entry yet. */
export function defaultRound(step: ApplicationStep, noted: readonly InterviewRound[]): InterviewRound {
  const rounds = INTERVIEW_ROUNDS.filter((round): round is Exclude<InterviewRound, "other"> => round !== "other");
  return rounds.find((round) => stepIndex(round) >= stepIndex(step) && !noted.includes(round)) ?? "other";
}

/**
 * The questions in a piece of typed or pasted text: one a line, with a leading
 * bullet or number dropped, and empty lines left out. A number, `-` or `*` is a
 * marker only with whitespace after it, since each can begin a real question
 * ("3.5 years…", "-v does what?"); `•` and `・` are dropped either way.
 */
export const questionsIn = (text: string): string[] =>
  text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:(?:[-*]|\d+[.)])\s+|[•・]\s*)/, "").trim())
    .filter((line) => line !== "");
