/**
 * A document's `.docx`, assembled from one stored version.
 *
 * Two callers, one assembly: a download hands the file to the browser and
 * keeps nothing, and a sent copy stores it (`docs/06`, 2026-10-11). They must
 * not differ, because the copy is "the file as it was that day" only if it is
 * the file a download would have produced that day.
 *
 * The name and contact lines come from the profile and a 履歴書's tables from
 * the record, both read here and now. That is why a version alone cannot stand
 * in for what was sent.
 */
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { profiles, type renderVersions, type renders } from "../db/schema";
import { ApiError, preconditionFailed } from "../http/errors";
import { badCitations, citationMessage, collectEditableRecord } from "./version-edit";
import { collectRirekishoProfile, collectRirekishoRecord } from "./rirekisho";
import { citedFactIds } from "~/render/edit";
import { downloadFilename, toDocx } from "~/render/docx";
import { rirekishoTemplateData, tokyoToday } from "~/render/rirekisho";
import { fillRirekishoTemplate } from "~/render/rirekisho-template";
import { rirekishoSentPage, sentPage, type SentPage } from "~/render/sent-page";
import type { RenderIdentity } from "~/render/identity";
import { RENDER_TITLE, type RenderContent, type RenderKind } from "~/shared/render-content";

type RenderRow = typeof renders.$inferSelect;
type VersionRow = typeof renderVersions.$inferSelect;

export interface DocumentFile {
  bytes: Uint8Array;
  filename: string;
  /** The text the file was assembled from, for a screen to show. */
  page: SentPage;
}

/**
 * **Enforcement point 4 at the last render time there is** (issue #17). A
 * version is a snapshot of what could be rendered in August, not a standing
 * permission to keep rendering it. A fact set Private in September is
 * withheld from the file that leaves the tool in September, whatever the
 * stored content says.
 *
 * `409` rather than the restore route's `422`: restore submits content to
 * be made current and the content is what fails validation, while a
 * download asks for a file the record's CURRENT state will not allow. The
 * ids are named because a refusal the author cannot act on is a dead end —
 * the way out is the hand-edit route, which lifts the block and produces a
 * version that downloads (`docs/06`, 2026-09-12 third entry).
 */
export async function refuseWithheldCitations(db: Db, userId: string, content: RenderContent) {
  const record = await collectEditableRecord(db, userId);
  const withheld = badCitations(citedFactIds(content), record);
  if (withheld.length > 0) {
    throw new ApiError("conflict", citationMessage(withheld), {
      facts: withheld.map((b) => ({ factId: b.factId, problem: b.problem })),
    });
  }
}

/** `resume-2026-08-12.docx`, or with a tailored résumé's name and id in it. */
export const filenameFor = (render: RenderRow | null, kind: RenderKind, extension: string, version: VersionRow) =>
  downloadFilename(kind, extension, version.acceptedAt, render?.label ? { label: render.label, id: render.id } : null);

/** The file of one version, as it is assembled today. Refuses what a download refuses. */
export async function buildDocumentFile(
  db: Db,
  userId: string,
  kind: RenderKind,
  render: RenderRow | null,
  version: VersionRow,
): Promise<DocumentFile> {
  const content = version.content as RenderContent;
  await refuseWithheldCitations(db, userId, content);

  const filename = filenameFor(render, kind, "docx", version);
  const today = tokyoToday();

  // A 履歴書 is FILLED, not built (`docs/03` §30). Its three tables are
  // derived from the record rather than read out of the version, its identity
  // block comes from the profile row, and the only generated text in it is
  // the two prose blocks. The submission date is stamped now, in Tokyo, and
  // the age is computed against it (`docs/04` §4).
  if (kind === "rirekisho") {
    const profile = await collectRirekishoProfile(db, userId);
    const record = await collectRirekishoRecord(db, userId);
    return assembled(version, () => {
      const data = rirekishoTemplateData({ profile, record, submittedOn: today, content });
      return { bytes: fillRirekishoTemplate(data), filename, page: rirekishoSentPage(data, content) };
    });
  }

  // Read now rather than stored with the version: the identity block is not
  // a claim about a career, and an accepted version must not go stale because
  // a phone number changed (`src/render/identity.ts`).
  const identity = await renderIdentity(db, userId);
  return assembled(version, async () => ({
    bytes: await toDocx(content, RENDER_TITLE[kind], kind, identity, today),
    filename,
    page: sentPage(kind, content, identity, today),
  }));
}

/** Runs the build alone, so a read that fails before it is not reported as a file that could not be assembled. */
async function assembled(version: VersionRow, build: () => DocumentFile | Promise<DocumentFile>): Promise<DocumentFile> {
  try {
    return await build();
  } catch (error) {
    // A refusal with words for the author is passed on as it is.
    if (error instanceof ApiError) throw error;
    // The build fails; the stored content is untouched and the next one can succeed.
    console.error(JSON.stringify({ event: "docx_build_failed", versionId: version.id }));
    throw new ApiError("internal", "That document could not be assembled. Your saved version is unchanged.");
  }
}

/**
 * The identity block's source, narrowed to the three fields a header may read.
 * The restricted PII columns are never selected, so they cannot reach a render
 * by accident — `src/render/identity.ts` and `docs/04` §3.2.
 *
 * A missing profile is a precondition failure, not a nameless document: nothing
 * can be generated without one (`requiredProfileFields`), so its absence at
 * download time means the row went away underneath an existing version.
 */
export async function renderIdentity(db: Db, userId: string): Promise<RenderIdentity> {
  const [profile] = await db
    .select({
      nameLatin: profiles.nameLatin,
      familyNameKanji: profiles.familyNameKanji,
      givenNameKanji: profiles.givenNameKanji,
      email: profiles.email,
    })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1);

  if (!profile) {
    throw preconditionFailed(
      "That document cannot be assembled without your name. Add it to your profile and download again.",
      ["nameLatin"],
    );
  }

  return {
    nameLatin: profile.nameLatin,
    nameKanji: `${profile.familyNameKanji} ${profile.givenNameKanji}`.trim(),
    email: profile.email,
  };
}
