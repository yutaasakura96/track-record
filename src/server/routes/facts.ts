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
import { and, asc, eq, gt, isNull, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { facts } from "../db/schema";
import { conflict, notFound, validationFailed, pathParam } from "../http/errors";
import { routes } from "../http/registry";
import { parseBody } from "../services/validate";
import { likelyMatchesFor, type LikelyMatchResponse } from "../services/overlap";
import { requireOwnedEmployer } from "./record";
import type { AppEnv } from "../env";
import type { Context } from "hono";
import type { Db } from "../db/client";

const PAGE_SIZE = 100;

const patchBody = z.object({
  claim: z.string().trim().min(1, "A claim cannot be empty.").optional(),
  provenance: z.enum(["measured", "attested", "generated"]).optional(),
  disclosure: z.enum(["public", "restricted", "private"]).optional(),
  /**
   * Which employer this fact belongs to. `null` detaches it.
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
    if (employerId) filters.push(eq(facts.employerId, employerId));
    const projectId = c.req.query("projectId");
    if (projectId) filters.push(eq(facts.projectId, projectId));
    // `graded=false` with `status=accepted` is the listing of what is still to
    // re-grade (`docs/07` §6); any other value is ignored, as an unknown status is.
    const graded = c.req.query("graded");
    if (graded === "false") filters.push(isNull(facts.gradedAt));
    const cursor = c.req.query("cursor");
    if (cursor) filters.push(gt(facts.id, cursor));

    const rows = await c
      .get("db")
      .select()
      .from(facts)
      .where(and(...filters))
      .orderBy(asc(facts.id))
      .limit(PAGE_SIZE + 1);

    const page = rows.slice(0, PAGE_SIZE);
    // Advisory, computed on this read and stored nowhere (`docs/04` §3.12).
    const matches = await likelyMatchesFor(c.get("db"), user.id, page);
    return c.json({
      items: page.map((fact) => toResponse(fact, matches.get(fact.id) ?? [])),
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

    const [updated] = await db
      .update(facts)
      .set({
        ...(body.claim === undefined ? {} : { claim: body.claim }),
        ...(body.provenance === undefined ? {} : { provenance: body.provenance }),
        ...(body.disclosure === undefined ? {} : { disclosure: body.disclosure }),
        ...(body.employerId === undefined ? {} : { employerId: body.employerId }),
        updatedAt: new Date(),
      })
      .where(and(eq(facts.userId, user.id), eq(facts.id, fact.id)))
      .returning();
    return c.json(await withMatches(db, user.id, updated!));
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

  /** A misclick is not permanent. */
  api.post("/api/facts/:id/undo", (c) => resolve(c, "candidate"));

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
    const [updated] = await db
      .update(facts)
      .set({ provenance: body.provenance, gradedAt: now, updatedAt: now })
      .where(and(eq(facts.userId, user.id), eq(facts.id, fact.id)))
      .returning();
    return c.json(await withMatches(db, user.id, updated!));
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

  // Accepting is the author grading the fact; a candidate carries no decision.
  // A rejection leaves the grade as it was (`docs/04` §3.7).
  const [updated] = await db
    .update(facts)
    .set({
      status,
      resolvedAt: status === "candidate" ? null : new Date(),
      ...(status === "rejected" ? {} : { gradedAt: status === "accepted" ? new Date() : null }),
      updatedAt: new Date(),
    })
    .where(and(eq(facts.userId, user.id), eq(facts.id, fact.id)))
    .returning();
  return c.json(await withMatches(db, user.id, updated!));
}

/** One fact after a write, its likely matches read the way the list reads them. */
async function withMatches(db: Db, userId: string, fact: typeof facts.$inferSelect) {
  const matches = await likelyMatchesFor(db, userId, [fact]);
  return toResponse(fact, matches.get(fact.id) ?? []);
}

async function requireFact(db: Db, userId: string, id: string) {
  const [fact] = await db
    .select()
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
export function toResponse(fact: typeof facts.$inferSelect, likelyMatches: LikelyMatchResponse[]) {
  return {
    id: fact.id,
    claim: fact.claim,
    provenance: fact.provenance,
    disclosure: fact.disclosure,
    status: fact.status,
    /** Which employer the fact is filed under — `null` until it is linked. */
    employerId: fact.employerId,
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
    /** False on an accepted fact whose provenance is not the author's (issue #37). */
    graded: fact.gradedAt !== null,
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
