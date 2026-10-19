/**
 * What the screen shows of a sent copy (`docs/10` Screen 15, issue #71).
 *
 * A sent copy is a `.docx`, and a `.docx` is not read on a page. So the text
 * the file was assembled from is kept beside it, taken at the same moment from
 * the same inputs. For a 履歴書 that includes the three tables, which a version
 * does not store and a later read would fill from a later record.
 *
 * The page is stored, never rebuilt. Rebuilding it would read today's profile
 * and today's record, which is the one thing a sent copy must not do.
 */
import { RENDER_TITLE, type BlockKind, type RenderContent, type RenderKind } from "~/shared/render-content";
import { documentDate, identityLines, type RenderIdentity } from "./identity";
import type { RirekishoRow, RirekishoTemplateData } from "./rirekisho-template";

export interface SentPage {
  title: string;
  /** The date the file carries above its name. Null where its kind is not dated. */
  stamp: string | null;
  name: string;
  /** The lines under the name, as the file carried them. */
  contact: string[];
  sections: { heading: string; blocks: { kind: BlockKind; text: string }[] }[];
  form?: {
    cells: { label: string; value: string }[];
    tables: { heading: string; rows: RirekishoRow[] }[];
    prose: { heading: string; text: string }[];
  };
}

const sectionsOf = (content: RenderContent): SentPage["sections"] =>
  content.sections
    .filter((section) => section.blocks.length > 0)
    .map((section) => ({
      heading: section.heading,
      blocks: section.blocks.map((block) => ({ kind: block.kind, text: block.text })),
    }));

/** The page of a document `toDocx` assembles, from what `toDocx` is given. */
export function sentPage(kind: RenderKind, content: RenderContent, identity: RenderIdentity, today: string): SentPage {
  const [name = "", ...contact] = identityLines(kind, identity);
  return { title: RENDER_TITLE[kind], stamp: documentDate(kind, today), name, contact, sections: sectionsOf(content) };
}

const tableRow = (row: RirekishoRow) => ({
  kind: "row" as const,
  text: row.year ? `${row.year}年${row.month}月　${row.text}` : row.text,
});

/**
 * The page of a 履歴書, from the data its template was filled with. The form's
 * cells are read out as sections in the form's own order; an empty table or an
 * unwritten prose cell is left out, as an empty section is anywhere else.
 */
export function rirekishoSentPage(data: RirekishoTemplateData, content: RenderContent): SentPage {
  const headingOf = new Map(content.sections.map((section) => [section.key, section.heading]));
  const prose = (key: string, text: string, fallback: string) =>
    text === "" ? [] : [{ heading: headingOf.get(key) ?? fallback, blocks: [{ kind: "paragraph" as const, text }] }];
  const table = (heading: string, rows: RirekishoRow[]) =>
    rows.length === 0 ? [] : [{ heading, blocks: rows.map(tableRow) }];

  return {
    title: "履 歴 書",
    stamp: `${data.submitYear}年${data.submitMonth}月${data.submitDay}日現在`,
    name: data.nameKanji,
    contact: [
      data.nameKana ? `ふりがな ${data.nameKana}` : "",
      `${data.birthYear}年${data.birthMonth}月${data.birthDay}日生（満${data.age}歳）`,
      data.gender ? `性別 ${data.gender}` : "",
      data.addressKana ? `現住所ふりがな ${data.addressKana}` : "",
      `〒${data.postalCode} ${data.address}`,
      [data.phone, data.email].filter((value) => value !== "").join(" · "),
      data.contactLine
        ? `連絡先 ${data.contactPostalCode ? `〒${data.contactPostalCode} ` : ""}${data.contactLine}`
        : "",
    ].filter((line) => line.trim() !== ""),
    sections: [
      ...table("学歴", data.gakureki),
      ...table("職歴", data.shokureki),
      ...table("免許・資格", data.shikaku),
      ...prose("motivation", data.motivation, "志望の動機、特技、アピールポイントなど"),
      ...prose("kibou", data.kibou, "本人希望記入欄"),
    ],
    form: {
      cells: [
        { label: "ふりがな", value: data.nameKana },
        { label: "氏名", value: data.nameKanji },
        { label: "性別", value: data.gender },
        { label: "生年月日", value: `${data.birthYear}年${data.birthMonth}月${data.birthDay}日生（満${data.age}歳）` },
        { label: "現住所 ふりがな", value: data.addressKana },
        { label: "現住所", value: `〒${data.postalCode} ${data.address}` },
        { label: "電話", value: data.phone },
        { label: "メール", value: data.email },
        { label: "連絡先", value: `${data.contactPostalCode ? `〒${data.contactPostalCode} ` : ""}${data.contactLine}` },
      ],
      tables: [
        { heading: "学歴・職歴", rows: [
          { year: "", month: "", text: "学歴" },
          ...data.gakureki,
          { year: "", month: "", text: "職歴" },
          ...data.shokureki,
          { year: "", month: "", text: "以上" },
        ] },
        { heading: "免許・資格", rows: data.shikaku },
      ],
      prose: [
        { heading: "志望動機・特技・アピールポイントなど", text: data.motivation },
        { heading: "本人希望欄", text: data.kibou },
      ],
    },
  };
}
