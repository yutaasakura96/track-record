/**
 * Reading an application's interview entries (issue #72).
 *
 * Here and not beside the route that writes one, because the application's own
 * read carries them: `routes/applications.ts` reads through this and
 * `routes/interviews.ts` writes through that file's standing, and neither
 * imports the other's half.
 */
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { interviewQuestions, interviews } from "../db/schema";
import { newestFirst, type Interview } from "~/shared/interview";

/**
 * An application's entries, newest day first, each with its questions in the
 * order given. One round trip: both reads go out as one batch.
 */
export async function interviewsOf(db: Db, userId: string, applicationId: string): Promise<Interview[]> {
  const [entries, questions] = await db.batch([
    db
      .select({
        id: interviews.id,
        date: interviews.happenedOn,
        round: interviews.round,
        who: interviews.who,
        howItWent: interviews.howItWent,
        createdAt: interviews.createdAt,
      })
      .from(interviews)
      .where(and(eq(interviews.userId, userId), eq(interviews.applicationId, applicationId))),
    db
      .select({ id: interviewQuestions.id, interviewId: interviewQuestions.interviewId, text: interviewQuestions.text })
      .from(interviewQuestions)
      .innerJoin(
        interviews,
        and(eq(interviews.id, interviewQuestions.interviewId), eq(interviews.userId, userId)),
      )
      .where(and(eq(interviewQuestions.userId, userId), eq(interviews.applicationId, applicationId)))
      .orderBy(asc(interviewQuestions.position)),
  ]);

  return newestFirst(entries.map((entry) => ({ ...entry, createdAt: entry.createdAt.toISOString() }))).map(
    ({ createdAt: _createdAt, ...entry }) => ({
      ...entry,
      questions: questions
        .filter((question) => question.interviewId === entry.id)
        .map(({ id, text }) => ({ id, text })),
    }),
  );
}
