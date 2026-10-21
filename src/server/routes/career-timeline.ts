/**
 * The career timeline's counts (`docs/07-api-design.md` §4, issue #113).
 *
 * Screen 4 reads its rows from the five collections; this answers what none of
 * them holds: how many accepted facts back each employer and project, where
 * they came from, and the gaps the 履歴書 would warn about. Counts and months
 * only — never a claim — and built on the read, as the career record is.
 */
import type { Hono } from "hono";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { facts, sourceDocumentVersions } from "../db/schema";
import { routes } from "../http/registry";
import { effectiveEmployerId } from "../services/employer";
import { collectRirekishoRecord } from "../services/rirekisho";
import { unexplainedGaps } from "~/render/rirekisho";
import type { CareerTimeline } from "~/shared/career-timeline";
import type { AppEnv } from "../env";

export function registerCareerTimelineRoutes(app: Hono<AppEnv>) {
  const api = routes(app);

  api.get("/api/career-timeline", async (c) => {
    const db = c.get("db");
    const userId = c.get("user").id;
    const n = sql<number>`count(*)::int`;
    // Accepted is the career record's rule too: a rejected fact was ruled out,
    // and nothing waits as a candidate once it is imported (issue #57).
    const accepted = and(eq(facts.userId, userId), eq(facts.status, "accepted"));

    // The rows the 履歴書 prints, its exclusions applied, so the warning here
    // is the one its download would carry. Read beside the counts, not after.
    const [[byEmployer, byProject], rirekisho] = await Promise.all([
      db.batch([
        db
          .select({
            id: effectiveEmployerId,
            achievements: n,
            unfiled: sql<number>`(count(*) filter (where ${facts.projectId} is null))::int`,
            documents: sql<number>`count(distinct ${sourceDocumentVersions.sourceDocumentId})::int`,
          })
          .from(facts)
          .leftJoin(
            sourceDocumentVersions,
            and(eq(sourceDocumentVersions.id, facts.sourceDocumentVersionId), eq(sourceDocumentVersions.userId, userId)),
          )
          .where(and(accepted, isNotNull(effectiveEmployerId)))
          .groupBy(effectiveEmployerId),
        db
          .select({ id: facts.projectId, achievements: n })
          .from(facts)
          .where(and(accepted, isNotNull(facts.projectId)))
          .groupBy(facts.projectId),
      ]),
      collectRirekishoRecord(db, userId),
    ]);

    const body: CareerTimeline = {
      employers: byEmployer.map((row) => ({ ...row, id: row.id! })),
      projects: byProject.map((row) => ({ ...row, id: row.id! })),
      gaps: unexplainedGaps(rirekisho),
    };
    return c.json(body);
  });
}
