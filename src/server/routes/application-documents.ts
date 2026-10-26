/**
 * An application's documents and its sent copies (`docs/07-api-design.md` §9c,
 * issue #71).
 *
 * Before Applied the owner chooses: a tailored résumé or a tailored 履歴書 made
 * from the job description, any of the main résumé, 履歴書 and 職務経歴書, or
 * several. An application sends one 履歴書, so before Applied the main and the
 * tailored one are never on it together (`docs/06`, 2026-10-26). From Applied
 * onward nothing is chosen any more, only recorded: `Record another sent copy`
 * freezes whatever is ticked, always, and compares nothing.
 *
 * Leaving Not applied for any step, by a move or by Undo, is the other moment
 * a copy is frozen. It lives with the status routes in `./applications.ts`,
 * because the change and its copies are one transaction.
 *
 * No log line here carries a company, a title or any text of a document: ids
 * and counts.
 */
import type { Hono } from "hono";
import { and, eq, inArray, isNull } from "drizzle-orm";
import PizZip from "pizzip";
import { z } from "zod";
import { applicationDocuments, applicationSentCopies, renders } from "../db/schema";
import { storedBytes } from "../db/bytes";
import { ApiError, notFound, pathParam, validationFailed, violatesUnique } from "../http/errors";
import { routes } from "../http/registry";
import { newId } from "../http/ids";
import { parseBody } from "../services/validate";
import { documentTitle, freezeDocuments, liveCopies } from "../services/application-documents";
import { mainRender } from "../services/render-ref";
import { photoResponse } from "../services/rirekisho";
import { detail, markActivity, requireApplication } from "./applications";
import { DOCX_MIME } from "~/render/docx";
import { attachment } from "../http/disposition";
import { tokyoToday } from "~/render/rirekisho";
import type { SentPage } from "~/render/sent-page";
import { readSheet } from "~/render/sheet";
import { photoOf } from "~/render/rirekisho-photo";
import {
  MAIN_RIREKISHO_HELD,
  SENDABLE_KINDS,
  SENDABLE_TITLE,
  TAILORED_KINDS,
  isSendableKind,
  isTailoredKind,
  type TailoredKind,
} from "~/shared/application-documents";
import { RENDER_LANGUAGE, type RenderKind } from "~/shared/render-content";
import type { AppEnv } from "../env";
import type { Db } from "../db/client";

const unique = <T>(items: T[]) => new Set(items).size === items.length;

const chosenBody = z.strictObject({
  documents: z.array(z.enum(SENDABLE_KINDS)).refine(unique, "A document can be ticked once."),
});
const sentBody = z.strictObject({
  documents: z
    .array(z.string().min(1).max(64))
    .min(1, "Tick at least one document.")
    .max(SENDABLE_KINDS.length + TAILORED_KINDS.length, "That is more documents than an application can send.")
    .refine(unique, "A document can be ticked once."),
});

type ApplicationRow = Awaited<ReturnType<typeof requireApplication>>;
type RenderRow = typeof renders.$inferSelect;

