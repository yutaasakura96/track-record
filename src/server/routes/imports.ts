/**
 * Imports (`docs/07-api-design.md` §5).
 *
 * An import IS a source document version — there is no separate table, and
 * `importId` is that version's id. `POST` returns `202 Accepted` with a
 * resource to poll; the review screen opens immediately on upload and the cards
 * appear as extraction progresses.
 */
import type { Hono } from "hono";
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { facts, importChunks, projects, sourceDocuments, sourceDocumentVersions } from "../db/schema";
import { ApiError, conflict, notFound, validationFailed, pathParam, violatesUnique } from "../http/errors";
import { routes } from "../http/registry";
import { newId } from "../http/ids";
import { parseBody } from "../services/validate";
import { extractUpload, EXTRACTOR_VERSION } from "~/pipeline/text";
import { runImport } from "~/pipeline/import";
import type { AppEnv, Bindings } from "../env";
import type { Db } from "../db/client";
import type { ModelSeam } from "~/model/types";
import type { Context } from "hono";
import { z } from "zod";

/** `null` is the answer `No project`, and it is the only way back to unfiled. */
const refileBody = z.object({ projectId: z.string().trim().min(1).nullable() });

export function registerImportRoutes(app: Hono<AppEnv>) {
  const api = routes(app);

  api.post("/api/imports", async (c) => {
    const user = c.get("user");
    const db = c.get("db");

    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      throw validationFailed("Choose a file to import.", ["file"]);
    }
    const file = form.get("file");
    if (!(file instanceof File)) throw validationFailed("Choose a file to import.", ["file"]);

    const projectId = stringOrNull(form.get("projectId"));
    const sourceDocumentId = stringOrNull(form.get("sourceDocumentId"));

    // A foreign key alone would let one user file a document under another
    // user's project. Ownership is checked in the same query that reads it.
    if (projectId) {
      const [owned] = await db
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.userId, user.id), eq(projects.id, projectId)))
        .limit(1);
      if (!owned) throw notFound("That project");
    }

    // Type and size are rejected here, before storage and before a single model
    // token is spent — the author is never billed for a doomed import.
    const upload = await extractUpload(file);

    let documentId = sourceDocumentId;
    let versionNo = 1;
    let isNewDocument = true;
    if (documentId) {
      const [existing] = await db
        .select({ id: sourceDocuments.id })
        .from(sourceDocuments)
        .where(and(eq(sourceDocuments.userId, user.id), eq(sourceDocuments.id, documentId)))
        .limit(1);
      if (!existing) throw notFound("That document");
      const [newest] = await db
        .select({ versionNo: sourceDocumentVersions.versionNo, status: sourceDocumentVersions.importStatus })
        .from(sourceDocumentVersions)
        .where(
          and(
            eq(sourceDocumentVersions.userId, user.id),
            eq(sourceDocumentVersions.sourceDocumentId, documentId),
          ),
        )
        .orderBy(desc(sourceDocumentVersions.versionNo))
        .limit(1);
      // The diff baseline would still be incomplete. A failed newest version does
      // not refuse: its text was stored before extraction began.
      if (newest && isRunning(newest.status)) {
        throw conflict(`Wait for v${newest.versionNo} to finish extracting.`, {
          versionNo: newest.versionNo,
        });
      }
      versionNo = (newest?.versionNo ?? 0) + 1;
      isNewDocument = false;
    }
    // A first import creates the document; a re-import is a new version of one
    // that already exists.
    documentId ??= newId("sourceDocument");

    const versionId = newId("sourceDocumentVersion");
    const version = db.insert(sourceDocumentVersions).values({
      id: versionId,
      userId: user.id,
      sourceDocumentId: documentId,
      versionNo,
      originalBytes: Buffer.from(await file.arrayBuffer()),
      extractedText: upload.text,
      // A version is never re-extracted in place; a parser upgrade makes a NEW
      // version, because stale offsets still resolve to *some* text.
      extractorVersion: EXTRACTOR_VERSION,
      byteSize: upload.byteSize,
      wordCount: upload.wordCount,
      importStatus: "queued",
    });

    // Two tables, one transaction. A failure between them would leave a source
    // document with no version — a row the author can see and cannot use.
    if (isNewDocument) {
      await db.batch([
        db.insert(sourceDocuments).values({
          id: documentId,
          userId: user.id,
          projectId,
          filename: file.name,
          mimeType: upload.mimeType,
        }),
        version,
      ]);
    } else {
      // The running check above is a read, then this insert, with no lock
      // between them. Two simultaneous re-imports can both pass it; the unique
      // index lets one version through, and the other lost to a version that is
      // now queued.
      try {
        await version;
      } catch (err) {
        if (!violatesUnique(err, "sdv_document_version_uq")) throw err;
        throw conflict(`Wait for v${versionNo} to finish extracting.`, { versionNo });
      }
    }

    await startImport(importStart(c, versionId));

    return c.json(
      {
        importId: versionId,
        sourceDocumentId: documentId,
        versionNo,
        status: "queued",
        isReimport: versionNo > 1,
      },
      202,
    );
  });

  /**
   * Screen 8, Documents. Grouped by source document, because re-import acts on a
   * document. Filenames, counts and the stored failure reason only: no source
   * text, and no fact claim.
   */
  api.get("/api/imports", async (c) => {
    const user = c.get("user");
    const db = c.get("db");

    const documents = await db
      .select({
        id: sourceDocuments.id,
        filename: sourceDocuments.filename,
        mimeType: sourceDocuments.mimeType,
        projectId: projects.id,
        projectName: projects.name,
      })
      .from(sourceDocuments)
      .leftJoin(projects, and(eq(projects.id, sourceDocuments.projectId), eq(projects.userId, user.id)))
      .where(eq(sourceDocuments.userId, user.id));

    const versions = await db
      .select({
        id: sourceDocumentVersions.id,
        sourceDocumentId: sourceDocumentVersions.sourceDocumentId,
        versionNo: sourceDocumentVersions.versionNo,
        importedAt: sourceDocumentVersions.importedAt,
        status: sourceDocumentVersions.importStatus,
        wordCount: sourceDocumentVersions.wordCount,
        changedRegionShare: sourceDocumentVersions.changedRegionShare,
        chunksTotal: sourceDocumentVersions.chunksTotal,
        chunksDone: sourceDocumentVersions.chunksDone,
        extractorVersion: sourceDocumentVersions.extractorVersion,
        importError: sourceDocumentVersions.importError,
      })
      .from(sourceDocumentVersions)
      .where(eq(sourceDocumentVersions.userId, user.id))
      .orderBy(desc(sourceDocumentVersions.versionNo));

    // Counted on the read. Nothing records that a review finished, so `open` is
    // the number of facts still `candidate`.
    const counts = await db
      .select({
        versionId: facts.sourceDocumentVersionId,
        accepted: sql<number>`count(*) filter (where ${facts.status} = 'accepted')::int`,
        rejected: sql<number>`count(*) filter (where ${facts.status} = 'rejected')::int`,
        open: sql<number>`count(*) filter (where ${facts.status} = 'candidate')::int`,
      })
      .from(facts)
      .where(and(eq(facts.userId, user.id), isNotNull(facts.sourceDocumentVersionId)))
      .groupBy(facts.sourceDocumentVersionId);
    const countsByVersion = new Map(counts.map((row) => [row.versionId, row]));

    // Which versions stopped on a chunk. The listing's `error` carries the same
    // code as the import's own status, and the code turns on this.
    const failedChunks = await db
      .selectDistinct({ versionId: importChunks.sourceDocumentVersionId })
      .from(importChunks)
      .where(and(eq(importChunks.userId, user.id), eq(importChunks.status, "failed")));
    const stoppedOnChunk = new Set(failedChunks.map((row) => row.versionId));

    const listed = documents
      .map((document) => {
        const own = versions
          .filter((v) => v.sourceDocumentId === document.id)
          .map((v) => {
            const { accepted = 0, rejected = 0, open = 0 } = countsByVersion.get(v.id) ?? {};
            return {
              importId: v.id,
              versionNo: v.versionNo,
              importedAt: v.importedAt.toISOString(),
              status: v.status,
              wordCount: v.wordCount,
              changedRegionShare: v.changedRegionShare,
              chunksTotal: v.chunksTotal,
              chunksDone: v.chunksDone,
              extractorVersion: v.extractorVersion,
              facts: { accepted, rejected, open },
              error: importFailure(v.status, v.importError, accepted + rejected + open, stoppedOnChunk.has(v.id)),
            };
          });
        const newest = own[0];
        return {
          sourceDocumentId: document.id,
          filename: document.filename,
          mimeType: document.mimeType,
          project: document.projectId ? { id: document.projectId, name: document.projectName! } : null,
          lastImportedAt: newest?.importedAt ?? "",
          openCandidates: own.reduce((sum, v) => sum + v.facts.open, 0),
          reimportable: !newest || !isRunning(newest.status),
          versions: own,
        };
      })
      .sort((a, b) => b.lastImportedAt.localeCompare(a.lastImportedAt));

    return c.json({
      openCandidates: listed.reduce((sum, d) => sum + d.openCandidates, 0),
      documents: listed,
    });
  });

  /**
   * The sidebar's badge, and nothing else (`docs/07` §5, `docs/10` Screen 8).
   *
   * The sidebar is on screen on every sidebar screen, so reading its one number
   * from the listing above fetched every document, every version and every fact
   * count on Home, Record and Skills — and polled all of it while an import ran.
   * Two aggregates in one round trip answer the same question.
   *
   * REGISTERED BEFORE `/api/imports/:id`. Hono resolves a static segment against
   * a sibling parameter by registration order, not by specificity, so the order
   * of these two calls is what keeps `summary` from being read as an import id.
   * The test "answers the summary rather than reading `summary` as an import id"
   * is what makes that real rather than remembered.
   */
  api.get("/api/imports/summary", async (c) => {
    const user = c.get("user");
    const db = c.get("db");

    const [[candidates], running] = await db.batch([
      db
        .select({ open: sql<number>`count(*)::int` })
        .from(facts)
        .where(
          and(
            eq(facts.userId, user.id),
            eq(facts.status, "candidate"),
            isNotNull(facts.sourceDocumentVersionId),
          ),
        ),
      // Existence, not a count: the sidebar only asks whether to keep polling.
      db
        .select({ id: sourceDocumentVersions.id })
        .from(sourceDocumentVersions)
        .where(
          and(
            eq(sourceDocumentVersions.userId, user.id),
            inArray(sourceDocumentVersions.importStatus, [...RUNNING_STATUSES]),
          ),
        )
        .limit(1),
    ]);

    return c.json({ openCandidates: candidates?.open ?? 0, running: running.length > 0 });
  });

  api.get("/api/imports/:id", async (c) => {
    const status = await importStatus(c.get("db"), c.get("user").id, pathParam(c, "id"));
    return c.json(status);
  });

  api.post("/api/imports/:id/retry", async (c) => {
    const user = c.get("user");
    const db = c.get("db");
    const versionId = pathParam(c, "id");
    await requireVersion(db, user.id, versionId);

    // Resume from the first failed step. Chunks already marked done are never
    // re-sent, so the author does not pay again for work that succeeded.
    //
    // Two tables, one transaction: a version reopened without its failed chunks
    // reopened would report itself as running and then never run them.
    const now = new Date();
    await db.batch([
      db
        .update(importChunks)
        .set({ status: "pending", error: null, updatedAt: now })
        .where(
          and(
            eq(importChunks.userId, user.id),
            eq(importChunks.sourceDocumentVersionId, versionId),
            eq(importChunks.status, "failed"),
          ),
        ),
      db
        .update(sourceDocumentVersions)
        .set({ importStatus: "queued", importError: null, updatedAt: now })
        .where(
          and(eq(sourceDocumentVersions.userId, user.id), eq(sourceDocumentVersions.id, versionId)),
        ),
    ]);

    await startImport(importStart(c, versionId));
    return c.json(await importStatus(db, user.id, versionId));
  });

  /**
   * Ends the review. Backs both `Finish review` in the header and
   * `Add N facts to record` in the footer — one action, two affordances.
   * Idempotent: it is a one-click action on a screen where a double-click is
   * likely.
   */
  api.post("/api/imports/:id/finish", async (c) => {
    const user = c.get("user");
    const db = c.get("db");
    const versionId = pathParam(c, "id");
    await requireVersion(db, user.id, versionId);

    const [{ accepted } = { accepted: 0 }] = await db
      .select({ accepted: sql<number>`count(*) filter (where ${facts.status} = 'accepted')::int` })
      .from(facts)
      .where(and(eq(facts.userId, user.id), eq(facts.sourceDocumentVersionId, versionId)));

    return c.json({ importId: versionId, acceptedFacts: accepted });
  });

  /**
   * Refiling a document (`docs/07` §5). The ONLY thing about a source document
   * that changes after import.
   *
   * The document and every fact extracted from every one of its versions move
   * together, in one batch. A fact's project has always been its document's,
   * snapshotted at extraction (`import.ts` reads `project_id` per chunk); this
   * keeps that rule true by making the following happen more than once rather
   * than by giving a fact a project of its own.
   *
   * **Refused while the newest version is running**, in the words a re-import
   * is refused in. A chunk that read the old project before the move and
   * inserted its facts after it would leave those facts behind, filed under a
   * project the document is no longer under, and nothing would say so.
   */
  api.patch("/api/source-documents/:id", async (c) => {
    const user = c.get("user");
    const db = c.get("db");
    const id = pathParam(c, "id");
    const body = await parseBody(c, refileBody);
    const projectId = body.projectId ?? null;

    const [document] = await db
      .select({ id: sourceDocuments.id })
      .from(sourceDocuments)
      .where(and(eq(sourceDocuments.userId, user.id), eq(sourceDocuments.id, id)))
      .limit(1);
    if (!document) throw notFound("That document");

    // A foreign key alone would let one user file a document under another
    // user's project. Ownership is checked in the same query that reads it.
    let project: { id: string; name: string } | null = null;
    if (projectId) {
      const [owned] = await db
        .select({ id: projects.id, name: projects.name })
        .from(projects)
        .where(and(eq(projects.userId, user.id), eq(projects.id, projectId)))
        .limit(1);
      if (!owned) throw notFound("That project");
      project = owned;
    }

    const [newest] = await db
      .select({ versionNo: sourceDocumentVersions.versionNo, status: sourceDocumentVersions.importStatus })
      .from(sourceDocumentVersions)
      .where(
        and(eq(sourceDocumentVersions.userId, user.id), eq(sourceDocumentVersions.sourceDocumentId, id)),
      )
      .orderBy(desc(sourceDocumentVersions.versionNo))
      .limit(1);
    if (newest && isRunning(newest.status)) {
      throw conflict(`Wait for v${newest.versionNo} to finish extracting.`, {
        versionNo: newest.versionNo,
      });
    }

    const now = new Date();
    // Two tables, one transaction. A document moved without its facts would be
    // filed under one project and quoted under another, with nothing to say
    // which was meant. The facts are matched through a subselect rather than
    // through ids read first, so a version created between the two cannot be
    // missed.
    const [, moved] = await db.batch([
      db
        .update(sourceDocuments)
        .set({ projectId, updatedAt: now })
        .where(and(eq(sourceDocuments.userId, user.id), eq(sourceDocuments.id, id))),
      db
        .update(facts)
        .set({ projectId, updatedAt: now })
        .where(
          and(
            eq(facts.userId, user.id),
            sql`${facts.sourceDocumentVersionId} in (
              select id from source_document_versions
              where source_document_id = ${id} and user_id = ${user.id}
            )`,
          ),
        )
        .returning({ id: facts.id }),
    ]);

    // A count, never a claim.
    return c.json({ sourceDocumentId: id, project, facts: moved.length });
  });

  /**
   * The source pane. **The only endpoint that returns source content, and it is
   * never used by generation.** Source documents never render, export, or
   * appear in any output.
   */
  api.get("/api/source-documents/:id/versions/:n/text", async (c) => {
    const user = c.get("user");
    const versionNo = Number(pathParam(c, "n"));
    if (!Number.isInteger(versionNo) || versionNo < 1) throw notFound("That version");

    const [version] = await c
      .get("db")
      .select({
        id: sourceDocumentVersions.id,
        text: sourceDocumentVersions.extractedText,
        wordCount: sourceDocumentVersions.wordCount,
        importedAt: sourceDocumentVersions.importedAt,
        filename: sourceDocuments.filename,
        projectId: projects.id,
        projectName: projects.name,
      })
      .from(sourceDocumentVersions)
      .innerJoin(sourceDocuments, eq(sourceDocuments.id, sourceDocumentVersions.sourceDocumentId))
      .leftJoin(projects, and(eq(projects.id, sourceDocuments.projectId), eq(projects.userId, user.id)))
      .where(
        and(
          eq(sourceDocumentVersions.userId, user.id),
          eq(sourceDocumentVersions.sourceDocumentId, pathParam(c, "id")),
          eq(sourceDocumentVersions.versionNo, versionNo),
        ),
      )
      .limit(1);
    if (!version) throw notFound("That document");

    return c.json({
      sourceDocumentVersionId: version.id,
      filename: version.filename,
      // Fact Review's breadcrumb. `null` for a document filed under no project.
      project: version.projectId ? { id: version.projectId, name: version.projectName! } : null,
      wordCount: version.wordCount,
      importedAt: version.importedAt.toISOString(),
      text: version.text,
    });
  });
}

