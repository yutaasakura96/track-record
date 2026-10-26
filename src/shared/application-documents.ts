/**
 * The documents an application sends (issue #71).
 *
 * Read by the routes and by the screens, like `./application.ts`: which
 * documents can be sent, what each is called on an application, and how a list
 * of them is said in a sentence.
 */
import type { RenderKind } from "./render-content";

/**
 * The documents the record already has that an application can use. The two
 * career stories are not among them: they are read by the author before an
 * interview and are sent to nobody (`./render-content.ts`).
 */
export const SENDABLE_KINDS = ["english_resume", "rirekisho", "shokumu_keirekisho"] as const satisfies readonly RenderKind[];
export type SendableKind = (typeof SENDABLE_KINDS)[number];

export const isSendableKind = (value: string): value is SendableKind =>
  (SENDABLE_KINDS as readonly string[]).includes(value);

/** What each is called on an application, where the untailored résumé is the main one. */
export const SENDABLE_TITLE: Record<SendableKind, string> = {
  english_resume: "Main résumé",
  rirekisho: "履歴書",
  shokumu_keirekisho: "職務経歴書",
};

/**
 * The documents an application can have one of its own of, written toward its
 * posting: a résumé (issue #57) and a 履歴書 (`docs/06`, 2026-10-26). A
 * tailored 職務経歴書 is a later piece.
 */
export const TAILORED_KINDS = ["english_resume", "rirekisho"] as const satisfies readonly SendableKind[];
export type TailoredKind = (typeof TAILORED_KINDS)[number];

export const isTailoredKind = (value: string): value is TailoredKind =>
  (TAILORED_KINDS as readonly string[]).includes(value);

/** What an application calls a document written for it. */
export const tailoredDocumentTitle = (kind: string, company: string) =>
  kind === "rirekisho" ? `Tailored 履歴書 for ${company}` : `Tailored résumé for ${company}`;

/** Why the main 履歴書 cannot be ticked while the application's own is on it, before Applied. */
export const MAIN_RIREKISHO_HELD = "This application has its own 履歴書, written for this job. Take that one off to use this one.";

export interface NamedVersion {
  title: string;
  versionNo: number | null;
}

/** `履歴書 v4`. A document with no version yet is its title alone. */
export const nameVersion = (document: NamedVersion) =>
  document.versionNo === null ? document.title : `${document.title} v${document.versionNo}`;

/** `履歴書 v4 and 職務経歴書 v6`, as a sentence names them. */
export const nameVersions = (documents: readonly NamedVersion[]) => documents.map(nameVersion).join(" and ");
