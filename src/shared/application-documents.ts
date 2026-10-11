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

/** What an application calls the résumé written for it. */
export const tailoredResumeTitle = (company: string) => `Tailored résumé for ${company}`;

export interface NamedVersion {
  title: string;
  versionNo: number | null;
}

/** `履歴書 v4`. A document with no version yet is its title alone. */
export const nameVersion = (document: NamedVersion) =>
  document.versionNo === null ? document.title : `${document.title} v${document.versionNo}`;

/** `履歴書 v4 and 職務経歴書 v6`, as a sentence names them. */
export const nameVersions = (documents: readonly NamedVersion[]) => documents.map(nameVersion).join(" and ");
