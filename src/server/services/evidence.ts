/**
 * What stands behind each line of a page (issue #110, S6): the facts a page's
 * blocks cite, with each fact's employer and the passage it was read from.
 *
 * Looked up for a page that has already passed the download's refusal
 * (`refuseWithheldCitations`), so every id it is given is an accepted fact
 * that may reach a document. An id it cannot find is left out rather than
 * refused; the reader says so under the line.
 */
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { employers, facts, sourceDocuments, sourceDocumentVersions } from "../db/schema";
import { effectiveEmployerId } from "./employer";
import { nameInLanguage } from "./render";
import type { FactEvidence } from "~/shared/evidence";

export async function factEvidence(
  db: Db,
  userId: string,
  factIds: readonly string[],
  language: "en" | "ja",
): Promise<FactEvidence[]> {
  if (factIds.length === 0) return [];

  const rows = await db
    .select({
      id: facts.id,
      claim: facts.claim,
      provenance: facts.provenance,
      quote: facts.quote,
      lineNumber: facts.lineNumber,
      importId: facts.sourceDocumentVersionId,
      filename: sourceDocuments.filename,
      employerJa: employers.nameJa,
      employerLatin: employers.nameLatin,
    })
    .from(facts)
    .leftJoin(
      sourceDocumentVersions,
      and(eq(sourceDocumentVersions.id, facts.sourceDocumentVersionId), eq(sourceDocumentVersions.userId, userId)),
    )
    .leftJoin(
      sourceDocuments,
      and(eq(sourceDocuments.id, sourceDocumentVersions.sourceDocumentId), eq(sourceDocuments.userId, userId)),
    )
    .leftJoin(employers, and(eq(employers.id, effectiveEmployerId), eq(employers.userId, userId)))
    .where(and(eq(facts.userId, userId), inArray(facts.id, [...factIds])));

  const byId = new Map(rows.map((row) => [row.id, row]));
  return factIds.flatMap((id): FactEvidence[] => {
    const row = byId.get(id);
    // A Generated fact is refused before this, as a missing one is; neither
    // is shown as a fact it is not.
    if (!row || row.provenance === "generated") return [];
    return [
      {
        id: row.id,
        claim: row.claim,
        provenance: row.provenance,
        employer: row.employerJa === null ? null : nameInLanguage(language, row.employerJa, row.employerLatin),
        quote: row.quote,
        source:
          row.importId && row.filename
            ? { importId: row.importId, filename: row.filename, lineNumber: row.lineNumber }
            : null,
      },
    ];
  });
}
