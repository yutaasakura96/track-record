/**
 * The identity header every render carries — the one block that is *not* written
 * from facts (issue #7).
 *
 * `src/client/router.tsx` gates the whole application on collecting a name
 * "because every render needs a name to put on it". Until this module existed
 * the name reached the generation prompt and nothing else: the `.docx` opened
 * with the render kind's title as its heading, no contact block, and
 * `docProps/core.xml` reading the `docx` library's `Un-named` placeholder.
 *
 * **Two decisions are recorded here** (`docs/06`, 2026-09-03).
 *
 * 1. **The header is fixed scaffolding the renderer writes, not a prompt
 *    instruction.** `EMIT_RENDER_TOOL`'s `factIds: []` escape hatch anticipates
 *    scaffolding, and a model *could* be told to emit a name — but a name the
 *    model may drop, translate or misspell is not a guarantee, and the identity
 *    gate promises one. The decisive reason is the PII rule (`docs/04` §3.2):
 *    for the model to write a contact block it would have to be *sent* the
 *    profile, and the four non-履歴書 renders must never see `phone`, `address`
 *    or `date_of_birth` at all. Composing the header here means those fields
 *    never enter a generation request, which is the same discipline as
 *    filtering Private facts before the request is built.
 *
 * 2. **The header is assembled on download, not stored in `RenderContent`.**
 *    Downloads are already built fresh on every request and never stored
 *    (`docs/03` §6); a version stores what was generated *from the record*, and
 *    a phone number is not a claim about a career. Storing it would make every
 *    accepted version go stale the moment the profile is corrected, and the
 *    remedy would be a regeneration with nothing to review.
 *
 * **The PII rule is the field list.** `docs/04` §3.2: `date_of_birth`, `phone`,
 * `postal_code`, `address`, `contact_*` and `photo` are readable only by the
 * 履歴書 spec. `name_latin`, the kanji name and `email` are not on that list,
 * which is what `HEADER_FIELDS` below encodes — read the other way, it is why
 * the English résumé may carry an email and may not carry a phone number.
 */
import type { RenderKind } from "~/shared/render-content";

/**
 * The profile fields a header may read. Deliberately a narrow projection rather
 * than the `profiles` row: a field that is not on this type cannot reach a
 * render by accident, and the restricted PII columns are not on it.
 *
 * 履歴書 is the exception the PII rule exists for and it is **not built in M1**
 * (`src/render/spec.ts`, `buildable: false`). When it is, it takes the full
 * conventional identity block — 氏名・ふりがな・生年月日・現住所・連絡先 — from
 * the profile row directly, and `docs/11` §2.4 is the test that governs it.
 * It is not modelled here, because a partial version of it would look like the
 * whole thing.
 */
export interface RenderIdentity {
  /** `name_latin` — the English renders' heading. */
  nameLatin: string;
  /** `family_name_kanji` + `given_name_kanji`, spaced as Japanese convention. */
  nameKanji: string;
  email: string;
}

/** What each render kind's header states, and in what order. */
const HEADER_FIELDS: Record<RenderKind, (id: RenderIdentity) => string[]> = {
  // A résumé is read by someone who may want to reply to it.
  english_resume: (id) => [id.nameLatin, id.email],
  // Placeholder until 履歴書 is built: the name alone is correct but nowhere
  // near sufficient, and the missing fields are conventional, not optional.
  rirekisho: (id) => [id.nameKanji],
  // 職務経歴書 convention is 氏名 and the date; contact details live in 履歴書.
  shokumu_keirekisho: (id) => [id.nameKanji],
  career_story_en: (id) => [id.nameLatin, id.email],
  career_story_ja: (id) => [id.nameKanji],
};

/**
 * The header lines for one render, in order, with empties dropped — a profile
 * field that is blank produces no line rather than a blank one.
 */
export function identityLines(kind: RenderKind, identity: RenderIdentity): string[] {
  return HEADER_FIELDS[kind](identity)
    .map((value) => value.trim())
    .filter((value) => value !== "");
}

/**
 * The name for `docProps/core.xml`. Latin for the English renders and kanji for
 * the Japanese ones, so the file's author reads the way the file does.
 */
export function documentAuthor(kind: RenderKind, identity: RenderIdentity): string {
  const [first] = identityLines(kind, identity);
  return first ?? "";
}
