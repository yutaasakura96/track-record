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
import { resolveEmployer } from "./attribution";
import { documentDate, identityLines, type RenderIdentity } from "./identity";

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
