/**
 * Quick capture (`docs/07-api-design.md` §6, `docs/09` Flow 6, issue #95):
 * work that left no document, typed in a sentence or two.
 *
 * Two routes. `read` asks the model to split the text into claims and **stores
 * nothing**; the author confirms or corrects every claim on the screen. The
 * save is the one write, and it puts the facts straight into the record.
 *
 * A captured fact has no source passage and no quote (`docs/04` §3.7). It is
 * **Attested**, never Measured, and the grade is the author's: the model words
 * it, and the author's confirmation is the ruling (`docs/06`, 2026-10-16).
 * Disclosure is Restricted, and the confidential-shape check still makes it
 * Private, the floor an import has.
 */
import type { Hono } from "hono";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { capturePromptDismissals, employers, factFlags, facts, projects } from "../db/schema";
import { ApiError } from "../http/errors";
import { newId } from "../http/ids";
import { routes } from "../http/registry";
import { parseBody } from "../services/validate";
import { factWithEmployer } from "../services/employer";
import { settleRepeats } from "../services/repeats";
import { flagsOf } from "./flags";
import { requireOwnedEmployer, requireOwnedProject } from "./record";
import { monthDate } from "./profile";
import { toResponse } from "./facts";
import { classifyClaim } from "~/pipeline/flags";
import { ModelUnavailableError, type CapturedClaim, type ModelUsage } from "~/model";
import { CAPTURE_TEXT_MAX, CAPTURED_CLAIMS_MAX, CLAIM_MAX } from "~/shared/capture";
import type { AppEnv } from "../env";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

const readBody = z.object({
  text: z
    .string()
    .trim()
    .min(1, "Type what you did first. A sentence or two is enough.")
    .max(CAPTURE_TEXT_MAX, `What you type can be at most ${CAPTURE_TEXT_MAX.toLocaleString("en-US")} characters.`),
  /** The author's own month, so "last month" is read where they are. The server's when absent. */
  today: z.string().regex(MONTH).optional(),
});

const claimBody = z
  .object({
    claim: z
      .string()
      .trim()
      .min(1, "A claim cannot be empty.")
      .max(CLAIM_MAX, `A claim can be at most ${CLAIM_MAX.toLocaleString("en-US")} characters.`),
    month: z.string().regex(MONTH, "A month is a year and a month.").nullish(),
    /**
     * Filed under an employer by hand. `null` is a hand-set `No employer`, as on
     * the card; absent is not said, and the fact is left unfiled.
     */
    employerId: z.string().trim().min(1).nullish(),
    /** Filed under a project, which files it under the project's employer. */
    projectId: z.string().trim().min(1).optional(),
    technologies: z.array(z.string().trim().min(1).max(100)).max(30).optional(),
  })
  .refine((claim) => !(claim.projectId && claim.employerId !== undefined), {
    message: "File a claim under an employer or a project, not both.",
    path: ["employerId"],
  });

const saveBody = z.object({
  claims: z
    .array(claimBody)
    .min(1, "Save at least one claim.")
    .max(CAPTURED_CLAIMS_MAX, `At most ${CAPTURED_CLAIMS_MAX} claims are saved at once.`),
});

const thisMonth = () => new Date().toISOString().slice(0, 7);

const dismissBody = z.object({
  /** The author's own month, `YYYY-MM-01`: the prompt is away until it ends. */
  month: monthDate,
});

/** Months since the year 0, so two months subtract. */
const monthIndex = (month: string) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7));

