/**
 * The career timeline's counts (`docs/07-api-design.md` §4, issue #113), and
 * the author's explanations of the 履歴書's gaps (issue #117).
 *
 * Screen 4 reads its rows from the five collections; this answers what none of
 * them holds: how many accepted facts back each employer and project, where
 * they came from, and the gaps the 履歴書 would warn about. Counts and months
 * only — never a claim — and built on the read, as the career record is.
 *
 * A gap is answered with a ※ row (`career_gap_notes`), written and removed
 * here. Writing a second note for the same months replaces the first: a gap
 * has one explanation, and editing it is writing it again.
 */
import type { Hono } from "hono";
import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { careerGapNotes, facts, sourceDocumentVersions } from "../db/schema";
import { notFound, pathParam, validationFailed } from "../http/errors";
import { newId } from "../http/ids";
import { routes } from "../http/registry";
import { effectiveEmployerId } from "../services/employer";
import { collectRirekishoRecord } from "../services/rirekisho";
import { parseBody } from "../services/validate";
import { monthDate } from "./profile";
import { explainedGaps, unexplainedGaps } from "~/render/rirekisho";
import { GAP_NOTE_MAX } from "~/shared/career-gap";
import type { CareerTimeline } from "~/shared/career-timeline";
import type { AppEnv } from "../env";

const gapNoteBody = z.object({
  fromOn: monthDate,
  toOn: monthDate,
  text: z
    .string()
    .trim()
    .min(1, "Write what you were doing.")
    .max(GAP_NOTE_MAX, `Keep it to ${GAP_NOTE_MAX} characters: it is one row of the 履歴書.`),
});

const noteColumns = {
  id: careerGapNotes.id,
  fromOn: careerGapNotes.fromOn,
  toOn: careerGapNotes.toOn,
  text: careerGapNotes.text,
};

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
    const [[byEmployer, byProject], rirekisho, notes] = await Promise.all([
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
      // With their ids, which the record's own read does not carry.
      db.select(noteColumns).from(careerGapNotes).where(eq(careerGapNotes.userId, userId)).orderBy(asc(careerGapNotes.fromOn)),
    ]);

    const explained = explainedGaps(rirekisho).map(({ gap, note }) => ({
      gap,
      note: notes.find((n) => n.fromOn === note.fromOn && n.toOn === note.toOn)!,
    }));
    const body: CareerTimeline = {
      employers: byEmployer.map((row) => ({ ...row, id: row.id! })),
      projects: byProject.map((row) => ({ ...row, id: row.id! })),
      gaps: unexplainedGaps(rirekisho),
      explained,
      staleNotes: notes.filter((n) => !explained.some((e) => e.note.id === n.id)),
    };
    return c.json(body);
  });

  api.post("/api/gap-notes", async (c) => {
    const body = await parseBody(c, gapNoteBody);
    if (body.fromOn > body.toOn) {
      throw validationFailed("A gap ends on or after the month it starts.", ["toOn"]);
    }
    const userId = c.get("user").id;
    const [row] = await c
      .get("db")
      .insert(careerGapNotes)
      .values({ id: newId("careerGapNote"), userId, ...body })
      .onConflictDoUpdate({
        target: [careerGapNotes.userId, careerGapNotes.fromOn, careerGapNotes.toOn],
        set: { text: body.text, updatedAt: new Date() },
      })
      .returning(noteColumns);
    return c.json(row, 201);
  });

  /** The record's own words, so the author may take them back. Nothing else points at a note. */
  api.delete("/api/gap-notes/:id", async (c) => {
    const [row] = await c
      .get("db")
      .delete(careerGapNotes)
      .where(and(eq(careerGapNotes.userId, c.get("user").id), eq(careerGapNotes.id, pathParam(c, "id"))))
      .returning({ id: careerGapNotes.id });
    if (!row) throw notFound("That explanation");
    return c.body(null, 204);
  });
}
