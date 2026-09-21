/**
 * Employers, roles and projects (`docs/07-api-design.md` §4).
 *
 * These are ENTERED, not derived. A career has a handful of employers and that
 * number does not grow; facts arrive in hundreds per import. Automate what
 * scales, hand-enter what does not — so there is no extraction path here and
 * deliberately never was (issue #14).
 *
 * Deletion carries the rule that facts are never silently orphaned: an employer
 * still referenced by a fact, a role or a project answers `409 conflict` with
 * the COUNTS of what is in the way, never their content. A project refuses the
 * same way, counting the facts and the source documents filed under it.
 */
import type { Hono } from "hono";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { employers, facts, projects, roles, sourceDocuments } from "../db/schema";
import { conflict, notFound, pathParam } from "../http/errors";
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

/**
 * A promotion is a SECOND ROW, not an edit to the first (`docs/04` §3.4), so
 * `employerId` is required and multiple roles per employer is the normal case.
 */
const roleBody = z.object({
  employerId: z.string().trim().min(1, "A role belongs to an employer."),
  titleJa: z.string().trim().nullish(),
  titleLatin: z.string().trim().nullish(),
  /** 職種 */
  shokushuJa: z.string().trim().nullish(),
  startedOn: monthDate,
  endedOn: monthDate.nullish(),
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

  /**
   * The `on delete restrict` foreign keys would refuse this anyway, as a
   * database error nobody could act on. The counts are read first so the
   * refusal can say what is attached and how much of it (`docs/07` §4).
   */
  api.delete("/api/employers/:id", async (c) => {
    const userId = c.get("user").id;
    const db = c.get("db");
    const id = pathParam(c, "id");
    await requireOwnedEmployer(db, userId, id);

    const attached = await countReferences(db, userId, id);
    if (attached.facts + attached.roles + attached.projects > 0) {
      throw conflict(
        `This employer has ${describe(attached)} attached. Reassign them before deleting.`,
        { ...attached },
      );
    }

    await db.delete(employers).where(and(eq(employers.userId, userId), eq(employers.id, id)));
    return c.body(null, 204);
  });

  api.get("/api/roles", async (c) => {
    const rows = await c
      .get("db")
      .select()
      .from(roles)
      .where(eq(roles.userId, c.get("user").id))
      .orderBy(desc(roles.startedOn), asc(roles.id));
    return c.json({ items: rows.map(stripInternals) });
  });

  api.post("/api/roles", async (c) => {
    const body = await parseBody(c, roleBody);
    const userId = c.get("user").id;
    await requireOwnedEmployer(c.get("db"), userId, body.employerId);
    const [row] = await c
      .get("db")
      .insert(roles)
      .values({ id: newId("role"), userId, ...nullish(body) })
      .returning();
    return c.json(stripInternals(row!), 201);
  });

  api.patch("/api/roles/:id", async (c) => {
    const body = await parseBody(c, roleBody.partial());
    const userId = c.get("user").id;
    if (body.employerId) await requireOwnedEmployer(c.get("db"), userId, body.employerId);
    const [row] = await c
      .get("db")
      .update(roles)
      .set({ ...nullish(body), updatedAt: new Date() })
      .where(and(eq(roles.userId, userId), eq(roles.id, pathParam(c, "id"))))
      .returning();
    if (!row) throw notFound("That role");
    return c.json(stripInternals(row));
  });

  /** Nothing references a role, so this needs no conflict check. */
  api.delete("/api/roles/:id", async (c) => {
    const [row] = await c
      .get("db")
      .delete(roles)
      .where(and(eq(roles.userId, c.get("user").id), eq(roles.id, pathParam(c, "id"))))
      .returning({ id: roles.id });
    if (!row) throw notFound("That role");
    return c.body(null, 204);
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
    if (body.employerId) await requireOwnedEmployer(c.get("db"), user.id, body.employerId);
    const [row] = await c
      .get("db")
      .insert(projects)
      .values({ id: newId("project"), userId: user.id, ...nullish(body) })
      .returning();
    return c.json(stripInternals(row!), 201);
  });

  api.patch("/api/projects/:id", async (c) => {
    const body = await parseBody(c, projectBody.partial());
    if (body.employerId) await requireOwnedEmployer(c.get("db"), c.get("user").id, body.employerId);
    const [row] = await c
      .get("db")
      .update(projects)
      .set({ ...nullish(body), updatedAt: new Date() })
      .where(and(eq(projects.userId, c.get("user").id), eq(projects.id, pathParam(c, "id"))))
      .returning();
    if (!row) throw notFound("That project");
    return c.json(stripInternals(row));
  });

  /**
   * A project is referenced by facts and by the documents filed under it, both
   * `on delete restrict`. The counts are read first so the refusal can say what
   * is in the way, exactly as an employer's does (`docs/07` §4).
   *
   * The documents count is not hypothetical, and the remedy is real: a document
   * is filed under a project at import and `PATCH /api/source-documents/:id`
   * moves it afterwards (`docs/06`, 2026-09-21), taking its facts with it. A
   * project with documents is refused until they are refiled.
   */
  api.delete("/api/projects/:id", async (c) => {
    const userId = c.get("user").id;
    const db = c.get("db");
    const id = pathParam(c, "id");
    await requireOwnedProject(db, userId, id);

    const attached = await countProjectReferences(db, userId, id);
    if (attached.facts + attached.documents > 0) {
      // A document names the control that moves it, because the author has to
      // find it on Screen 8 rather than on the screen they are refused on.
      // Every fact with a project came from a document, so a facts-only
      // refusal is the employer wording and unreachable through a document.
      const remedy = attached.documents
        ? "Refile them from Documents before deleting."
        : "Reassign them before deleting.";
      throw conflict(`This project has ${describe(attached)} attached. ${remedy}`, { ...attached });
    }

    await db.delete(projects).where(and(eq(projects.userId, userId), eq(projects.id, id)));
    return c.body(null, 204);
  });
}

type Attached = {
  facts: number;
  roles: number;
  projects: number;
};

/** Counts only. A conflict says how much is in the way, never what it says. */
async function countReferences(db: Db, userId: string, employerId: string): Promise<Attached> {
  const n = sql<number>`count(*)::int`;
  const [factRows, roleRows, projectRows] = await Promise.all([
    db
      .select({ n })
      .from(facts)
      .where(and(eq(facts.userId, userId), eq(facts.employerId, employerId))),
    db
      .select({ n })
      .from(roles)
      .where(and(eq(roles.userId, userId), eq(roles.employerId, employerId))),
    db
      .select({ n })
      .from(projects)
      .where(and(eq(projects.userId, userId), eq(projects.employerId, employerId))),
  ]);
  return {
    facts: factRows[0]?.n ?? 0,
    roles: roleRows[0]?.n ?? 0,
    projects: projectRows[0]?.n ?? 0,
  };
}

/**
 * `3 facts, 2 roles and 1 project`. Counts only, in the order the caller built
 * them, so an employer's refusal and a project's read the same way.
 */
const describe = (attached: Record<string, number>) =>
  Object.entries(attached)
    .filter(([, n]) => n > 0)
    .map(([key, n]) => `${n} ${n === 1 ? key.slice(0, -1) : key}`)
    .join(", ")
    .replace(/, ([^,]*)$/, " and $1");

/** Counts only, as an employer's are. */
async function countProjectReferences(db: Db, userId: string, projectId: string) {
  const n = sql<number>`count(*)::int`;
  const [factRows, documentRows] = await Promise.all([
    db
      .select({ n })
      .from(facts)
      .where(and(eq(facts.userId, userId), eq(facts.projectId, projectId))),
    db
      .select({ n })
      .from(sourceDocuments)
      .where(and(eq(sourceDocuments.userId, userId), eq(sourceDocuments.projectId, projectId))),
  ]);
  return { facts: factRows[0]?.n ?? 0, documents: documentRows[0]?.n ?? 0 };
}

/** A miss is a 404, never a 403, which would confirm the row exists. */
async function requireOwnedProject(db: Db, userId: string, projectId: string) {
  const [row] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.userId, userId), eq(projects.id, projectId)))
    .limit(1);
  if (!row) throw notFound("That project");
}

/**
 * A foreign key alone would let one user attach a role, a project or a fact to
 * another user's employer. Ownership is checked in the same query that reads
 * it, and a miss is a 404 — never a 403, which would confirm the row exists.
 */
export async function requireOwnedEmployer(db: Db, userId: string, employerId: string) {
  const [row] = await db
    .select({ id: employers.id })
    .from(employers)
    .where(and(eq(employers.userId, userId), eq(employers.id, employerId)))
    .limit(1);
  if (!row) throw notFound("That employer");
}

/** `undefined` means "not supplied"; `null` means "clear it". Zod's nullish gives both. */
export function nullish<T extends Record<string, unknown>>(body: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) if (value !== undefined) out[key] = value;
  return out as T;
}

export function stripInternals<T extends { userId: string; createdAt: Date; updatedAt: Date }>(
  row: T,
) {
  const { userId, createdAt, updatedAt, ...rest } = row;
  void userId;
  void createdAt;
  void updatedAt;
  return rest;
}
