/**
 * Reading an application's interview entries (issue #72), each with its
 * recordings (issue #74).
 *
 * Here and not beside the route that writes one, because the application's own
 * read carries them: `routes/applications.ts` reads through this and
 * `routes/interviews.ts` writes through that file's standing, and neither
 * imports the other's half.
 */
import { and, asc, desc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { interviewQuestions, interviewRecordings, interviews } from "../db/schema";
import { tokyoToday } from "~/render/rirekisho";
import type { Interview } from "~/shared/interview";
import type { Recording } from "~/shared/recording";

/**
 * An application's entries, newest day first, each with its questions in the
 * order given and its recordings in the order attached. One round trip: the
 * three reads go out as one batch.
 */
export async function interviewsOf(db: Db, userId: string, applicationId: string): Promise<Interview[]> {
  const [entries, questions, recordings] = await db.batch([
    db
      .select({
        id: interviews.id,
        date: interviews.happenedOn,
        round: interviews.round,
        who: interviews.who,
        howItWent: interviews.howItWent,
      })
      .from(interviews)
      .where(and(eq(interviews.userId, userId), eq(interviews.applicationId, applicationId)))
      .orderBy(desc(interviews.happenedOn), desc(interviews.createdAt), desc(interviews.id)),
    db
      .select({ id: interviewQuestions.id, interviewId: interviewQuestions.interviewId, text: interviewQuestions.text })
      .from(interviewQuestions)
      .innerJoin(
        interviews,
        and(eq(interviews.id, interviewQuestions.interviewId), eq(interviews.userId, userId)),
      )
      .where(and(eq(interviewQuestions.userId, userId), eq(interviews.applicationId, applicationId)))
      .orderBy(asc(interviewQuestions.position)),
    db
      .select({
        id: interviewRecordings.id,
        interviewId: interviewRecordings.interviewId,
        url: interviewRecordings.url,
        label: interviewRecordings.label,
        removedAt: interviewRecordings.removedAt,
      })
      .from(interviewRecordings)
      .innerJoin(
        interviews,
        and(eq(interviews.id, interviewRecordings.interviewId), eq(interviews.userId, userId)),
      )
      .where(and(eq(interviewRecordings.userId, userId), eq(interviews.applicationId, applicationId)))
      .orderBy(asc(interviewRecordings.createdAt), asc(interviewRecordings.id)),
  ]);

  return entries.map((entry) => ({
    ...entry,
    questions: questions
      .filter((question) => question.interviewId === entry.id)
      .map(({ id, text }) => ({ id, text })),
    recordings: recordings.filter((recording) => recording.interviewId === entry.id).map(recordingOf),
  }));
}

/**
 * A stored row as the page reads it. A removed one says only that it was
 * removed and on which day in Japan; the check on the table means a row that
 * is not removed has its link.
 */
function recordingOf(row: { id: string; url: string | null; label: string; removedAt: Date | null }): Recording {
  if (row.removedAt || row.url === null) {
    return { id: row.id, kind: "removed", removedOn: tokyoToday(row.removedAt ?? undefined) };
  }
  return { id: row.id, kind: "link", url: row.url, label: row.label };
}
