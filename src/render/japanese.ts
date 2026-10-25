/**
 * The 職務経歴書 and the Japanese career story, as their files print them
 * (issue #117, review §4.1).
 *
 * Both went through `toDocx`, the generic renderer the English résumé had
 * already left: Word's defaults, Times New Roman beside a Japanese font, blue
 * headings, and each employer's line a paragraph of the model's prose that ran
 * into the employer before it. This is the document both formats are set from
 * instead — the `.docx` (`./japanese-docx.ts`), the PDF (`./japanese-pdf.ts`),
 * the Markdown and the page on the screen — so the four cannot disagree.
 *
 * **Each employer's header is the record's, not the model's.** The 職務経歴
 * section is a run of groups, each opened by one paragraph (`docs/03` §4.2).
 * That paragraph is now only the employer's name, and here it is joined to the
 * record by the same name resolution the attribution check uses
 * (`./attribution.ts`), then printed as a header: 会社名, 雇用形態, the period
 * and the roles held there, all as the record holds them on the day the file
 * is built. A version written before this, whose opening paragraph also
 * carries a period and roles in the model's words, resolves the same way, so
 * every version downloads with a header the record vouches for. A paragraph
 * naming no employer is printed as it was written rather than refused: the
 * 職務経歴書 has no other way to say which employer it is.
 */
import { RENDER_TITLE, type BlockKind, type RenderContent, type RenderKind } from "~/shared/render-content";
import type { RenderFact, RenderSpec } from "~/model/types";
import { resolveEmployer } from "./attribution";
import { documentDate, identityLines, type RenderIdentity } from "./identity";
import { PROSE_SECTION_KEYS } from "./rirekisho";

export type EmploymentType = "full_time" | "contract" | "dispatch" | "part_time" | "independent";

/** 雇用形態 as a 職務経歴書 writes it beside the company. */
export const EMPLOYMENT_JA: Record<EmploymentType, string> = {
  full_time: "正社員",
  contract: "契約社員",
  dispatch: "派遣社員",
  part_time: "アルバイト",
  independent: "個人事業主",
};

/** One employer as the header reads it from the record. */
export interface JapaneseEmployer {
  id: string;
  nameJa: string;
  nameLatin: string | null;
  employmentType: EmploymentType;
  startedOn: string;
  endedOn: string | null;
  /** Oldest first. */
  roles: { title: string; startedOn: string; endedOn: string | null }[];
}

export interface EmployerHeader {
  kind: "employer";
  name: string;
  employment: string;
  period: string;
  /** The roles held there, or null when the record holds none with a title. */
  roles: string | null;
  factIds: string[];
}

export type JapaneseBlock = EmployerHeader | { kind: BlockKind; text: string; factIds: string[] };

export interface JapaneseSection {
  key: string;
  heading: string;
  blocks: JapaneseBlock[];
}

export interface JapaneseDocument {
  kind: RenderKind;
  title: string;
  /** 「2026年10月23日現在」, or null for a kind that is not dated. */
  stamp: string | null;
  name: string;
  contact: string[];
  sections: JapaneseSection[];
}

/** The section whose paragraphs open employers (`docs/03` §4.2). */
const EXPERIENCE = "experience";

/** `2019-01-01` → `2019年1月`. */
export const monthJa = (iso: string) => `${Number(iso.slice(0, 4))}年${Number(iso.slice(5, 7))}月`;

/** `2019年1月～2020年6月`, or `2020年7月～現在` while it continues. */
export const periodJa = (startedOn: string, endedOn: string | null) =>
  `${monthJa(startedOn)}～${endedOn ? monthJa(endedOn) : "現在"}`;

function rolesLine(roles: JapaneseEmployer["roles"]): string | null {
  const titled = roles.filter((r) => r.title.trim());
  if (titled.length === 0) return null;
  if (titled.length === 1) return titled[0]!.title.trim();
  return titled.map((r) => `${r.title.trim()}（${periodJa(r.startedOn, r.endedOn)}）`).join("、");
}

export function employerHeader(employer: JapaneseEmployer, factIds: string[] = []): EmployerHeader {
  return {
    kind: "employer",
    name: employer.nameJa,
    employment: EMPLOYMENT_JA[employer.employmentType],
    period: periodJa(employer.startedOn, employer.endedOn),
    roles: rolesLine(employer.roles),
    factIds,
  };
}

