/**
 * Applications (`docs/07-api-design.md` §7b, issue #70).
 *
 * One job the author is looking at or has applied for: the posting, where it
 * stands, and the date of each step. The rules for moving through the steps
 * are in `~/shared/application`, and every route that changes where an
 * application stands goes through {@link saveStanding}, so a date is never
 * overwritten: the row holding it is superseded and a new one written.
 *
 * Gone quiet and the "how long since" figures are worked out on every read,
 * against today's date in Japan. None is stored. The figures count from the
 * dates of the steps; gone quiet and the list's order count from
 * `last_activity_at`, which every change to where an application stands sets.
 *
 * A company, a position and a job description name somebody else's business.
 * No log line here carries any of them: an id, a status, a length.
 */
import type { Context, Hono } from "hono";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";
import { applicationSteps, applications, renderVersions, renders } from "../db/schema";
import { ApiError, notFound, pathParam, validationFailed, violatesUnique } from "../http/errors";
import { routes } from "../http/registry";
import { newId } from "../http/ids";
import { parseBody } from "../services/validate";
import { tailoredTitle } from "../services/render-ref";
import { renderState } from "./renders";
import { tokyoToday } from "~/render/rirekisho";
import {
  APPLICATION_STATUSES,
  APPLICATION_STEPS,
  CLOSED_KINDS,
  StandingRefused,
  close,
  figures,
  isClosedKind,
  isDay,
  isStep,
  moveTo,
  reopen,
  setDate,
  standingProblem,
  type ApplicationStatus,
  type ApplicationStep,
  type ClosedKind,
  type Standing,
} from "~/shared/application";
import type { AppEnv } from "../env";
import type { Db } from "../db/client";

/** The limit a tailored résumé's job description has always had (`docs/06`, 2026-10-08). */
const JOB_DESCRIPTION_MAX = 20_000;
const NAME_MAX = 200;
const REQUIREMENT_MAX = 300;
const REQUIREMENTS_MAX = 30;

const company = z.string().trim().min(1, "Give it a company.").max(NAME_MAX, `Keep the company under ${NAME_MAX} characters.`);
const position = z.string().trim().min(1, "Give it a position.").max(NAME_MAX, `Keep the position under ${NAME_MAX} characters.`);
/** Stored and shown, and opened only when the author clicks it: so `http` or `https` and nothing else. */
const postingUrl = z
  .string()
  .trim()
  .max(2000, "That link is too long.")
  .refine((value) => value === "" || /^https?:\/\/\S+$/i.test(value), "A link to the posting starts with https://")
  .nullable()
  .transform((value) => (value ? value : null));
const requirements = z
  .array(z.string().trim().max(REQUIREMENT_MAX, `Keep each requirement under ${REQUIREMENT_MAX} characters.`))
  .max(REQUIREMENTS_MAX, `An application holds at most ${REQUIREMENTS_MAX} key requirements.`)
  .transform((items) => items.filter((item) => item !== ""));

const createBody = z.strictObject({
  company,
  position,
  jobDescription: z
    .string()
    .trim()
    .min(1, "Paste the job description.")
    .max(JOB_DESCRIPTION_MAX, `A job description can be at most ${JOB_DESCRIPTION_MAX.toLocaleString("en-US")} characters.`),
  postingUrl: postingUrl.optional(),
  requirements: requirements.optional(),
});

/** The job description is not here: it stays as it was pasted. */
const editBody = z.strictObject({
  company: company.optional(),
  position: position.optional(),
  postingUrl: postingUrl.optional(),
  requirements: requirements.optional(),
});

const day = z.string().refine(isDay, "A date must be a real day, as YYYY-MM-DD.");
const stepBody = z.strictObject({ status: z.enum(APPLICATION_STATUSES) });
const dateBody = z.strictObject({ date: day });
const standingBody = z.strictObject({
  step: z.enum(APPLICATION_STEPS),
  closedAs: z.enum(CLOSED_KINDS).nullable(),
  dates: z.partialRecord(z.enum(APPLICATION_STATUSES), day),
});

type ApplicationRow = typeof applications.$inferSelect;
type SummaryRow = Pick<ApplicationRow, keyof typeof SUMMARY>;
type StepRow = Pick<typeof applicationSteps.$inferSelect, "id" | "applicationId" | "status" | "happenedOn">;

