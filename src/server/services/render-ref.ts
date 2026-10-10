/**
 * Which document a render route is about.
 *
 * A main document is addressed by its kind: there is one per kind, and it is
 * listed whether or not it has ever been generated. A tailored résumé
 * (issue #57) is addressed by its own id, because there may be any number of
 * them and all share a kind. One path segment carries either, so every route a
 * main document has (generate, history, compare, restore, edit, download) is
 * a route a tailored résumé has too, with nothing written twice.
 */
import { and, eq, isNotNull, isNull, type SQL } from "drizzle-orm";
import type { Db } from "../db/client";
import { renders } from "../db/schema";
import { notFound } from "../http/errors";
import { RENDER_KINDS, RENDER_TITLE, type RenderKind } from "~/shared/render-content";

export interface RenderRef {
  /** What the route was addressed by: a kind, or a tailored résumé's id. */
  ref: string;
  kind: RenderKind;
  /** `null` only for a main document that has never been generated. */
  render: typeof renders.$inferSelect | null;
  /** What screens and refusals call it. */
  title: string;
  /** The job description a tailored résumé is written toward. `null` on a main document. */
  jobDescription: string | null;
}

const isKind = (value: string): value is RenderKind => (RENDER_KINDS as readonly string[]).includes(value);

/** The main document of a kind: the one row of that kind that is not tailored. */
export const mainRender = (userId: string, kind: RenderKind): SQL =>
  and(eq(renders.userId, userId), eq(renders.kind, kind), isNull(renders.jobDescription))!;

/** What a tailored résumé is called wherever a main document's title would stand. */
export const tailoredTitle = (label: string | null) => `Résumé for ${label ?? "a job"}`;

/**
 * A miss is a 404 either way, and so is another user's id: the read is
 * filtered by `user_id`, and saying a row exists would confirm it.
 */
export async function resolveRender(db: Db, userId: string, ref: string | undefined): Promise<RenderRef> {
  if (!ref) throw notFound("That document");

  if (isKind(ref)) {
    const [render] = await db.select().from(renders).where(mainRender(userId, ref)).limit(1);
    return { ref, kind: ref, render: render ?? null, title: RENDER_TITLE[ref], jobDescription: null };
  }

  const [render] = await db
    .select()
    .from(renders)
    .where(and(eq(renders.userId, userId), eq(renders.id, ref), isNotNull(renders.jobDescription)))
    .limit(1);
  if (!render) throw notFound("That document");
  return {
    ref,
    kind: render.kind as RenderKind,
    render,
    title: tailoredTitle(render.label),
    jobDescription: render.jobDescription,
  };
}

/** The ref a stored row is addressed by: its id when tailored, its kind when not. */
export const refOf = (render: Pick<typeof renders.$inferSelect, "id" | "kind" | "jobDescription">) =>
  render.jobDescription === null ? render.kind : render.id;

/** The title of a stored row, by the same rule {@link resolveRender} names it with. */
export const titleOf = (render: Pick<typeof renders.$inferSelect, "kind" | "jobDescription" | "label">) =>
  render.jobDescription === null ? RENDER_TITLE[render.kind as RenderKind] : tailoredTitle(render.label);