export function registerApplicationDocumentRoutes(app: Hono<AppEnv>) {
  const api = routes(app);

  /**
   * Which of the main résumé, 履歴書 and 職務経歴書 this application uses: the
   * ticked ones, whole. A document left unticked is taken off; a tailored
   * document is not on this list and is left alone. Only before Applied: after
   * that, what was sent is recorded, not chosen. The main 履歴書 is refused
   * while the application's own 履歴書 is on it.
   */
  api.put("/api/applications/:id/documents", async (c) => {
    const user = c.get("user");
    const db = c.get("db");
    const id = pathParam(c, "id");
    const body = await parseBody(c, chosenBody);
    const application = await requireApplication(db, user.id, id);
    refuseOnceApplied(application, "From Applied onward a document is added by recording it as sent.");

    const ticked = await requireDocuments(db, user.id, application, body.documents);
    if (ticked.some((render) => render.kind === "rirekisho")) {
      const own = await ownTailored(db, user.id, id, "rirekisho");
      if (own && (await isOn(db, user.id, id, own.id))) throw new ApiError("conflict", MAIN_RIREKISHO_HELD);
    }
    const [mains, on] = await db.batch([
      db
        .select({ id: renders.id })
        .from(renders)
        .where(and(eq(renders.userId, user.id), isNull(renders.jobDescription), inArray(renders.kind, [...SENDABLE_KINDS]))),
      db.select({ id: applicationDocuments.id, renderId: applicationDocuments.renderId }).from(applicationDocuments).where(onApplication(user.id, id)),
    ]);
    const main = new Set(mains.map((row) => row.id));
    const wanted = new Set(ticked.map((render) => render.id));
    const added = ticked.filter((render) => !on.some((row) => row.renderId === render.id));
    const removed = on.filter((row) => main.has(row.renderId) && !wanted.has(row.renderId));
    // The same ticks saved again: nothing is written, and it is not activity.
    if (added.length === 0 && removed.length === 0) return c.json(await detail(db, user.id, id));

    const now = new Date();
    await db.batch([
      markActivity(db, user.id, id, now),
      ...removed.map((row) => takeOff(db, user.id, row.id, now)),
      ...added.map((render) => putOn(db, user.id, id, render.id)),
    ]);
    console.log(JSON.stringify({ event: "application_documents_set", applicationId: id, added: added.length, removed: removed.length }));
    return c.json(await detail(db, user.id, id));
  });

  /** Takes one document off the application. The document itself is untouched. */
  api.delete("/api/applications/:id/documents/:ref", async (c) => {
    const user = c.get("user");
    const db = c.get("db");
    const id = pathParam(c, "id");
    const application = await requireApplication(db, user.id, id);
    refuseOnceApplied(application, "A document stays on its application once the application is Applied.");

    const render = await findDocument(db, user.id, application, pathParam(c, "ref"));
    const [row] = render
      ? await db
          .select({ id: applicationDocuments.id })
          .from(applicationDocuments)
          .where(and(onApplication(user.id, id), eq(applicationDocuments.renderId, render.id)))
          .limit(1)
      : [];
    if (!row) throw notFound("That document on this application");

    const now = new Date();
    await db.batch([markActivity(db, user.id, id, now), takeOff(db, user.id, row.id, now)]);
    console.log(JSON.stringify({ event: "application_documents_set", applicationId: id, added: 0, removed: 1 }));
    return c.json(await detail(db, user.id, id));
  });

  /**
   * Stores this application's tailored document of a kind, a résumé or a
   * 履歴書, and puts it on the application. It generates nothing: the screen
   * asks for the first version with the Generate every document has, so a
   * refusal there (no usable fact, a missing profile field) is said the way it
   * is said everywhere else, and the document is still on the application to
   * generate later.
   *
   * An application has one of each. Asked again, this answers with the one it
   * has, put back on the application if it had been taken off. Before Applied,
   * putting a tailored 履歴書 on takes the main 履歴書 off, in the same batch,
   * and `replaced` names it so the screen can say so.
   */
  api.post("/api/applications/:id/tailored/:kind", async (c) => {
    const user = c.get("user");
    const db = c.get("db");
    const id = pathParam(c, "id");
    const kind = pathParam(c, "kind");
    if (!isTailoredKind(kind)) {
      throw validationFailed("An application can have its own résumé or its own 履歴書, and no other document.", ["kind"]);
    }
    const application = await requireApplication(db, user.id, id);

    let existing = await ownTailored(db, user.id, id, kind);
    const created = !existing;
    if (!existing) {
      const renderId = newId("render");
      try {
        await db.insert(renders).values({
          id: renderId,
          userId: user.id,
          kind,
          label: application.company,
          jobDescription: application.jobDescription,
          applicationId: id,
        });
        // An id, a kind and a length. Never the text: a job description names a company.
        console.log(JSON.stringify({ event: "tailored_document_created", renderId, applicationId: id, kind, characters: application.jobDescription.length }));
      } catch (error) {
        // Two requests at once. The index let one in, and that one is the document.
        if (!violatesUnique(error, "renders_application_uq")) throw error;
      }
      existing = await ownTailored(db, user.id, id, kind);
      if (!existing) throw new ApiError("internal", "The document could not be stored. Try again.");
    }

    const replaced: string[] = [];
    if (!(await isOn(db, user.id, id, existing.id))) {
      // One 履歴書 before Applied: the main one makes way, and is still a
      // document on Home, untouched.
      const main =
        kind === "rirekisho" && application.currentStep === "not_applied"
          ? await mainOn(db, user.id, id, "rirekisho")
          : undefined;
      const now = new Date();
      try {
        await db.batch([
          markActivity(db, user.id, id, now),
          ...(main ? [takeOff(db, user.id, main, now)] : []),
          putOn(db, user.id, id, existing.id),
        ]);
        if (main) replaced.push(SENDABLE_TITLE.rirekisho);
      } catch (error) {
        if (!violatesUnique(error, "application_documents_live_uq")) throw error;
      }
    }
    return c.json({ ...(await detail(db, user.id, id)), replaced }, created ? 201 : 200);
  });

  /**
   * `Record another sent copy`. Each ticked document is frozen as a further
   * copy, dated today, whether or not it was sent before and whether or not it
   * has changed since: nothing is compared. One not yet on the application is
   * put on it.
   */
  api.post("/api/applications/:id/sent-copies", async (c) => {
    const user = c.get("user");
    const db = c.get("db");
    const id = pathParam(c, "id");
    const body = await parseBody(c, sentBody);
    const application = await requireApplication(db, user.id, id);
    if (application.currentStep === "not_applied") {
      throw new ApiError(
        "conflict",
        "A sent copy is recorded once the application is Applied. Moving it to Applied freezes the documents on it.",
      );
    }

    const documents = await requireDocuments(db, user.id, application, body.documents);
    const now = new Date();
    const made = await freezeDocuments(db, user.id, application, documents, {
      sentOn: tokyoToday(now),
      recordedAt: now,
      frozenStepId: null,
    });
    const on = await db.select({ renderId: applicationDocuments.renderId }).from(applicationDocuments).where(onApplication(user.id, id));
    const missing = documents.filter((render) => !on.some((row) => row.renderId === render.id));

    await db.batch([
      markActivity(db, user.id, id, now),
      ...missing.map((render) => putOn(db, user.id, id, render.id)),
      ...made.rows.map((copy) => db.insert(applicationSentCopies).values(copy)),
    ]);
    console.log(JSON.stringify({ event: "application_copies_recorded", applicationId: id, copies: made.rows.length }));
    return c.json({ ...(await detail(db, user.id, id)), frozen: made.named }, 201);
  });

  /** One sent copy, to read (`docs/10` Screen 15): what the file said, as it was taken that day. */
  api.get("/api/applications/:id/sent-copies/:copyId", async (c) => {
    const user = c.get("user");
    const db = c.get("db");
    const id = pathParam(c, "id");
    const application = await requireApplication(db, user.id, id);
    const [copy] = await db
      .select({
        id: applicationSentCopies.id,
        kind: applicationSentCopies.kind,
        title: applicationSentCopies.title,
        versionNo: applicationSentCopies.versionNo,
        filename: applicationSentCopies.filename,
        page: applicationSentCopies.page,
        sentOn: applicationSentCopies.sentOn,
        recordedAt: applicationSentCopies.recordedAt,
      })
      .from(applicationSentCopies)
      .where(and(liveCopies(user.id, id), eq(applicationSentCopies.id, pathParam(c, "copyId"))))
      .limit(1);
    // Asked for under another application it is a 404, as another user's is.
    if (!copy) throw notFound("That sent copy");

    return c.json({
      ...copy,
      page: await withSheet(db, user.id, copy),
      recordedAt: copy.recordedAt.toISOString(),
      language: RENDER_LANGUAGE[copy.kind as RenderKind],
      applicationId: id,
      company: application.company,
    });
  });

  /** The stored file, byte for byte. Never a fresh one. */
  api.get("/api/applications/:id/sent-copies/:copyId/download", async (c) => {
    const user = c.get("user");
    const db = c.get("db");
    const id = pathParam(c, "id");
    await requireApplication(db, user.id, id);
    const [copy] = await db
      .select({ file: applicationSentCopies.file, filename: applicationSentCopies.filename, kind: applicationSentCopies.kind })
      .from(applicationSentCopies)
      .where(and(liveCopies(user.id, id), eq(applicationSentCopies.id, pathParam(c, "copyId"))))
      .limit(1);
    if (!copy) throw notFound("That sent copy");

    return new Response(storedBytes(copy.file) as BodyInit, {
      headers: {
        "content-type": DOCX_MIME,
        // A Japanese document's copy is named in Japanese (issue #117); the
        // ASCII name beside it is its kind and its date.
        "content-disposition": attachment(copy.filename, asciiCopyName(copy.kind, copy.filename)),
      },
    });
  });

  /**
   * The 写真 a 履歴書 copy was sent with, read out of its stored file: the
   * photo as it was that day, which the profile's may no longer be. `404` for a
   * copy that carries none. Never cached, as the profile's is not.
   */
  api.get("/api/applications/:id/sent-copies/:copyId/photo", async (c) => {
    const user = c.get("user");
    const db = c.get("db");
    const id = pathParam(c, "id");
    await requireApplication(db, user.id, id);
    const [copy] = await db
      .select({ file: applicationSentCopies.file, kind: applicationSentCopies.kind })
      .from(applicationSentCopies)
      .where(and(liveCopies(user.id, id), eq(applicationSentCopies.id, pathParam(c, "copyId"))))
      .limit(1);
    if (!copy || copy.kind !== "rirekisho") throw notFound("That photo");
    let photo: ReturnType<typeof photoOf> = null;
    try {
      photo = photoOf(new PizZip(storedBytes(copy.file)));
    } catch {
      photo = null;
    }
    if (!photo) throw notFound("That photo");
    return photoResponse(photo);
  });
}