export function registerApplicationRoutes(app: Hono<AppEnv>) {
  const api = routes(app);

  /**
   * Every application, newest activity first. The job description is not in
   * the listing: it is long, and one application's is read from its own route.
   */
  api.get("/api/applications", async (c) => {
    const user = c.get("user");
    const db = c.get("db");
    const today = tokyoToday();
    const [rows, steps, resumes] = await db.batch([
      db.select(SUMMARY).from(applications).where(eq(applications.userId, user.id)),
      db.select(LIVE_STEP).from(applicationSteps).where(liveSteps(user.id)),
      db
        .select({
          applicationId: renders.applicationId,
          label: renders.label,
          versionNo: renderVersions.versionNo,
        })
        .from(renders)
        .leftJoin(
          renderVersions,
          and(eq(renderVersions.id, renders.currentVersionId), eq(renderVersions.userId, user.id)),
        )
        .where(and(eq(renders.userId, user.id), isNotNull(renders.applicationId))),
    ]);

    const stepsOf = groupBy(steps, (step) => step.applicationId);
    const resumeOf = new Map(resumes.map((row) => [row.applicationId, row]));
    const items = rows
      .map((row) => {
        const standing = standingOf(row, stepsOf.get(row.id) ?? []);
        const resume = resumeOf.get(row.id);
        return {
          ...summaryOf(row, standing, today),
          resume: resume ? { title: tailoredTitle(resume.label), versionNo: resume.versionNo } : null,
        };
      })
      .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));

    return c.json({ items, today });
  });

  /** Adds a job, at Not applied, with today as the day it was added. */
  api.post("/api/applications", async (c) => {
    const user = c.get("user");
    const db = c.get("db");
    const body = await parseBody(c, createBody);

    const id = newId("application");
    const now = new Date();
    await db.batch([
      db.insert(applications).values({
        id,
        userId: user.id,
        company: body.company,
        position: body.position,
        jobDescription: body.jobDescription,
        postingUrl: body.postingUrl ?? null,
        requirements: body.requirements ?? [],
        lastActivityAt: now,
      }),
      db.insert(applicationSteps).values({
        id: newId("applicationStep"),
        userId: user.id,
        applicationId: id,
        status: "not_applied",
        happenedOn: tokyoToday(now),
      }),
    ]);
    // An id and a length. Never the text, the company or the position.
    console.log(JSON.stringify({ event: "application_created", applicationId: id, characters: body.jobDescription.length }));

    return c.json(await detail(db, user.id, id), 201);
  });

  api.get("/api/applications/:id", async (c) =>
    c.json(await detail(c.get("db"), c.get("user").id, pathParam(c, "id"))),
  );

  /**
   * Corrects the company, the position, the link or the key requirements. Not
   * activity: it changes what the application is called, not how it is going,
   * so it neither reorders the list nor resets gone quiet.
   */
  api.patch("/api/applications/:id", async (c) => {
    const user = c.get("user");
    const db = c.get("db");
    const id = pathParam(c, "id");
    const body = await parseBody(c, editBody);
    await requireApplication(db, user.id, id);

    const changes = Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined));
    await db
      .update(applications)
      .set({ ...changes, updatedAt: new Date() })
      .where(and(eq(applications.userId, user.id), eq(applications.id, id)));
    return c.json(await detail(db, user.id, id));
  });

  /**
   * Sets a step, or closes the application as rejected or withdrawn. Either
   * saves today's date, which `PATCH …/steps/:status` corrects afterwards.
   */
  api.post("/api/applications/:id/steps", async (c) => {
    const { status } = await parseBody(c, stepBody);
    const today = tokyoToday();
    return change(c, (standing) =>
      isClosedKind(status) ? close(standing, status, today) : moveTo(standing, status, today),
    );
  });

  /** Corrects the date of a status the application has reached, or gives one to a step passed over. */
  api.patch("/api/applications/:id/steps/:status", async (c) => {
    const status = pathParam(c, "status");
    if (!isStep(status) && !isClosedKind(status)) throw notFound("That step");
    const { date } = await parseBody(c, dateBody);
    if (date > tokyoToday()) throw validationFailed("A date cannot be in the future.", ["date"]);
    return change(c, (standing) => setDate(standing, status, date));
  });

  /** Reopens a closed application at the step it was closed at. */
  api.post("/api/applications/:id/reopen", async (c) => change(c, reopen));

  /**
   * Puts an application back where it stood: step, closed or not, and every
   * date. This is Undo. The screen holds the standing from before a change and
   * sends it here, and the dates it replaces are superseded like any others.
   */
  api.put("/api/applications/:id/standing", async (c) => {
    const body = await parseBody(c, standingBody);
    const problem = standingProblem(body, tokyoToday());
    if (problem) throw validationFailed(problem, ["dates"]);
    return change(c, () => body);
  });
}

/* ------------------------------------------------------------------ reads */

/** The columns the list reads. The job description and the requirements are not among them. */
const SUMMARY = {
  id: applications.id,
  company: applications.company,
  position: applications.position,
  postingUrl: applications.postingUrl,
  currentStep: applications.currentStep,
  closedAs: applications.closedAs,
  lastActivityAt: applications.lastActivityAt,
};

const LIVE_STEP = {
  id: applicationSteps.id,
  applicationId: applicationSteps.applicationId,
  status: applicationSteps.status,
  happenedOn: applicationSteps.happenedOn,
};

const liveSteps = (userId: string, applicationId?: string) =>
  and(
    eq(applicationSteps.userId, userId),
    isNull(applicationSteps.supersededAt),
    applicationId ? eq(applicationSteps.applicationId, applicationId) : undefined,
  );

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
  return groups;
}

