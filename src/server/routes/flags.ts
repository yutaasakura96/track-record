/**
 * Flags — the list that replaced reviewing every fact (issue #57,
 * `docs/07-api-design.md` §6).
 *
 * A flag is advice. It never removes a fact from the record, never rejects
 * one, and marking it checked changes nothing about the fact: not its worth,
 * and not who may read it. Making a Private fact usable is still done on the
 * fact, one at a time.
 *
 * **`Explain this` is the only route here that calls the model**, and only on
 * a press: the list is read with no model call, and an explanation already
 * written is returned as stored.
 */
import type { Hono } from "hono";
import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { factFlags, facts, sourceDocumentVersions, sourceDocuments } from "../db/schema";
import { ApiError, notFound, pathParam } from "../http/errors";
import { routes } from "../http/registry";
import { ModelUnavailableError, type ModelUsage } from "~/model";
import type { AppEnv } from "../env";
import type { Db } from "../db/client";

export interface FlagResponse {
  id: string;
  kind: "confidential" | "number" | "unsure" | "repeat";
  reason: string;
  /** `null` until `Explain this` has been pressed for it. */
  explanation: string | null;
  checked: boolean;
}

export const flagResponse = (flag: typeof factFlags.$inferSelect): FlagResponse => ({
  id: flag.id,
  kind: flag.kind,
  reason: flag.reason,
  explanation: flag.explanation,
  checked: flag.checkedAt !== null,
});

/** The order a fact's flags are read in: what keeps it out of documents first. */
const KIND_ORDER = sql`case ${factFlags.kind} when 'confidential' then 0 when 'unsure' then 1 when 'repeat' then 2 else 3 end`;

/** Every flag on these facts, by fact. One read for a whole page of cards. */
export async function flagsOf(db: Db, userId: string, factIds: string[]): Promise<Map<string, FlagResponse[]>> {
  const byFact = new Map<string, FlagResponse[]>();
  if (factIds.length === 0) return byFact;
  const rows = await db
    .select()
    .from(factFlags)
    .where(and(eq(factFlags.userId, userId), inArray(factFlags.factId, factIds)))
    .orderBy(KIND_ORDER, asc(factFlags.id));
  for (const row of rows) byFact.set(row.factId, [...(byFact.get(row.factId) ?? []), flagResponse(row)]);
  return byFact;
}

/** The facts whose `repeat` flag is still open: the ones a card shows the pair for. */
export const repeatFlagged = (flags: Map<string, FlagResponse[]>) =>
  new Set([...flags].filter(([, own]) => own.some((flag) => flag.kind === "repeat" && !flag.checked)).map(([id]) => id));

/**
 * Flags the author has not marked checked, on facts still in the record. A
 * rejected fact's flags are not counted: the author has already ruled on it.
 */
export const openFlags = (userId: string) =>
  and(eq(factFlags.userId, userId), isNull(factFlags.checkedAt), ne(facts.status, "rejected"));

/** The join every flag read makes to its fact. Both sides carry the user. */
export const factOfFlag = (userId: string) => and(eq(facts.id, factFlags.factId), eq(facts.userId, userId));

