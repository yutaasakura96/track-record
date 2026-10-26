/**
 * The documents on an application, and the copies that were sent
 * (`docs/10` Screens 14 and 15, issue #71).
 *
 * Two different things, kept apart on purpose. A document on an application is
 * a pointer: it is the same document as on Home, and it moves on when that
 * one does. A sent copy is a file: it was taken once and nothing reads the
 * document again to show it.
 *
 * Nothing here compares a copy with its document. Whether what was sent is
 * still what would be sent today is the owner's to know (`docs/06`, 2026-10-11).
 */
import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { applicationDocuments, applicationSentCopies, renderVersions, renders } from "../db/schema";
import { newId } from "../http/ids";
import { buildDocumentFile } from "./document-file";
import { renderState, type RenderState } from "../routes/renders";
import {
  MAIN_RIREKISHO_HELD,
  SENDABLE_KINDS,
  SENDABLE_TITLE,
  TAILORED_KINDS,
  isSendableKind,
  tailoredDocumentTitle,
  type NamedVersion,
  type SendableKind,
} from "~/shared/application-documents";
import { draftedBlocks, type RenderContent, type RenderKind } from "~/shared/render-content";
import { ApiError } from "../http/errors";

type RenderRow = typeof renders.$inferSelect;

/** The application a read or a freeze is for: its id, the name a tailored document takes from it, and its step. */
export interface ApplicationRef {
  id: string;
  company: string;
  currentStep?: string;
}

/** A document as an application lists it. */
export interface ApplicationDocument {
  /** What the render routes address it by: its kind, or a tailored document's id. */
  ref: string;
  kind: RenderKind;
  tailored: boolean;
  title: string;
  language: "en" | "ja";
  currentVersionId: string | null;
  currentVersionNo: number | null;
  status: RenderState["status"];
  /** Facts a document may use now that the current version was not generated from. */
  newFactsSince: number | null;
  /** Facts the current version was generated from that a document may no longer use. */
  withdrawnFactsSince: number | null;
  pendingProposalId: string | null;
}

/** A document the owner could tick: the three, and this application's tailored documents. */
export interface DocumentChoice extends ApplicationDocument {
  onApplication: boolean;
  /**
   * Why it cannot be ticked now, or null. Before Applied an application
   * sends one 履歴書, and the main one is held back while the tailored one is
   * on it (`docs/06`, 2026-10-26).
   */
  heldBy: string | null;
}

export interface SentCopySummary {
  id: string;
  /** The document it is a copy of, as `ApplicationDocument.ref` names it. */
  ref: string;
  kind: RenderKind;
  title: string;
  versionNo: number;
  sentOn: string;
  recordedAt: string;
}

/** What an application is called for a document: the main documents by kind, its own by kind and company. */
export const documentTitle = (render: Pick<RenderRow, "kind" | "jobDescription">, company: string) =>
  render.jobDescription === null && isSendableKind(render.kind)
    ? SENDABLE_TITLE[render.kind]
    : tailoredDocumentTitle(render.kind, company);

/** Tailored first, résumé then 履歴書, then the three in the order they are offered. */
const placeOf = (kind: string, tailored: boolean) =>
  tailored ? TAILORED_KINDS.indexOf(kind as never) - TAILORED_KINDS.length : SENDABLE_KINDS.indexOf(kind as never);

/** Everything about a copy but the file and the page, which only its own routes read. */
const COPY = {
  id: applicationSentCopies.id,
  applicationId: applicationSentCopies.applicationId,
  renderId: applicationSentCopies.renderId,
  kind: applicationSentCopies.kind,
  title: applicationSentCopies.title,
  versionNo: applicationSentCopies.versionNo,
  sentOn: applicationSentCopies.sentOn,
  recordedAt: applicationSentCopies.recordedAt,
};

const liveDocuments = (userId: string, applicationId?: string) =>
  and(
    eq(applicationDocuments.userId, userId),
    isNull(applicationDocuments.removedAt),
    applicationId ? eq(applicationDocuments.applicationId, applicationId) : undefined,
  );

export const liveCopies = (userId: string, applicationId?: string) =>
  and(
    eq(applicationSentCopies.userId, userId),
    isNull(applicationSentCopies.undoneAt),
    applicationId ? eq(applicationSentCopies.applicationId, applicationId) : undefined,
  );

/**
 * One application's documents in full: what is on it, what could be ticked,
 * and every copy sent, most recently recorded first.
 */
