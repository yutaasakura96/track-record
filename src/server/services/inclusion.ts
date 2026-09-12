/**
 * Per-render inclusion (S13, `docs/04` `render_inclusions`).
 *
 * An entry left out of one render is left out of THAT render's inputs and
 * nothing else. The record is untouched, every other render still reads it, and
 * the absence of a row means included — so an author who never opens the
 * setting sees no change anywhere, and the 履歴書's "everything by default" is
 * the table's default rather than a rule someone has to remember.
 *
 * Read once, at the two collectors, for the same reason the private and
 * generated filters run there: nothing downstream can reintroduce what it was
 * never given.
 */
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { renderInclusions } from "../db/schema";
import type { RenderKind } from "~/shared/render-content";

/** The three S13 names. A role follows its employer; certifications are not in it. */
export const INCLUDABLE_ENTITIES = ["employer", "education", "project"] as const;
export type IncludableEntity = (typeof INCLUDABLE_ENTITIES)[number];

export type Exclusions = Record<IncludableEntity, Set<string>>;

const isIncludable = (value: string): value is IncludableEntity =>
  (INCLUDABLE_ENTITIES as readonly string[]).includes(value);

export async function exclusionsFor(db: Db, userId: string, kind: RenderKind): Promise<Exclusions> {
  const rows = await db
    .select({ entityType: renderInclusions.entityType, entityId: renderInclusions.entityId })
    .from(renderInclusions)
    .where(
      and(
        eq(renderInclusions.userId, userId),
        eq(renderInclusions.kind, kind),
        eq(renderInclusions.included, false),
      ),
    );

  const excluded: Exclusions = { employer: new Set(), education: new Set(), project: new Set() };
  for (const row of rows) {
    if (isIncludable(row.entityType)) excluded[row.entityType].add(row.entityId);
  }
  return excluded;
}

/**
 * A project under an excluded employer leaves with it. Kept, it would reach the
 * model naming an employer the document has no section for, which is the shape
 * that produced every `unfiled-fact` finding S10 and S11 turned up.
 */
export function excludesProject(
  excluded: Exclusions,
  project: { id: string; employerId: string | null },
): boolean {
  return (
    excluded.project.has(project.id) ||
    (project.employerId !== null && excluded.employer.has(project.employerId))
  );
}
