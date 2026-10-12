/**
 * Interview entries (`docs/07-api-design.md` §9b, issue #72).
 *
 * One entry an interview, written by hand: the day, the round, who it was
 * with, how it went, and the questions asked as rows of their own in the order
 * given. No route here reaches a model, and no model reads an entry.
 *
 * Saving an entry for a round later than the step the application is at moves
 * it to that round, with the entry's day as the step's date; one for an earlier
 * round that was skipped fills that step's missing date only. The entry, its
 * questions and the move are one transaction, through the same
 * `saveStanding` every other change to where an application stands uses, so
 * the dates it replaces are superseded and Undo can put them back.
 *
 * A recording on an entry is a link to one kept elsewhere (issue #74): only
 * the link is stored, nothing here fetches it, and it is the one thing the
 * author can remove. Adding and removing one are changes to the application,
 * so both go through `saveStanding` with the standing as it was, which marks
 * the application as changed and refuses a write over a newer one.
 *
 * An interviewer's name, the notes, the questions and a recording's link and
 * label are other people's words. No log line carries any of them: an id, a
 * round, a count.
 */
import type { Hono } from "hono";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import { interviewQuestions, interviewRecordings, interviews } from "../db/schema";
import { notFound, validationFailed, pathParam } from "../http/errors";
import { routes } from "../http/registry";
import { newId } from "../http/ids";
import { parseBody } from "../services/validate";
import { detail, readStanding, saveStanding } from "./applications";
import { tokyoToday } from "~/render/rirekisho";
import { isDay } from "~/shared/application";
import {
  EMPTY_ENTRY,
  HOW_IT_WENT_MAX,
  INTERVIEW_ROUNDS,
  QUESTIONS_MAX,
  QUESTION_MAX,
  WHO_MAX,
  standingAfterInterview,
} from "~/shared/interview";
import { LABEL_MAX, LINK_MAX, NOT_A_LINK, isWebLink } from "~/shared/recording";
import type { AppEnv } from "../env";

const interviewBody = z.strictObject({
  date: z.string().refine(isDay, "A date must be a real day, as YYYY-MM-DD."),
  round: z.enum(INTERVIEW_ROUNDS),
  who: z.string().trim().max(WHO_MAX, `Keep who you spoke with under ${WHO_MAX} characters.`).default(""),
  howItWent: z
    .string()
    .trim()
    .max(HOW_IT_WENT_MAX, `Keep how it went under ${HOW_IT_WENT_MAX.toLocaleString("en-US")} characters.`)
    .default(""),
  questions: z
    .array(z.string().trim().max(QUESTION_MAX, `Keep each question under ${QUESTION_MAX.toLocaleString("en-US")} characters.`))
    .max(QUESTIONS_MAX, `An interview holds at most ${QUESTIONS_MAX} questions.`)
    .default([])
    .transform((items) => items.filter((item) => item !== "")),
});

const recordingLinkBody = z.strictObject({
  url: z.string().trim().max(LINK_MAX, "That link is too long.").refine(isWebLink, NOT_A_LINK),
  label: z.string().trim().max(LABEL_MAX, `Keep what it is under ${LABEL_MAX} characters.`).default(""),
});

/** A miss is a 404, and so is an entry of another application or another user. */
async function requireInterview(db: Db, userId: string, applicationId: string, interviewId: string) {
  const [row] = await db
    .select({ id: interviews.id })
    .from(interviews)
    .where(and(eq(interviews.userId, userId), eq(interviews.applicationId, applicationId), eq(interviews.id, interviewId)))
    .limit(1);
  if (!row) throw notFound("That interview");
}

