/**
 * The import queue (`docs/09` Flow 8, `docs/03` §5, #93).
 *
 * **One document is read at a time, per author.** Several files chosen at once
 * become several versions, each `queued`, and each its own import. Reading them
 * in parallel would only spend money faster.
 *
 * The queue is the `import_status` column and nothing else: there is no batch
 * row, so there is no batch that can be half-committed, and every import
 * survives on its own. An upload or a retry asks for the next one to start;
 * so does the end of every run, whether it finished or failed. Whichever asks
 * while nobody is reading claims the oldest waiting version.
 */
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "~/server/db/client";
import { sourceDocumentVersions } from "~/server/db/schema";
import { violatesUnique } from "~/server/http/errors";
import type { Bindings } from "~/server/env";

/** Starts reading a version the queue has already claimed. */
export type LaunchImport = (versionId: string) => Promise<unknown>;

export async function ensureWorkflow(
  workflow: NonNullable<Bindings["IMPORT_WORKFLOW"]>, userId: string, versionId: string,
): Promise<void> {
  let instance;
  try {
    instance = await workflow.get(versionId);
  } catch {
    try {
      await workflow.create({ id: versionId, params: { userId, versionId } });
      return;
    } catch (error) {
      try {
        instance = await workflow.get(versionId);
      } catch {
        throw error;
      }
    }
  }
  const status = await instance.status();
  if (status.status === "complete" || status.status === "errored") await instance.restart();
}

export async function recoverActiveImport(
  db: Db, userId: string, workflow: NonNullable<Bindings["IMPORT_WORKFLOW"]>,
): Promise<void> {
  const [active] = await db.select({ id: sourceDocumentVersions.id }).from(sourceDocumentVersions)
    .where(and(eq(sourceDocumentVersions.userId, userId), eq(sourceDocumentVersions.importStatus, "extracting")))
    .limit(1);
  if (active) await ensureWorkflow(workflow, userId, active.id);
}

/**
 * Claims the oldest waiting version and starts it, unless one is being read.
 *
 * @returns the version started, or `null` when nothing is waiting or another
 * version is still being read.
 */
export async function startNextImport(db: Db, userId: string, launch: LaunchImport): Promise<string | null> {
  const versionId = await claimNext(db, userId);
  if (!versionId) return null;
  try {
    await launch(versionId);
  } catch {
    await db
      .update(sourceDocumentVersions)
      .set({ importStatus: "failed", importError: "Extraction could not start.", updatedAt: new Date() })
      .where(
        and(
          eq(sourceDocumentVersions.userId, userId),
          eq(sourceDocumentVersions.id, versionId),
          eq(sourceDocumentVersions.importStatus, "extracting"),
        ),
      );
    return startNextImport(db, userId, launch);
  }
  return versionId;
}

/**
 * One statement: a read, then a write, would let two uploads both see nobody
 * reading. Two of these racing can still both see that, under read committed;
 * `sdv_one_extracting_uq` lets one through and refuses the other, which is then
 * the answer "someone is reading".
 *
 * Oldest first by `imported_at`, so the files chosen together are read in the
 * order they were listed: the client sends them in that order.
 */
async function claimNext(db: Db, userId: string): Promise<string | null> {
  try {
    const [claimed] = await db
      .update(sourceDocumentVersions)
      .set({ importStatus: "extracting", importError: null, updatedAt: new Date() })
      .where(
        and(
          eq(sourceDocumentVersions.userId, userId),
          eq(
            sourceDocumentVersions.id,
            sql`(select id from source_document_versions
                 where user_id = ${userId} and import_status = 'queued'
                 order by imported_at, batch_order, id limit 1)`,
          ),
          sql`not exists (select 1 from source_document_versions
                          where user_id = ${userId} and import_status = 'extracting')`,
        ),
      )
      .returning({ id: sourceDocumentVersions.id });
    return claimed?.id ?? null;
  } catch (err) {
    if (violatesUnique(err, "sdv_one_extracting_uq")) return null;
    throw err;
  }
}
