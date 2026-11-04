/**
 * Likely matches for the candidates on one page of the fact list
 * (`docs/07-api-design.md` §6, `docs/04` §3.12).
 *
 * Computed on every read and stored nowhere. What a candidate is compared with
 * — the accepted facts at its employer — changes with every accept, reject,
 * claim edit and employer pick, and those are the actions that settle a flag.
 * A stored pair would be stale after each (`docs/06`, 2026-09-28).
 *
 * Every query here filters by `user_id`, joins included. Nothing is logged:
 * the rows read are claims.
 */
import { and, eq, inArray } from "drizzle-orm";
import { facts, sourceDocumentVersions, sourceDocuments } from "../db/schema";
import { overlapMatcher, type OverlapFact } from "~/overlap";
import { effectiveEmployerId, type FactWithEmployer } from "./employer";

/** What the matcher reads of a fact it compares: the fields `matchesFor` uses, and no others. */
export type OverlapSubject = Pick<
  FactWithEmployer,
  "id" | "status" | "claim" | "technologies" | "sourceDocumentVersionId" | "resolvedEmployerId"
>;

/** The columns of {@link OverlapSubject}, for a select that hands facts to the matcher. */
export const overlapSubject = {
  id: facts.id,
  status: facts.status,
  claim: facts.claim,
  technologies: facts.technologies,
  sourceDocumentVersionId: facts.sourceDocumentVersionId,
  resolvedEmployerId: effectiveEmployerId,
};

interface PoolRow {
  id: string;
  claim: string;
  technologies: string[];
  employerId: string | null;
  sourceDocumentVersionId: string | null;
}

/**
 * The accepted facts at each employer, as one request read them. A request that
 * asks for matches more than once after its last write to `facts` — flag the
 * repeats, settle them, then answer with the card — passes one of these to
 * every call and reads each employer's pool once. Flags are written between
 * those calls, and facts are not, so the pool cannot have changed.
 *
 * Without one, each call reads afresh, as every call did before.
 */
export type OverlapPools = Map<string, PoolRow[]>;
import type { Db } from "../db/client";

export interface LikelyMatchResponse {
  id: string;
  claim: string;
  /** With `graded`, what lets the card offer the re-grade beside the match (issue #37). */
  provenance: (typeof facts.$inferSelect)["provenance"];
  graded: boolean;
  /** Where the match was extracted from. `null` for a fact with no source. */
  document: { importId: string; filename: string; versionNo: number } | null;
  conflict: boolean;
}

const NONE: ReadonlySet<string> = new Set();

/**
 * Keyed by fact id. A fact absent from the map has no likely matches: the
 * author has settled it, its employer does not resolve, or nothing is alike.
 *
 * Shown on a candidate, and on an accepted fact carrying an open `repeat` flag
 * (`repeatFlagged`, issue #57). The second is what a candidate's match became
 * when facts stopped being reviewed one by one: the flag is what says a pair
 * is still unsettled, and marking it checked is what takes the pair away.
 */
export async function likelyMatchesFor(
  db: Db,
  userId: string,
  page: readonly OverlapSubject[],
  repeatFlagged: ReadonlySet<string> = NONE,
  pools: OverlapPools = new Map(),
): Promise<Map<string, LikelyMatchResponse[]>> {
  return matchesFor(
    db,
    userId,
    page.filter(
      (fact) => fact.status === "candidate" || (fact.status === "accepted" && repeatFlagged.has(fact.id)),
    ),
    pools,
  );
}

/**
 * The same comparison for accepted facts, whatever flags they carry: what
 * decides whether a `repeat` flag is written or has outlived its pair
 * (`./repeats.ts`).
 */
export async function repeatsAmong(
  db: Db,
  userId: string,
  accepted: readonly OverlapSubject[],
  pools: OverlapPools = new Map(),
): Promise<Map<string, LikelyMatchResponse[]>> {
  return matchesFor(db, userId, accepted.filter((fact) => fact.status === "accepted"), pools);
}