/* ------------------------------------------------------------------ shared */

/**
 * Hand the import to the Workflow when the binding exists; otherwise run the
 * same function behind `waitUntil`. Both paths checkpoint to the same rows,
 * which is why the resume guarantee holds either way (`docs/06`, 2026-08-30).
 *
 * Either way the route RETURNS IMMEDIATELY: the review screen opens on upload
 * and the cards appear as extraction progresses, rather than after one long
 * silence.
 */
async function startImport(deps: ImportStart) {
  if (deps.workflow) {
    await deps.workflow.create({ params: { userId: deps.userId, versionId: deps.versionId } });
    return;
  }
  const run = runImport({
    db: deps.db,
    model: deps.model,
    userId: deps.userId,
    versionId: deps.versionId,
  }).catch((err: unknown) => {
    // Ids only — never the document, the chunk or the model's response.
    console.error(
      JSON.stringify({ event: "import_run_failed", versionId: deps.versionId, name: (err as Error)?.name }),
    );
  });
  if (deps.waitUntil) deps.waitUntil(run);
  else await run;
}

interface ImportStart {
  db: Db;
  model: ModelSeam;
  userId: string;
  versionId: string;
  workflow: Bindings["IMPORT_WORKFLOW"];
  waitUntil?: (promise: Promise<unknown>) => void;
}