export function registerInterviewRoutes(app: Hono<AppEnv>) {
  const api = routes(app);

  /**
   * Adds an interview entry. For a round later than the step the application
   * is at, it also moves the application there, dated as the entry is.
   */
  api.post("/api/applications/:id/interviews", async (c) => {
    const user = c.get("user");
    const db = c.get("db");
    const id = pathParam(c, "id");
    const body = await parseBody(c, interviewBody);
    if (body.date > tokyoToday()) throw validationFailed("A date cannot be in the future.", ["date"]);
    if (body.howItWent === "" && body.questions.length === 0) {
      throw validationFailed(EMPTY_ENTRY, ["howItWent", "questions"]);
    }

    const { row, steps, standing } = await readStanding(db, user.id, id);
    const next = standingAfterInterview(standing, body.round, body.date);
    const step = next.step !== standing.step ? next.step : null;
    const interviewId = newId("interview");

    // An entry is a change to the application whether or not it moves the
    // status, so the same write marks it as changed now.
    await saveStanding(db, user.id, id, row, steps, next, [
      db.insert(interviews).values({
        id: interviewId,
        userId: user.id,
        applicationId: id,
        happenedOn: body.date,
        round: body.round,
        who: body.who,
        howItWent: body.howItWent,
      }),
      ...body.questions.map((text, position) =>
        db.insert(interviewQuestions).values({ id: newId("interviewQuestion"), userId: user.id, interviewId, position, text }),
      ),
    ]);
    // Ids, the round and a count. Never who, the notes or a question.
    console.log(
      JSON.stringify({
        event: "interview_added",
        applicationId: id,
        interviewId,
        round: body.round,
        questions: body.questions.length,
        movedTo: step,
      }),
    );

    return c.json(await detail(db, user.id, id), 201);
  });

  /** Attaches a link to a recording kept elsewhere to an entry. Only the link is kept. */
  api.post("/api/applications/:id/interviews/:interviewId/recordings", async (c) => {
    const user = c.get("user");
    const db = c.get("db");
    const id = pathParam(c, "id");
    const interviewId = pathParam(c, "interviewId");
    const body = await parseBody(c, recordingLinkBody);

    const { row, steps, standing } = await readStanding(db, user.id, id);
    await requireInterview(db, user.id, id, interviewId);
    const recordingId = newId("interviewRecording");

    await saveStanding(db, user.id, id, row, steps, standing, [
      db.insert(interviewRecordings).values({
        id: recordingId,
        userId: user.id,
        interviewId,
        kind: "link",
        url: body.url,
        label: body.label,
      }),
    ]);
    // Ids and the kind. Never the link or what the author called it.
    console.log(
      JSON.stringify({ event: "recording_added", applicationId: id, interviewId, recordingId, kind: "link" }),
    );

    return c.json(await detail(db, user.id, id), 201);
  });

  /**
   * Removes a recording for good. The link and its label are emptied and the
   * row stays, so the entry keeps a line saying one was removed and when.
   */
  api.delete("/api/applications/:id/interviews/:interviewId/recordings/:recordingId", async (c) => {
    const user = c.get("user");
    const db = c.get("db");
    const id = pathParam(c, "id");
    const interviewId = pathParam(c, "interviewId");
    const recordingId = pathParam(c, "recordingId");

    const { row, steps, standing } = await readStanding(db, user.id, id);
    await requireInterview(db, user.id, id, interviewId);
    const live = and(
      eq(interviewRecordings.userId, user.id),
      eq(interviewRecordings.interviewId, interviewId),
      eq(interviewRecordings.id, recordingId),
      isNull(interviewRecordings.removedAt),
    );
    const [recording] = await db.select({ id: interviewRecordings.id }).from(interviewRecordings).where(live).limit(1);
    // One already removed is a miss too: there is nothing left of it to remove.
    if (!recording) throw notFound("That recording");

    const now = new Date();
    await saveStanding(db, user.id, id, row, steps, standing, [
      db.update(interviewRecordings).set({ url: null, label: "", removedAt: now, updatedAt: now }).where(live),
    ]);
    console.log(JSON.stringify({ event: "recording_removed", applicationId: id, interviewId, recordingId }));

    return c.json(await detail(db, user.id, id));
  });
}
