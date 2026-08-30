/**
 * The import pipeline (`docs/03-technical-design.md` §5).
 *
 * One function, taking a step runner. `ImportWorkflow` wraps each step in
 * `step.do`; the inline runner calls it directly. Every durability guarantee the
 * pipeline makes is a database row rather than engine state, so the runner
 * controls retry granularity, not correctness (`docs/06`, 2026-08-30).
 *
 * Steps pass IDs, never text. No step returns the uploaded file, the extracted
 * text, a chunk body or a generated render — each re-reads what it needs from
 * Postgres by ID, which is what keeps the 1 MiB step-result cap structurally
 * unreachable.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "~/server/db/client";
import { facts, importChunks, sourceDocumentVersions } from "~/server/db/schema";
import { newId } from "~/server/http/ids";
import { ModelUnavailableError, type ModelSeam } from "~/model/types";
import { planChunks } from "./chunk";
import { anchorQuote } from "./quote";
import { scrub } from "./scrub";
import { dedupeHash } from "./dedupe";

export interface StepRunner {
  do<T>(name: string, fn: () => Promise<T>): Promise<T>;
}

/** Used in tests and wherever the Workflows binding is absent. */
export const inlineStepRunner: StepRunner = { do: (_name, fn) => fn() };

export interface ImportDeps {
  db: Db;
  model: ModelSeam;
  userId: string;
  /** The source document version. It IS the import — there is no separate row. */
  versionId: string;
  step?: StepRunner;
}

export async function runImport(deps: ImportDeps): Promise<void> {
  const step = deps.step ?? inlineStepRunner;

  const planned = await step.do("plan-chunks", () => planChunksStep(deps));
  if (planned === "gone") return;

  for (const chunkId of planned) {
    const outcome = await step.do(`extract-${chunkId}`, () => extractChunkStep(deps, chunkId));
    if (outcome === "failed") {
      // Stop at the failed chunk. Everything before it keeps its candidates, and
      // retry resumes here rather than at chunk 1.
      return;
    }
  }

  await step.do("finish", () => finishStep(deps));
}

/* ------------------------------------------------------------------ step 1 */

/**
 * Store → extract text → diff against the previous version → chunk the changed
 * regions. Steps 1–4 collapse into one durable step because they are pure
 * functions of rows already written by the upload route.
 *
 * @returns the ids of the chunks still to extract, in document order.
 */
async function planChunksStep(deps: ImportDeps): Promise<string[] | "gone"> {
  const { db, userId, versionId } = deps;

  const version = await loadVersion(db, userId, versionId);
  if (!version) return "gone";

  const existing = await db
    .select({ id: importChunks.id, status: importChunks.status })
    .from(importChunks)
    .where(and(eq(importChunks.userId, userId), eq(importChunks.sourceDocumentVersionId, versionId)))
    .orderBy(asc(importChunks.chunkIndex));

  // A retry re-enters here. The plan is not recomputed — recomputing it would
  // renumber chunks and lose the record of which ones already succeeded.
  if (existing.length > 0) {
    await db
      .update(sourceDocumentVersions)
      .set({ importStatus: "extracting", importError: null, updatedAt: new Date() })
      .where(and(eq(sourceDocumentVersions.userId, userId), eq(sourceDocumentVersions.id, versionId)));
    return existing.filter((c) => c.status !== "done").map((c) => c.id);
  }

  const previousText = await previousVersionText(db, userId, version);
  const plan = planChunks(version.extractedText, previousText);

  const rows = plan.chunks.map((region, index) => ({
    id: newId("importChunk"),
    userId,
    sourceDocumentVersionId: versionId,
    chunkIndex: index,
    startOffset: region.start,
    endOffset: region.end,
  }));

  const writes = [
    db
      .update(sourceDocumentVersions)
      .set({
        importStatus: "extracting",
        importError: null,
        chunksTotal: rows.length,
        chunksDone: 0,
        changedRegionShare: plan.changedRegionShare,
        updatedAt: new Date(),
      })
      .where(and(eq(sourceDocumentVersions.userId, userId), eq(sourceDocumentVersions.id, versionId))),
    ...(rows.length > 0 ? [db.insert(importChunks).values(rows)] : []),
  ];
  await batch(db, writes);

  log({ event: "import_planned", versionId, chunks: rows.length });
  return rows.map((r) => r.id);
}

