/**
 * Educations and certifications (`docs/07-api-design.md` §4).
 *
 * Two forms, not one (`docs/10`): an education carries an **outcome**, and a
 * certification follows the shape the author already maintains on LinkedIn.
 * They are separate tables for the same reason they are separate forms — the
 * 履歴書 学歴 rows derive from an education and nothing else does.
 *
 * Nothing references either table, so deletion here needs no conflict check.
 */
import type { Hono } from "hono";
import { asc, and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { certifications, educations } from "../db/schema";
import { notFound, pathParam } from "../http/errors";
import { routes } from "../http/registry";
import { newId } from "../http/ids";
import { parse, parseBody } from "../services/validate";
import { monthDate } from "./profile";
import { nullish, stripInternals } from "./record";
import type { AppEnv } from "../env";

/**
 * `outcome` is NOT decoration. 履歴書 convention requires a withdrawal to read
 * 中退 rather than 卒業, and rendering it wrong is a misrepresentation rather
 * than a formatting slip (`docs/04` §3.8). `endedOn` is null only for a course
 * still running, which is what `expected` means.
 */
/** The rung. Mirrors the `education_level` enum in `db/schema.ts`. */
const educationLevel = z.enum([
  "secondary_lower", "secondary_upper", "vocational", "tertiary", "postgraduate",
]);

const educationFields = z.object({
  institution: z.string().trim().min(1, "An institution name is required."),
  institutionJa: z.string().trim().nullish(),
  /** 学部・学科 — appears on the 履歴書 closing line. */
  faculty: z.string().trim().nullish(),
  degree: z.string().trim().nullish(),
  fieldOfStudy: z.string().trim().nullish(),
  /**
   * Optional, because the author's own 学歴 table records one row as a
   * graduation month with no matching entry month. Requiring it did not
   * produce the missing value; it kept a real row out of the record
   * (`docs/06`, 2026-09-06).
   */
  startedOn: monthDate.nullish(),
  endedOn: monthDate.nullish(),
  outcome: z.enum(["graduated", "completed", "withdrawn", "expected"]),
  /**
   * Required on a row this endpoint CREATES, although the column is nullable.
   * The résumé register asks whether a row is below university level, and
   * before this field the only answer available was the institution's name —
   * which reads "College" on a senior high school (`docs/06`, 2026-09-06).
   * Every row entered from now on answers it from the record.
   */
  level: educationLevel,
});

/**
 * The same row as it may already EXIST. A row entered before migration 0006
 * carries no level, and the column is nullable precisely because a migration
 * cannot classify one. Validating a PATCH against the create schema refused
 * every such row — a patch naming only `degree` came back 422 on `level`, a
 * field it never mentioned, leaving the row uneditable.
 *
 * Null is also what the form sends when the author picks 未記入 on a row whose
 * rung is genuinely unknown. That is a statement, not a gap: an unstated level
 * PRINTS, so the worst this can do is carry a row the register cannot place
 * below university level — never drop a real education.
 */
const educationRowFields = educationFields.extend({ level: educationLevel.nullish() });

/**
 * The rule between the fields, shared by both shapes above. Written once
 * because it is one rule: what makes a finished 学歴 row coherent does not
 * depend on whether the row is arriving or already stored.
 */
function educationRules(
  value: { outcome: string; startedOn?: string | null; endedOn?: string | null },
  ctx: z.RefinementCtx,
) {
  if (value.outcome !== "expected" && !value.endedOn) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endedOn"],
      message: "An education that has finished needs the month it finished.",
    });
  }
  // Dropping `notNull` from `started_on` must not turn into a row that says
  // when nothing. One endpoint is what a 学歴 line needs to be placed in time.
  if (!value.startedOn && !value.endedOn) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["startedOn"],
      message: "An education needs the month it started, the month it ended, or both.",
    });
  }
}

/**
 * The fields plus the rule between them. Kept separate from `educationFields`
 * because a refinement cannot be made `.partial()` — a PATCH validates its own
 * fields against the loose schema and the RESULTING ROW against `educationRow`.
 */
const educationBody = educationFields.superRefine(educationRules);
const educationRow = educationRowFields.superRefine(educationRules);