const standingOf = (row: SummaryRow, steps: StepRow[]): Standing => ({
  step: row.currentStep as ApplicationStep,
  closedAs: row.closedAs as ClosedKind | null,
  dates: Object.fromEntries(steps.map((step) => [step.status, step.happenedOn])),
});

/** What the list shows of an application, which is also the top of its page. */
const summaryOf = (row: SummaryRow, standing: Standing, today: string) => ({
  id: row.id,
  company: row.company,
  position: row.position,
  postingUrl: row.postingUrl,
  ...standing,
  lastActivityAt: row.lastActivityAt.toISOString(),
  ...figures(standing, tokyoToday(row.lastActivityAt), today),
});

/** A miss is a 404, and so is another user's id: saying a row exists would confirm it. */
async function requireApplication(db: Db, userId: string, id: string) {
  const [row] = await db
    .select()
    .from(applications)
    .where(and(eq(applications.userId, userId), eq(applications.id, id)))
    .limit(1);
  if (!row) throw notFound("That application");
  return row;
}

async function readStanding(db: Db, userId: string, id: string) {
  const row = await requireApplication(db, userId, id);
  const steps = await db.select(LIVE_STEP).from(applicationSteps).where(liveSteps(userId, id));
  return { row, steps, standing: standingOf(row, steps) };
}

/** One application in full: the posting, where it stands, and its résumé if it has one. */
async function detail(db: Db, userId: string, id: string) {
  const { row, standing } = await readStanding(db, userId, id);
  const [resume] = await db
    .select({ id: renders.id })
    .from(renders)
    .where(and(eq(renders.userId, userId), eq(renders.applicationId, id)))
    .limit(1);
  const documents = resume ? await renderState(db, userId) : null;
  const today = tokyoToday();

  return {
    ...summaryOf(row, standing, today),
    requirements: row.requirements,
    jobDescription: row.jobDescription,
    /** The tailored résumé written for this job, as every document list shows one. */
    resume: documents?.tailored.find((document) => document.id === resume!.id) ?? null,
    canGenerate: (documents?.usableFacts ?? 0) > 0,
    today,
  };
}

/* ----------------------------------------------------------------- writes */

/**
 * Reads where an application stands, applies one change to it, saves it and
 * answers with the result. A change that leaves it standing as it was is not
 * activity: nothing is written and nothing logged.
 */
async function change(c: Context<AppEnv>, apply: (standing: Standing) => Standing) {
  const user = c.get("user");
  const db = c.get("db");
  const id = pathParam(c, "id");
  const { steps, standing } = await readStanding(db, user.id, id);

  let next: Standing;
  try {
    next = apply(standing);
  } catch (error) {
    if (error instanceof StandingRefused) throw new ApiError("conflict", error.message);
    throw error;
  }
  const same =
    next.step === standing.step &&
    next.closedAs === standing.closedAs &&
    APPLICATION_STATUSES.every((status) => next.dates[status] === standing.dates[status]);
  if (same) return c.json(await detail(db, user.id, id));

  await saveStanding(db, user.id, id, steps, next);
  console.log(JSON.stringify({ event: "application_standing_set", applicationId: id, step: next.step, closedAs: next.closedAs }));
  return c.json(await detail(db, user.id, id));
}

/**
 * Makes the stored dates match a standing, in one transaction, and marks the
 * application as changed now. A date that differs from the live row's
 * supersedes that row and writes a new one; a date that is gone supersedes its
 * row; nothing is updated in place or deleted.
 */
async function saveStanding(db: Db, userId: string, applicationId: string, live: StepRow[], next: Standing) {
  const liveBy = new Map(live.map((row) => [row.status as ApplicationStatus, row]));
  const changed = APPLICATION_STATUSES.filter((status) => liveBy.get(status)?.happenedOn !== next.dates[status]);
  const superseded = changed.flatMap((status) => liveBy.get(status)?.id ?? []);
  const written = changed.flatMap((status) => {
    const happenedOn = next.dates[status];
    return happenedOn
      ? [{ id: newId("applicationStep"), userId, applicationId, status, happenedOn }]
      : [];
  });

  const now = new Date();
  try {
    await db.batch([
      db
        .update(applications)
        .set({ currentStep: next.step, closedAs: next.closedAs, lastActivityAt: now, updatedAt: now })
        .where(and(eq(applications.userId, userId), eq(applications.id, applicationId))),
      ...superseded.map((id) =>
        db
          .update(applicationSteps)
          .set({ supersededAt: now, updatedAt: now })
          .where(
            and(eq(applicationSteps.userId, userId), eq(applicationSteps.id, id), isNull(applicationSteps.supersededAt)),
          ),
      ),
      ...written.map((row) => db.insert(applicationSteps).values(row)),
    ]);
  } catch (error) {
    // Two changes read the same standing and both wrote. The index let one in.
    if (!violatesUnique(error, "application_steps_live_uq")) throw error;
    throw new ApiError("conflict", "This application was changed somewhere else. Reload it and try again.");
  }
}