/* ------------------------------------------------------------------ step 2 */

/**
 * Extract one chunk, verify every quote, scrub, deduplicate, persist.
 *
 * The whole chunk lands in one batched write, so a chunk is either fully
 * recorded and marked done or it is not marked done at all.
 */
async function extractChunkStep(deps: ImportDeps, chunkId: string): Promise<"done" | "failed"> {
  const { db, model, userId, versionId } = deps;

  const [chunk] = await db
    .select()
    .from(importChunks)
    .where(and(eq(importChunks.userId, userId), eq(importChunks.id, chunkId)))
    .limit(1);
  if (!chunk || chunk.status === "done") return "done";

  const version = await loadVersion(db, userId, versionId);
  if (!version) return "done";

  const text = version.extractedText;
  const body = text.slice(chunk.startOffset, chunk.endOffset);

  let candidates;
  try {
    candidates = await model.extractFacts(body, { waiting: "interactive" });
  } catch (err) {
    const reason =
      err instanceof ModelUnavailableError
        ? err.message
        : "Extraction failed while reading this document.";
    await batch(db, [
      db
        .update(importChunks)
        .set({ status: "failed", error: reason, updatedAt: new Date() })
        .where(and(eq(importChunks.userId, userId), eq(importChunks.id, chunkId))),
      db
        .update(sourceDocumentVersions)
        .set({ importStatus: "failed", importError: reason, updatedAt: new Date() })
        .where(and(eq(sourceDocumentVersions.userId, userId), eq(sourceDocumentVersions.id, versionId))),
    ]);
    // Provider, step and chunk index. No content, ever.
    log({ event: "import_chunk_failed", versionId, chunkIndex: chunk.chunkIndex });
    return "failed";
  }

  let discarded = 0;
  const seenInChunk = new Set<string>();
  const rows: (typeof facts.$inferInsert)[] = [];

  for (const candidate of candidates) {
    // Quote anchoring. Offsets are derived from OUR text, never taken from the
    // model. A quote that is not verbatim is discarded here, before it reaches
    // the database and before the author ever sees it.
    const anchor = anchorQuote(text, candidate.quote);
    if (!anchor || candidate.claim.trim() === "") {
      discarded++;
      continue;
    }
    const hash = await dedupeHash(anchor.quote, candidate.claim);
    if (seenInChunk.has(hash)) continue;
    seenInChunk.add(hash);

    const { disclosure, isClientIdentifying } = scrub(candidate);
    rows.push({
      id: newId("fact"),
      userId,
      projectId: version.projectId,
      claim: candidate.claim.trim(),
      // Everything the model produces starts Generated. Promotion is always a
      // deliberate act by the author.
      provenance: "generated",
      disclosure,
      status: "candidate",
      sourceDocumentVersionId: versionId,
      quote: anchor.quote,
      quoteStart: anchor.quoteStart,
      quoteEnd: anchor.quoteEnd,
      lineNumber: anchor.lineNumber,
      dedupeHash: hash,
      technologies: candidate.technologies,
      isClientIdentifying,
    });
  }

  // Suppress candidates the author has already judged — accepted or rejected —
  // in one lookup against the partial unique index.
  const fresh = rows.length === 0 ? [] : await withoutAlreadyJudged(db, userId, rows);

  await batch(db, [
    ...(fresh.length > 0 ? [db.insert(facts).values(fresh)] : []),
    db
      .update(importChunks)
      .set({ status: "done", error: null, updatedAt: new Date() })
      .where(and(eq(importChunks.userId, userId), eq(importChunks.id, chunkId))),
    db
      .update(sourceDocumentVersions)
      .set({
        chunksDone: sql`${sourceDocumentVersions.chunksDone} + 1`,
        candidatesDiscarded: sql`${sourceDocumentVersions.candidatesDiscarded} + ${discarded}`,
        updatedAt: new Date(),
      })
      .where(and(eq(sourceDocumentVersions.userId, userId), eq(sourceDocumentVersions.id, versionId))),
  ]);

  // Counts only. The discarded candidates' content is never surfaced or logged.
  log({
    event: "import_chunk_done",
    versionId,
    chunkIndex: chunk.chunkIndex,
    kept: fresh.length,
    discarded,
  });
  return "done";
}

