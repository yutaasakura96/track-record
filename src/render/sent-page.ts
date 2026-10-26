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
import { fillRirekishoTemplate, type RirekishoRow, type RirekishoTemplateData } from "./rirekisho-template";
import { readSheet, type Sheet } from "./sheet";
import { blockLines, type JapaneseDocument } from "./japanese";

export interface SentPage {
  /**
   * The title the file prints above the name. Null where it prints none, as the
   * English résumé does; a page stored before titles were kept has no field.
   */
  title?: string | null;
  /** The date the file carries above its name. Null where its kind is not dated. */
  stamp: string | null;
  name: string;
  /**
   * The English résumé's line under the name, set apart as its file sets it.
   * Absent on every other kind, and on a résumé page stored before it was set
   * apart, whose headline is its first contact line.
   */
  headline?: string;
  /** The lines under the name, as the file carried them. */
  contact: string[];
  sections: { heading: string; blocks: { kind: BlockKind; text: string; factIds?: string[] }[] }[];
  /**
   * A 履歴書's form as its file lays it out, read back out of the file
   * (`./sheet.ts`). Set only for a 履歴書; the screen shows it in place of
   * everything above, which stays for the readers that want the text alone.
   */
  sheet?: Sheet;
  readFailure?: "original_file_unreadable";
}

const sectionsOf = (content: RenderContent, citations: boolean): SentPage["sections"] =>
  content.sections
    .filter((section) => section.blocks.length > 0)
    .map((section) => ({
      heading: section.heading,
      blocks: section.blocks.map((block) => ({ kind: block.kind, text: block.text, ...(citations ? { factIds: block.factIds } : {}) })),
    }));

/**
 * The page of a 職務経歴書 or a Japanese story (`./japanese.ts`): each
 * employer's header as the line {@link headerLine} writes, and its roles as a
 * row under it, as the files print them.
 */
export function japaneseSentPage(doc: JapaneseDocument, citations = false): SentPage {
  return {
    title: doc.title,
    stamp: doc.stamp,
    name: doc.name,
    contact: doc.contact,
    sections: doc.sections.map((section) => ({
      heading: section.heading,
      blocks: section.blocks.flatMap(blockLines).map((block) => ({
        kind: block.kind,
        text: block.text,
        ...(citations ? { factIds: block.factIds } : {}),
      })),
    })),
  };
}

/** The page of a document `toDocx` assembles, from what `toDocx` is given. */
export function sentPage(kind: RenderKind, content: RenderContent, identity: RenderIdentity, today: string, citations = false): SentPage {
  const [name = "", ...contact] = identityLines(kind, identity);
  return { title: RENDER_TITLE[kind], stamp: documentDate(kind, today), name, contact, sections: sectionsOf(content, citations) };
}

const tableRow = (row: RirekishoRow) => ({
  kind: "row" as const,
  text: row.year ? `${row.year}年${row.month}月　${row.text}` : row.text,
});

/**
 * The page of a 履歴書, from the data its template was filled with and the file
 * that filling produced. The form's cells are also read out as sections in the
 * form's own order, for a reader that wants the text alone; an empty table or
 * an unwritten prose cell is left out there, as an empty section is anywhere
 * else. `bytes` is the file a download hands over, when the caller has it.
 */
export function rirekishoSentPage(
  data: RirekishoTemplateData,
  content: RenderContent,
  bytes: Uint8Array = fillRirekishoTemplate(data),
  citations = false,
): SentPage {
  const headingOf = new Map(content.sections.map((section) => [section.key, section.heading]));
  // A cell is one paragraph however many blocks wrote it, so it cites them all.
  const citedBy = (key: string) => [
    ...new Set(content.sections.filter((section) => section.key === key).flatMap((section) => section.blocks.flatMap((block) => block.factIds))),
  ];
  const prose = (key: string, text: string, fallback: string) =>
    text === ""
      ? []
      : [{ heading: headingOf.get(key) ?? fallback, blocks: [{ kind: "paragraph" as const, text, ...(citations ? { factIds: citedBy(key) } : {}) }] }];
  const table = (heading: string, rows: RirekishoRow[]) =>
    rows.length === 0 ? [] : [{ heading, blocks: rows.map(tableRow) }];

  const sheet = readSheet(bytes);
  if (citations) {
    const tables = sheet.blocks.filter((block) => block.kind === "table");
    for (const [index, key] of [[3, "motivation"], [4, "kibou"]] as const) {
      const cell = tables[index]?.rows[1]?.[0];
      if (!cell || cell.lines.map((line) => line.text).join("\n") !== data[key]) {
        throw new Error(`The ${key} cell does not match the filled 履歴書.`);
      }
      cell.factIds = citedBy(key);
    }
  }
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
    sheet,
  };
}
