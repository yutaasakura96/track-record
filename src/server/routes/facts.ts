/**
 * Facts (`docs/07-api-design.md` §6).
 *
 * **No confidence score is returned.** Not omitted from the interface — absent
 * from the contract, so it cannot be rendered by accident.
 *
 * **The quote text is not returned.** The client already has the source text
 * and the offsets; sending the quote again would duplicate record content into
 * another response.
 */
import type { Hono } from "hono";
import { and, asc, eq, gt, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { facts } from "../db/schema";
import { notFound, validationFailed, pathParam } from "../http/errors";
import { routes } from "../http/registry";
import { parseBody } from "../services/validate";
import type { AppEnv } from "../env";
import type { Context } from "hono";
import type { Db } from "../db/client";

const PAGE_SIZE = 100;

const patchBody = z.object({
  claim: z.string().trim().min(1, "A claim cannot be empty.").optional(),
  provenance: z.enum(["measured", "attested", "generated"]).optional(),
  disclosure: z.enum(["public", "restricted", "private"]).optional(),
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
    return c.json({
      items: page.map(toResponse),
      nextCursor: rows.length > PAGE_SIZE ? (page[page.length - 1]?.id ?? null) : null,
    });
  });

  api.patch("/api/facts/:id", async (c) => {
    const user = c.get("user");
    const db = c.get("db");
    const body = await parseBody(c, patchBody);
    const fact = await requireFact(db, user.id, pathParam(c, "id"));

    // The strongest tier cannot be claimed without proof. A Measured fact must
    // have a passage in the source that proves it.
    if (body.provenance === "measured" && !hasEvidence(fact)) {
      throw validationFailed("A Measured fact needs a passage in the source that proves it.", [
        "provenance",
      ]);
    }

    const [updated] = await db
      .update(facts)
      .set({
        ...(body.claim === undefined ? {} : { claim: body.claim }),
        ...(body.provenance === undefined ? {} : { provenance: body.provenance }),
        ...(body.disclosure === undefined ? {} : { disclosure: body.disclosure }),
        updatedAt: new Date(),
      })
      .where(and(eq(facts.userId, user.id), eq(facts.id, fact.id)))
      .returning();
    return c.json(toResponse(updated!));
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

  const [updated] = await db
    .update(facts)
    .set({
      status,
      resolvedAt: status === "candidate" ? null : new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(facts.userId, user.id), eq(facts.id, fact.id)))
    .returning();
  return c.json(toResponse(updated!));
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
 */
export function toResponse(fact: typeof facts.$inferSelect) {
  return {
    id: fact.id,
    claim: fact.claim,
    provenance: fact.provenance,
    disclosure: fact.disclosure,
    status: fact.status,
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
