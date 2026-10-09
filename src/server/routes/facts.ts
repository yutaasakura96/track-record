/**
 * Facts (`docs/07-api-design.md` §6).
 *
 * **No confidence score is returned.** Not omitted from the interface — absent
 * from the contract, so it cannot be rendered by accident.
 *
 * **The quote text is not returned.** The client already has the source text
 * and the offsets; sending the quote again would duplicate record content into
 * another response. The same holds for a candidate's likely matches: ids,
 * claims and documents, never a quote and never a score.
 */
import type { Hono } from "hono";
import { and, asc, eq, gt, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { factFlags, facts } from "../db/schema";
import { ApiError, conflict, notFound, validationFailed, pathParam } from "../http/errors";
import { newId } from "../http/ids";
import { routes } from "../http/registry";
import { parseBody } from "../services/validate";
import { likelyMatchesFor, type LikelyMatchResponse } from "../services/overlap";
import { effectiveEmployerId, factWithEmployer, type FactWithEmployer } from "../services/employer";
import { flagRepeats, settleRepeats } from "../services/repeats";
import { employerSetByHand } from "../db/fact-employer";
import { requireOwnedEmployer } from "./record";
import { flagsOf, repeatFlagged, type FlagResponse } from "./flags";
import { classifyClaim, sortFact } from "~/pipeline/flags";
import { ModelUnavailableError, type ModelUsage } from "~/model";
import type { AppEnv } from "../env";
import type { Context } from "hono";
import type { Db } from "../db/client";

const PAGE_SIZE = 100;

const patchBody = z.object({
  claim: z.string().trim().min(1, "A claim cannot be empty.").optional(),
  provenance: z.enum(["measured", "attested", "generated"]).optional(),
  disclosure: z.enum(["public", "restricted", "private"]).optional(),
  /**
   * Which employer this fact belongs to, set by hand. `null` is a hand-set
   * `No employer`, not a return to reading through the document: either way
   * the fact keeps it whatever later happens to its document (`docs/04` §3.12).
   *
   * Employer structure used to be reconstructed by the model from the claim
   * prose, which worked only because the imported source happened to name its
   * employers inside the sentences that became claims (`docs/06`, 2026-09-04).
   * This is the column that replaces that inference with data — set here rather
   * than at extraction, because a source document version is never re-extracted
   * in place and re-importing to gain a foreign key would orphan every accept
   * decision already made against it.
   */
  employerId: z.string().trim().min(1).nullish(),
});

const regradeBody = z.object({
  provenance: z.enum(["measured", "attested", "generated"]),
});

/**
 * How many waiting facts one sort grades. One model call per request, sized so
 * the call answers while the browser is still waiting on it; the client asks
 * again until none are left (`docs/07` §6).
 */
const SORT_BATCH = 25;

const sortBody = z.object({ importId: z.string().trim().min(1).optional() });

export function registerFactRoutes(app: Hono<AppEnv>) {
  const api = routes(app);

  api.get("/api/facts", async (c) => {
    const user = c.get("user");
    const filters: SQL[] = [eq(facts.userId, user.id)];

    const importId = c.req.query("importId");
    if (importId) filters.push(eq(facts.sourceDocumentVersionId, importId));
    const status = c.req.query("status");
    if (status === "candidate" || status === "accepted" || status === "rejected") {
      filters.push(eq(facts.status, status));
    }
    const employerId = c.req.query("employerId");
    // The employer the fact resolves to, the one the card shows.
    if (employerId) filters.push(eq(effectiveEmployerId, employerId));
    const projectId = c.req.query("projectId");
    if (projectId) filters.push(eq(facts.projectId, projectId));
    // `graded=false` with `status=accepted` is the listing of what is still to
    // re-grade (`docs/07` §6); any other value is ignored, as an unknown status is.
    const graded = c.req.query("graded");
    if (graded === "false") filters.push(isNull(facts.gradedAt), isNull(facts.autoAcceptedAt));
    const cursor = c.req.query("cursor");
    if (cursor) filters.push(gt(facts.id, cursor));

    const rows = await c
      .get("db")
      .select(factWithEmployer)
      .from(facts)
      .where(and(...filters))
      .orderBy(asc(facts.id))
      .limit(PAGE_SIZE + 1);

    const page = rows.slice(0, PAGE_SIZE);
    // Advisory, computed on this read and stored nowhere (`docs/04` §3.12).
    const flags = await flagsOf(c.get("db"), user.id, page.map((fact) => fact.id));
    const matches = await likelyMatchesFor(c.get("db"), user.id, page, repeatFlagged(flags));
    return c.json({
      items: page.map((fact) => toResponse(fact, matches.get(fact.id) ?? [], flags.get(fact.id) ?? [])),
      nextCursor: rows.length > PAGE_SIZE ? (page[page.length - 1]?.id ?? null) : null,
    });
  });

  api.patch("/api/facts/:id", async (c) => {
    const user = c.get("user");
    const db = c.get("db");
    const body = await parseBody(c, patchBody);
    const fact = await requireFact(db, user.id, pathParam(c, "id"));

    requireEvidenceFor(body.provenance, fact);

    // A foreign key alone would let one user file a fact under another user's
    // employer. The check is a read filtered by `user_id`, and a miss is a 404.
    if (body.employerId) await requireOwnedEmployer(db, user.id, body.employerId);

    const now = new Date();
    const claimChanged = body.claim !== undefined && body.claim !== fact.claim;
    const classified = claimChanged ? classifyClaim({ ...fact, claim: body.claim! }) : null;
    const writes: unknown[] = [db
      .update(facts)
      .set({
        ...(body.claim === undefined ? {} : { claim: body.claim }),
        ...(body.provenance === undefined ? {} : { provenance: body.provenance }),
        ...(classified?.shape ? { disclosure: "private" as const, isClientIdentifying: true } : body.disclosure === undefined ? {} : { disclosure: body.disclosure }),
        ...(body.employerId === undefined ? {} : { employerId: body.employerId, employerSetAt: now }),
        updatedAt: now,
      })
      .where(and(eq(facts.userId, user.id), eq(facts.id, fact.id)))];
    if (classified) {
      const old = classifyClaim(fact);
      const oldShapeReason = old.flags.find((flag) => flag.kind === "confidential")?.reason;
      for (const kind of ["confidential", "number"] as const) {
        const flag = classified.flags.find((item) => item.kind === kind);
        if (flag) {
          writes.push(db.insert(factFlags).values({ id: newId("factFlag"), userId: user.id, factId: fact.id, ...flag })
            .onConflictDoUpdate({ target: [factFlags.factId, factFlags.kind], set: {
              reason: flag.reason, checkedAt: null, systemSettledAt: null, explanation: null,
              inputTokens: null, outputTokens: null, cacheCreationInputTokens: null, cacheReadInputTokens: null,
              updatedAt: now,
            } }));
        } else if (kind === "number" || oldShapeReason) {
          writes.push(db.update(factFlags).set({ checkedAt: now, updatedAt: now })
            .where(and(eq(factFlags.userId, user.id), eq(factFlags.factId, fact.id), eq(factFlags.kind, kind), isNull(factFlags.checkedAt),
              ...(kind === "confidential" ? [eq(factFlags.reason, oldShapeReason!)] : []))));
        }
      }
    }
    await db.batch(writes as any);
    // A new wording or a new employer can make a pair, and can unmake one.
    if (body.claim !== undefined || body.employerId !== undefined) {
      await flagRepeats(db, user.id, eq(facts.id, fact.id));
      await settleRepeats(db, user.id);
    }
    return c.json(await withMatches(db, user.id, fact.id));
  });

  /**
   * Accepting a **Generated** fact SUCCEEDS. It is accepted, flagged, and
   * excluded when a render is produced. Placing the block at review time would
   * be the wrong guarantee — it would depend on review having happened
   * correctly (`docs/07` §6).
   *
   * Private facts are accepted normally too; the record can hold what the
   * renders must not.
   */
  api.post("/api/facts/:id/accept", (c) => resolve(c, "accepted"));
  api.post("/api/facts/:id/reject", (c) => resolve(c, "rejected"));

  /**
   * A misclick is not permanent. Undo returns a fact to where it stood before
   * the author ruled on it: a candidate, or, for a fact the importer accepted
   * (issue #57), accepted again. It never takes such a fact out of the record.
   */
  api.post("/api/facts/:id/undo", (c) => resolve(c, "candidate"));

  /**
   * Sorts facts still waiting from before the importer accepted on its own
   * (issue #57): grades up to `SORT_BATCH` of them in one model call, accepts
   * every one, and flags what is worth a look.
   *
   * A fact the model returned no grade for is kept as Generated and flagged.
   *
   * A fact the author already made Private stays Private, and one they made
   * Public is made Private only if it reads as confidential. Nothing here
   * loosens a disclosure.
   */
  api.post("/api/facts/sort", async (c) => {
    const user = c.get("user");
    const db = c.get("db");
    const body = await parseBody(c, sortBody);
    const waiting = and(
      eq(facts.userId, user.id),
      eq(facts.status, "candidate"),
      ...(body.importId ? [eq(facts.sourceDocumentVersionId, body.importId)] : []),
    );

    const batch = await db.select().from(facts).where(waiting).orderBy(asc(facts.id)).limit(SORT_BATCH);
    if (batch.length === 0) return c.json({ sorted: 0, flagged: 0, remaining: 0 });

    let usage: ModelUsage | null = null;
    let grades;
    try {
      grades = await c.get("model").gradeFacts(
        batch.map((fact) => ({ id: fact.id, claim: fact.claim, quote: fact.quote })),
        { onUsage: (u) => (usage = u) },
      );
    } catch (err) {
      if (!(err instanceof ModelUnavailableError)) throw err;
      throw new ApiError("upstream_unavailable", "The facts could not be sorted just now. Nothing was changed; try again.");
    }

    const now = new Date();
    const flags: (typeof factFlags.$inferInsert)[] = [];
    const updates = batch.map((fact) => {
      const sorted = sortFact(fact, grades.get(fact.id) ?? null);
      for (const flag of sorted.flags) {
        flags.push({ id: newId("factFlag"), userId: user.id, factId: fact.id, kind: flag.kind, reason: flag.reason });
      }
      const confidential = sorted.disclosure === "private";
      return db
        .update(facts)
        .set({
          status: "accepted",
          provenance: sorted.provenance,
          disclosure: confidential ? "private" : fact.disclosure,
          isClientIdentifying: fact.isClientIdentifying || sorted.isClientIdentifying,
          autoAcceptedAt: now,
          resolvedAt: now,
          updatedAt: now,
        })
        // Still a candidate: a fact the author ruled on while the model was
        // answering keeps the author's ruling.
        .where(and(eq(facts.userId, user.id), eq(facts.id, fact.id), eq(facts.status, "candidate"),
          eq(facts.claim, fact.claim), eq(facts.disclosure, fact.disclosure), eq(facts.provenance, fact.provenance)))
        .returning({ id: facts.id });
    });
    const results = await db.batch(updates as any) as { id: string }[][];
    const sortedIds = results.flat().map((row) => row.id);
    const savedFlags = flags.filter((flag) => sortedIds.includes(flag.factId));
    if (savedFlags.length > 0) await db.insert(factFlags).values(savedFlags).onConflictDoNothing();

    // The check a candidate's card made, now that there is no card to make it on.
    const repeats = sortedIds.length > 0 ? await flagRepeats(db, user.id, inArray(facts.id, sortedIds)) : [];
    const flagged = new Set([...savedFlags.map((flag) => flag.factId), ...repeats]).size;

    const [{ remaining } = { remaining: 0 }] = await db
      .select({ remaining: sql<number>`count(*)::int` })
      .from(facts)
      .where(waiting);

    // Counts only. No claim, no quote, no note.
    console.log(
      JSON.stringify({ event: "facts_sorted", sorted: sortedIds.length, flagged, remaining, ...(usage ?? {}) }),
    );
    return c.json({ sorted: sortedIds.length, flagged, remaining });
  });

  /**
   * The author's grade on a fact already accepted (`docs/07` §6, issue #37).
   * Choosing the provenance it already has is a re-grade too: confirming the
   * agent's default is the answer for most of the 2026-09-04 import. Writes the
   * provenance and the grade, and nothing else — not the status, and not
   * `resolved_at`, so the accept decision stands as it was made.
   */
  api.post("/api/facts/:id/regrade", async (c) => {
    const user = c.get("user");
    const db = c.get("db");
    const body = await parseBody(c, regradeBody);
    const fact = await requireFact(db, user.id, pathParam(c, "id"));
    if (fact.status !== "accepted") {
      throw conflict("Only an accepted fact is re-graded. Grade a candidate on its card.", {});
    }
    requireEvidenceFor(body.provenance, fact);

    const now = new Date();
    await db
      .update(facts)
      .set({ provenance: body.provenance, gradedAt: now, updatedAt: now })
      .where(and(eq(facts.userId, user.id), eq(facts.id, fact.id)));
    return c.json(await withMatches(db, user.id, fact.id));
  });
}

/**
 * The strongest tier cannot be claimed without proof. A Measured fact must
 * have a passage in the source that proves it.
 */
function requireEvidenceFor(provenance: string | undefined, fact: typeof facts.$inferSelect) {
  if (provenance !== "measured" || hasEvidence(fact)) return;
  throw validationFailed("A Measured fact needs a passage in the source that proves it.", [
    "provenance",
  ]);
}

/**
 * Idempotent: repeating an accept, reject or undo returns 200 with the same
 * resulting state, never an error. These are one-click actions on a screen
 * where a double-click is likely.
 */
async function resolve(
  c: Context<AppEnv>,
  status: "accepted" | "rejected" | "candidate",
) {
  const user = c.get("user");
  const db = c.get("db");
  const fact = await requireFact(db, user.id, pathParam(c, "id"));

  // Undoing the author's ruling on a fact the importer accepted puts it back
  // as the importer left it: accepted, and graded by nobody but the importer.
  if (status === "candidate" && fact.autoAcceptedAt !== null) {
    await db
      .update(facts)
      .set({ status: "accepted", resolvedAt: fact.autoAcceptedAt, updatedAt: new Date() })
      .where(and(eq(facts.userId, user.id), eq(facts.id, fact.id)));
    await flagRepeats(db, user.id, eq(facts.id, fact.id));
    await settleRepeats(db, user.id);
    return c.json(await withMatches(db, user.id, fact.id));
  }

  // Accepting is the author grading the fact; a candidate carries no decision.
  // A rejection leaves the grade as it was (`docs/04` §3.7).
  await db
    .update(facts)
    .set({
      status,
      resolvedAt: status === "candidate" ? null : new Date(),
      ...(status === "rejected" ? {} : { gradedAt: status === "accepted" ? new Date() : null }),
      updatedAt: new Date(),
    })
    .where(and(eq(facts.userId, user.id), eq(facts.id, fact.id)));
  if (status !== "candidate") await settleRepeats(db, user.id);
  return c.json(await withMatches(db, user.id, fact.id));
}

/**
 * One fact after a write, read back the way the list reads it: its employer
 * resolved, and its likely matches computed. Read rather than taken from the
 * write's `returning`, so the employer is resolved by the same select.
 */
async function withMatches(db: Db, userId: string, id: string) {
  const fact = await requireFact(db, userId, id);
  const flags = await flagsOf(db, userId, [fact.id]);
  const matches = await likelyMatchesFor(db, userId, [fact], repeatFlagged(flags));
  return toResponse(fact, matches.get(fact.id) ?? [], flags.get(fact.id) ?? []);
}

async function requireFact(db: Db, userId: string, id: string): Promise<FactWithEmployer> {
  const [fact] = await db
    .select(factWithEmployer)
    .from(facts)
    .where(and(eq(facts.userId, userId), eq(facts.id, id)))
    .limit(1);
  if (!fact) throw notFound("That fact");
  return fact;
}

const hasEvidence = (fact: typeof facts.$inferSelect) =>
  fact.sourceDocumentVersionId !== null &&
  fact.quote !== null &&
  fact.quoteStart !== null &&
  fact.quoteEnd !== null;

/**
 * `evidence` is `null` for a fact with no verbatim support — the card renders
 * the dashed amber treatment and the promotion warning from that.
 *
 * `likelyMatches` is empty on anything but a candidate: the flag is settled on
 * the open card (`docs/10` Screen 1).
 */
export function toResponse(
  fact: FactWithEmployer,
  likelyMatches: LikelyMatchResponse[],
  flags: FlagResponse[],
) {
  return {
    id: fact.id,
    claim: fact.claim,
    provenance: fact.provenance,
    disclosure: fact.disclosure,
    status: fact.status,
    /**
     * Which employer the fact is filed under: its hand-set one, then its
     * document's, then its project's (`docs/04` §3.12). `null` when none is.
     */
    employerId: fact.resolvedEmployerId,
    /** True once the card set it; the fact then keeps it whatever its document does. */
    employerSetByHand: employerSetByHand(fact),
    projectId: fact.projectId,
    evidence: hasEvidence(fact)
      ? {
          sourceDocumentVersionId: fact.sourceDocumentVersionId,
          lineNumber: fact.lineNumber,
          quoteStart: fact.quoteStart,
          quoteEnd: fact.quoteEnd,
        }
      : null,
    technologies: fact.technologies,
    isClientIdentifying: fact.isClientIdentifying,
    /**
     * False on an accepted fact whose provenance nobody chose: neither the
     * author (issue #37) nor the importer (issue #57). Those are the facts an
     * agent's default promoted, and the only ones still to re-grade.
     */
    graded: fact.gradedAt !== null || fact.autoAcceptedAt !== null,
    /** True on a fact the importer accepted on its own. It stays true whatever the author does next. */
    autoAccepted: fact.autoAcceptedAt !== null,
    /** Whose grade the provenance is: the author's once they set it, else the importer's, else nobody's. */
    gradedBy: fact.gradedAt !== null ? "author" : fact.autoAcceptedAt !== null ? "importer" : null,
    /** Why the fact is worth a look, each with its reason. Empty on most facts. */
    flags,
    likelyMatches,
  };
}

/** Used by the overview's provenance breakdown. */
export const provenanceCounts = (db: Db, userId: string) =>
  db
    .select({
      measured: sql<number>`count(*) filter (where ${facts.provenance} = 'measured')::int`,
      attested: sql<number>`count(*) filter (where ${facts.provenance} = 'attested')::int`,
      generated: sql<number>`count(*) filter (where ${facts.provenance} = 'generated')::int`,
    })
    .from(facts)
    .where(and(eq(facts.userId, userId), eq(facts.status, "accepted")));