export async function readDocuments(db: Db, userId: string, application: ApplicationRef) {
  const [state, [on, copies, own]] = await Promise.all([
    renderState(db, userId),
    db.batch([
      db
        .select({ renderId: applicationDocuments.renderId })
        .from(applicationDocuments)
        .where(liveDocuments(userId, application.id)),
      db.select(COPY).from(applicationSentCopies).where(liveCopies(userId, application.id)).orderBy(desc(applicationSentCopies.recordedAt)),
      db
        .select({ id: renders.id })
        .from(renders)
        .where(and(eq(renders.userId, userId), eq(renders.applicationId, application.id))),
    ]),
  ]);

  const onApplication = new Set(on.map((row) => row.renderId));
  const ownIds = new Set(own.map((row) => row.id));
  const ownDocuments = state.tailored
    .filter((row) => row.id !== null && ownIds.has(row.id))
    .sort((a, b) => placeOf(a.kind, true) - placeOf(b.kind, true));
  const tailoredRirekishoOn = ownDocuments.some((row) => row.kind === "rirekisho" && onApplication.has(row.id!));
  const choosing = (application.currentStep ?? "not_applied") === "not_applied";
  const choices: DocumentChoice[] = [
    ...ownDocuments.map((row) => ({ row, tailored: true })),
    ...SENDABLE_KINDS.map((kind) => ({ row: state.documents.find((row) => row.kind === kind)!, tailored: false })),
  ].map(({ row, tailored }) => ({
    ref: row.ref,
    kind: row.kind,
    tailored,
    title: tailored ? tailoredDocumentTitle(row.kind, application.company) : SENDABLE_TITLE[row.kind as SendableKind],
    language: row.language,
    currentVersionId: row.currentVersionId,
    currentVersionNo: row.currentVersionNo,
    status: row.status,
    newFactsSince: row.newFactsSince,
    withdrawnFactsSince: row.withdrawnFactsSince,
    pendingProposalId: row.pendingProposalId,
    onApplication: row.id !== null && onApplication.has(row.id),
    heldBy: !tailored && row.kind === "rirekisho" && choosing && tailoredRirekishoOn ? MAIN_RIREKISHO_HELD : null,
  }));

  const refByRender = new Map<string, string>();
  for (const row of [...state.documents, ...state.tailored]) if (row.id) refByRender.set(row.id, row.ref);
  // Copies frozen by one move share a recorded time, and then read in document order.
  const place = (copy: (typeof copies)[number]) => placeOf(copy.kind, ownIds.has(copy.renderId));

  return {
    documents: choices
      .filter((choice) => choice.onApplication)
      .map(({ onApplication: _, heldBy: __, ...document }) => document),
    choices,
    sentCopies: copies
      .sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime() || place(a) - place(b))
      .map(
        (copy): SentCopySummary => ({
          id: copy.id,
          ref: refByRender.get(copy.renderId) ?? copy.renderId,
          kind: copy.kind as RenderKind,
          title: copy.title,
          versionNo: copy.versionNo,
          sentOn: copy.sentOn,
          recordedAt: copy.recordedAt.toISOString(),
        }),
      ),
    canGenerate: state.usableFacts > 0,
  };
}

/** What a list row says of an application's résumé. */
export interface ResumeLine {
  /** The latest sent copy of each document; with nothing sent, the documents chosen. */
  documents: NamedVersion[];
  sent: boolean;
}

/**
 * The résumé line of every application, for the list. `latest` is the copy
 * most recently recorded, never the one with the latest sent date, which the
 * owner can correct.
 */
export async function readResumeLines(
  db: Db,
  userId: string,
  companyOf: Map<string, string>,
): Promise<Map<string, ResumeLine>> {
  const [chosen, copies, written] = await db.batch([
    db
      .select({
        applicationId: applicationDocuments.applicationId,
        kind: renders.kind,
        jobDescription: renders.jobDescription,
        versionNo: renderVersions.versionNo,
      })
      .from(applicationDocuments)
      .innerJoin(renders, and(eq(renders.id, applicationDocuments.renderId), eq(renders.userId, userId)))
      .leftJoin(renderVersions, and(eq(renderVersions.id, renders.currentVersionId), eq(renderVersions.userId, userId)))
      .where(liveDocuments(userId)),
    db.select(COPY).from(applicationSentCopies).where(liveCopies(userId)).orderBy(desc(applicationSentCopies.recordedAt)),
    db.select({ id: renders.id }).from(renders).where(and(eq(renders.userId, userId), isNotNull(renders.applicationId))),
  ]);

  const tailored = new Set(written.map((render) => render.id));
  const lines = new Map<string, ResumeLine>();
  const seen = new Set<string>();
  // Newest first, so the first copy met of a document is its latest. The line
  // then names them in document order, as the application's own page lists them.
  const latest = copies.filter((copy) => {
    const key = `${copy.applicationId} ${copy.renderId}`;
    return !seen.has(key) && seen.add(key);
  });
  const placed = (copy: (typeof copies)[number]) => placeOf(copy.kind, tailored.has(copy.renderId));
  for (const copy of latest.sort((a, b) => placed(a) - placed(b))) {
    const line = lines.get(copy.applicationId) ?? { documents: [], sent: true };
    line.documents.push({ title: copy.title, versionNo: copy.versionNo });
    lines.set(copy.applicationId, line);
  }

  const ordered = [...chosen].sort(
    (a, b) => placeOf(a.kind, a.jobDescription !== null) - placeOf(b.kind, b.jobDescription !== null),
  );
  for (const row of ordered) {
    const line = lines.get(row.applicationId) ?? { documents: [], sent: false };
    // Once anything is sent the row names what was sent, not what is chosen.
    if (line.sent) continue;
    line.documents.push({ title: documentTitle(row, companyOf.get(row.applicationId) ?? ""), versionNo: row.versionNo });
    lines.set(row.applicationId, line);
  }
  return lines;
}

