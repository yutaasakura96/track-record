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
import { effectiveEmployerId } from "./employer";
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

type FactRow = typeof facts.$inferSelect;

/**
 * Keyed by candidate id. A fact absent from the map has no likely matches:
 * it is not a candidate, its employer does not resolve, or nothing is alike.
 */
export async function likelyMatchesFor(
  db: Db,
  userId: string,
  page: readonly FactRow[],
): Promise<Map<string, LikelyMatchResponse[]>> {
  const result = new Map<string, LikelyMatchResponse[]>();
  const open = page.filter((fact) => fact.status === "candidate");
  if (open.length === 0) return result;

  const resolved = await db
    .select({ id: facts.id, employerId: effectiveEmployerId })
    .from(facts)
    .where(and(eq(facts.userId, userId), inArray(facts.id, open.map((fact) => fact.id))));
  const employerOf = new Map<string, string>();
  for (const row of resolved) if (row.employerId !== null) employerOf.set(row.id, row.employerId);
  const employerIds = [...new Set(employerOf.values())];
  if (employerIds.length === 0) return result;

  const existing = await db
    .select({
      id: facts.id,
      claim: facts.claim,
      provenance: facts.provenance,
      gradedAt: facts.gradedAt,
      technologies: facts.technologies,
      employerId: effectiveEmployerId,
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
    .where(
      and(
        eq(facts.userId, userId),
        eq(facts.status, "accepted"),
        inArray(effectiveEmployerId, employerIds),
      ),
    );

  const byEmployer = new Map<string, typeof existing>();
  for (const row of existing) {
    const group = byEmployer.get(row.employerId!) ?? [];
    group.push(row);
    byEmployer.set(row.employerId!, group);
  }
  const byId = new Map(existing.map((row) => [row.id, row]));
  const matchers = new Map<string, (candidate: OverlapFact) => { id: string; conflict: boolean }[]>();

  for (const candidate of open) {
    const employerId = employerOf.get(candidate.id);
    const pool = employerId === undefined ? undefined : byEmployer.get(employerId);
    if (employerId === undefined || pool === undefined) continue;
    let match = matchers.get(employerId);
    if (!match) {
      match = overlapMatcher(pool);
      matchers.set(employerId, match);
    }
    const found = match(candidate);
    if (found.length === 0) continue;
    result.set(
      candidate.id,
      found.map(({ id, conflict }) => {
        const row = byId.get(id)!;
        return {
          id,
          claim: row.claim,
          provenance: row.provenance,
          graded: row.gradedAt !== null,
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
