/**
 * The 履歴書's two fixed pages (`src/render/rirekisho-layout.ts`, issue #117).
 *
 * What Word does with the file is checked in Word (`docs/11` §3 items 1 and
 * 2). What is asserted here is what the file tells Word: no row may split, the
 * 年 / 月 headers repeat, every line has an exact height, and the filled
 * document is padded so 学歴・職歴 always runs onto page 2 with 志望動機
 * after it there. Every value is invented.
 */
import { describe, expect, it } from "vitest";
import PizZip from "pizzip";
import {
  CONTINUED_ROWS,
  blankRowOf,
  defaultHalfPoints,
  lineCount,
  paginateXml,
  prepareTemplateXml,
} from "~/render/rirekisho-layout";
import {
  RIREKISHO_TEMPLATE_BYTES,
  fillRirekishoTemplate,
  type RirekishoRow,
  type RirekishoTemplateData,
} from "~/render/rirekisho-template";
import { pngPhoto } from "./helpers/photo";

const template = new PizZip(RIREKISHO_TEMPLATE_BYTES);
const BODY = defaultHalfPoints(template.file("word/styles.xml")!.asText());
const PREPARED = prepareTemplateXml(template.file("word/document.xml")!.asText(), BODY);

const entry = (n: number): RirekishoRow[] => [
  { year: String(2000 + n), month: "4", text: `架空株式会社第${n}事業所　情報通信業（受託開発）　システムエンジニアとして入社` },
  { year: String(2001 + n), month: "3", text: `一身上の都合により架空株式会社第${n}事業所を退社` },
];

const data = (employers: number): RirekishoTemplateData => ({
  submitYear: "2099", submitMonth: "4", submitDay: "1",
  nameKana: "かくう　はなこ", nameKanji: "架空　花子",
  birthYear: "1970", birthMonth: "1", birthDay: "2", age: "129", gender: "",
  phone: "000-0000-0000", email: "kakuu@example.invalid",
  addressKana: "かくうけん かくうし", postalCode: "000-0000", address: "架空県架空市架空町1-2-3\n架空マンション404号室",
  contactPostalCode: "", contactLine: "同上",
  gakureki: [
    { year: "1985", month: "4", text: "架空高等学校　普通科　入学" },
    { year: "1988", month: "3", text: "架空高等学校　普通科　卒業" },
    { year: "1988", month: "4", text: "架空大学　架空学部　入学" },
    { year: "1992", month: "3", text: "架空大学　架空学部　卒業" },
  ],
  shokureki: Array.from({ length: employers }, (_, n) => entry(n)).flat(),
  shikaku: [
    { year: "1990", month: "6", text: "架空技術者試験　合格" },
    { year: "1993", month: "9", text: "Kakuu Certified Cloud Architect – Professional　取得" },
  ],
  motivation: "架空の志望動機です。".repeat(8),
  kibou: "貴社規定に従います。",
});

const documentXml = (bytes: Uint8Array) => new PizZip(bytes).file("word/document.xml")!.asText();
const tablesOf = (xml: string) => [...xml.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>/g)].map((m) => m[0]);
const rowsOf = (xml: string) => [...xml.matchAll(/<w:tr(?:\s[^>]*)?>[\s\S]*?<\/w:tr>/g)].map((m) => m[0]);
const textOf = (xml: string) => [...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("");

describe("the 履歴書 template, prepared for two pages", () => {
  it("lets no row split across a page", () => {
    const rows = rowsOf(PREPARED);
    expect(rows.length).toBeGreaterThan(10);
    for (const row of rows) expect(row).toMatch(/^<w:tr\b[^>]*><w:trPr><w:cantSplit\/>/);
  });

  it("repeats exactly the two 年 / 月 header rows when their table continues", () => {
    const headers = rowsOf(PREPARED).filter((row) => row.includes("<w:tblHeader/>")).map(textOf);
    expect(headers).toEqual(["年月学歴・職歴", "年月免許・資格"]);
    for (const row of rowsOf(PREPARED).filter((r) => r.includes("<w:tblHeader/>"))) {
      expect(row).toContain("<w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>");
    }
  });

  it("gives every paragraph an exact line height, so Word's font cannot move the break", () => {
    const paragraphs = [...PREPARED.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>|<w:p(?:\s[^>]*)?\/>/g)].map((m) => m[0]);
    expect(paragraphs.length).toBeGreaterThan(40);
    for (const paragraph of paragraphs) expect(paragraph).toMatch(/<w:spacing\b[^>]*w:lineRule="exact"/);
    // The 10pt rows sit 13pt apart, as Word sets MS Mincho at single spacing.
    const row = rowsOf(PREPARED).find((r) => r.includes("{#shokureki}"))!;
    expect(row).toContain('w:line="260" w:lineRule="exact"');
  });

  it("keeps the template's spacing before and after each paragraph", () => {
    expect(PREPARED).toContain('<w:spacing w:after="200" w:line="624" w:lineRule="exact"/>');
    expect(PREPARED).toContain('<w:spacing w:before="40" w:after="20" w:line="260" w:lineRule="exact"/>');
  });

  it("makes a blank row of the 学歴 loop row, with no placeholder left in it", () => {
    const blank = blankRowOf(PREPARED);
    expect(textOf(blank)).toBe("");
    expect(blank.match(/<w:tc>/g)).toHaveLength(3);
    expect(blank).toContain("<w:cantSplit/>");
  });
});

