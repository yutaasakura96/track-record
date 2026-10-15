/**
 * The hand-off to Suburi (issue #77).
 *
 * Suburi, the author's interview practice app, can take a job description as
 * the role for a practice round. Nothing connects the two apps (`AGENTS.md`):
 * these are two pieces of text the author carries across by hand, a file
 * holding the job description and the questions asked, copied as plain text.
 */
import type { Interview } from "./interview";

/** The file the job description is saved as: its text and nothing else, under the company's name. */
export function jobDescriptionFile(application: { company: string; jobDescription: string }): {
  name: string;
  text: string;
} {
  // Characters no file system takes in a name, and control characters, are dropped.
  const company = application.company.replace(/[\\/:*?"<>|\p{Cc}]/gu, " ").replace(/\s+/g, " ").trim();
  return { name: `${company || "Job"} job description.txt`, text: application.jobDescription };
}

/**
 * Every question asked in the entries given, oldest interview first and each in
 * the order it was asked. The entries are read back newest day first, and one
 * deleted, or a question taken out of one, is not among them. A question is one
 * line, so a line break inside one is closed up.
 */
export function questionsAsked(interviews: readonly Interview[]): string[] {
  // Reversed, then sorted by day: two entries on one day keep the order they were saved in.
  return [...interviews]
    .reverse()
    .sort((a, b) => a.date.localeCompare(b.date))
    .flatMap((entry) => entry.questions.map((question) => question.text.replace(/\s*[\r\n]+\s*/g, " ").trim()))
    .filter((question) => question !== "");
}

/** The questions asked as the text that is copied: one a line. */
export const questionsText = (questions: readonly string[]): string => questions.join("\n");