/** The header as one line of text, for the Markdown and the screen: 「株式会社X（正社員）　2019年1月～2020年6月」. */
export const headerLine = (header: EmployerHeader) => `${header.name}（${header.employment}）　${header.period}`;

export function assembleJapanese(args: {
  kind: RenderKind;
  content: RenderContent;
  identity: RenderIdentity;
  today: string;
  employers: readonly JapaneseEmployer[];
}): JapaneseDocument {
  const { kind, content, identity, today, employers } = args;
  const named = employers.map((e) => ({
    employer: e,
    record: { id: e.id, names: [e.nameJa, ...(e.nameLatin ? [e.nameLatin] : [])], copy: [] },
  }));
  const [name = "", ...contact] = identityLines(kind, identity);

  const sections = content.sections
    .filter((section) => section.blocks.length > 0)
    .map((section): JapaneseSection => ({
      key: section.key,
      heading: section.heading,
      blocks: section.blocks.map((block): JapaneseBlock => {
        if (section.key !== EXPERIENCE || block.kind !== "paragraph") {
          return { kind: block.kind, text: block.text, factIds: block.factIds };
        }
        const id = resolveEmployer(block.text, named.map((n) => n.record));
        const employer = named.find((n) => n.employer.id === id)?.employer;
        return employer
          ? employerHeader(employer, block.factIds)
          : { kind: block.kind, text: block.text, factIds: block.factIds };
      }),
    }));

  return { kind, title: RENDER_TITLE[kind], stamp: documentDate(kind, today), name, contact, sections };
}

/** Each block as the text it prints, the header as {@link headerLine} and its roles as a line of their own. */
export function blockLines(block: JapaneseBlock): { kind: BlockKind; text: string; factIds: string[] }[] {
  if (block.kind !== "employer") return [block];
  return [
    { kind: "paragraph", text: headerLine(block), factIds: block.factIds },
    ...(block.roles ? [{ kind: "row" as const, text: block.roles, factIds: [] }] : []),
  ];
}

