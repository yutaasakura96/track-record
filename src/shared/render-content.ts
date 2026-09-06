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
}

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

export const RENDER_TITLE: Record<RenderKind, string> = {
  english_resume: "Résumé (English)",
  rirekisho: "履歴書",
  shokumu_keirekisho: "職務経歴書",
  career_story_en: "Career story (English)",
  career_story_ja: "職務経歴ストーリー",
};
