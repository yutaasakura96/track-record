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
 * A saved entry can be corrected and deleted (issue #81). A correction
 * overwrites the entry in place and keeps the id of every question that
 * stays; a corrected day is followed by the date of its round's step
 * (`standingAfterEdit`). Deleting sets `removed_at` and keeps the row, takes
 * the entry's recording links with it for good, and leaves the status and its
 * dates where they are. Both are changes to the application like any other
 * here: one transaction, through `saveStanding`.
 *
 * A recording on an entry is a link to one kept elsewhere (issue #74), of
 * which only the link is stored and nothing here fetches it, or an uploaded
 * audio file (#76, uploaded and played in `./recordings.ts`). It is the one
 * thing the author can remove: an upload's file is deleted from the bucket,
 * and then its row is emptied as a link's is. Adding and removing one are
 * changes to the application, so both go through `saveStanding` with the
 * standing as it was, which marks the application as changed and refuses a
 * write over a newer one.
 *
 * An interviewer's name, the notes, the questions and a recording's link and
 * label are other people's words. No log line carries any of them: an id, a
 * round, a count.
 */
import type { Hono } from "hono";
import { and, asc, eq, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { z } from "zod";
import type { Db } from "../db/client";
import { interviewQuestions, interviewRecordings, interviews } from "../db/schema";
import { notFound, validationFailed, pathParam } from "../http/errors";
import { routes } from "../http/registry";
import { newId } from "../http/ids";
import { parseBody } from "../services/validate";
import { deleteRecordings, recordingObjectKey } from "../services/recording-store";
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
  standingAfterEdit,
  standingAfterInterview,
} from "~/shared/interview";
import { LABEL_MAX, LINK_MAX, NOT_A_LINK, isWebLink } from "~/shared/recording";
import type { AppEnv } from "../env";

const questionText = z
  .string()
  .trim()
  .max(QUESTION_MAX, `Keep each question under ${QUESTION_MAX.toLocaleString("en-US")} characters.`);
const TOO_MANY_QUESTIONS = `An interview holds at most ${QUESTIONS_MAX} questions.`;

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
    .array(questionText)
    .max(QUESTIONS_MAX, TOO_MANY_QUESTIONS)
    .default([])
    .transform((items) => items.filter((item) => item !== "")),
});

/**
 * An entry as its correction sends it: the same fields, whole, with each
 * question it keeps named by its id so that the question stays the row it was.
 * One with no id is new.
 */
const interviewEditBody = interviewBody.extend({
  questions: z
    .array(z.strictObject({ id: z.string().optional(), text: questionText }))
    .max(QUESTIONS_MAX, TOO_MANY_QUESTIONS)
    .default([])
    .transform((items) => items.filter((item) => item.text !== "")),
});

const recordingLinkBody = z.strictObject({
  url: z.string().trim().max(LINK_MAX, "That link is too long.").refine(isWebLink, NOT_A_LINK),
  label: z.string().trim().max(LABEL_MAX, `Keep what it is under ${LABEL_MAX} characters.`).default(""),
});

/**
 * A recording as removing leaves it, either kind: stamped, and nothing left
 * that said what it was or where it lived. The checks on the table refuse less.
 */
const EMPTIED = (now: Date) => ({
  url: null,
  label: "",
  fileName: null,
  byteSize: null,
  contentType: null,
  durationSeconds: null,
  removedAt: now,
  updatedAt: now,
});

/** What every saved entry must satisfy, new or corrected. */
function checkEntry(entry: { date: string; howItWent: string; questions: unknown[] }) {
  if (entry.date > tokyoToday()) throw validationFailed("A date cannot be in the future.", ["date"]);
  if (entry.howItWent === "" && entry.questions.length === 0) {
    throw validationFailed(EMPTY_ENTRY, ["howItWent", "questions"]);
  }
}

/** A miss is a 404, and so is an entry of another application or another user, or one that was deleted. */
export async function requireInterview(db: Db, userId: string, applicationId: string, interviewId: string) {
  const [row] = await db
    .select({
      id: interviews.id,
      date: interviews.happenedOn,
      round: interviews.round,
      who: interviews.who,
      howItWent: interviews.howItWent,
    })
    .from(interviews)
    .where(
      and(
        eq(interviews.userId, userId),
        eq(interviews.applicationId, applicationId),
        eq(interviews.id, interviewId),
        isNull(interviews.removedAt),
      ),
    )
    .limit(1);
  if (!row) throw notFound("That interview");
  return row;
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
    checkEntry(body);

    const { row, steps, standing } = await readStanding(db, user.id, id);
    const next = standingAfterInterview(standing, body.round, body.date);
    const step = next.step !== standing.step ? next.step : null;
    const interviewId = newId("interview");

    // An entry is a change to the application whether or not it moves the
    // status, so the same write marks it as changed now.
    const frozen = await saveStanding(db, user.id, id, row, steps, next, [
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

    return c.json({ ...(await detail(db, user.id, id)), frozen }, 201);
  });

  /**
   * Corrects an entry: every field, whole, over what was saved. A question
   * sent with its id stays the row it was, in its new place and with its new
   * words; one left out is stamped removed, and one with no id is new.
   *
   * A changed day or round is a change to where the application stands, by
   * `standingAfterEdit`. A correction that changes nothing writes nothing.
   */
  api.put("/api/applications/:id/interviews/:interviewId", async (c) => {
    const user = c.get("user");
    const db = c.get("db");
    const id = pathParam(c, "id");
    const interviewId = pathParam(c, "interviewId");
    const body = await parseBody(c, interviewEditBody);
    checkEntry(body);

    const { row, steps, standing } = await readStanding(db, user.id, id);
    const entry = await requireInterview(db, user.id, id, interviewId);
    const ofEntry = and(eq(interviewQuestions.userId, user.id), eq(interviewQuestions.interviewId, interviewId), isNull(interviewQuestions.removedAt));
    const stored = await db
      .select({ id: interviewQuestions.id, position: interviewQuestions.position, text: interviewQuestions.text })
      .from(interviewQuestions)
      .where(ofEntry)
      .orderBy(asc(interviewQuestions.position));

    const storedBy = new Map(stored.map((question) => [question.id, question]));
    const kept = new Set(body.questions.flatMap((question) => question.id ?? []));
    const named = body.questions.filter((question) => question.id !== undefined).length;
    if (kept.size !== named || [...kept].some((questionId) => !storedBy.has(questionId))) {
      throw validationFailed("Those are not this interview's questions as it is now. Reload it and try again.", ["questions"]);
    }

    const same =
      body.date === entry.date &&
      body.round === entry.round &&
      body.who === entry.who &&
      body.howItWent === entry.howItWent &&
      body.questions.length === stored.length &&
      body.questions.every((question, position) => question.id === stored[position]!.id && question.text === stored[position]!.text);
    if (same) return c.json(await detail(db, user.id, id));

    const sameDateEntries = body.round === entry.round && body.date !== entry.date
      ? await db.select({ id: interviews.id }).from(interviews).where(and(
          eq(interviews.userId, user.id),
          eq(interviews.applicationId, id),
          ne(interviews.id, interviewId),
          eq(interviews.round, entry.round),
          eq(interviews.happenedOn, entry.date),
          isNull(interviews.removedAt),
        )).limit(1)
      : [];
    const next = standingAfterEdit(standing, entry, body, sameDateEntries.length > 0);
    const step = next.step !== standing.step ? next.step : null;
    const now = new Date();
    const gone = stored.filter((question) => !kept.has(question.id)).map((question) => question.id);

    // `(interview_id, position)` is unique and checked a row at a time, so a
    // question that changes place is parked below zero, where no place is,
    // until the ones leaving are gone and the new ones are in.
    const placed: BatchItem<"pg">[] = [];
    let parked = false;
    body.questions.forEach((question, position) => {
      if (question.id === undefined) return;
      const was = storedBy.get(question.id)!;
      if (was.position === position && was.text === question.text) return;
      parked ||= was.position !== position;
      placed.push(
        db
          .update(interviewQuestions)
          .set({ position: was.position === position ? position : -position - 1, text: question.text, updatedAt: now })
          .where(and(ofEntry, eq(interviewQuestions.id, question.id))),
      );
    });

    const frozen = await saveStanding(
      db,
      user.id,
      id,
      row,
      steps,
      next,
      [
        db
          .update(interviews)
          .set({ happenedOn: body.date, round: body.round, who: body.who, howItWent: body.howItWent, updatedAt: now })
          .where(and(eq(interviews.userId, user.id), eq(interviews.id, interviewId))),
        ...(gone.length > 0 ? [db.update(interviewQuestions).set({ removedAt: now, updatedAt: now }).where(and(ofEntry, inArray(interviewQuestions.id, gone)))] : []),
        ...placed,
        ...body.questions.flatMap((question, position) =>
          question.id === undefined
            ? [db.insert(interviewQuestions).values({ id: newId("interviewQuestion"), userId: user.id, interviewId, position, text: question.text })]
            : [],
        ),
        ...(parked
          ? [
              db
                .update(interviewQuestions)
                .set({ position: sql`-${interviewQuestions.position} - 1` })
                .where(and(ofEntry, lt(interviewQuestions.position, 0))),
            ]
          : []),
      ],
      // A day put right under the step it is at is a correction, and a copy frozen by that date follows it.
      step ? "move" : "correct",
    );
    // Ids, the round and a count. Never who, the notes or a question.
    console.log(
      JSON.stringify({
        event: "interview_edited",
        applicationId: id,
        interviewId,
        round: body.round,
        questions: body.questions.length,
        movedTo: step,
      }),
    );

    return c.json({ ...(await detail(db, user.id, id)), frozen });
  });

  /**
   * Deletes an entry. The row and its questions are kept and no page reads
   * them again; its recordings are removed for good, as removing each would,
   * uploaded files deleted. The status and its dates stay where they are.
   */
  api.delete("/api/applications/:id/interviews/:interviewId", async (c) => {
    const user = c.get("user");
    const db = c.get("db");
    const id = pathParam(c, "id");
    const interviewId = pathParam(c, "interviewId");

    const { row, steps, standing } = await readStanding(db, user.id, id);
    await requireInterview(db, user.id, id, interviewId);

    // Its uploaded files go first, so a delete that fails after them is
    // finished by trying again rather than leaving a row naming a file.
    const uploads = await db
      .select({ id: interviewRecordings.id })
      .from(interviewRecordings)
      .where(
        and(
          eq(interviewRecordings.userId, user.id),
          eq(interviewRecordings.interviewId, interviewId),
          eq(interviewRecordings.kind, "upload"),
          isNull(interviewRecordings.removedAt),
        ),
      );
    await deleteRecordings(c.env.RECORDINGS, uploads.map((upload) => recordingObjectKey(user.id, upload.id)));

    const now = new Date();
    await saveStanding(db, user.id, id, row, steps, standing, [
      db
        .update(interviews)
        .set({ removedAt: now, updatedAt: now })
        .where(and(eq(interviews.userId, user.id), eq(interviews.id, interviewId), isNull(interviews.removedAt))),
      db
        .update(interviewRecordings)
        .set(EMPTIED(now))
        .where(
          and(
            eq(interviewRecordings.userId, user.id),
            eq(interviewRecordings.interviewId, interviewId),
            isNull(interviewRecordings.removedAt),
          ),
        ),
    ]);
    console.log(JSON.stringify({ event: "interview_removed", applicationId: id, interviewId }));

    return c.json(await detail(db, user.id, id));
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
   * Removes a recording for good. An upload's file is deleted from the bucket
   * first; then the link and its label, or what described the file, are
   * emptied and the row stays, so the entry keeps a line saying one was
   * removed and when.
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
    const [recording] = await db
      .select({ id: interviewRecordings.id, kind: interviewRecordings.kind })
      .from(interviewRecordings)
      .where(live)
      .limit(1);
    // One already removed is a miss too: there is nothing left of it to remove.
    if (!recording) throw notFound("That recording");
    // Deleting a file already gone is not an error, so a removal that failed after this is finished by trying again.
    if (recording.kind === "upload") await deleteRecordings(c.env.RECORDINGS, [recordingObjectKey(user.id, recordingId)]);

    const now = new Date();
    await saveStanding(db, user.id, id, row, steps, standing, [
      db.update(interviewRecordings).set(EMPTIED(now)).where(live),
    ]);
    console.log(
      JSON.stringify({ event: "recording_removed", applicationId: id, interviewId, recordingId, kind: recording.kind }),
    );

    return c.json(await detail(db, user.id, id));
  });
}