const certificationBody = z.object({
  name: z.string().trim().min(1, "A certification name is required."),
  nameJa: z.string().trim().nullish(),
  issuingOrganization: z.string().trim().min(1, "An issuing organization is required."),
  issuedOn: monthDate.nullish(),
  expiresOn: monthDate.nullish(),
  /** Not rendered in v1 — for the author's own reference at renewal. */
  credentialId: z.string().trim().nullish(),
  credentialUrl: z.string().trim().url("That is not a URL.").nullish(),
  /** Feeds the SAME skill-candidate pool as `facts.technologies`. */
  technologies: z.array(z.string().trim().min(1)).optional(),
});

export function registerCredentialRoutes(app: Hono<AppEnv>) {
  const api = routes(app);

  api.get("/api/educations", async (c) => {
    const rows = await c
      .get("db")
      .select()
      .from(educations)
      .where(eq(educations.userId, c.get("user").id))
      // Chronological, because that is the order 学歴 is read in. On the
      // coalesce, not on `started_on`: a row carrying only a graduation month
      // has a null there, and Postgres sorts nulls LAST in ASC — which put the
      // author's oldest schooling at the bottom of the list.
      .orderBy(asc(sql`coalesce(${educations.startedOn}, ${educations.endedOn})`), asc(educations.id));
    return c.json({ items: rows.map(stripInternals) });
  });

  api.post("/api/educations", async (c) => {
    const body = await parseBody(c, educationBody);
    const [row] = await c
      .get("db")
      .insert(educations)
      .values({ id: newId("education"), userId: c.get("user").id, ...nullish(body) })
      .returning();
    return c.json(stripInternals(row!), 201);
  });

  /**
   * The outcome rule is a rule about the finished row, so a PATCH is validated
   * against the row it would produce rather than against the fields it names.
   */
  api.patch("/api/educations/:id", async (c) => {
    const userId = c.get("user").id;
    const db = c.get("db");
    const id = pathParam(c, "id");
    const [existing] = await db
      .select()
      .from(educations)
      .where(and(eq(educations.userId, userId), eq(educations.id, id)))
      .limit(1);
    if (!existing) throw notFound("That education");

    // The loose shape a PATCH may name is the EXISTING row's, not the created
    // row's: a stored level of null has to survive a patch that says nothing
    // about it, and has to be nameable by a form that sends the whole row.
    const patch = await parseBody(c, educationRowFields.partial());
    parse(educationRow, { ...stripInternals(existing), ...nullish(patch) });

    const [row] = await db
      .update(educations)
      .set({ ...nullish(patch), updatedAt: new Date() })
      .where(and(eq(educations.userId, userId), eq(educations.id, id)))
      .returning();
    return c.json(stripInternals(row!));
  });

  api.delete("/api/educations/:id", async (c) => {
    const [row] = await c
      .get("db")
      .delete(educations)
      .where(and(eq(educations.userId, c.get("user").id), eq(educations.id, pathParam(c, "id"))))
      .returning({ id: educations.id });
    if (!row) throw notFound("That education");
    return c.body(null, 204);
  });

  api.get("/api/certifications", async (c) => {
    const rows = await c
      .get("db")
      .select()
      .from(certifications)
      .where(eq(certifications.userId, c.get("user").id))
      .orderBy(desc(certifications.issuedOn), asc(certifications.id));
    return c.json({ items: rows.map(stripInternals) });
  });

  api.post("/api/certifications", async (c) => {
    const body = await parseBody(c, certificationBody);
    const [row] = await c
      .get("db")
      .insert(certifications)
      .values({ id: newId("certification"), userId: c.get("user").id, ...nullish(body) })
      .returning();
    return c.json(stripInternals(row!), 201);
  });

  api.patch("/api/certifications/:id", async (c) => {
    const body = await parseBody(c, certificationBody.partial());
    const [row] = await c
      .get("db")
      .update(certifications)
      .set({ ...nullish(body), updatedAt: new Date() })
      .where(
        and(
          eq(certifications.userId, c.get("user").id),
          eq(certifications.id, pathParam(c, "id")),
        ),
      )
      .returning();
    if (!row) throw notFound("That certification");
    return c.json(stripInternals(row));
  });

  api.delete("/api/certifications/:id", async (c) => {
    const [row] = await c
      .get("db")
      .delete(certifications)
      .where(
        and(
          eq(certifications.userId, c.get("user").id),
          eq(certifications.id, pathParam(c, "id")),
        ),
      )
      .returning({ id: certifications.id });
    if (!row) throw notFound("That certification");
    return c.body(null, 204);
  });
}