describe("a filled 履歴書, paginated", () => {
  const BLANK = blankRowOf(PREPARED);

  for (const employers of [1, 4, 8]) {
    it(`runs 学歴・職歴 onto page 2 and puts 志望動機 there, with ${employers} employer(s)`, () => {
      const xml = documentXml(fillRirekishoTemplate(data(employers)));
      // Laid out again, the filled file needs nothing more: it already continues
      // onto page 2 by enough rows, and the 志望動機 cell is on page 2.
      const again = paginateXml(xml, BLANK, BODY).layout;
      expect(again).toEqual({ blankRows: 0, motivationPage: 2, pages: 2 });
    });
  }

  it("pads a short record with blank rows after 以上, and a long one with none", () => {
    const blanks = (employers: number) => {
      const history = tablesOf(documentXml(fillRirekishoTemplate(data(employers))))[1]!;
      const rows = rowsOf(history);
      const end = rows.findIndex((row) => textOf(row) === "以上");
      expect(rows.slice(end + 1).every((row) => textOf(row) === "")).toBe(true);
      return rows.length - end - 1;
    };
    expect(blanks(1)).toBeGreaterThan(CONTINUED_ROWS);
    expect(blanks(1)).toBeGreaterThan(blanks(4));
    expect(blanks(8)).toBe(0);
  });

  it("grows the 志望動機 cell into what page 2 has left", () => {
    const motivation = tablesOf(documentXml(fillRirekishoTemplate(data(1))))[3]!;
    expect(rowsOf(motivation)[1]).toMatch(/<w:trPr><w:cantSplit\/><w:trHeight w:val="\d{4,}" w:hRule="atLeast"\/><\/w:trPr>/);
  });

  it("adds no blank row to a record that already runs past page 2", () => {
    const { layout } = paginateXml(documentXml(fillRirekishoTemplate(data(30))), BLANK, BODY);
    expect(layout.blankRows).toBe(0);
    expect(layout.pages).toBeGreaterThan(2);
  });
});

describe("how many lines a cell's text takes, in MS Mincho", () => {
  // A 学歴・職歴 cell: 6,760 twips of text at 10pt, so 33.8 full-width characters.
  const WIDTH = 6760;
  const EM = 200;

  it("wraps Japanese at any character", () => {
    expect(lineCount("あ".repeat(33), WIDTH, EM)).toBe(1);
    expect(lineCount("あ".repeat(34), WIDTH, EM)).toBe(2);
    expect(lineCount("あ".repeat(68), WIDTH, EM)).toBe(3);
  });

  it("counts ASCII at half an em and moves a whole word to the next line", () => {
    expect(lineCount("a".repeat(67), WIDTH, EM)).toBe(1);
    expect(lineCount(`${"a".repeat(60)} kubernetes`, WIDTH, EM)).toBe(2);
  });

  it("adds Word's quarter em between Japanese and Latin", () => {
    // Alternating, 18 pairs are 27 em of characters and 8.75 em of gaps.
    expect(lineCount("あa".repeat(16), WIDTH, EM)).toBe(1);
    expect(lineCount("あa".repeat(18), WIDTH, EM)).toBe(2);
  });

  it("keeps a closing mark with the character before it", () => {
    expect(lineCount(`${"あ".repeat(33)}。`, WIDTH, EM)).toBe(2);
  });

  it("counts a line break as a line", () => {
    expect(lineCount("一行目\n二行目", WIDTH, EM)).toBe(2);
    expect(lineCount("", WIDTH, EM)).toBe(1);
  });
});

describe("a filled 履歴書 with its 写真 (issue #117)", () => {
  const BLANK = blankRowOf(PREPARED);
  const PHOTO = { bytes: pngPhoto(300, 400), type: "image/png" as const };
  const blanks = (bytes: Uint8Array) => {
    const rows = rowsOf(tablesOf(documentXml(bytes))[1]!);
    return rows.length - rows.findIndex((row) => textOf(row) === "以上") - 1;
  };

  for (const employers of [1, 8]) {
    it(`still runs 学歴・職歴 onto page 2 with 志望動機 there, with ${employers} employer(s)`, () => {
      const xml = documentXml(fillRirekishoTemplate(data(employers), PHOTO));
      expect(paginateXml(xml, BLANK, BODY).layout).toEqual({ blankRows: 0, motivationPage: 2, pages: 2 });
    });
  }

  it("counts the photo's 40 mm, so page 1 holds fewer rows of 学歴・職歴 than without it", () => {
    const without = blanks(fillRirekishoTemplate(data(1)));
    const withPhoto = blanks(fillRirekishoTemplate(data(1), PHOTO));
    // The cell is about 8 mm taller than the three rows it spans: one or two rows of 学歴・職歴.
    expect(without - withPhoto).toBeGreaterThanOrEqual(1);
    expect(without - withPhoto).toBeLessThanOrEqual(2);
  });
});