/** The documents on an application that a standing transition freezes: on it, with a version, never sent. */
export async function unsentDocuments(db: Db, userId: string, applicationId: string): Promise<RenderRow[]> {
  const [on, sent] = await db.batch([
    db
      .select({ render: renders })
      .from(applicationDocuments)
      .innerJoin(renders, and(eq(renders.id, applicationDocuments.renderId), eq(renders.userId, userId)))
      .where(liveDocuments(userId, applicationId)),
    db
      .select({ renderId: applicationSentCopies.renderId })
      .from(applicationSentCopies)
      .where(liveCopies(userId, applicationId)),
  ]);
  const hasCopy = new Set(sent.map((row) => row.renderId));
  return on
    .map((row) => row.render)
    .filter((render) => render.currentVersionId !== null && !hasCopy.has(render.id))
    .sort((a, b) => placeOf(a.kind, a.jobDescription !== null) - placeOf(b.kind, b.jobDescription !== null));
}

export interface Frozen {
  /** The rows to insert, in the same batch as whatever the freeze belongs to. */
  rows: (typeof applicationSentCopies.$inferInsert)[];
  /** What was frozen, for the sentence that says so. */
  named: NamedVersion[];
}

/**
 * Takes each document's file as it is assembled now. Nothing is written: the
 * caller inserts the rows together with the change they belong to, so a status
 * that says Applied is never saved without the copies it froze. A document
 * whose file cannot be made refuses the whole freeze, with the reason.
 */
export async function freezeDocuments(
  db: Db,
  userId: string,
  application: ApplicationRef,
  documents: RenderRow[],
  at: { sentOn: string; recordedAt: Date; frozenStepId: string | null },
): Promise<Frozen> {
  const versionIds = documents.flatMap((render) => render.currentVersionId ?? []);
  const versions =
    versionIds.length > 0
      ? await db
          .select()
          .from(renderVersions)
          .where(and(eq(renderVersions.userId, userId), inArray(renderVersions.id, versionIds)))
      : [];
  const versionOf = new Map(versions.map((version) => [version.id, version]));

  const rows: Frozen["rows"] = [];
  for (const render of documents) {
    const version = render.currentVersionId ? versionOf.get(render.currentVersionId) : undefined;
    if (!version) continue;
    // Unreachable through accept, which refuses a draft, and checked here
    // anyway: a sent 履歴書 whose reason for applying nobody confirmed would
    // be the one thing this flow exists to prevent.
    if (draftedBlocks(version.content as RenderContent).length > 0) {
      throw new ApiError("conflict", `${documentTitle(render, application.company)} has drafted parts nobody confirmed, so it was not frozen.`);
    }
    const kind = render.kind as RenderKind;
    // One at a time: each is a build, and a second's failure should name itself.
    const file = await buildDocumentFile(db, userId, kind, version);
    rows.push({
      id: newId("applicationSentCopy"),
      userId,
      applicationId: application.id,
      renderId: render.id,
      renderVersionId: version.id,
      kind,
      title: documentTitle(render, application.company),
      versionNo: version.versionNo,
      filename: file.filename,
      file: Buffer.from(file.bytes),
      page: file.page,
      sentOn: at.sentOn,
      recordedAt: at.recordedAt,
      frozenStepId: at.frozenStepId,
    });
  }
  return { rows, named: rows.map((row) => ({ title: row.title, versionNo: row.versionNo })) };
}
