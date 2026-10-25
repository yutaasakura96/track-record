/**
 * The 職務経歴書's 保有資格 and 学歴, filled from the record (issue #117).
 *
 * The register used to ask the model to copy both lists. It copied a
 * certification name that already carried its verb and added 取得 to it, and
 * nothing held the two documents sent together — this one and the 履歴書 — to
 * the same name or month. The 履歴書 has always derived the same rows in code
 * (`./rirekisho-rows.ts`); this prints those rows, so the two agree by
 * construction, and the model is told the sections are not its to write.
 *
 * The rows are spliced into the generated content before it is stored, rather
 * than added when the file is built, so the review, the in-app view and the
 * download all show the same thing, and a version keeps the rows it was
 * reviewed with.
 */
import type { RenderSpec } from "~/model/types";
import type { Block, RenderContent, RenderSection } from "~/shared/render-content";
import { leavesOutEducation } from "~/shared/education";
import { RENDER_DEFINITIONS } from "./spec";
import { isExpired } from "./shikaku";
import {
  certificationText,
  educationRows,
  shikakuRows,
  type DerivedRow,
  type RirekishoEducation,
} from "./rirekisho-rows";

export const CERTIFICATIONS_SECTION = "certifications";
export const EDUCATION_SECTION = "education";
/** The section the record's two are placed before. Without it, they close the document. */
const PLACED_BEFORE = "self_pr";

/** `2016年6月　応用情報技術者試験　合格`: the 履歴書's row, with its 年 and 月 columns folded in. */
const rowText = (r: DerivedRow) => `${r.year}年${r.month}月　${r.text}`;

/**
 * The two sections, in the document's direction. Empty sections are left out,
 * as the register omits a section with nothing behind it.
 */
export function recordSections(spec: RenderSpec, today: string): RenderSection[] {
  const educations: RirekishoEducation[] = spec.educations
    .filter((e) => !leavesOutEducation(spec.kind, e.level))
    // `institution` is already the Japanese name where the record has one.
    .map((e) => ({ ...e, institutionJa: null }));
  // A lapsed certification is left off, as it is on the 履歴書 (`./shikaku.ts`).
  const held = spec.certifications
    .filter((c) => !isExpired(c.expiresOn, today))
    // `name` is already the Japanese name where the record has one.
    .map((c) => ({ name: c.name, nameJa: null, issuedOn: c.issuedOn, expiresOn: c.expiresOn }));

  // The 履歴書's rows read ascending; a 逆編年体 document reverses them. A
  // certification with no date has no place in a dated list and closes it.
  const ordered = (rows: DerivedRow[]) => (RENDER_DEFINITIONS[spec.kind].chronology === "newest_first" ? [...rows].reverse() : rows);
  const certificationRows = [
    ...ordered(shikakuRows(held, educations, today)).map(rowText),
    ...held.filter((c) => c.issuedOn === null).map(certificationText),
  ];
  const educationLines = ordered(educationRows(educations)).map(rowText);

  const section = (key: string, heading: string, lines: string[]): RenderSection[] =>
    lines.length === 0
      ? []
      : [{ key, heading, blocks: lines.map((text) => ({ id: "", kind: "row", text, factIds: [] })) }];
  return [
    ...section(CERTIFICATIONS_SECTION, "保有資格", certificationRows),
    ...section(EDUCATION_SECTION, "学歴", educationLines),
  ];
}

/**
 * The generated content with the record's sections in place: any the model
 * wrote anyway are dropped, the record's go before 自己PR, and every block is
 * numbered again so ids stay unique within the version.
 */
export function withRecordSections(content: RenderContent, spec: RenderSpec, today: string): RenderContent {
  const generated = content.sections.filter(
    (s) => s.key !== CERTIFICATIONS_SECTION && s.key !== EDUCATION_SECTION,
  );
  const at = generated.findIndex((s) => s.key === PLACED_BEFORE);
  const cut = at === -1 ? generated.length : at;
  const sections = [...generated.slice(0, cut), ...recordSections(spec, today), ...generated.slice(cut)];
  let n = 0;
  return {
    sections: sections.map((s) => ({
      ...s,
      blocks: s.blocks.map((b): Block => ({ ...b, id: `blk_${++n}` })),
    })),
  };
}
