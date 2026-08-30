/**
 * Render specifications.
 *
 * The register lives here rather than in the data: the same fact renders as an
 * action-verb bullet in the English résumé and in the flat factual voice
 * 職務経歴書 expects. That is a prompt difference, not a data difference
 * (`docs/03-technical-design.md` §4.2).
 *
 * M1 builds the English résumé only. The other four are declared so the
 * overview can show them as never generated, which is distinct from up to date.
 */
import { RENDER_LANGUAGE, type RenderKind } from "~/shared/render-content";

export interface RenderDefinition {
  kind: RenderKind;
  language: "en" | "ja";
  /** Built in M1? The rest are listed on the overview and cannot be generated. */
  buildable: boolean;
  register: string;
  /** Profile fields generation is blocked without (`docs/07` §7). */
  requiredProfileFields: string[];
}

const RESUME_REGISTER = `Write a résumé for a technical audience reading in English.

Sections, in this order, omitting any with no facts behind it:
- "summary": one short paragraph. key "summary".
- "experience": one section per employer, most recent first. Blocks are bullets, one outcome each. key "experience".
- "projects": independent projects only — projects with no employer. key "projects".
- "skills": one paragraph listing the technologies the facts actually name. key "skills".

Register:
- Bullets open with a past-tense action verb and state the outcome. "Reduced nightly batch runtime from 6 hours to 90 minutes."
- No adjectives of self-assessment: no "successfully", "expertly", "cutting-edge", "passionate".
- No first-person pronouns.
- Keep each bullet to one sentence.`;

export const RENDER_DEFINITIONS: Record<RenderKind, RenderDefinition> = {
  english_resume: {
    kind: "english_resume",
    language: RENDER_LANGUAGE.english_resume,
    buildable: true,
    register: RESUME_REGISTER,
    requiredProfileFields: ["nameLatin"],
  },
  rirekisho: {
    kind: "rirekisho",
    language: RENDER_LANGUAGE.rirekisho,
    buildable: false,
    register: "",
    requiredProfileFields: ["dateOfBirth", "address", "addressKana"],
  },
  shokumu_keirekisho: {
    kind: "shokumu_keirekisho",
    language: RENDER_LANGUAGE.shokumu_keirekisho,
    buildable: false,
    register: "",
    requiredProfileFields: [],
  },
  career_story_en: {
    kind: "career_story_en",
    language: RENDER_LANGUAGE.career_story_en,
    buildable: false,
    register: "",
    requiredProfileFields: [],
  },
  career_story_ja: {
    kind: "career_story_ja",
    language: RENDER_LANGUAGE.career_story_ja,
    buildable: false,
    register: "",
    requiredProfileFields: [],
  },
};
