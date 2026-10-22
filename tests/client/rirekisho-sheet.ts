/**
 * A 履歴書's sheet as `readSheet` gives it for the template filled with
 * `RIREKISHO_DATA`; `tests/sheet.test.ts` asserts the two are equal. The client
 * suite cannot load the `.docx` template, so it reads this. Every value is invented.
 */
import type { RirekishoTemplateData } from "~/render/rirekisho-template";
import type { Sheet, SheetCell, SheetLine } from "~/render/sheet";

export const RIREKISHO_DATA: RirekishoTemplateData = {
  submitYear: "2026", submitMonth: "10", submitDay: "6",
  nameKana: "かくう　はなこ", nameKanji: "架空　花子",
  birthYear: "1995", birthMonth: "2", birthDay: "3", age: "31", gender: "女",
  phone: "000-0000-0000", email: "hanako@example.invalid",
  addressKana: "かくうけんかくうし", postalCode: "000-0000", address: "架空県架空市0-0-0",
  contactPostalCode: "", contactLine: "同上",
  gakureki: [{ year: "2017", month: "3", text: "架空大学　架空学部　卒業" }],
  shokureki: [{ year: "2020", month: "4", text: "架空商事　入社" }],
  shikaku: [{ year: "2018", month: "6", text: "架空資格　取得" }],
  motivation: "架空の志望動機です。", kibou: "貴社規定に従います。",
};

const line = (text: string, over: Partial<SheetLine> = {}): SheetLine => ({ text, align: "start", size: "body", bold: false, beforeTwips: 0, afterTwips: 0, ...over });
const cell = (lines: SheetLine[], colSpan = 1, rowSpan = 1, shaded = false): SheetCell => ({ lines, colSpan, rowSpan, shaded });
const shaded = (lines: SheetLine[], colSpan = 1, rowSpan = 1) => cell(lines, colSpan, rowSpan, true);
const heading = (text: string) => line(text, { align: "center", bold: true });
const row = (year: string, month: string, text: string) => [
  cell([line(year, { align: "center" })]),
  cell([line(month, { align: "center" })]),
  cell([line(text)]),
];
const spacer = (afterTwips: number) => ({ kind: "line" as const, line: line("", { afterTwips }) });

export const RIREKISHO_SHEET: Sheet = {
  blocks: [
    { kind: "line", line: line("履 歴 書", { align: "center", size: "title", bold: true, afterTwips: 200 }) },
    { kind: "line", line: line("2026年 10月 6日 ", { align: "end", afterTwips: 200 }) },
    {
      kind: "table",
      columns: [2000 / 9360, 5360 / 9360, 2000 / 9360],
      rows: [
        [
          cell([line("ふりがな", { align: "center", size: "small" }), line("名前", { align: "center", afterTwips: 80 })]),
          cell([line("かくう　はなこ", { beforeTwips: 40, afterTwips: 20 }), line("架空　花子", { size: "large", bold: true, afterTwips: 40 })]),
          shaded([line("", { align: "center", beforeTwips: 400 })], 1, 3),
        ],
        [cell([line("1995年 2月 3日生（満 31 歳） 女")], 2)],
        [cell([line("電話 000-0000-0000"), line("Email hanako@example.invalid")], 2)],
        [cell([line("ふりがな", { size: "small" }), line("現住所")]), cell([line("かくうけんかくうし", { size: "small" }), line("〒000-0000"), line("架空県架空市0-0-0")], 2)],
        [cell([line("ふりがな", { size: "small" }), line("連絡先")]), cell([line("〒"), line("同上")], 2)],
      ],
    },
    spacer(200),
    {
      kind: "table",
      columns: [1200 / 9360, 1200 / 9360, 6960 / 9360],
      rows: [
        [shaded([heading("年")]), shaded([heading("月")]), shaded([heading("学歴・職歴")])],
        [shaded([heading("学歴")], 3)],
        row("2017", "3", "架空大学　架空学部　卒業"),
        [shaded([heading("職歴")], 3)],
        row("2020", "4", "架空商事　入社"),
        [cell([line("以上", { align: "center" })], 3)],
      ],
    },
    spacer(200),
    {
      kind: "table",
      columns: [1200 / 9360, 1200 / 9360, 6960 / 9360],
      rows: [[shaded([heading("年")]), shaded([heading("月")]), shaded([heading("免許・資格")])], row("2018", "6", "架空資格　取得")],
    },
    spacer(200),
    { kind: "table", columns: [1], rows: [[shaded([line("志望動機・特技・アピールポイントなど", { bold: true })])], [cell([line("架空の志望動機です。", { beforeTwips: 100, afterTwips: 100 })])]] },
    spacer(100),
    { kind: "table", columns: [1], rows: [[shaded([line("本人希望欄")])], [cell([line("貴社規定に従います。", { beforeTwips: 100, afterTwips: 100 })])]] },
    spacer(0),
  ],
};
