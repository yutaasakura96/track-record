/**
 * Is an English document English? (Issue #104.)
 *
 * The first English career stories generated from a record with Japanese
 * business descriptions came back in Japanese — the whole of one, and every
 * chapter heading of the next — and both were offered for review, where a
 * heading change cannot be seen. The prompt said "Write the document in
 * English" once, below a register that named no language and above a list of
 * Japanese fields. Nothing looked at what came back.
 *
 * This is what looks. It is a count, not a judgement: the share of Japanese
 * script in the headings and, separately, in the blocks. Separately because the
 * second failure was headings only, and twelve short headings averaged into
 * eight thousand characters of English prose come to under one percent.
 *
 * A name the record holds ONLY in Japanese is the one Japanese an English
 * document is right to carry, and it is taken out before counting. A name the
 * record also holds in Latin script is not: 北辰 written where the record says
 * Hokushin is the transliteration the first story made, and it counts.
 */
import type { RenderSpec } from "~/model/types";
import type { RenderContent } from "~/shared/render-content";
import { employerIdOfChapter } from "./chapters";

/**
 * Kana, kanji, and the punctuation that comes with them: the CJK symbols block
 * (、。「」) and the full-width forms (（）：), which an English sentence never
 * needs and a sentence copied from a Japanese field always brings.
 */
const JAPANESE_SCRIPT = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}　-〿＀-￯]/gu;

export const hasJapaneseScript = (text: string): boolean => text.search(JAPANESE_SCRIPT) !== -1;

/**
 * What an English prompt prints before a field it is given in Japanese, and
 * what the English registers name when they say what to do with one. One
 * constant, so the label and the rule about it cannot drift apart.
 */
export const JAPANESE_ONLY_LABEL = "[recorded in Japanese only]";

/**
 * Above this share, the headings or the blocks are not English. Proposed by the
 * 2026-10-17 evaluation that found the failure. A name the record holds only in
 * Japanese is excluded before the share is taken, so what this allows is the
 * odd term with no English form, not a sentence.
 */
export const MAX_JAPANESE_SHARE = 0.05;

/**
 * The record's names that exist only in Japanese, as this spec gives them. The
 * spec already prefers a Latin name wherever the record holds one
 * (`nameInLanguage`), so a name it carries in Japanese script is one the record
 * has no other spelling for.
 */
export function japaneseOnlyNames(spec: RenderSpec): string[] {
  const names = [
    ...spec.employers.map((e) => e.name),
    ...spec.projects.map((p) => p.name),
    ...spec.educations.map((e) => e.institution),
  ];
  // Longest first, so a name containing a shorter one is removed whole.
  return [...new Set(names.filter(hasJapaneseScript))].sort((a, b) => b.length - a.length);
}

/** The share of Japanese script in `texts`, over every character that is not whitespace. */
export function japaneseShare(texts: readonly string[], exempt: readonly string[] = []): number {
  let japanese = 0;
  let total = 0;
  for (const raw of texts) {
    const text = exempt.reduce((t, name) => t.split(name).join(" "), raw);
    japanese += text.match(JAPANESE_SCRIPT)?.length ?? 0;
    total += text.replace(/\s/gu, "").length;
  }
  return total === 0 ? 0 : japanese / total;
}

export type EnglishDefect = "headings" | "blocks" | "employer_names";

/**
 * What is wrong with an English document, or null when nothing this checks is.
 *
 * `employer_names` is the second half of the same failure: the story that came
 * back in Japanese also respelt three of the record's names. An employer's
 * chapter is keyed by that employer's id, so whether it names its employer as
 * the record writes it is a lookup rather than a guess. The other renders are
 * not checked for it here: nothing ties a résumé section to one employer.
 */
export function englishDefect(content: RenderContent, spec: RenderSpec): EnglishDefect | null {
  const exempt = japaneseOnlyNames(spec);
  if (japaneseShare(content.sections.map((s) => s.heading), exempt) > MAX_JAPANESE_SHARE) return "headings";
  const blocks = content.sections.flatMap((s) => s.blocks.map((b) => b.text));
  if (japaneseShare(blocks, exempt) > MAX_JAPANESE_SHARE) return "blocks";

  const nameOf = new Map(spec.employers.map((e) => [e.id, e.name]));
  for (const section of content.sections) {
    const employerId = employerIdOfChapter(section.key);
    const name = employerId === null ? undefined : nameOf.get(employerId);
    if (name === undefined) continue;
    const said = [section.heading, ...section.blocks.map((b) => b.text)].join("\n");
    if (!said.includes(name)) return "employer_names";
  }
  return null;
}

/**
 * The reason a twice-failed generation is marked failed with. Plain, and about
 * the document rather than its content: this reaches the proposal row and the
 * screen, where no render text is shown.
 */
export const ENGLISH_DEFECT_REASON: Record<EnglishDefect, string> = {
  headings:
    "The model wrote this English document's headings in Japanese, twice, so it was not offered for review. Your current version is unchanged; generate again to retry.",
  blocks:
    "The model wrote this English document partly in Japanese, twice, so it was not offered for review. Your current version is unchanged; generate again to retry.",
  employer_names:
    "The model did not name every employer the way your record writes it, twice, so this document was not offered for review. Your current version is unchanged; generate again to retry.",
};
