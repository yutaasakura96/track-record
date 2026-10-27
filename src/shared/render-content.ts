/**
 * `RenderContent` — the structured shape a render is stored as
 * (`docs/03-technical-design.md` §4.2). Never a file, never a prose blob.
 *
 * Shared between the Worker and the SPA: the diff screen reads the same shape
 * the generator produces.
 */
export type BlockKind = "paragraph" | "bullet" | "row";

export interface Block {
  /** Stable within one version. The diff addresses blocks by it. */
  id: string;
  kind: BlockKind;
  text: string;
  /**
   * The facts that produced this block. What makes a weak bullet traceable to a
   * weak fact — and a list rather than a single id because a bullet is composed
   * from several atomic facts (`docs/adr/0001-facts-stay-atomic.md`).
   *
   * Empty is legal for headings, for fixed scaffolding, and for a row copied
   * from an entity table rather than written from a claim: an education or a
   * certification row is data, and has no fact behind it by construction.
   */
  factIds: string[];
  /**
   * Written for the author to confirm, not from the record alone: the 志望動機
   * and the 本人希望欄 of a tailored 履歴書 (`docs/06`, 2026-10-26). Set only
   * on a proposal. Confirming or editing the block clears it, and a proposal
   * with a drafted block left is not accepted, so no version carries one.
   */
  drafted?: true;
}

/** The blocks of a document still waiting for the author to confirm them. */
export const draftedBlocks = (content: RenderContent): { section: RenderSection; block: Block }[] =>
  content.sections.flatMap((section) =>
    section.blocks.filter((block) => block.drafted === true).map((block) => ({ section, block })),
  );

export interface RenderSection {
  key: string;
  heading: string;
  blocks: Block[];
}

export interface RenderContent {
  sections: RenderSection[];
}

export const RENDER_KINDS = [
  "english_resume",
  "rirekisho",
  "shokumu_keirekisho",
  "career_story_en",
  "career_story_ja",
] as const;

export type RenderKind = (typeof RENDER_KINDS)[number];

export const RENDER_LANGUAGE: Record<RenderKind, "en" | "ja"> = {
  english_resume: "en",
  rirekisho: "ja",
  shokumu_keirekisho: "ja",
  career_story_en: "en",
  career_story_ja: "ja",
};

export type DownloadFormat = "docx" | "md" | "pdf";

/**
 * The format a render is taken away in.
 *
 * Three of the five are documents somebody is sent, and a Japanese hiring
 * process expects a file it can open in Word. The two career stories are not
 * sent to anybody: they are read by the author before an interview, and
 * `docs/06` (2026-08-20) put them outside the `.docx` path for that reason.
 * Offering one a `.docx` button would be offering to produce a submission
 * document out of the one render that is not one.
 *
 * The download route serves `.docx` and Markdown for any kind (a 履歴書 is
 * `.docx` and PDF only) and a PDF for the three submission documents — this
 * decides which the screen offers first, so that the affordance and the
 * decision agree.
 */
export const RENDER_DOWNLOAD_FORMAT: Record<RenderKind, DownloadFormat> = {
  // PDF is what employers and ATS guidance expect of an English résumé, so it
  // is the default; Word is offered beside it for a posting that asks for one
  // (issue #109). doda and Recruit say the same of a Japanese application
  // unless the employer asks for Word (issue #117).
  english_resume: "pdf",
  rirekisho: "pdf",
  shokumu_keirekisho: "pdf",
  career_story_en: "md",
  career_story_ja: "md",
};

/** The second format a submission document is offered in, beside its PDF: the Word file. */
export const RENDER_DOWNLOAD_ALTERNATIVE: Partial<Record<RenderKind, DownloadFormat>> = {
  english_resume: "docx",
  rirekisho: "docx",
  shokumu_keirekisho: "docx",
};

export const RENDER_TITLE: Record<RenderKind, string> = {
  english_resume: "Résumé (English)",
  rirekisho: "履歴書",
  shokumu_keirekisho: "職務経歴書",
  career_story_en: "Career story (English)",
  career_story_ja: "職務経歴ストーリー",
};
