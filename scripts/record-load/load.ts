/**
 * Empties one user's record and loads a structured-record file in its place,
 * apart from the command line (`./run.ts`) so the suite can run it against its
 * own database. It writes no fact and no document: those come from the real
 * import afterwards, which is why the file holds what only the author can type.
 *
 * The user row, its sessions and its Google account link are kept. The deletes
 * and the inserts are ONE transaction, so a load that fails leaves the record
 * it found, not an empty one.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "~/server/db/client";
import * as s from "~/server/db/schema";
import { newId } from "~/server/http/ids";
import { assertRecordingsGone } from "../demo-seed/guard";
import { RESET_ORDER, resetStatements, uploadedRecordings } from "../demo-seed/reset";
import type { RecordFile } from "./format";
import { clearRecordingObjects, type RecordingObjects } from "./recordings";

export interface LoadCounts {
  user: string;
  recordingObjectsDeleted: number;
  employers: number;
  roles: number;
  educations: number;
  certifications: number;
  /** Zero, each: what the run left behind for the imports to fill. */
  facts: number;
  documents: number;
  renders: number;
}

/**
 * A Workflow writing into rows this is about to delete would fail, or leave
 * rows nobody wrote, depending on which got there first.
 */
async function assertNothingRunning(db: Db, userId: string): Promise<void> {
  const [imports] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(s.sourceDocumentVersions)
    .where(and(eq(s.sourceDocumentVersions.userId, userId), inArray(s.sourceDocumentVersions.importStatus, ["queued", "extracting"])));
  const [generations] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(s.renderProposals)
    .where(and(eq(s.renderProposals.userId, userId), eq(s.renderProposals.status, "pending"), eq(s.renderProposals.generationStatus, "generating")));
  if (imports?.n || generations?.n) {
    throw new Error(`${imports?.n ?? 0} import(s) and ${generations?.n ?? 0} generation(s) are still running. Let them finish, then run this again.`);
  }
}

/** The rows the file holds, as inserts in foreign-key order. */
function loadStatements(db: Db, userId: string, record: RecordFile) {
  const { employers, educations, certifications, profile } = record;
  return [
    db.insert(s.profiles).values({ id: newId("profile"), userId, ...profile }),
    ...employers.flatMap(({ roles, ...employer }, sortOrder) => {
      const employerId = newId("employer");
      return [
        db.insert(s.employers).values({ id: employerId, userId, ...employer, sortOrder }),
        ...roles.map((role) => db.insert(s.roles).values({ id: newId("role"), userId, employerId, ...role })),
      ];
    }),
    ...educations.map((education) => db.insert(s.educations).values({ id: newId("education"), userId, ...education })),
    ...certifications.map((certification) =>
      db.insert(s.certifications).values({ id: newId("certification"), userId, ...certification }),
    ),
  ];
}

export async function clearAndLoad(
  db: Db,
  userId: string,
  record: RecordFile,
  options: { flags: readonly string[]; objects?: RecordingObjects },
): Promise<LoadCounts> {
  await assertNothingRunning(db, userId);
  // Before any delete, because the rows are how the guard knows there are uploads.
  const recordingObjectsDeleted = options.objects ? await clearRecordingObjects(options.objects, userId) : 0;
  if (!options.objects) assertRecordingsGone(await uploadedRecordings(db, userId), userId, options.flags);

  const [first, ...rest] = [...resetStatements(db, userId), ...loadStatements(db, userId, record)];
  await db.batch([first!, ...rest]);

  const count = async (table: (typeof RESET_ORDER)[number]) =>
    (await db.select({ n: sql<number>`count(*)::int` }).from(table).where(eq(table.userId, userId)))[0]?.n ?? 0;
  return {
    user: userId,
    recordingObjectsDeleted,
    employers: await count(s.employers),
    roles: await count(s.roles),
    educations: await count(s.educations),
    certifications: await count(s.certifications),
    facts: await count(s.facts),
    documents: await count(s.sourceDocuments),
    renders: await count(s.renders),
  };
}
