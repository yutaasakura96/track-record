/**
 * Uploaded recordings on an interview entry (`docs/07-api-design.md` §9b,
 * issue #76): putting an audio file on an entry, and playing or downloading
 * it. Adding a link and removing either kind are in `./interviews.ts`, beside
 * the entry they hang from.
 *
 * The upload is the raw body of one request, never a form, and goes to R2 as a
 * stream (`services/recording-store.ts`). The file is stored FIRST and its row
 * written after, through the same `saveStanding` as every other change to the
 * application, so a row never names a file that is not there and an upload cut
 * off half way leaves nothing listed. A row that then cannot be written takes
 * the file just stored with it.
 *
 * Only the owner, signed in, reaches a file: the session is required as on
 * every route, and the row is read by `user_id`, the application and the
 * entry before anything is read from the bucket. A recording is never sent to
 * a model and is not in the export.
 *
 * The file's name is the author's words, often other people's names. No log
 * line carries it: ids, the type and the size.
 */
import type { Hono } from "hono";
import { and, eq, isNull } from "drizzle-orm";
import { interviewRecordings } from "../db/schema";
import { ApiError, notFound, pathParam, validationFailed } from "../http/errors";
import { newId } from "../http/ids";
import { routes } from "../http/registry";
import { detail, readStanding, saveStanding } from "./applications";
import { requireInterview } from "./interviews";
import { dispositionOf } from "../http/disposition";
import {
  deleteRecordings,
  peekBody,
  putRecording,
  recordingObjectKey,
  recordingResponse,
} from "../services/recording-store";
import { RECORDING_MAX_BYTES, audioTypeOf, emptyFile, keptFileName, notAudio, tooLarge } from "~/shared/recording";
import type { AppEnv } from "../env";

/** Twelve hours. A duration past it is not one a browser read from an interview. */
const DURATION_MAX = 12 * 60 * 60;

export function registerRecordingRoutes(app: Hono<AppEnv>) {
  const api = routes(app);

  /**
   * Uploads an audio file to an entry. The body is the file; `X-File-Name`
   * carries its name, URI-encoded, and `X-Duration-Seconds` how long it plays
   * when the browser could read that. `201` + the application.
   */
  api.post("/api/applications/:id/interviews/:interviewId/recordings/audio", async (c) => {
    const user = c.get("user");
    const db = c.get("db");
    const id = pathParam(c, "id");
    const interviewId = pathParam(c, "interviewId");
    const body = c.req.raw.body;

    // Checked before a byte of the file is read: a miss is a miss whatever was sent.
    await readStanding(db, user.id, id);
    await requireInterview(db, user.id, id, interviewId);

    let name = "";
    try {
      name = keptFileName(decodeURIComponent(c.req.header("x-file-name") ?? ""));
    } catch {
      name = "";
    }
    if (name === "") throw validationFailed("Give the file a name.", ["fileName"]);

    const declared = c.req.header("content-length");
    const length = declared && /^\d+$/.test(declared) ? Number(declared) : NaN;
    if (!Number.isSafeInteger(length)) {
      throw validationFailed("The file's size was not sent, so it was not stored. Try again.", ["file"]);
    }
    if (length === 0 || !body) throw validationFailed(emptyFile(name), ["file"]);
    if (length > RECORDING_MAX_BYTES) throw validationFailed(tooLarge(name, length), ["file"]);

    const durationHeader = c.req.header("x-duration-seconds");
    const durationSeconds =
      durationHeader && /^\d+$/.test(durationHeader) && Number(durationHeader) <= DURATION_MAX ? Number(durationHeader) : null;

    const peeked = await peekBody(body, length);
    const contentType = audioTypeOf(peeked.head);
    if (!contentType) {
      await peeked.cancel();
      throw validationFailed(notAudio(name), ["file"]);
    }

    const recordingId = newId("interviewRecording");
    const key = recordingObjectKey(user.id, recordingId);
    try {
      await putRecording(c.env.RECORDINGS, key, peeked.stream(), contentType);
    } catch {
      // Cut off, or a size that did not match what arrived. Nothing is stored.
      console.log(JSON.stringify({ event: "recording_upload_failed", applicationId: id, interviewId, bytes: length }));
      throw new ApiError("upstream_unavailable", "The whole file did not arrive, so nothing was kept. Try again.");
    }

    try {
      // Read again now: the upload took a while, and what was read before it may be stale.
      const { row, steps, standing } = await readStanding(db, user.id, id);
      await requireInterview(db, user.id, id, interviewId);
      await saveStanding(db, user.id, id, row, steps, standing, [
        db.insert(interviewRecordings).values({
          id: recordingId,
          userId: user.id,
          interviewId,
          kind: "upload",
          fileName: name,
          byteSize: length,
          contentType,
          durationSeconds,
        }),
      ]);
    } catch (error) {
      await deleteRecordings(c.env.RECORDINGS, [key]);
      throw error;
    }
    // Ids, the type and the size. Never the file's name.
    console.log(
      JSON.stringify({
        event: "recording_added",
        applicationId: id,
        interviewId,
        recordingId,
        kind: "upload",
        contentType,
        bytes: length,
      }),
    );

    return c.json(await detail(db, user.id, id), 201);
  });

  /**
   * An uploaded recording, to play in the page (`Range` is honoured, which is
   * what seeking asks for) or, with `?download`, to save. `404` for anything
   * that is not a live upload on that entry of that application of this user.
   */
  api.get("/api/applications/:id/interviews/:interviewId/recordings/:recordingId/audio", async (c) => {
    const user = c.get("user");
    const db = c.get("db");
    const id = pathParam(c, "id");
    const interviewId = pathParam(c, "interviewId");
    const recordingId = pathParam(c, "recordingId");

    await requireInterview(db, user.id, id, interviewId);
    const [file] = await db
      .select({
        fileName: interviewRecordings.fileName,
        byteSize: interviewRecordings.byteSize,
        contentType: interviewRecordings.contentType,
      })
      .from(interviewRecordings)
      .where(
        and(
          eq(interviewRecordings.userId, user.id),
          eq(interviewRecordings.interviewId, interviewId),
          eq(interviewRecordings.id, recordingId),
          eq(interviewRecordings.kind, "upload"),
          isNull(interviewRecordings.removedAt),
        ),
      )
      .limit(1);
    if (!file?.fileName || file.byteSize === null || !file.contentType) throw notFound("That recording");

    const response = await recordingResponse(
      c.env.RECORDINGS,
      recordingObjectKey(user.id, recordingId),
      {
        byteSize: file.byteSize,
        contentType: file.contentType,
        disposition: dispositionOf(c.req.query("download") === undefined ? "inline" : "attachment", file.fileName),
      },
      c.req.header("range") ?? null,
    );
    if (!response) throw notFound("That recording");
    return response;
  });
}
