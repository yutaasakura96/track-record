/**
 * Interview entries (`docs/07-api-design.md` §9b, issue #72).
 *
 * One entry an interview, written by hand: the day, the round, who it was
 * with, how it went, and the questions asked as rows of their own in the order
 * given. No route here reaches a model, and no model reads an entry.
 *
 * Saving an entry for a round later than the step the application is at moves
 * it to that round, with the entry's day as the step's date. The entry, its
 * questions and the move are one transaction, through the same
 * `saveStanding` every other change to where an application stands uses, so
 * the dates it replaces are superseded and Undo can put them back.
 *
 * An interviewer's name, the notes and the questions are other people's words.
 * No log line carries any of them: an id, a round, a count.
 */
import type { Hono } from "hono";
import { z } from "zod";
import { interviewQuestions, interviews } from "../db/schema";
import { validationFailed, pathParam } from "../http/errors";
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
}
