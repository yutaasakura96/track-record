/**
 * A document's `.docx`, assembled from one stored version.
 *
 * Two callers, one assembly: a download hands the file to the browser and
 * keeps nothing, and a sent copy stores it (`docs/06`, 2026-10-11). They must
 * not differ, because the copy is "the file as it was that day" only if it is
 * the file a download would have produced that day. Reading a version on a
 * screen (issue #106) takes the same inputs and builds only the page.
 *
 * The name and contact lines come from the profile and a 履歴書's tables from
 * the record, both read here and now. That is why a version alone cannot stand
 * in for what was sent.
 */
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { profiles, type renderVersions } from "../db/schema";
import { ApiError, preconditionFailed } from "../http/errors";
import { badCitations, citationMessage, collectEditableRecord } from "./version-edit";
import { collectRirekishoProfile, collectRirekishoRecord } from "./rirekisho";
import { citedFactIds } from "~/render/edit";
import { downloadFilename, toDocx } from "~/render/docx";
import { rirekishoTemplateData, tokyoToday } from "~/render/rirekisho";
import { fillRirekishoTemplate, type RirekishoTemplateData } from "~/render/rirekisho-template";
import { rirekishoSentPage, sentPage, type SentPage } from "~/render/sent-page";
import { assembleResume, ResumeAssemblyError, resumeFilename, resumeSentPage, type ResumeDocument } from "~/render/resume";
import { resumeDocx, type PaperSize } from "~/render/resume-docx";
import { resumePdf } from "~/render/resume-pdf";
import { collectResumeRecord } from "./resume";
import type { RenderIdentity } from "~/render/identity";
import { RENDER_TITLE, type RenderContent, type RenderKind } from "~/shared/render-content";

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

/**
 * `Kenji-Moriyama-Resume-2026-10.docx` for an English résumé, main or tailored
 * alike: it is the file an employer receives, and the label is the author's
 * note to themselves. Every other kind keeps `shokumu-keirekisho-2026-08-12.docx`.
 */
export const filenameFor = (
  kind: RenderKind,
  extension: string,
  version: VersionRow,
  identity: RenderIdentity,
) =>
  kind === "english_resume"
    ? resumeFilename(identity.nameLatin, extension, version.acceptedAt)
    : downloadFilename(kind, extension, version.acceptedAt);

/** The file of one version, as it is assembled today. Refuses what a download refuses. */
export async function buildDocumentFile(
  db: Db,
  userId: string,
  kind: RenderKind,
  version: VersionRow,
): Promise<DocumentFile> {
  const inputs = await assemblyInputs(db, userId, kind, version);
  switch (inputs.kind) {
    case "rirekisho": {
      const filename = downloadFilename(kind, "docx", version.acceptedAt);
      return assembled(version, () => rirekishoFile(inputs.data, inputs.content, filename));
    }
    case "resume": {
      const { document, paper } = inputs;
      const filename = filenameFor(kind, "docx", version, inputs.identity);
      return assembled(version, async () => ({
        bytes: await resumeDocx(document, paper, resumeMetadata(document)),
        filename,
        page: resumeSentPage(document),
      }));
    }
    case "built": {
      const filename = filenameFor(kind, "docx", version, inputs.identity);
      return assembled(version, async () => ({
        bytes: await toDocx(inputs.content, RENDER_TITLE[kind], kind, inputs.identity, inputs.today),
        filename,
        page: sentPage(kind, inputs.content, inputs.identity, inputs.today),
      }));
    }
  }
}

/**
 * The English résumé as a PDF (issue #109): the same assembly and the same
 * refusals as its `.docx`, set from the same layout. Only the résumé has one;
 * the Japanese documents are expected as Word files, and the stories are read
 * as Markdown (`~/shared/render-content`). Never stored — a sent copy keeps the
 * `.docx`, which is the file its page is read out of.
 */
export async function buildResumePdf(
  db: Db,
  userId: string,
  kind: RenderKind,
  version: VersionRow,
): Promise<Pick<DocumentFile, "bytes" | "filename">> {
  const inputs = await assemblyInputs(db, userId, kind, version);
  // The route refuses a PDF of any other kind before it reads a version.
  if (inputs.kind !== "resume") throw new Error("Only the English résumé is produced as a PDF.");
  const { document, paper } = inputs;
  const filename = filenameFor(kind, "pdf", version, inputs.identity);
  return assembled(version, async () => ({
    bytes: await resumePdf(document, paper, resumeMetadata(document)),
    filename,
  }));
}

