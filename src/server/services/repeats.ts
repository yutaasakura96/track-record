/**
 * The `repeat` flag: a fact the importer accepted that likely restates one
 * already in the record (`docs/06`, 2026-10-08).
 *
 * It is the likely match a candidate's card computed, kept as a flag, because
 * a fact that is accepted on arrival has no open card to compute it on. The
 * flag says THAT a pair exists and is stored; which facts make the pair is
 * still computed on the read (`./overlap.ts`), so it is never stale.
 *
 * Every query here filters by `user_id`, joins included. Nothing is logged:
 * the rows read are claims.
 */
import { and, eq, inArray, isNotNull, isNull, or, type SQL } from "drizzle-orm";
import { factFlags, facts } from "../db/schema";
import { newId } from "../http/ids";
import { repeatFlag } from "~/pipeline/flags";
import { factWithEmployer } from "./employer";
import { repeatsAmong } from "./overlap";
import type { Db } from "../db/client";

/**
 * Flags which of the facts `where` selects likely restate another, and returns
 * their ids. Only a fact the importer accepted and the author has not graded
 * is looked at: a fact the author ruled on is theirs.
 *
 * Idempotent. A fact already flagged keeps the flag it has, checked or not, so
 * a pair the author dismissed is not raised a second time.
 */
export async function flagRepeats(db: Db, userId: string, where: SQL | undefined): Promise<string[]> {
  const arrived = await db
    .select(factWithEmployer)
    .from(facts)
    .where(
      and(
        eq(facts.userId, userId),
        eq(facts.status, "accepted"),
        isNotNull(facts.autoAcceptedAt),
        isNull(facts.gradedAt),
        where,
      ),
    );
  const matches = await repeatsAmong(db, userId, arrived);
  if (matches.size === 0) return [];
  await db
    .insert(factFlags)
    .values(
      [...matches].map(([factId, found]) => ({
        id: newId("factFlag"),
        userId,
        factId,
        ...repeatFlag(found.some((match) => match.conflict)),
      })),
    )
    .onConflictDoNothing();
  return [...matches.keys()];
}

export async function settleRepeats(db: Db, userId: string): Promise<void> {
  const tracked = await db
    .select({ ...factWithEmployer, flagId: factFlags.id, checkedAt: factFlags.checkedAt, systemSettledAt: factFlags.systemSettledAt })
    .from(factFlags)
    .innerJoin(facts, and(eq(facts.id, factFlags.factId), eq(facts.userId, factFlags.userId)))
    .where(
      and(
        eq(factFlags.userId, userId),
        eq(factFlags.kind, "repeat"),
        or(isNull(factFlags.checkedAt), isNotNull(factFlags.systemSettledAt)),
        eq(facts.status, "accepted"),
      ),
    );
  if (tracked.length === 0) return;
  const matches = await repeatsAmong(db, userId, tracked);
  const gone = tracked.filter((fact) => fact.checkedAt === null && !matches.has(fact.id)).map((fact) => fact.flagId);
  const restored = tracked.filter((fact) => fact.systemSettledAt !== null && matches.has(fact.id)).map((fact) => fact.flagId);
  const now = new Date();
  const updates = [];
  if (gone.length > 0) updates.push(db.update(factFlags)
    .set({ checkedAt: now, systemSettledAt: now, updatedAt: now })
    .where(and(eq(factFlags.userId, userId), inArray(factFlags.id, gone), isNull(factFlags.checkedAt))));
  if (restored.length > 0) updates.push(db.update(factFlags)
    .set({ checkedAt: null, systemSettledAt: null, updatedAt: now })
    .where(and(eq(factFlags.userId, userId), inArray(factFlags.id, restored), isNotNull(factFlags.systemSettledAt))));
  if (updates.length > 0) await db.batch(updates as any);
}