/**
 * The `error` of an import, on the listing and on the import's own status alike
 * (`docs/07` §2, one shape everywhere). `null` unless the import failed.
 */
function importFailure(
  status: string,
  reason: string | null,
  extracted: number,
  stoppedOnChunk: boolean,
): { code: "no_facts_extracted" | "extraction_failed"; message: string } | null {
  if (status !== "failed") return null;
  return {
    code: extracted === 0 && !stoppedOnChunk ? "no_facts_extracted" : "extraction_failed",
    message: reason ?? "This import could not be completed.",
  };
}

async function requireVersion(db: Db, userId: string, versionId: string) {
  const [version] = await db
    .select({ id: sourceDocumentVersions.id })
    .from(sourceDocumentVersions)
    .where(and(eq(sourceDocumentVersions.userId, userId), eq(sourceDocumentVersions.id, versionId)))
    .limit(1);
  if (!version) throw notFound("That import");
  return version;
}

/**
 * The polling target. Drives the progress bar and the incremental appearance of
 * cards in the fact rail.
 *
 * A failed import is `200` with `status: "failed"`, NOT an HTTP error — the
 * import resource exists and is retained so the author can retry without
 * re-uploading.
 */
export async function importStatus(db: Db, userId: string, versionId: string) {
  const [version] = await db
    .select()
    .from(sourceDocumentVersions)
    .where(and(eq(sourceDocumentVersions.userId, userId), eq(sourceDocumentVersions.id, versionId)))
    .limit(1);
  if (!version) throw notFound("That import");

  const [{ extracted } = { extracted: 0 }] = await db
    .select({ extracted: sql<number>`count(*)::int` })
    .from(facts)
    .where(and(eq(facts.userId, userId), eq(facts.sourceDocumentVersionId, versionId)));

  const [failedChunk] = await db
    .select({ chunkIndex: importChunks.chunkIndex })
    .from(importChunks)
    .where(
      and(
        eq(importChunks.userId, userId),
        eq(importChunks.sourceDocumentVersionId, versionId),
        eq(importChunks.status, "failed"),
      ),
    )
    .orderBy(asc(importChunks.chunkIndex))
    .limit(1);

  return {
    importId: version.id,
    sourceDocumentId: version.sourceDocumentId,
    versionNo: version.versionNo,
    status: version.importStatus,
    chunksTotal: version.chunksTotal,
    chunksDone: version.chunksDone,
    candidatesExtracted: extracted,
    // A COUNT, never content. The author sees that the guard fired, not what it
    // caught.
    candidatesDiscarded: version.candidatesDiscarded,
    // Repeats of facts already in the record. A count, never which facts.
    candidatesSuppressed: version.candidatesSuppressed,
    wordCount: version.wordCount,
    changedRegionShare: version.changedRegionShare,
    error: importFailure(version.importStatus, version.importError, extracted, Boolean(failedChunk)),
    /** Where a retry resumes. `null` when nothing failed. */
    failedAtChunk: failedChunk?.chunkIndex ?? null,
  };
}

function importStart(c: Context<AppEnv>, versionId: string): ImportStart {
  return {
    db: c.get("db"),
    model: c.get("model"),
    userId: c.get("user").id,
    versionId,
    workflow: c.env.IMPORT_WORKFLOW,
    waitUntil: (promise) => c.executionCtx.waitUntil(promise),
  };
}

/**
 * The version's text or chunk plan is not settled yet. Stated once, because the
 * summary asks the same question in SQL and the two must not drift.
 */
const RUNNING_STATUSES = ["queued", "extracting"] as const;
const isRunning = (status: (typeof sourceDocumentVersions.$inferSelect)["importStatus"]) =>
  (RUNNING_STATUSES as readonly string[]).includes(status);

function stringOrNull(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** Kept exported so the render routes can reuse the same 409 shape. */
export const alreadyDecided = () =>
  new ApiError("conflict", "That has already been decided.");
