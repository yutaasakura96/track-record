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
import { and, eq, inArray, isNotNull, isNull, type SQL } from "drizzle-orm";
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

/**
 * Marks checked every open `repeat` flag whose pair is gone: the other fact
 * was rejected, or one of the two was reworded or filed elsewhere. Called after
 * the writes that can do that, so the list never sends the author to a card
 * with one fact on it.
 */
export async function settleRepeats(db: Db, userId: string): Promise<void> {
  const open = await db
    .select({ ...factWithEmployer, flagId: factFlags.id })
    .from(factFlags)
    .innerJoin(facts, and(eq(facts.id, factFlags.factId), eq(facts.userId, factFlags.userId)))
    .where(
      and(
        eq(factFlags.userId, userId),
        eq(factFlags.kind, "repeat"),
        isNull(factFlags.checkedAt),
        eq(facts.status, "accepted"),
      ),
    );
  if (open.length === 0) return;
  const matches = await repeatsAmong(db, userId, open);
  const gone = open.filter((fact) => !matches.has(fact.id)).map((fact) => fact.flagId);
  if (gone.length === 0) return;
  await db
    .update(factFlags)
    .set({ checkedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(factFlags.userId, userId), inArray(factFlags.id, gone)));
}
