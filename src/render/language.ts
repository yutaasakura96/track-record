/**
 * Is an English document English? (Issue #104.)
 *
 * The first English career stories generated from a record with Japanese
 * business descriptions came back in Japanese — the whole of one, and every
 * chapter heading of the next — and both were offered for review. At that
 * time, the review screen did not show heading changes. The prompt said
 * "Write the document in English" once, below a register that named no language and above a list of
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
 * A mention of a name in prose keeps the name's capitals: "Payment gateways" at
 * the start of a sentence is prose, not a respelling of the project "Payment Gateway".
 */
const casedLike = (tokens: readonly string[], words: readonly string[]): boolean =>
  words.every((word, j) => /^\p{Lu}/u.test(word) === /^\p{Lu}/u.test(tokens[j] ?? ""));

const escaped = (name: string): string => name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/**
 * A name as a whole word: "Data" is not in "Database", and "Mira" is not in
 * "Mirage". Only a Latin letter or a digit continues a word; a Japanese name
 * written against the kana around it is still that name.
 */
const nameRegExp = (name: string, flags: string): RegExp => {
  const edge = /[\p{Script=Latin}\p{N}]/u;
  const before = edge.test(name.at(0) ?? "") ? "(?<![\\p{Script=Latin}\\p{N}])" : "";
  const after = edge.test(name.at(-1) ?? "") ? "(?![\\p{Script=Latin}\\p{N}])" : "";
  return new RegExp(`${before}${escaped(name)}${after}`, flags);
};

/** Whether `text` names `name` exactly, as a whole word. */
const mentions = (text: string, name: string): boolean => nameRegExp(name, "u").test(text);

/** Where a name was taken out. Never a word, so never read as one. */
const STRIPPED = "\u0000";

/**
 * The text with every one of `names` it holds exactly taken out, longest first,
 * so "Shirasagi University" is not read as a changed "Shirasagi University Graduate School".
 */
const withoutNames = (text: string, names: readonly string[], flags: string): string =>
  [...names].sort((a, b) => b.length - a.length).reduce((t, name) => t.replace(nameRegExp(name, flags), ` ${STRIPPED} `), text);

/**
 * What divides a heading or a row into fields: "Aoi — graduated", "Shirasagi
 * University, 2011-2015". A field that is nothing but a name-like word is a name.
 */
const FIELD_SEPARATOR = /\s[-–—]\s|[—–,;:|()·]/gu;

type Token = { word: string; field: number };