async function matchesFor(
  db: Db,
  userId: string,
  open: readonly OverlapSubject[],
  pools: OverlapPools,
): Promise<Map<string, LikelyMatchResponse[]>> {
  const result = new Map<string, LikelyMatchResponse[]>();
  if (open.length === 0) return result;

  // Resolved by the select that read the page, in the order every reader uses.
  const employerOf = new Map<string, string>();
  for (const fact of open) if (fact.resolvedEmployerId !== null) employerOf.set(fact.id, fact.resolvedEmployerId);
  const employerIds = [...new Set(employerOf.values())];
  if (employerIds.length === 0) return result;

  // What the matcher compares, and nothing else: every accepted fact at these
  // employers is read here, on every card and every settle, so the columns that
  // only decorate a match — its grade, its document — are read below for the
  // matches alone (`docs/06`, 2026-11-04).
  const missing = employerIds.filter((id) => !pools.has(id));
  if (missing.length > 0) {
    const read = await db
      .select({
        id: facts.id,
        claim: facts.claim,
        technologies: facts.technologies,
        employerId: effectiveEmployerId,
        sourceDocumentVersionId: facts.sourceDocumentVersionId,
      })
      .from(facts)
      .where(
        and(
          eq(facts.userId, userId),
          eq(facts.status, "accepted"),
          inArray(effectiveEmployerId, missing),
        ),
      );
    for (const id of missing) pools.set(id, []);
    for (const row of read) pools.get(row.employerId!)!.push(row);
  }

  const byEmployer = new Map(employerIds.map((id) => [id, pools.get(id)!]));
  const matchers = new Map<string, (candidate: OverlapFact) => { id: string; conflict: boolean }[]>();
  const matched = new Map<string, { id: string; conflict: boolean }[]>();

  for (const candidate of open) {
    const employerId = employerOf.get(candidate.id);
    const pool = employerId === undefined ? undefined : byEmployer.get(employerId);
    if (employerId === undefined || pool === undefined) continue;
    // An accepted fact is in the pool itself, and so are the facts read from
    // the same version of the same document. Neither is "already in your
    // record" from where it stands, so it is matched against the rest.
    const key = candidate.status === "candidate" ? employerId : `${employerId}\0${candidate.sourceDocumentVersionId}`;
    let match = matchers.get(key);
    if (!match) {
      match = overlapMatcher(
        candidate.status === "candidate"
          ? pool
          : pool.filter(
              (row) =>
                row.sourceDocumentVersionId === null ||
                row.sourceDocumentVersionId !== candidate.sourceDocumentVersionId,
            ),
      );
      matchers.set(key, match);
    }
    const found = match(candidate);
    if (found.length === 0) continue;
    matched.set(candidate.id, found);
  }
  if (matched.size === 0) return result;

  // The matches, decorated: at most a few per card.
  const matchedIds = [...new Set([...matched.values()].flatMap((found) => found.map((match) => match.id)))];
  const decorations = await db
    .select({
      id: facts.id,
      provenance: facts.provenance,
      gradedAt: facts.gradedAt,
      autoAcceptedAt: facts.autoAcceptedAt,
      importId: sourceDocumentVersions.id,
      versionNo: sourceDocumentVersions.versionNo,
      filename: sourceDocuments.filename,
    })
    .from(facts)
    .leftJoin(
      sourceDocumentVersions,
      and(
        eq(sourceDocumentVersions.id, facts.sourceDocumentVersionId),
        eq(sourceDocumentVersions.userId, facts.userId),
      ),
    )
    .leftJoin(
      sourceDocuments,
      and(
        eq(sourceDocuments.id, sourceDocumentVersions.sourceDocumentId),
        eq(sourceDocuments.userId, facts.userId),
      ),
    )
    .where(and(eq(facts.userId, userId), inArray(facts.id, matchedIds)));
  const decorationOf = new Map(decorations.map((row) => [row.id, row]));
  const claimOf = new Map<string, string>();
  for (const pool of byEmployer.values()) for (const row of pool) claimOf.set(row.id, row.claim);

  for (const [candidateId, found] of matched) {
    result.set(
      candidateId,
      found.map(({ id, conflict }) => {
        const row = decorationOf.get(id)!;
        return {
          id,
          claim: claimOf.get(id)!,
          provenance: row.provenance,
          graded: row.gradedAt !== null || row.autoAcceptedAt !== null,
          document:
            row.importId !== null && row.filename !== null && row.versionNo !== null
              ? { importId: row.importId, filename: row.filename, versionNo: row.versionNo }
              : null,
          conflict,
        };
      }),
    );
  }
  return result;
}
