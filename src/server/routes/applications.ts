/**
 * Applications (`docs/07-api-design.md` §9b, issues #70 and #73).
 *
 * One job the author is looking at or has applied for: the posting, where it
 * stands, and the date of each step. The rules for moving through the steps
 * are in `~/shared/application`, and every route that changes where an
 * application stands goes through {@link saveStanding}, so a date is never
 * overwritten: the row holding it is superseded and a new one written.
 * It is also where the documents are frozen: whenever an application leaves
 * Not applied for any step, by a move, by Undo or by an interview entry's move.
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
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { z } from "zod";
import { applicationSentCopies, applicationSteps, applications } from "../db/schema";
import { ApiError, notFound, pathParam, validationFailed, violatesUnique } from "../http/errors";
import { routes } from "../http/registry";
import { newId } from "../http/ids";
import { parseBody } from "../services/validate";
import { interviewsOf } from "../services/interviews";
import {
  freezeDocuments,
  liveCopies,
  readDocuments,
  readResumeLines,
  unsentDocuments,
} from "../services/application-documents";
import { tokyoToday } from "~/render/rirekisho";
import {
  APPLICATION_STATUSES,
  APPLICATION_STEPS,
  CLOSED_KINDS,
  APPLICATION_NOTE_MAX,
  JOB_DESCRIPTION_MAX,
  JOB_DESCRIPTION_READ_MIN,
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
import { creditsExhaustedError } from "../services/model-credits";
import { ModelUnavailableError, type ModelUsage, type PostingReading } from "~/model";
import type { NamedVersion } from "~/shared/application-documents";
import type { AppEnv } from "../env";
import type { Db } from "../db/client";

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

const tooLong = `A job description can be at most ${JOB_DESCRIPTION_MAX.toLocaleString("en-US")} characters.`;

const createBody = z.strictObject({
  company,
  position,
  jobDescription: z.string().trim().min(1, "Paste the job description.").max(JOB_DESCRIPTION_MAX, tooLong),
  postingUrl: postingUrl.optional(),
  requirements: requirements.optional(),
});

/** The text to read, and nothing else: the link is only stored, so it is not sent here. */
const readBody = z.strictObject({
  jobDescription: z
    .string()
    .trim()
    .min(JOB_DESCRIPTION_READ_MIN, "Paste the job description first. A few lines is enough.")
    .max(JOB_DESCRIPTION_MAX, tooLong),
});

/** One of the author's two notes for a tailored 履歴書. Empty is no note. */
const note = (what: string) =>
  z
    .string()
    .trim()
    .max(APPLICATION_NOTE_MAX, `Keep ${what} under ${APPLICATION_NOTE_MAX} characters.`)
    .nullable()
    .transform((value) => (value ? value : null));

/** The job description is not here: it stays as it was pasted. */
const editBody = z.strictObject({
  company: company.optional(),
  position: position.optional(),
  postingUrl: postingUrl.optional(),
  requirements: requirements.optional(),
  motivationNote: note("your reason for applying").optional(),
  kibouNote: note("your request").optional(),
});

const day = z.string().refine(isDay, "A date must be a real day, as YYYY-MM-DD.");
const stepBody = z.strictObject({ status: z.enum(APPLICATION_STATUSES) });
const dateBody = z.strictObject({ date: day });
const standingBody = z.strictObject({
  step: z.enum(APPLICATION_STEPS),
  closedAs: z.enum(CLOSED_KINDS).nullable(),
  dates: z.partialRecord(z.enum(APPLICATION_STATUSES), day),
});

/**
 * What was read, held to the limits a saved application has, so a proposal is
 * always one `POST /api/applications` would accept. The model is asked for
 * short lines and is not trusted to have written them.
 */