/** The document as Markdown, for the `?format=md` download. */
export function japaneseMarkdown(doc: JapaneseDocument): string {
  const lines: string[] = [`# ${doc.title}`, ""];
  if (doc.stamp) lines.push(doc.stamp, "");
  if (doc.name) lines.push(`**${doc.name}**`, ...doc.contact, "");
  for (const section of doc.sections) {
    lines.push(`## ${section.heading}`, "");
    for (const block of section.blocks) {
      if (block.kind === "employer") {
        lines.push(`### ${headerLine(block)}`, "");
        if (block.roles) lines.push(block.roles, "");
        continue;
      }
      lines.push(block.kind === "bullet" ? `- ${block.text}` : block.text, "");
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

/**
 * `職務経歴書_森山健二_20261023.pdf`, the name recruiters' guidance gives a
 * Japanese application file: what it is, whose it is, and the day it is dated.
 * The date is the day it is built, which is the date the document prints.
 */
export function japaneseFilename(kind: RenderKind, nameKanji: string, today: string, extension: string): string {
  const name = nameKanji.replace(/[\s　]+/g, "");
  return `${RENDER_TITLE[kind]}_${name ? `${name}_` : ""}${today.replace(/-/g, "")}.${extension}`;
}

/** The ASCII name sent beside it, for a client that cannot read `filename*` (RFC 6266 §4.3). */
export function asciiFilename(kind: RenderKind, nameLatin: string, today: string, extension: string): string {
  const name = nameLatin
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${kind.replace(/_/g, "-")}_${name ? `${name}_` : ""}${today.replace(/-/g, "")}.${extension}`;
}
/**
 * Is a Japanese document written the way its register says? (Issue #117,
 * review issue 5.)
 *
 * Every rule the three Japanese registers state was enforced by the prompt
 * alone, and the review that found it also found English printed in a
 * 職務経歴書: curated skill group names copied as given (E1), and a project's
 * English summary copied into its プロジェクト row (E2). This is the Japanese
 * half of `./language.ts`, and like it, a count rather than a judgement.
 *
 * Two kinds of finding, because two kinds of mistake:
 * - a **defect** is a document no Japanese reader should be sent — 御社, or a
 *   line of English. It is retried once and then refused, exactly as an
 *   English document in Japanese is.
 * - an **advisory** is a register slip the author can see and fix in a word —
 *   a 貴社 where no company is addressed, a full-width digit, a long bullet, a
 *   です・ます bullet. It is stated in the review footer and never blocks.
 */

/**
 * Kana and kanji only. `./language.ts` counts the CJK punctuation and the
 * full-width forms as Japanese too, which is right for asking whether English
 * is English and wrong here: 「Languages：」 is still a line of English.
 */
const KANA_KANJI = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;

const LATIN_WORD = /\p{Script=Latin}{2,}/u;

/**
 * What divides one statement from the next inside a block. E2's row was
 * 「プロジェクト：決済元帳の再構築　Replaced an update-in-place balance table…」:
 * Japanese as a whole, and an English sentence after the ideographic space.
 * 、 is not here, because it divides the items of a list, and a list of
 * technologies is Latin by nature.
 */
const STATEMENT_BREAK = /[：。！？\n　]/u;

/**
 * Words a technology name or a label never is and an English sentence always
 * holds. A run of three or more Latin words carrying one is prose.
 */
const FUNCTION_WORDS = new Set([
  "a", "an", "the", "and", "or", "of", "to", "in", "on", "at", "by", "for", "from", "with", "into", "over",
  "is", "are", "was", "were", "as", "that", "which",
]);

/** The longest run of Latin words a statement may hold before it is read as an English sentence. */
const MAX_LATIN_WORDS_IN_JAPANESE = 2;

/**
 * The 職務経歴書's bound on a bullet, stated by its register. Counted in code
 * points, which is what a reader counts as characters.
 */
export const MAX_SHOKUMU_BULLET_LENGTH = 120;

/** です・ます体 at the end of a sentence, in the forms an experience bullet would take. */
const DESU_MASU_ENDING = /(?:です|ます|でした|ました|ません|ましょう)[。．.！!]?$/u;

const FULL_WIDTH_DIGIT = /[０-９]/u;

const escaped = (term: string): string => term.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/**
 * Everything a Japanese document is right to print in Latin script: the
 * record's names as it holds them, the titles held, the qualifications, and
 * every technology a fact or a curated skill names. A skill group's NAME is not
 * here. It is the label E1 printed in English, and a label is written in the
 * document's language.
 */
export function latinTerms(spec: RenderSpec, facts: readonly Pick<RenderFact, "technologies">[] = []): string[] {
  const terms = [
    spec.subjectName,
    ...spec.employers.flatMap((e) => [e.name, e.city, ...e.roles.map((r) => r.title)]),
    ...spec.projects.map((p) => p.name),
    ...spec.educations.flatMap((e) => [e.institution, e.faculty, e.degree, e.fieldOfStudy]),
    ...spec.certifications.flatMap((c) => [c.name, c.issuingOrganization, ...c.technologies]),
    ...(spec.curatedSkills ?? []).flatMap((g) => g.skills),
    ...facts.flatMap((f) => f.technologies),
  ];
  // Longest first, so a name containing a shorter one is removed whole.
  return [...new Set(terms.filter((t): t is string => t !== null && LATIN_WORD.test(t)))].sort((a, b) => b.length - a.length);
}

const withoutTerms = (text: string, terms: readonly string[]): string =>
  terms.reduce((t, term) => t.replace(new RegExp(escaped(term), "giu"), " "), text);

/**
 * A heading or a block written in English. Either the whole line has no kana
 * or kanji and something Latin is left once the record's own terms are taken
 * out (E1: 「Languages」), or one statement inside it is an English sentence
 * (E2: a Japanese label, then the summary in English).
 */
export function isEnglishLine(text: string, terms: readonly string[]): boolean {
  const rest = withoutTerms(text, terms);
  if (!KANA_KANJI.test(rest) && LATIN_WORD.test(rest)) return true;
  return rest.split(STATEMENT_BREAK).some((statement) => {
    if (KANA_KANJI.test(statement)) return false;
    const words = (statement.match(/\p{Script=Latin}+/gu) ?? []).map((w) => w.toLocaleLowerCase());
    return words.length > MAX_LATIN_WORDS_IN_JAPANESE && words.some((w) => FUNCTION_WORDS.has(w));
  });
}

export type JapaneseDefect = "onsha" | "english";

/**
 * What makes a Japanese document unfit to offer, or null when nothing this
 * checks does. Headings are checked with the blocks: a heading in English is
 * as much a leak as a line, and the 職務経歴書's own headings are Japanese.
 */
export function japaneseDefect(
  content: RenderContent,
  spec: RenderSpec,
  facts: readonly Pick<RenderFact, "technologies">[] = [],
): JapaneseDefect | null {
  const lines = content.sections.flatMap((s) => [s.heading, ...s.blocks.map((b) => b.text)]);
  // 御社 is the spoken form. No register allows it anywhere.
  if (lines.some((line) => line.includes("御社"))) return "onsha";
  const terms = latinTerms(spec, facts);
  if (lines.some((line) => line.trim() !== "" && isEnglishLine(line, terms))) return "english";
  return null;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/**
 * The sections a register fixes, by the name it gives them. A section the
 * model names itself — a story chapter — is named by its place instead.
 */
const SECTION_NAMES: Partial<Record<RenderSpec["kind"], Record<string, string>>> = {
  rirekisho: { [PROSE_SECTION_KEYS.motivation]: "志望動機・特技・アピールポイントなど", [PROSE_SECTION_KEYS.kibou]: "本人希望欄" },
  shokumu_keirekisho: {
    summary: "経歴要約",
    skills: "活かせるスキル・経験",
    experience: "職務経歴",
    certifications: "保有資格",
    education: "学歴",
    self_pr: "自己PR",
  },
};

/**
 * The register slips in a Japanese document that do not stop it being offered.
 * One sentence per finding and section, said in the review footer, stated the
 * way `rirekishoWarnings` states its own: counts and the register's section
 * names, never render text.
 */
export function japaneseAdvisories(content: RenderContent, spec: RenderSpec): string[] {
  const advisories: string[] = [];
  for (const [i, section] of content.sections.entries()) {
    const texts = [section.heading, ...section.blocks.map((b) => b.text)];
    const name = SECTION_NAMES[spec.kind]?.[section.key];
    const where = name === undefined ? `section ${i + 1}` : name;
    // The 履歴書's 本人希望欄 is the one cell addressed to the company that receives it.
    const addressed = spec.kind === "rirekisho" && section.key === PROSE_SECTION_KEYS.kibou;
    if (!addressed && texts.some((t) => t.includes("貴社"))) {
      advisories.push(`貴社 appears in ${where}. Only the 履歴書's 本人希望欄 addresses a company; check the wording before accepting.`);
    }
    if (texts.some((t) => FULL_WIDTH_DIGIT.test(t))) {
      advisories.push(`Full-width digits in ${where}. Japanese documents write numbers in half-width digits (2024, not ２０２４).`);
    }
    if (spec.kind !== "shokumu_keirekisho") continue;
    const bullets = section.blocks.filter((b) => b.kind === "bullet");
    const long = bullets.filter((b) => [...b.text.trim()].length > MAX_SHOKUMU_BULLET_LENGTH).length;
    if (long > 0) {
      advisories.push(`${plural(long, "bullet", "bullets")} in ${where} ${long === 1 ? "runs" : "run"} over ${MAX_SHOKUMU_BULLET_LENGTH} characters.`);
    }
    if (section.key !== "experience") continue;
    const politeEndings = bullets.filter((b) => DESU_MASU_ENDING.test(b.text.trim())).length;
    if (politeEndings > 0) {
      advisories.push(
        `${plural(politeEndings, "bullet", "bullets")} in ${where} ${politeEndings === 1 ? "ends" : "end"} in です・ます. 職務経歴 bullets are written 体言止め.`,
      );
    }
  }
  return advisories;
}

/**
 * The reason a twice-failed generation is marked failed with. Plain, and about
 * the document rather than its content: this reaches the proposal row and the
 * screen, where no render text is shown.
 */
export const JAPANESE_DEFECT_REASON: Record<JapaneseDefect, string> = {
  onsha:
    "The model wrote 御社, the spoken form, in this Japanese document twice, so it was not offered for review. Your current version is unchanged; generate again to retry.",
  english:
    "The model wrote part of this Japanese document in English, twice, so it was not offered for review. Your current version is unchanged; generate again to retry.",
};

export const MIXED_JAPANESE_DEFECT_REASON =
  "The model returned two Japanese documents with different errors (御社, and a line in English), so neither was offered for review. Your current version is unchanged; generate again to retry.";
