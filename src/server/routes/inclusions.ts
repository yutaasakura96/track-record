/**
 * Per-render inclusion (`docs/07-api-design.md`, S13).
 *
 * `GET` answers with the stored rows only. A missing row means included, and
 * the client reads it that way, so there is no expansion to five kinds times
 * every entry here for the two sides to disagree about.
 *
 * `PUT` writes one setting. Setting an entry back to included keeps the row
 * with `included = true` rather than deleting it; the answer is the same and
 * nothing is removed.
 */
import type { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { educations, employers, projects, renderInclusions } from "../db/schema";
import { notFound } from "../http/errors";
import { routes } from "../http/registry";
import { parseBody } from "../services/validate";
import { INCLUDABLE_ENTITIES, type IncludableEntity } from "../services/inclusion";
import { RENDER_KINDS } from "~/shared/render-content";
import type { AppEnv } from "../env";
import type { Db } from "../db/client";

const inclusionBody = z.object({
  entityType: z.enum(INCLUDABLE_ENTITIES),
  entityId: z.string().trim().min(1, "An entry is required."),
  kind: z.enum(RENDER_KINDS),
  included: z.boolean(),
});

export function registerInclusionRoutes(app: Hono<AppEnv>) {
  const api = routes(app);

  api.get("/api/render-inclusions", async (c) => {
    const rows = await c
      .get("db")
      .select({
        entityType: renderInclusions.entityType,
        entityId: renderInclusions.entityId,
        kind: renderInclusions.kind,
        included: renderInclusions.included,
      })
      .from(renderInclusions)
      .where(eq(renderInclusions.userId, c.get("user").id));
    return c.json({ items: rows });
  });

  api.put("/api/render-inclusions", async (c) => {
    const body = await parseBody(c, inclusionBody);
    const userId = c.get("user").id;
    const db = c.get("db");
    await requireOwnedEntry(db, userId, body.entityType, body.entityId);

    await db
      .insert(renderInclusions)
      .values({ userId, ...body })
      .onConflictDoUpdate({
        target: [
          renderInclusions.userId,
          renderInclusions.entityType,
          renderInclusions.entityId,
          renderInclusions.kind,
        ],
        set: { included: body.included, updatedAt: new Date() },
      });
    return c.json(body);
  });
}

/**
 * The table carries no foreign key to the entry, because one column names three
 * tables. Ownership is therefore checked here, and a miss is a 404 for the same
 * reason `requireOwnedEmployer` gives: a 403 would confirm the row exists.
 */
async function requireOwnedEntry(db: Db, userId: string, type: IncludableEntity, id: string) {
  const table = { employer: employers, education: educations, project: projects }[type];
  const [row] = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.userId, userId), eq(table.id, id)))
    .limit(1);
  if (!row) throw notFound(`That ${type}`);
}
