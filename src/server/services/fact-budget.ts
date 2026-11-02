/**
 * How many facts one document is sent, and which (`docs/06`, 2026-11-02).
 *
 * A record of thousands of facts cannot all go to the model. About 7,000 pass
 * its context window, and well before that each document costs dollars, again
 * on every regeneration and every tailored document. So each employer has a
 * budget, and so do the facts filed under none, which keeps a thin employer's
 * section from being crowded out by a thick one's.
 *
 * Only an employer over its budget loses anything. What it keeps is chosen in
 * tiers, best first, and the last tier that fits only in part is sampled evenly
 * through its documents, so a budget that runs out does not read as a portfolio
 * whose later case studies were never written.
 *
 * A fact left out here is still usable: staleness and the skills list read the
 * whole set. This chooses what the model reads, and nothing else.
 */
import { and, eq, isNull } from "drizzle-orm";
import { factFlags } from "../db/schema";
import type { Db } from "../db/client";

/**
 * Per employer, and once more for the facts filed under none. Four employers
 * send at most 750 facts: at about 150 tokens each, 112,500 input tokens, or
 * about $0.56 of input a document.
 */
export const FACTS_PER_EMPLOYER = 150;

export interface BudgetedFact {
  id: string;
  employerId: string | null;
  sourceDocumentVersionId: string | null;
  quoteStart: number | null;
}

/** Where a fact sits in what it was read from, so taking every nth one spreads across it. */
const bySourcePosition = (a: BudgetedFact, b: BudgetedFact): number =>
  (a.sourceDocumentVersionId ?? "").localeCompare(b.sourceDocumentVersionId ?? "") ||
  (a.quoteStart ?? 0) - (b.quoteStart ?? 0) ||
  a.id.localeCompare(b.id);

/** `count` of a list already in order, evenly spaced through it. */
const evenly = <T>(sorted: T[], count: number): T[] =>
  Array.from({ length: count }, (_, i) => sorted[Math.floor((i * sorted.length) / count)]!);

/**
 * The facts one employer keeps. Lower tiers are kept first:
 *
 * - a fact with no open flag before one the importer flagged for a look;
 * - a repeat after everything else, since what it says is said by another fact
 *   (a flag the author checked no longer counts: they ruled on it).
 */
export function chooseFacts<T extends BudgetedFact>(
  facts: T[],
  openFlags: ReadonlyMap<string, ReadonlySet<string>>,
  budget: number = FACTS_PER_EMPLOYER,
): T[] {
  if (facts.length <= budget) return facts;
  const tierOf = (fact: T): number => {
    const open = openFlags.get(fact.id);
    return open?.has("repeat") ? 2 : open && open.size > 0 ? 1 : 0;
  };
  const tiers = new Map<number, T[]>();
  for (const fact of facts) {
    const tier = tierOf(fact);
    const held = tiers.get(tier);
    if (held) held.push(fact);
    else tiers.set(tier, [fact]);
  }

  const kept: T[] = [];
  for (const [, tier] of [...tiers].sort(([a], [b]) => a - b)) {
    const room = budget - kept.length;
    if (room <= 0) break;
    kept.push(...evenly(tier.sort(bySourcePosition), Math.min(room, tier.length)));
  }
  return kept;
}

/** The facts a document is sent, in the order they came. */
export async function factsWithinBudget<T extends BudgetedFact>(
  db: Db,
  userId: string,
  facts: T[],
): Promise<T[]> {
  const byEmployer = new Map<string | null, T[]>();
  for (const fact of facts) {
    const held = byEmployer.get(fact.employerId);
    if (held) held.push(fact);
    else byEmployer.set(fact.employerId, [fact]);
  }
  if ([...byEmployer.values()].every((held) => held.length <= FACTS_PER_EMPLOYER)) return facts;

  const flags = await db
    .select({ factId: factFlags.factId, kind: factFlags.kind })
    .from(factFlags)
    .where(and(eq(factFlags.userId, userId), isNull(factFlags.checkedAt)));
  const openFlags = new Map<string, Set<string>>();
  for (const { factId, kind } of flags) {
    const open = openFlags.get(factId);
    if (open) open.add(kind);
    else openFlags.set(factId, new Set([kind]));
  }

  const kept = new Set(
    [...byEmployer.values()].flatMap((held) => chooseFacts(held, openFlags).map((fact) => fact.id)),
  );
  return facts.filter((fact) => kept.has(fact.id));
}