const tokensOf = (text: string): Token[] =>
  text.split(FIELD_SEPARATOR).flatMap((field, i) => (field.match(/[\p{L}\p{N}'’]+|\u0000/gu) ?? []).map((word) => ({ word, field: i })));

/** The words that put a name next to them: "at Ledger", "joined Ledger", "the Mira project". */
const NAME_BEFORE = /^(?:at|for|from|with|to|joined|left|project|school|employer|called|named)$/iu;
const SHORT_NAME_CUE = /^(?:joined|at|for|with|left|from)$/iu;
const NAME_AFTER = /^(?:project|school)$/iu;

const besideNameWord = (tokens: readonly Token[], i: number, length: number): boolean =>
  NAME_BEFORE.test(tokens[i - 1]?.word ?? "") || NAME_AFTER.test(tokens[i + length]?.word ?? "");

const isWholeField = (tokens: readonly Token[], i: number, length: number): boolean =>
  tokens.filter((t) => t.field === tokens[i]!.field).length === length &&
  tokens.slice(i, i + length).every((t) => t.field === tokens[i]!.field);

const MONTH = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
const YEAR = "\\d{4}";
const DATE = `(?:${YEAR}(?:-(?:0?[1-9]|1[0-2]))?|(?:0?[1-9]|1[0-2])/${YEAR}|${MONTH}\\s+${YEAR})`;
const DATE_FIELD = new RegExp(`^${DATE}(?:\\s*[-–—]\\s*(?:${DATE}|Present|Now))?$`, "iu");

const isDateLabel = (text: string, tokens: readonly Token[], i: number): boolean =>
  tokens[i]!.word.toLocaleLowerCase() === "date" &&
  (tokens[i + 1]?.word.toLocaleLowerCase() === "of" ||
    DATE_FIELD.test(text.split(FIELD_SEPARATOR)[tokens[i]!.field + 1]?.trim() ?? ""));

function hasRespeltName(text: string, names: readonly string[], header: boolean): boolean {
  // In prose a name differing from the record only in letter case is the name.
  const flags = header ? "gu" : "giu";
  for (const name of names) {
    const words = name.match(WORD) ?? [];
    if (words.length === 0) continue;
    // This name, and every name not inside it, is taken out. A shorter record
    // name inside this one stays, or "Shirasagi University Graduate Schol" would
    // lose "Shirasagi University" and leave nothing to compare.
    const inside = (other: string) => other !== name && nameRegExp(other, header ? "u" : "iu").test(name);
    const stripped = withoutNames(text, names.filter((other) => !inside(other)), flags);
    const tokens = tokensOf(stripped);
    const expected = words.join(" ").toLocaleLowerCase();
    for (let i = 0; i <= tokens.length - words.length; i++) {
      const found = tokens.slice(i, i + words.length).map((t) => t.word);
      if (found.includes(STRIPPED)) continue;
      if (header) {
        const capitalised = !/\p{Script=Latin}/u.test(found[0]!) || /^\p{Lu}/u.test(found[0]!);
        const named = capitalised && (words.length > 1 || name.length >= 6);
        const namePosition = isWholeField(tokens, i, words.length) || besideNameWord(tokens, i, words.length);
        if (name.length < 6 && isDateLabel(stripped, tokens, i)) continue;
        if (name.length < 6 && found.join(" ").toLocaleLowerCase() === expected && !namePosition) continue;
        if (name.length >= 6 && !named && !namePosition) continue;
      } else {
        if (name.length < 6) {
          if (!SHORT_NAME_CUE.test(tokens[i - 1]?.word ?? "")) continue;
        } else {
          if (!casedLike(found, words)) continue;
          if (words.length === 1 && !/[\p{Script=Han}\p{Script=Katakana}]/u.test(found[0]!) && !NAME_BEFORE.test(tokens[i - 1]?.word ?? "")) continue;
        }
      }
      const candidate = found.join(" ").toLocaleLowerCase();
      if (distanceWithin(candidate, expected, name.length >= 12 ? 2 : 1)) return true;
    }
  }
  return false;
}

function hasChangedHeaderName(text: string, names: readonly string[]): boolean {
  const tokens = withoutNames(text, names, "gu").match(WORD) ?? [];
  for (const name of names) {
    const words = name.match(WORD) ?? [];
    if (words.length < 2 || words[0]!.length < 5) continue;
    for (let i = 0; i < tokens.length - 1; i++) {
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
 * The words a résumé's experience heading uses without naming anybody —
 * "Selected Experience", "Recent Work". A heading with any other capitalised
 * word may name an employer and is held to the record's names.
 */
const GENERIC_EXPERIENCE_WORDS = new Set([
  "selected", "recent", "relevant", "highlights", "professional", "work", "experience", "career", "key",
  "history", "employment", "roles",
]);

const isGenericExperienceHeading = (heading: string): boolean =>
  (heading.match(WORD) ?? []).every((word) => !/^\p{Lu}/u.test(word) || GENERIC_EXPERIENCE_WORDS.has(word.toLocaleLowerCase()));

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
    if (!mentions(said, name)) return "record_names";
  }
  if (spec.kind === "english_resume") {
    // A line that names an employer, a school or a project names one of the
    // record's, exactly. A section title names none of them and is not held to it.
    const employers = spec.employers.map((e) => e.name);
    const experience = content.sections.filter((s) => s.key === "experience" && !isSectionTitle(s.heading) && !isGenericExperienceHeading(s.heading));
    if (experience.some((s) => !employers.some((name) => mentions(s.heading, name)))) return "record_names";
    const rowsOf = (key: string) => content.sections.filter((s) => s.key === key).flatMap((s) => s.blocks.filter((b) => b.kind === "row"));
    const schools = spec.educations.map((e) => e.institution);
    if (rowsOf("education").some((row) => !schools.some((name) => mentions(row.text, name)))) return "record_names";
    const projects = spec.projects.filter((p) => p.employerId === null).map((p) => p.name);
    if (rowsOf("projects").some((row) => !projects.some((name) => mentions(row.text, name)))) return "record_names";
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