export function registerFlagRoutes(app: Hono<AppEnv>) {
  const api = routes(app);

  /**
   * The list. `state=checked` is the ones already marked; anything else is the
   * ones still to look at. Every item carries where its fact is opened, so the
   * author clicks into one only when they want to.
   */
  api.get("/api/flags", async (c) => {
    const user = c.get("user");
    const db = c.get("db");
    const checked = c.req.query("state") === "checked";

    const [rows, [counts]] = await db.batch([
      db
        .select({
          flag: factFlags,
          factId: facts.id,
          claim: facts.claim,
          provenance: facts.provenance,
          disclosure: facts.disclosure,
          lineNumber: facts.lineNumber,
          importId: facts.sourceDocumentVersionId,
          filename: sourceDocuments.filename,
        })
        .from(factFlags)
        .innerJoin(facts, factOfFlag(user.id))
        .leftJoin(
          sourceDocumentVersions,
          and(eq(sourceDocumentVersions.id, facts.sourceDocumentVersionId), eq(sourceDocumentVersions.userId, user.id)),
        )
        .leftJoin(
          sourceDocuments,
          and(eq(sourceDocuments.id, sourceDocumentVersions.sourceDocumentId), eq(sourceDocuments.userId, user.id)),
        )
        .where(
          and(
            eq(factFlags.userId, user.id),
            ne(facts.status, "rejected"),
            checked ? isNotNull(factFlags.checkedAt) : isNull(factFlags.checkedAt),
          ),
        )
        .orderBy(KIND_ORDER, desc(factFlags.createdAt), asc(factFlags.id)),
      db
        .select({
          open: sql<number>`count(*) filter (where ${factFlags.checkedAt} is null)::int`,
          checked: sql<number>`count(*) filter (where ${factFlags.checkedAt} is not null)::int`,
        })
        .from(factFlags)
        .innerJoin(facts, factOfFlag(user.id))
        .where(and(eq(factFlags.userId, user.id), ne(facts.status, "rejected"))),
    ]);

    return c.json({
      counts: { open: counts?.open ?? 0, checked: counts?.checked ?? 0 },
      items: rows.map((row) => ({
        ...flagResponse(row.flag),
        fact: {
          id: row.factId,
          claim: row.claim,
          provenance: row.provenance,
          disclosure: row.disclosure,
          lineNumber: row.lineNumber,
          /** Where the fact is opened: its import. `null` for a fact with no document. */
          importId: row.importId,
          filename: row.filename,
        },
      })),
    });
  });

  /**
   * `Explain this`. One model call, on the press, and the answer is stored on
   * the flag: asking again reads it back and spends nothing.
   */
  api.post("/api/flags/:id/explain", async (c) => {
    const user = c.get("user");
    const db = c.get("db");
    const { flag, fact } = await requireFlag(db, user.id, pathParam(c, "id"));
    if (flag.explanation !== null) return c.json(flagResponse(flag));

    let usage: ModelUsage | null = null;
    let explanation: string;
    try {
      explanation = await c.get("model").explainFlag(
        {
          kind: flag.kind,
          reason: flag.reason,
          claim: fact.claim,
          quote: fact.quote,
          provenance: fact.provenance,
          disclosure: fact.disclosure,
        },
        { onUsage: (u) => (usage = u) },
      );
    } catch (err) {
      if (!(err instanceof ModelUnavailableError)) throw err;
      throw new ApiError("upstream_unavailable", "The explanation could not be written just now. Try again.");
    }

    const [updated] = await db
      .update(factFlags)
      // `ModelUsage`'s four keys are the four column names (`pipeline/import.ts`).
      .set({ explanation, ...(usage ?? {}), updatedAt: new Date() })
      .where(and(eq(factFlags.userId, user.id), eq(factFlags.id, flag.id)))
      .returning();
    // The flag id and counts. Never the explanation, which restates the fact.
    console.log(JSON.stringify({ event: "flag_explained", flagId: flag.id, ...(usage ?? {}) }));
    return c.json(flagResponse(updated ?? { ...flag, explanation }));
  });

  /** Idempotent, both ways: a one-click action on a list where a double-click is likely. */
  api.post("/api/flags/:id/check", (c) => setChecked(c.get("db"), c.get("user").id, pathParam(c, "id"), true).then((f) => c.json(f)));
  api.post("/api/flags/:id/uncheck", (c) => setChecked(c.get("db"), c.get("user").id, pathParam(c, "id"), false).then((f) => c.json(f)));
}

async function setChecked(db: Db, userId: string, id: string, checked: boolean): Promise<FlagResponse> {
  const { flag } = await requireFlag(db, userId, id);
  if ((flag.checkedAt !== null) === checked && !(checked && flag.systemSettledAt !== null)) return flagResponse(flag);
  const now = new Date();
  const [updated] = await db
    .update(factFlags)
    .set({ checkedAt: checked ? now : null, systemSettledAt: null, updatedAt: now })
    .where(and(eq(factFlags.userId, userId), eq(factFlags.id, id)))
    .returning();
  return flagResponse(updated ?? flag);
}

/** A flag and its fact, or a 404. Another user's flag is the same 404. */
async function requireFlag(db: Db, userId: string, id: string) {
  const [row] = await db
    .select({ flag: factFlags, fact: facts })
    .from(factFlags)
    .innerJoin(facts, factOfFlag(userId))
    .where(and(eq(factFlags.userId, userId), eq(factFlags.id, id)))
    .limit(1);
  if (!row) throw notFound("That flag");
  return row;
}
