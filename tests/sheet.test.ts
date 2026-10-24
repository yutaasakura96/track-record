/**
 * A filled 履歴書 read back as the form its file lays out (`src/render/sheet.ts`).
 *
 * The screen draws exactly what this reads, so what is asserted here is the
 * printed structure: the spaced title, the date, the identity cells with the
 * merged 写真 cell beside them, and the 年 / 月 tables with their full-width
 * 学歴 / 職歴 / 以上 rows. Every value is invented.
 */
import { describe, expect, it } from "vitest";
import { fillRirekishoTemplate, type RirekishoTemplateData } from "~/render/rirekisho-template";
import { readSheet, sheetOf, type Sheet, type SheetCell } from "~/render/sheet";
import { RIREKISHO_DATA, RIREKISHO_SHEET } from "./client/rirekisho-sheet";

const DATA: RirekishoTemplateData = {
  submitYear: "2099",
  submitMonth: "4",
  submitDay: "1",
  nameKana: "かくう はなこ",
  nameKanji: "架空 花子",
  birthYear: "1970",
  birthMonth: "1",
  birthDay: "2",
  age: "129",
  gender: "女",
  phone: "000-0000-0000",
  email: "kakuu@example.invalid",
  addressKana: "かくうけん かくうし",
  postalCode: "000-0000",
  address: "架空県架空市架空町1-2-3\n架空マンション404号室",
  contactPostalCode: "",
  contactLine: "同上",
  gakureki: [
    { year: "2085", month: "3", text: "架空高等学校 卒業" },
    { year: "2085", month: "4", text: "架空大学 架空学部 入学" },
  ],
  shokureki: [{ year: "2089", month: "4", text: "架空株式会社 入社" }],
  shikaku: [{ year: "2090", month: "6", text: "架空技術者試験　合格" }],
  motivation: "架空の志望動機 & <その理由>。",
  kibou: "貴社規定に従います。",
};

const tables = (sheet: Sheet) => sheet.blocks.flatMap((block) => (block.kind === "table" ? [block] : []));
const texts = (row: SheetCell[]) => row.map((cell) => cell.lines.map((line) => line.text).join("\n"));

describe("a filled 履歴書, read back out of its file", () => {
  const sheet = readSheet(fillRirekishoTemplate(DATA));

  it("opens with the title spaced as the file spaces it, then the date on the right", () => {
    const lines = sheet.blocks.flatMap((block) => (block.kind === "line" && block.line.text.trim() ? [block.line] : []));
    expect(lines[0]).toEqual({ text: "履 歴 書", align: "center", size: "title", bold: true, beforeTwips: 0, afterTwips: 200 });
    expect(lines[1]).toMatchObject({ text: "2099年 4月 1日現在", align: "end" });
  });

  it("lays the identity out in cells, every template field in its place, beside one 写真 cell three rows tall", () => {
    const [identity] = tables(sheet);
    expect(identity!.rows.map(texts)).toEqual([
      ["ふりがな\n名前", "かくう はなこ\n架空 花子", ""],
      ["1970年 1月 2日生（満 129 歳） 女"],
      ["電話 000-0000-0000\nEmail kakuu@example.invalid"],
      ["ふりがな\n現住所", "かくうけん かくうし\n〒000-0000\n架空県架空市架空町1-2-3\n架空マンション404号室"],
      ["ふりがな\n連絡先", "〒\n同上"],
    ]);
    expect(identity!.rows[0]![2]).toMatchObject({ colSpan: 1, rowSpan: 3, shaded: true });
    expect(identity!.rows[1]![0]!.colSpan).toBe(2);
    expect(identity!.rows[0]![1]!.lines[1]).toMatchObject({ size: "large", bold: true });
    expect(identity!.rows[0]![0]!.lines[0]!.size).toBe("small");
    expect(identity!.columns.reduce((sum, width) => sum + width, 0)).toBeCloseTo(1);
  });

  it("heads the 学歴・職歴 table with 年 / 月 and sets 学歴, 職歴 and 以上 across the whole row", () => {
    const [, history, licences] = tables(sheet);
    expect(history!.rows.map(texts)).toEqual([
      ["年", "月", "学歴・職歴"],
      ["学歴"],
      ["2085", "3", "架空高等学校 卒業"],
      ["2085", "4", "架空大学 架空学部 入学"],
      ["職歴"],
      ["2089", "4", "架空株式会社 入社"],
      ["以上"],
    ]);
    for (const at of [1, 4, 6]) expect(history!.rows[at]![0]).toMatchObject({ colSpan: 3, rowSpan: 1 });
    // 以上 closes the table on the right; the two bands stay centred.
    expect(history!.rows[6]![0]!.lines[0]!.align).toBe("end");
    expect(history!.rows[1]![0]!.lines[0]!.align).toBe("center");
    expect(history!.rows[0]!.every((cell) => cell.lines[0]!.bold && cell.shaded)).toBe(true);
    expect(history!.rows[2]!.some((cell) => cell.shaded)).toBe(false);
    expect(licences!.rows.map(texts)).toEqual([["年", "月", "免許・資格"], ["2090", "6", "架空技術者試験　合格"]]);
  });

  it("leaves out the blank rows that pad 学歴・職歴 for print, and keeps an empty 本人希望欄", () => {
    const empty = readSheet(fillRirekishoTemplate({ ...DATA, kibou: "" }));
    const [, history, , , kibou] = tables(empty);
    expect(history!.rows.map(texts).at(-1)).toEqual(["以上"]);
    expect(kibou!.rows.map(texts)).toEqual([["本人希望欄"], [""]]);
  });

  it("is the sheet the client suite draws, so a screen test reads what the file holds", () => {
    expect(readSheet(fillRirekishoTemplate(RIREKISHO_DATA))).toEqual(RIREKISHO_SHEET);
  });

  it("carries paragraph after-spacing from the filled file through separators and table cells", () => {
    const blocks = sheet.blocks;
    expect(blocks.filter((block) => block.kind === "line").map((block) => block.line.afterTwips)).toEqual([200, 200, 200, 200, 200, 100, 0]);
    const [identity, , , motivation, kibou] = tables(sheet);
    expect(identity!.rows[0]![0]!.lines[1]!.afterTwips).toBe(80);
    expect(identity!.rows[0]![1]!.lines.map((line) => line.afterTwips)).toEqual([20, 40]);
    expect(identity!.rows[0]![2]!.lines[0]!.afterTwips).toBe(0);
    expect(motivation!.rows[1]![0]!.lines[0]!.afterTwips).toBe(100);
    expect(kibou!.rows[1]![0]!.lines[0]!.afterTwips).toBe(100);
  });

  it("carries paragraph before-spacing from the filled file into table cells, and none onto lines the file does not space", () => {
    const blocks = sheet.blocks;
    expect(blocks.filter((block) => block.kind === "line").every((block) => block.line.beforeTwips === 0)).toBe(true);
    const [identity, , , motivation, kibou] = tables(sheet);
    expect(identity!.rows[0]![1]!.lines.map((line) => line.beforeTwips)).toEqual([40, 0]);
    expect(identity!.rows[0]![2]!.lines[0]!.beforeTwips).toBe(400);
    expect(motivation!.rows[1]![0]!.lines[0]!.beforeTwips).toBe(100);
    expect(kibou!.rows[1]![0]!.lines[0]!.beforeTwips).toBe(100);
  });

  it("keeps the prose cells' text as written, markup characters included", () => {
    const [, , , motivation, kibou] = tables(sheet);
    expect(motivation!.rows.map(texts)).toEqual([["志望動機・特技・アピールポイントなど"], ["架空の志望動機 & <その理由>。"]]);
    expect(kibou!.rows.map(texts)).toEqual([["本人希望欄"], ["貴社規定に従います。"]]);
  });
});