export function registerCaptureRoutes(app: Hono<AppEnv>) {
  const api = routes(app);

  /**
   * Splits the typed text into claims and proposes the month and the employer
   * or project each names (`docs/07` §6). **It stores nothing.** A call that
   * fails answers 503, and the screen opens the plain form with the text kept,
   * so adding a fact never depends on it. A call that finds nothing answers an
   * empty list, which opens the same form.
   */
  api.post("/api/capture/read", async (c) => {
    const user = c.get("user");
    const db = c.get("db");
    const { text, today } = await parseBody(c, readBody);

    const [employerRows, projectRows] = await Promise.all([
      db.select({ id: employers.id, nameJa: employers.nameJa, nameLatin: employers.nameLatin }).from(employers)
        .where(eq(employers.userId, user.id)).orderBy(asc(employers.startedOn)),
      db.select({ id: projects.id, name: projects.name, nameJa: projects.nameJa }).from(projects)
        .where(eq(projects.userId, user.id)).orderBy(asc(projects.name)),
    ]);
    // Both of a name's forms, since the text can be typed in either language.
    const both = (first: string, second: string | null) => (second && second !== first ? `${first} / ${second}` : first);

    let usage: ModelUsage | null = null;
    let claims: CapturedClaim[];
    try {
      claims = await c.get("model").captureClaims(
        text,
        {
          today: today ?? thisMonth(),
          employers: employerRows.map((row) => ({ id: row.id, name: both(row.nameJa, row.nameLatin) })),
          projects: projectRows.map((row) => ({ id: row.id, name: both(row.name, row.nameJa) })),
        },
        { onUsage: (u) => (usage = u) },
      );
    } catch (err) {
      if (!(err instanceof ModelUnavailableError)) throw err;
      // A length and the failure. Never the text.
      console.log(JSON.stringify({ event: "capture_read_failed", characters: text.length }));
      throw new ApiError(
        "upstream_unavailable",
        "What you typed could not be read just now. Fill the claim in yourself; your text is kept.",
      );
    }

    // Lengths and counts. Never the text or a claim.
    console.log(
      JSON.stringify({
        event: "capture_read",
        characters: text.length,
        claims: claims.length,
        missing: claims.reduce((n, claim) => n + claim.missing.length, 0),
        ...(usage ?? {}),
      }),
    );
    return c.json({ claims });
  });

  /**
   * Saves the confirmed claims into the record: accepted, Attested, graded by
   * the author, with no source and no quote. Nothing is created before this.
   */
  api.post("/api/capture", async (c) => {
    const user = c.get("user");
    const db = c.get("db");
    const body = await parseBody(c, saveBody);

    // A foreign key alone would let one user file a fact under another user's
    // employer or project. Each is a read filtered by `user_id`, and a miss is a 404.
    for (const id of new Set(body.claims.map((claim) => claim.employerId).filter((id): id is string => !!id))) {
      await requireOwnedEmployer(db, user.id, id);
    }
    for (const id of new Set(body.claims.map((claim) => claim.projectId).filter((id): id is string => !!id))) {
      await requireOwnedProject(db, user.id, id);
    }

    const now = new Date();
    const rows = body.claims.map((claim) => {
      const technologies = [...new Set(claim.technologies ?? [])];
      const { shape, flags } = classifyClaim({ claim: claim.claim, quote: null, technologies });
      return {
        fact: {
          id: newId("fact"),
          userId: user.id,
          claim: claim.claim,
          occurredOn: claim.month ? `${claim.month}-01` : null,
          projectId: claim.projectId ?? null,
          ...(claim.employerId === undefined ? {} : { employerId: claim.employerId, employerSetAt: now }),
          provenance: "attested" as const,
          disclosure: shape ? ("private" as const) : ("restricted" as const),
          isClientIdentifying: shape !== null,
          status: "accepted" as const,
          technologies,
          resolvedAt: now,
          // The author's grade: the confirmation on the screen is the ruling.
          gradedAt: now,
        },
        // Only the shape check's flag. A number needs no passage to check it
        // against: the author typed it and confirmed it.
        flags: flags.filter((flag) => flag.kind === "confidential"),
      };
    });

    await db.batch([
      db.insert(facts).values(rows.map((row) => row.fact)),
      ...rows.flatMap((row) =>
        row.flags.map((flag) =>
          db.insert(factFlags).values({ id: newId("factFlag"), userId: user.id, factId: row.fact.id, ...flag }),
        ),
      ),
    ] as any);

    const ids = rows.map((row) => row.fact.id);
    await settleRepeats(db, user.id);

    const saved = await db
      .select(factWithEmployer)
      .from(facts)
      .where(and(eq(facts.userId, user.id), inArray(facts.id, ids)))
      .orderBy(asc(facts.id));
    const flags = await flagsOf(db, user.id, ids);

    // Counts only. Never a claim.
    console.log(
      JSON.stringify({
        event: "facts_captured",
        facts: saved.length,
        private: saved.filter((fact) => fact.disclosure === "private").length,
        withMonth: saved.filter((fact) => fact.occurredOn !== null).length,
        filed: saved.filter((fact) => fact.resolvedEmployerId !== null).length,
      }),
    );
    return c.json({ items: saved.map((fact) => toResponse(fact, [], flags.get(fact.id) ?? [])) }, 201);
  });

  /**
   * Puts Home's monthly capture prompt away until the author's month ends
   * (issue #116). Kept on the member, so it holds on every device. The month
   * is the author's, since a month ends where they are; one more than a month
   * from the server's is refused, so no dismissal outlasts the month it was for.
   */
  api.post("/api/capture/prompt/dismiss", async (c) => {
    const user = c.get("user");
    const { month } = await parseBody(c, dismissBody);
    if (Math.abs(monthIndex(month) - monthIndex(thisMonth())) > 1) {
      throw new ApiError("validation_failed", "The prompt can only be put away for this month.");
    }
    await c
      .get("db")
      .insert(capturePromptDismissals)
      .values({ userId: user.id, dismissedOn: month })
      .onConflictDoUpdate({
        target: capturePromptDismissals.userId,
        set: { dismissedOn: month, updatedAt: new Date() },
      });
    return c.json({ dismissedOn: month });
  });
}