/* ------------------------------------------------------------------ shared */

const onApplication = (userId: string, applicationId: string) =>
  and(
    eq(applicationDocuments.userId, userId),
    eq(applicationDocuments.applicationId, applicationId),
    isNull(applicationDocuments.removedAt),
  );

const putOn = (db: Db, userId: string, applicationId: string, renderId: string) =>
  db.insert(applicationDocuments).values({ id: newId("applicationDocument"), userId, applicationId, renderId });

/** Off the application, and still a row: nothing is deleted. */
const takeOff = (db: Db, userId: string, id: string, now: Date) =>
  db
    .update(applicationDocuments)
    .set({ removedAt: now, updatedAt: now })
    .where(and(eq(applicationDocuments.userId, userId), eq(applicationDocuments.id, id)));

function refuseOnceApplied(application: ApplicationRow, message: string) {
  if (application.currentStep !== "not_applied") throw new ApiError("conflict", message);
}

/** The tailored document of a kind written for this application, on it or taken off it. */
async function ownTailored(db: Db, userId: string, applicationId: string, kind: TailoredKind): Promise<RenderRow | undefined> {
  const [render] = await db
    .select()
    .from(renders)
    .where(and(eq(renders.userId, userId), eq(renders.applicationId, applicationId), eq(renders.kind, kind)))
    .limit(1);
  return render;
}

