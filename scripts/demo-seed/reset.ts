/**
 * Emptying one user's record, which the demo seed and `db:load:record` both do
 * first. The user row, its sessions and its Google account link are kept, so
 * the person stays signed in.
 */
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "~/server/db/client";
import * as s from "~/server/db/schema";
import { assertRecordingsGone } from "./guard";

/** Every table a user owns, children first. Users, sessions, accounts and verifications are kept. */
export const RESET_ORDER = [
  s.interviewRecordings,
  s.interviewQuestions,
  s.interviews,
  s.applicationSentCopies,
  s.applicationDocuments,
  s.applicationSteps,
  s.renderProposals,
  s.renderVersions,
  s.renders,
  s.applications,
  s.factFlags,
  s.facts,
  s.importChunks,
  s.sourceDocumentVersions,
  s.sourceDocuments,
  s.skillCurations,
  s.renderInclusions,
  s.capturePromptDismissals,
  s.careerGapNotes,
  s.certifications,
  s.educations,
  s.projects,
  s.roles,
  s.employers,
  s.profiles,
] as const;

/** Uploads still in R2: a removed recording's object is already gone. */
export async function uploadedRecordings(db: Db, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(s.interviewRecordings)
    .where(
      and(
        eq(s.interviewRecordings.userId, userId),
        eq(s.interviewRecordings.kind, "upload"),
        sql`${s.interviewRecordings.removedAt} is null`,
      ),
    );
  return row?.n ?? 0;
}

/** The deletes, in order, for a caller that puts them in a transaction with more. */
export const resetStatements = (db: Db, userId: string) =>
  RESET_ORDER.map((table) => db.delete(table).where(eq(table.userId, userId)));

export async function resetUser(db: Db, userId: string, flags: readonly string[]): Promise<void> {
  assertRecordingsGone(await uploadedRecordings(db, userId), userId, flags);
  // One transaction: a reset that stops halfway would leave a record nobody wrote.
  const [first, ...rest] = resetStatements(db, userId);
  await db.batch([first!, ...rest]);
}