async function withoutAlreadyJudged(
  db: Db,
  userId: string,
  rows: (typeof facts.$inferInsert)[],
): Promise<(typeof facts.$inferInsert)[]> {
  const hashes = rows.map((r) => r.dedupeHash!).filter(Boolean);
  if (hashes.length === 0) return rows;
  const judged = await db
    .select({ dedupeHash: facts.dedupeHash })
    .from(facts)
    .where(and(eq(facts.userId, userId), inArray(facts.dedupeHash, hashes)));
  const seen = new Set(judged.map((f) => f.dedupeHash));
  return rows.filter((r) => !seen.has(r.dedupeHash!));
}

/* ------------------------------------------------------------------ step 3 */

async function finishStep(deps: ImportDeps): Promise<void> {
  const { db, userId, versionId } = deps;

  const [{ total } = { total: 0 }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(facts)
    .where(and(eq(facts.userId, userId), eq(facts.sourceDocumentVersionId, versionId)));

  const [version] = await db
    .select({ chunksTotal: sourceDocumentVersions.chunksTotal })
    .from(sourceDocumentVersions)
    .where(and(eq(sourceDocumentVersions.userId, userId), eq(sourceDocumentVersions.id, versionId)))
    .limit(1);

  // Zero facts is a FAILURE of extraction, never an empty success — the document
  // is retained and the author can retry or capture manually.
  //
  // The exception is a re-import in which nothing changed: there were no chunks
  // to extract from, so zero candidates is the correct and successful answer.
  const nothingToExtract = (version?.chunksTotal ?? 0) === 0;
  const failed = total === 0 && !nothingToExtract;

  await db
    .update(sourceDocumentVersions)
    .set({
      importStatus: failed ? "failed" : "ready",
      importError: failed ? "No facts could be extracted from this document." : null,
      updatedAt: new Date(),
    })
    .where(and(eq(sourceDocumentVersions.userId, userId), eq(sourceDocumentVersions.id, versionId)));

  log({ event: "import_finished", versionId, candidates: total, failed });
}

/* ------------------------------------------------------------------ shared */

async function loadVersion(db: Db, userId: string, versionId: string) {
  const [version] = await db
    .select({
      id: sourceDocumentVersions.id,
      sourceDocumentId: sourceDocumentVersions.sourceDocumentId,
      versionNo: sourceDocumentVersions.versionNo,
      extractedText: sourceDocumentVersions.extractedText,
      projectId: sql<string | null>`(select project_id from source_documents where id = ${sourceDocumentVersions.sourceDocumentId})`,
    })
    .from(sourceDocumentVersions)
    .where(and(eq(sourceDocumentVersions.userId, userId), eq(sourceDocumentVersions.id, versionId)))
    .limit(1);
  return version ?? null;
}

async function previousVersionText(
  db: Db,
  userId: string,
  version: { sourceDocumentId: string; versionNo: number },
): Promise<string | null> {
  if (version.versionNo <= 1) return null;
  const [previous] = await db
    .select({ extractedText: sourceDocumentVersions.extractedText })
    .from(sourceDocumentVersions)
    .where(
      and(
        eq(sourceDocumentVersions.userId, userId),
        eq(sourceDocumentVersions.sourceDocumentId, version.sourceDocumentId),
        eq(sourceDocumentVersions.versionNo, version.versionNo - 1),
      ),
    )
    .limit(1);
  return previous?.extractedText ?? null;
}

/**
 * `db.transaction()` THROWS on the neon-http driver. `db.batch([...])` reaches
 * the driver's own `transaction(builtQueries)` and executes as a genuine single
 * non-interactive transaction (`docs/03` §5).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function batch(db: Db, statements: any[]): Promise<void> {
  if (statements.length === 0) return;
  if (statements.length === 1) {
    await statements[0];
    return;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await db.batch(statements as any);
}

/** Ids and counts. Never source text, a fact claim, a quote or render content. */
function log(entry: Record<string, unknown>) {
  console.log(JSON.stringify(entry));
}