/** Whether a document is on this application now. */
async function isOn(db: Db, userId: string, applicationId: string, renderId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: applicationDocuments.id })
    .from(applicationDocuments)
    .where(and(onApplication(userId, applicationId), eq(applicationDocuments.renderId, renderId)))
    .limit(1);
  return row !== undefined;
}

/** The pointer row of the main document of a kind, when it is on this application. */
async function mainOn(db: Db, userId: string, applicationId: string, kind: RenderKind): Promise<string | undefined> {
  const [row] = await db
    .select({ id: applicationDocuments.id })
    .from(applicationDocuments)
    .innerJoin(renders, and(eq(renders.id, applicationDocuments.renderId), mainRender(userId, kind)))
    .where(onApplication(userId, applicationId))
    .limit(1);
  return row?.id;
}

/**
 * The document a ref names for this application: one of the three by its kind,
 * or one of this application's own tailored documents by its id. Another
 * application's tailored document is not one of this one's, and neither is a
 * career story.
 */
async function findDocument(db: Db, userId: string, application: ApplicationRow, ref: string): Promise<RenderRow | undefined> {
  if (isSendableKind(ref)) {
    const [render] = await db.select().from(renders).where(mainRender(userId, ref)).limit(1);
    return render;
  }
  const [own] = await db
    .select()
    .from(renders)
    .where(and(eq(renders.userId, userId), eq(renders.applicationId, application.id), eq(renders.id, ref)))
    .limit(1);
  return own;
}

