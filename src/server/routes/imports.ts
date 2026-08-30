/**
 * Imports (`docs/07-api-design.md` §5).
 *
 * An import IS a source document version — there is no separate table, and
 * `importId` is that version's id. `POST` returns `202 Accepted` with a
 * resource to poll; the review screen opens immediately on upload and the cards
 * appear as extraction progresses.
 */
import type { Hono } from "hono";
import { and, asc, eq, sql } from "drizzle-orm";
import { facts, importChunks, projects, sourceDocuments, sourceDocumentVersions } from "../db/schema";
import { ApiError, notFound, validationFailed, pathParam } from "../http/errors";
import { routes } from "../http/registry";
import { newId } from "../http/ids";
import { extractUpload, EXTRACTOR_VERSION } from "~/pipeline/text";
import { runImport } from "~/pipeline/import";
import type { AppEnv, Bindings } from "../env";
import type { Db } from "../db/client";
import type { ModelSeam } from "~/model/types";
import type { Context } from "hono";

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
      const [{ highest } = { highest: 0 }] = await db
        .select({ highest: sql<number>`coalesce(max(${sourceDocumentVersions.versionNo}), 0)::int` })
        .from(sourceDocumentVersions)
        .where(
          and(
            eq(sourceDocumentVersions.userId, user.id),
            eq(sourceDocumentVersions.sourceDocumentId, documentId),
          ),
        );
      versionNo = highest + 1;
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
      await version;
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
      })
      .from(sourceDocumentVersions)
      .innerJoin(sourceDocuments, eq(sourceDocuments.id, sourceDocumentVersions.sourceDocumentId))
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
    wordCount: version.wordCount,
    changedRegionShare: version.changedRegionShare,
    error:
      version.importStatus === "failed"
        ? {
            code: extracted === 0 && !failedChunk ? "no_facts_extracted" : "extraction_failed",
            message: version.importError ?? "This import could not be completed.",
          }
        : null,
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

function stringOrNull(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** Kept exported so the render routes can reuse the same 409 shape. */
export const alreadyDecided = () =>
  new ApiError("conflict", "That has already been decided.");
