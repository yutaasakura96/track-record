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

export type EnglishDefect = "headings" | "blocks" | "record_names";

function distanceWithin(a: string, b: string, limit: number): boolean {
  if (Math.abs(a.length - b.length) > limit) return false;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(previous[j]! + 1, next[j - 1]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = next;
  }
  return previous[b.length]! <= limit;
}

const WORD = /[\p{L}\p{N}'’]+/gu;

/**
 * A mention of a name keeps the name's capitals: "Payment gateways" at the
 * start of a sentence is prose, not a respelling of the project "Payment Gateway".
 */
const casedLike = (tokens: readonly string[], words: readonly string[]): boolean =>
  words.every((word, j) => /^\p{Lu}/u.test(word) === /^\p{Lu}/u.test(tokens[j] ?? ""));

function hasRespeltName(text: string, names: readonly string[], header: boolean): boolean {
  for (const name of names) {
    // Free prose needs a six-character floor; short ordinary words resemble short names too often.
    if (!header && name.length < 6) continue;
    const words = name.match(WORD) ?? [];
    if (words.length === 0) continue;
    // In prose a name differing from the record only in letter case is the name.
    const exact = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), header ? "gu" : "giu");
    const tokens = text.replace(exact, " ").match(WORD) ?? [];
    const expected = words.join(" ").toLocaleLowerCase();
    for (let i = 0; i <= tokens.length - words.length; i++) {
      const found = tokens.slice(i, i + words.length);
      if (!casedLike(found, words)) continue;
      if (!header && words.length === 1 && !/[\p{Script=Han}\p{Script=Katakana}]/u.test(found[0]!) &&
          !/^(?:at|for|from|with|project|school|employer|called|named)$/iu.test(tokens[i - 1] ?? "")) continue;
      const candidate = found.join(" ").toLocaleLowerCase();
      if (distanceWithin(candidate, expected, name.length >= 12 ? 2 : 1)) return true;
    }
  }
  return false;
}

function hasChangedHeaderName(text: string, names: readonly string[]): boolean {
  const tokens = text.match(WORD) ?? [];
  for (const name of names) {
    if (text.includes(name)) continue;
    const words = name.match(WORD) ?? [];
    if (words.length < 2 || words[0]!.length < 5) continue;
    for (let i = 0; i < tokens.length - 1; i++) {
      if (!casedLike(tokens.slice(i, i + 2), words.slice(0, 2))) continue;
      if (distanceWithin(tokens[i]!.toLocaleLowerCase(), words[0]!.toLocaleLowerCase(), 1) &&
          distanceWithin(tokens[i + 1]!.toLocaleLowerCase(), words[1]!.toLocaleLowerCase(), 1)) return true;
    }
  }
  return false;
}

/**
 * The generic titles a résumé or story gives its sections — "Experience",
 * 職務経歴 — which name no employer, school or project, so the record-name
 * checks pass over them. A heading that adds anything to one of these is not a
 * bare title and is checked like any other.
 */
const SECTION_TITLES = new Set([
  "summary", "profile", "experience", "work experience", "professional experience", "employment",
  "education", "skills", "technical skills", "projects", "certifications", "languages",
  "職務要約", "職務経歴", "学歴", "スキル", "技術スキル", "プロジェクト", "資格", "免許・資格", "語学", "自己pr",
]);

const isSectionTitle = (heading: string): boolean =>
  SECTION_TITLES.has(heading.normalize("NFKC").trim().replace(/[:：]$/u, "").toLocaleLowerCase());

/**
 * What is wrong with an English document, or null when nothing this checks is.
 *
 * Names in record-backed locations and near-miss spellings in any output text
 * are checked against the same spec supplied to the model.
 */
export function englishDefect(content: RenderContent, spec: RenderSpec): EnglishDefect | null {
  const exempt = japaneseOnlyNames(spec);
  if (japaneseShare(content.sections.map((s) => s.heading), exempt) > MAX_JAPANESE_SHARE) return "headings";
  const blocks = content.sections.flatMap((s) => s.blocks.map((b) => b.text));
  if (japaneseShare(blocks, exempt) > MAX_JAPANESE_SHARE) return "blocks";

  const names = [...spec.employers.map((e) => e.name), ...spec.educations.map((e) => e.institution), ...spec.projects.map((p) => p.name)];
  if (content.sections.some((s) => s.blocks.some((b) => b.kind !== "row" && hasRespeltName(b.text, names, false)))) {
    return "record_names";
  }
  if (content.sections.some((s) => (!isSectionTitle(s.heading) && (hasRespeltName(s.heading, names, true) || hasChangedHeaderName(s.heading, names))) ||
      s.blocks.some((b) => b.kind === "row" &&
        (hasRespeltName(b.text, names, true) || hasChangedHeaderName(b.text, names))))) return "record_names";
  const nameOf = new Map(spec.employers.map((e) => [e.id, e.name]));
  for (const section of content.sections) {
    const employerId = employerIdOfChapter(section.key);
    const name = employerId === null ? undefined : nameOf.get(employerId);
    if (name === undefined) continue;
    const said = [section.heading, ...section.blocks.map((b) => b.text)].join("\n");
    if (!said.includes(name)) return "record_names";
  }
  if (spec.kind === "english_resume") {
    // A line that names an employer, a school or a project names one of the
    // record's, exactly. A section title names none of them and is not held to it.
    const employers = spec.employers.map((e) => e.name);
    const experience = content.sections.filter((s) => s.key === "experience" && !isSectionTitle(s.heading));
    if (experience.some((s) => !employers.some((name) => s.heading.includes(name)))) return "record_names";
    const rowsOf = (key: string) => content.sections.filter((s) => s.key === key).flatMap((s) => s.blocks.filter((b) => b.kind === "row"));
    const schools = spec.educations.map((e) => e.institution);
    if (rowsOf("education").some((row) => !schools.some((name) => row.text.includes(name)))) return "record_names";
    const projects = spec.projects.filter((p) => p.employerId === null).map((p) => p.name);
    if (rowsOf("projects").some((row) => !projects.some((name) => row.text.includes(name)))) return "record_names";
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
  record_names:
    "The model changed a name from your record twice, so this document was not offered for review. Your current version is unchanged; generate again to retry.",
};

export const MIXED_ENGLISH_DEFECT_REASON =
  "The model returned two English documents with different language or record name errors, so neither was offered for review. Your current version is unchanged; generate again to retry.";