/** Each ref as a document that has a version, in the order asked for. Otherwise a `422` naming the one that does not. */
async function requireDocuments(db: Db, userId: string, application: ApplicationRow, refs: readonly string[]): Promise<RenderRow[]> {
  const documents: RenderRow[] = [];
  for (const ref of refs) {
    const render = await findDocument(db, userId, application, ref);
    if (!render && !isSendableKind(ref)) throw validationFailed("That is not a document this application can send.", ["documents"]);
    if (!render?.currentVersionId) {
      const title = render ? documentTitle(render, application.company) : SENDABLE_TITLE[ref as keyof typeof SENDABLE_TITLE];
      throw validationFailed(`${title} has no version yet. Generate it first.`, ["documents"]);
    }
    documents.push(render);
  }
  return documents;
}

/**
 * A 履歴書 copy's page with its form, as its file lays it out. A copy stored
 * before the page carried one is read from its stored file, which is the form
 * as it was sent that day: nothing about it is rebuilt from the record now.
 * A file that cannot be read leaves the page as it was stored, its text.
 */
async function withSheet(db: Db, userId: string, copy: { id: string; kind: string; page: unknown }) {
  const page = copy.page as SentPage;
  if (copy.kind !== "rirekisho" || page.sheet) return page;
  const [stored] = await db
    .select({ file: applicationSentCopies.file })
    .from(applicationSentCopies)
    .where(and(eq(applicationSentCopies.userId, userId), eq(applicationSentCopies.id, copy.id)))
    .limit(1);
  if (!stored) return page;
  try {
    return { ...page, sheet: readSheet(storedBytes(stored.file)) };
  } catch (error) {
    console.error(JSON.stringify({ event: "sent_copy_sheet_unreadable", userId, copyId: copy.id, errorKind: error instanceof Error ? error.constructor.name : typeof error }));
    return { ...page, readFailure: "original_file_unreadable" as const };
  }
}

/** `rirekisho_20261023.docx` for `履歴書_森山健二_20261023.docx`: the kind, and the date the stored name carries. */
function asciiCopyName(kind: string, filename: string): string {
  const date = /_(\d{8})\.[a-z]+$/.exec(filename)?.[1];
  const extension = /\.([a-z]+)$/.exec(filename)?.[1] ?? "docx";
  return `${kind.replace(/_/g, "-")}${date ? `_${date}` : ""}.${extension}`;
}
