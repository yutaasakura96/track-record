/**
 * Employers and projects (`docs/07-api-design.md` §4).
 *
 * The tracer needs one employer and optionally one project, so this is the M1
 * half: read, create, edit. Deletion is M2 and carries the `409 conflict` rule
 * that facts are never silently orphaned.
 */
import type { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { employers, projects } from "../db/schema";
import { notFound, pathParam } from "../http/errors";
import { routes } from "../http/registry";
import { newId } from "../http/ids";
import { parseBody } from "../services/validate";
import { monthDate } from "./profile";
import type { AppEnv } from "../env";
import type { Db } from "../db/client";

const employerBody = z.object({
  nameJa: z.string().trim().min(1, "An employer name is required."),
  nameLatin: z.string().trim().nullish(),
  industryJa: z.string().trim().nullish(),
  businessDescription: z.string().trim().nullish(),
  /** 資本金 in YEN, not 万円. Formatting happens at render time. */
  capitalYen: z.number().int().nonnegative().nullish(),
  headcount: z.number().int().nonnegative().nullish(),
  employmentType: z.enum(["full_time", "contract", "dispatch", "part_time", "independent"]),
  startedOn: monthDate,
  /** `null` = current employer. */
  endedOn: monthDate.nullish(),
  leavingReasonJa: z.string().trim().nullish(),
});

const projectBody = z.object({
  name: z.string().trim().min(1, "A project name is required."),
  nameJa: z.string().trim().nullish(),
  /** Nullable, and load-bearing: `null` means an independent project. */
  employerId: z.string().trim().nullish(),
  summary: z.string().trim().nullish(),
  startedOn: monthDate.nullish(),
  endedOn: monthDate.nullish(),
  clientIsNamed: z.boolean().default(false),
});

export function registerRecordRoutes(app: Hono<AppEnv>) {
  const api = routes(app);

  api.get("/api/employers", async (c) => {
    const rows = await c
      .get("db")
      .select()
      .from(employers)
      .where(eq(employers.userId, c.get("user").id))
      .orderBy(desc(employers.startedOn));
    return c.json({ items: rows.map(stripInternals) });
  });

  api.post("/api/employers", async (c) => {
    const body = await parseBody(c, employerBody);
    const [row] = await c
      .get("db")
      .insert(employers)
      .values({ id: newId("employer"), userId: c.get("user").id, ...nullish(body) })
      .returning();
    return c.json(stripInternals(row!), 201);
  });

  api.patch("/api/employers/:id", async (c) => {
    const body = await parseBody(c, employerBody.partial());
    const [row] = await c
      .get("db")
      .update(employers)
      .set({ ...nullish(body), updatedAt: new Date() })
      .where(and(eq(employers.userId, c.get("user").id), eq(employers.id, pathParam(c, "id"))))
      .returning();
    if (!row) throw notFound("That employer");
    return c.json(stripInternals(row));
  });

  api.get("/api/projects", async (c) => {
    const rows = await c
      .get("db")
      .select()
      .from(projects)
      .where(eq(projects.userId, c.get("user").id))
      .orderBy(desc(projects.createdAt));
    return c.json({ items: rows.map(stripInternals) });
  });

  api.post("/api/projects", async (c) => {
    const body = await parseBody(c, projectBody);
    const user = c.get("user");
    if (body.employerId) await assertOwnedEmployer(c.get("db"), user.id, body.employerId);
    const [row] = await c
      .get("db")
      .insert(projects)
      .values({ id: newId("project"), userId: user.id, ...nullish(body) })
      .returning();
    return c.json(stripInternals(row!), 201);
  });

  api.patch("/api/projects/:id", async (c) => {
    const body = await parseBody(c, projectBody.partial());
    if (body.employerId) await assertOwnedEmployer(c.get("db"), c.get("user").id, body.employerId);
    const [row] = await c
      .get("db")
      .update(projects)
      .set({ ...nullish(body), updatedAt: new Date() })
      .where(and(eq(projects.userId, c.get("user").id), eq(projects.id, pathParam(c, "id"))))
      .returning();
    if (!row) throw notFound("That project");
    return c.json(stripInternals(row));
  });
}

/**
 * A foreign key alone would let one user attach a project to another user's
 * employer. Ownership is checked in the same query that reads it, and a miss is
 * a 404 — never a 403, which would confirm the row exists.
 */
async function assertOwnedEmployer(db: Db, userId: string, employerId: string) {
  const [row] = await db
    .select({ id: employers.id })
    .from(employers)
    .where(and(eq(employers.userId, userId), eq(employers.id, employerId)))
    .limit(1);
  if (!row) throw notFound("That employer");
}

/** `undefined` means "not supplied"; `null` means "clear it". Zod's nullish gives both. */
function nullish<T extends Record<string, unknown>>(body: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) if (value !== undefined) out[key] = value;
  return out as T;
}

function stripInternals<T extends { userId: string; createdAt: Date; updatedAt: Date }>(row: T) {
  const { userId, createdAt, updatedAt, ...rest } = row;
  void userId;
  void createdAt;
  void updatedAt;
  return rest;
}