/** The title and author both files carry in their properties. */
const resumeMetadata = (document: ResumeDocument) => ({ title: `${document.name} – Résumé`, author: document.name });

/** One filling, so the page is read out of the very bytes that are handed over. */
function rirekishoFile(data: RirekishoTemplateData, content: RenderContent, filename: string): DocumentFile {
  const bytes = fillRirekishoTemplate(data);
  return { bytes, filename, page: rirekishoSentPage(data, content, bytes) };
}

/**
 * The page of one version, as a download would assemble it today (issue #106).
 * The same inputs and the same refusal as `buildDocumentFile`, so what is read
 * on the screen is what the file would hold. Only a 履歴書's file is made, and
 * only to read its form back out of it (`~/render/sheet`); nothing is kept.
 */
export async function buildDocumentPage(db: Db, userId: string, kind: RenderKind, version: VersionRow): Promise<SentPage> {
  const inputs = await assemblyInputs(db, userId, kind, version);
  switch (inputs.kind) {
    case "rirekisho":
      return assembled(version, () => rirekishoSentPage(inputs.data, inputs.content, undefined, true));
    case "resume":
      return assembled(version, () => resumeSentPage(inputs.document, true));
    case "built":
      return assembled(version, () => sentPage(kind, inputs.content, inputs.identity, inputs.today, true));
  }
}

type AssemblyInputs =
  | { kind: "rirekisho"; content: RenderContent; data: RirekishoTemplateData }
  | { kind: "resume"; identity: RenderIdentity; document: ResumeDocument; paper: PaperSize }
  | { kind: "built"; content: RenderContent; identity: RenderIdentity; today: string };

/** What a file is assembled from today, read once for the file and the page alike. */
async function assemblyInputs(db: Db, userId: string, kind: RenderKind, version: VersionRow): Promise<AssemblyInputs> {
  const content = version.content as RenderContent;
  await refuseWithheldCitations(db, userId, content);
  const today = tokyoToday();

  // A 履歴書 is FILLED, not built (`docs/03` §30). Its three tables are
  // derived from the record rather than read out of the version, its identity
  // block comes from the profile row, and the only generated text in it is
  // the two prose blocks. The submission date is stamped now, in Tokyo, and
  // the age is computed against it (`docs/04` §4).
  if (kind === "rirekisho") {
    const profile = await collectRirekishoProfile(db, userId);
    const record = await collectRirekishoRecord(db, userId);
    return assembled(version, () => ({
      kind: "rirekisho" as const,
      content,
      data: rirekishoTemplateData({ profile, record, submittedOn: today, content }),
    }));
  }

  // Read now rather than stored with the version: the identity block is not
  // a claim about a career, and an accepted version must not go stale because
  // a phone number changed (`src/render/identity.ts`).
  const identity = await renderIdentity(db, userId);

  // The English résumé is laid out from the record with the version's summary
  // and bullets set into it (issue #107, `src/render/resume.ts`). Tailored
  // résumés are the same kind and take the same path.
  if (kind === "english_resume") {
    const { paper, ...record } = await collectResumeRecord(db, userId);
    return assembled(version, () => ({
      kind: "resume" as const,
      identity,
      document: assembleResume({ content, record, identity, today }),
      paper,
    }));
  }

  return { kind: "built", content, identity, today };
}

/** Runs the build alone, so a read that fails before it is not reported as a file that could not be assembled. */
async function assembled<T>(version: VersionRow, build: () => T | Promise<T>): Promise<T> {
  try {
    return await build();
  } catch (error) {
    // A refusal with words for the author is passed on as it is.
    if (error instanceof ApiError) throw error;
    if (error instanceof ResumeAssemblyError) throw new ApiError("conflict", error.message);
    // The build fails; the stored content is untouched and the next one can succeed.
    console.error(JSON.stringify({ event: "document_build_failed", versionId: version.id }));
    throw new ApiError("internal", "That document could not be assembled. Your saved version is unchanged.");
  }
}

/**
 * The identity block's source, narrowed to the fields a header may read: the
 * names, the email and the résumé's own header columns (issue #108). The
 * restricted PII columns are never selected, so they cannot reach a render
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
      resume: {
        headline: profiles.resumeHeadline,
        city: profiles.resumeCity,
        country: profiles.resumeCountry,
        phone: profiles.resumePhone,
        linkedinUrl: profiles.resumeLinkedinUrl,
        githubUrl: profiles.resumeGithubUrl,
        portfolioUrl: profiles.resumePortfolioUrl,
      },
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
    resume: profile.resume,
  };
}