const proposalOf = (read: PostingReading): PostingReading => ({
  company: read.company.trim().slice(0, NAME_MAX).trim(),
  position: read.position.trim().slice(0, NAME_MAX).trim(),
  requirements: read.requirements
    .map((item) => item.trim().slice(0, REQUIREMENT_MAX).trim())
    .filter((item) => item !== "")
    .slice(0, REQUIREMENTS_MAX),
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
    const [rows, steps] = await db.batch([
      db.select(SUMMARY).from(applications).where(eq(applications.userId, user.id)),
      db.select(LIVE_STEP).from(applicationSteps).where(liveSteps(user.id)),
    ]);
    const resumeOf = await readResumeLines(db, user.id, new Map(rows.map((row) => [row.id, row.company])));

    const stepsOf = groupBy(steps, (step) => step.applicationId);
    const items = rows
      .map((row) => ({
        ...summaryOf(row, standingOf(row, stepsOf.get(row.id) ?? []), today),
        resume: resumeOf.get(row.id) ?? { documents: [], sent: false },
      }))
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

  /**
   * Reads a pasted posting and proposes the company, the position and the key
   * requirements (issue #73). **It stores nothing**: the application is made
   * by `POST /api/applications`, when the author has checked what was read.
   *
   * The one route here that calls the model. A reading that fails answers 503
   * and the screen opens the same fields empty, so adding a job never depends
   * on it.
   */
  api.post("/api/applications/read-posting", async (c) => {
    const { jobDescription } = await parseBody(c, readBody);

    let usage: ModelUsage | null = null;
    let read: PostingReading;
    try {
      read = await c.get("model").readPosting(jobDescription, { onUsage: (u) => (usage = u) });
    } catch (err) {
      if (!(err instanceof ModelUnavailableError)) throw err;
      const outOfCredits = creditsExhaustedError(err, "read_posting");
      if (outOfCredits) throw outOfCredits;
      // A length and the failure. Never the text.
      console.log(JSON.stringify({ event: "posting_read_failed", characters: jobDescription.length }));
      throw new ApiError(
        "upstream_unavailable",
        "The job description could not be read just now. Type the fields in; your text is kept.",
      );
    }

    const proposal = proposalOf(read);
    // Lengths and counts. Never the text, the company, the position or a requirement.
    console.log(
      JSON.stringify({
        event: "posting_read",
        characters: jobDescription.length,
        company: proposal.company !== "",
        position: proposal.position !== "",
        requirements: proposal.requirements.length,
        ...(usage ?? {}),
      }),
    );
    return c.json(proposal);
  });

  api.get("/api/applications/:id", async (c) =>
    c.json(await detail(c.get("db"), c.get("user").id, pathParam(c, "id"))),
  );

  /**
   * Corrects the company, the position, the link or the key requirements, or
   * writes the author's notes for a tailored 履歴書. Not activity: it changes
   * what the application is called or what a document is written toward, not
   * how it is going, so it neither reorders the list nor resets gone quiet. A
   * note changed after a version was made marks nothing stale: the author
   * regenerates when they want it used (`docs/06`, 2026-10-26).
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
   * Moving out of Not applied freezes the documents on it that were never sent.
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
    return change(c, (standing) => setDate(standing, status, date), "correct");
  });

  /** Reopens a closed application at the step it was closed at. */
  api.post("/api/applications/:id/reopen", async (c) => change(c, reopen));

  /**
   * Puts an application back where it stood: step, closed or not, and every
   * date. This is Undo. The screen holds the standing from before a change and
   * sends it here, and the dates it replaces are superseded like any others.
   * Back at Not applied, the copies the undone move froze are taken back too.
   */
  api.put("/api/applications/:id/standing", async (c) => {
    const body = await parseBody(c, standingBody);
    const problem = standingProblem(body, tokyoToday());
    if (problem) throw validationFailed(problem, ["dates"]);
    return change(c, () => body, "restore");
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
export async function requireApplication(db: Db, userId: string, id: string) {
  const [row] = await db
    .select()
    .from(applications)
    .where(and(eq(applications.userId, userId), eq(applications.id, id)))
    .limit(1);
  if (!row) throw notFound("That application");
  return row;
}

export async function readStanding(db: Db, userId: string, id: string) {
  const row = await requireApplication(db, userId, id);
  const steps = await db.select(LIVE_STEP).from(applicationSteps).where(liveSteps(userId, id));
  return { row, steps, standing: standingOf(row, steps) };
}

/** One application in full: the posting, where it stands, its documents, what was sent and its interview entries. */
export async function detail(db: Db, userId: string, id: string) {
  const { row, standing } = await readStanding(db, userId, id);
  const today = tokyoToday();

  return {
    ...summaryOf(row, standing, today),
    requirements: row.requirements,
    jobDescription: row.jobDescription,
    motivationNote: row.motivationNote,
    kibouNote: row.kibouNote,
    ...(await readDocuments(db, userId, row)),
    interviews: await interviewsOf(db, userId, id),
    today,
  };
}

/* ----------------------------------------------------------------- writes */

/**
 * The update that marks an application as changed now, for a batch. The list
 * is ordered by it and gone quiet is counted from it.
 */
export const markActivity = (db: Db, userId: string, applicationId: string, now: Date) =>
  db
    .update(applications)
    .set({ lastActivityAt: now, updatedAt: now })
    .where(and(eq(applications.userId, userId), eq(applications.id, applicationId)));

/**
 * What a change to the standing is, which decides what it does to sent copies
 * (`docs/10` Screen 14, issue #71).
 *
 * Whatever the kind, a change that leaves Not applied for any step freezes
 * the documents on the application that have no sent copy yet. One that
 * already has a copy is left alone, and no other change freezes anything.
 *
 * - `move`: a step set, a close, a reopen. It does nothing more to copies.
 * - `correct`: one date put right. A copy frozen by the change that saved
 *   that date follows it.
 * - `restore`: Undo. Back at Not applied, it takes back the copies the undone
 *   move froze. A plain move back to Not applied keeps them.
 */
type ChangeKind = "move" | "correct" | "restore";

/**
 * Reads where an application stands, applies one change to it, saves it and
 * answers with the result. A change that leaves it standing as it was is not
 * activity: nothing is written and nothing logged.
 */
async function change(c: Context<AppEnv>, apply: (standing: Standing) => Standing, kind: ChangeKind = "move") {
  const user = c.get("user");
  const db = c.get("db");
  const id = pathParam(c, "id");
  const { row, steps, standing } = await readStanding(db, user.id, id);

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

  const frozen = await saveStanding(db, user.id, id, row, steps, next, [], kind);
  console.log(JSON.stringify({ event: "application_standing_set", applicationId: id, step: next.step, closedAs: next.closedAs, frozen: frozen.length }));
  return c.json({ ...(await detail(db, user.id, id)), frozen });
}

/**
 * Makes the stored dates match a standing, in one transaction, and marks the
 * application as changed now. A date that differs from the live row's
 * supersedes that row and writes a new one; a date that is gone supersedes its
 * row; saved dates are not overwritten or deleted.
 *
 * `previous` is the application as it was read. The write is refused as a
 * conflict when `last_activity_at` has moved since, which every write here
 * does, a date-only one included: the update then matches no row, and the
 * division by its count of zero fails the whole batch. The new value is always
 * at least a millisecond later, so two writes in one millisecond still differ.
 *
 * `alongside` is what else the same change writes, an interview entry and its
 * questions, so that it and the status it moved are saved or refused together.
 *
 * What `kind` does to sent copies is written in the same transaction, and the
 * documents it froze are the answer.
 */
export async function saveStanding(
  db: Db,
  userId: string,
  applicationId: string,
  previous: ApplicationRow,
  live: StepRow[],
  next: Standing,
  alongside: BatchItem<"pg">[] = [],
  kind: ChangeKind = "move",
): Promise<NamedVersion[]> {
  const liveBy = new Map(live.map((row) => [row.status as ApplicationStatus, row]));
  const changed = APPLICATION_STATUSES.filter((status) => liveBy.get(status)?.happenedOn !== next.dates[status]);
  const superseded = changed.flatMap((status) => liveBy.get(status) ?? []);
  const written = changed.flatMap((status) => {
    const happenedOn = next.dates[status];
    return happenedOn
      ? [{ id: newId("applicationStep"), userId, applicationId, status, happenedOn }]
      : [];
  });

  const now = new Date();
  const leaving = previous.currentStep === "not_applied" && next.step !== "not_applied";
  const returning = previous.currentStep !== "not_applied" && next.step === "not_applied";
  const mine = and(eq(applicationSentCopies.applicationId, applicationId), liveCopies(userId));

  let frozen: NamedVersion[] = [];
  const copies: BatchItem<"pg">[] = [];
  if (leaving) {
    // Built before anything is saved: a file that cannot be made refuses the
    // move, so Applied is never saved with nothing kept.
    const made = await freezeDocuments(db, userId, previous, await unsentDocuments(db, userId, applicationId), {
      sentOn: next.dates[next.step]!,
      recordedAt: now,
      frozenStepId: (written.find((row) => row.status === next.step) ?? live.find((step) => step.status === next.step))!.id,
    });
    frozen = made.named;
    copies.push(...made.rows.map((copy) => db.insert(applicationSentCopies).values(copy)));
  }
  if (kind === "correct") {
    for (const row of written) {
      const replaced = superseded.find((old) => old.status === row.status);
      if (!replaced) continue;
      copies.push(
        db
          .update(applicationSentCopies)
          .set({ sentOn: row.happenedOn, frozenStepId: row.id, updatedAt: now })
          .where(and(mine, eq(applicationSentCopies.frozenStepId, replaced.id))),
      );
    }
  }
  if (kind === "restore" && returning && live.length > 0) {
    // The copies a move froze name the live row of the date it saved. One
    // recorded by hand names none, and one from an earlier move names a row
    // that was superseded when the application was moved back, so both stay.
    copies.push(
      db
        .update(applicationSentCopies)
        .set({ undoneAt: now, updatedAt: now })
        .where(and(mine, inArray(applicationSentCopies.frozenStepId, live.map((step) => step.id)))),
    );
  }

  try {
    await db.batch([
      db.execute(sql`
        with changed as (
          update ${applications}
          set ${sql.identifier("current_step")} = ${next.step},
              ${sql.identifier("closed_as")} = ${next.closedAs},
              ${sql.identifier("last_activity_at")} = greatest(
                date_trunc('milliseconds', ${applications.lastActivityAt}) + interval '1 millisecond',
                ${now.toISOString()}::timestamptz
              ),
              ${sql.identifier("updated_at")} = ${now.toISOString()}::timestamptz
          where ${applications.userId} = ${userId}
            and ${applications.id} = ${applicationId}
            and date_trunc('milliseconds', ${applications.lastActivityAt}) = ${previous.lastActivityAt.toISOString()}::timestamptz
          returning 1
        )
        select 1 / count(*)::integer from changed
      `),
      ...superseded.map((row) =>
        db
          .update(applicationSteps)
          .set({ supersededAt: now, updatedAt: now })
          .where(
            and(eq(applicationSteps.userId, userId), eq(applicationSteps.id, row.id), isNull(applicationSteps.supersededAt)),
          ),
      ),
      ...written.map((row) => db.insert(applicationSteps).values(row)),
      ...copies,
      ...alongside,
    ]);
  } catch (error) {
    // 22012 is division by zero: the guard above found the application changed since it was read.
    let stale = false;
    for (let cause = error; cause instanceof Error; cause = cause.cause) {
      if ((cause as Error & { code?: string }).code === "22012") stale = true;
    }
    if (!stale && !violatesUnique(error, "application_steps_live_uq")) throw error;
    throw new ApiError("conflict", "This application was changed somewhere else. Reload it and try again.");
  }
  return frozen;
}