describe("reading a sheet", () => {
  const body = (inner: string) =>
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${inner}</w:body></w:document>`;
  const cell = (text: string, properties = "") =>
    `<w:tc><w:tcPr>${properties}</w:tcPr><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;

  it("folds a merge that runs several rows, in the grid column after a spanned cell", () => {
    const sheet = sheetOf(body(
      `<w:tbl><w:tblGrid><w:gridCol w:w="1"/><w:gridCol w:w="1"/><w:gridCol w:w="2"/></w:tblGrid>` +
        `<w:tr>${cell("a", '<w:gridSpan w:val="2"/>')}${cell("m", '<w:vMerge w:val="restart"/>')}</w:tr>` +
        `<w:tr>${cell("b")}${cell("c")}${cell("", "<w:vMerge/>")}</w:tr>` +
        `<w:tr>${cell("d", '<w:gridSpan w:val="2"/>')}${cell("", "<w:vMerge/>")}</w:tr>` +
        `<w:tr>${cell("e", '<w:gridSpan w:val="3"/>')}</w:tr></w:tbl>`,
    ));
    const [table] = tables(sheet);
    expect(table!.columns).toEqual([0.25, 0.25, 0.5]);
    expect(table!.rows.map(texts)).toEqual([["a", "m"], ["b", "c"], ["d"], ["e"]]);
    expect(table!.rows[0]![1]!.rowSpan).toBe(3);
  });

  it("reads a paragraph's spacing above and below it, and not a run's", () => {
    const sheet = sheetOf(body(
      `<w:p><w:pPr><w:spacing w:before="100" w:after="40"/></w:pPr><w:r><w:rPr><w:spacing w:val="20"/></w:rPr><w:t>一</w:t></w:r></w:p>` +
        `<w:p><w:pPr><w:spacing w:before="400"/></w:pPr><w:r><w:t>二</w:t></w:r></w:p>`,
    ));
    expect(sheet.blocks.map((block) => block.kind === "line" && [block.line.beforeTwips, block.line.afterTwips])).toEqual([[100, 40], [400, 0]]);
  });

  it("reads breaks and tabs inside a paragraph, and not its tab stops or a tracked deletion", () => {
    const sheet = sheetOf(body(
      `<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs><w:jc w:val="right"/></w:pPr>` +
        `<w:r><w:t>一</w:t><w:br/><w:t>二</w:t><w:tab/><w:t>三</w:t></w:r>` +
        `<w:del><w:r><w:delText>消</w:delText></w:r></w:del><w:r><w:br w:type="page"/></w:r></w:p>`,
    ));
    expect(sheet.blocks).toEqual([{ kind: "line", line: { text: "一\n二\t三", align: "end", size: "body", bold: false, beforeTwips: 0, afterTwips: 0 } }]);
  });
});
