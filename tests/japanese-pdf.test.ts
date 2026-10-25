/**
 * The Japanese PDFs as files (issue #117): the faces cut to what a page draws,
 * Japanese line breaking, and the 履歴書 drawn from its filled `.docx`. Run
 * inside workerd, the runtime the download is served from. Every entry is
 * INVENTED.
 */
import { describe, expect, it } from "vitest";
import fontkit from "@pdf-lib/fontkit";
import PizZip from "pizzip";
import { PDFDocument, PDFName, PDFRawStream, rgb } from "pdf-lib";
import { extractText, extractTextItems, getDocumentProxy } from "unpdf";
import gothic from "../templates/fonts/BIZUDPGothic-Regular.ttf";
import { subsetFont } from "~/render/font-subset";
import { breakLines, embedFace, type PdfRun } from "~/render/pdf-text";
import { japanesePdf } from "~/render/japanese-pdf";
import { assembleJapanese, type JapaneseEmployer } from "~/render/japanese";
import { rirekishoPdf } from "~/render/rirekisho-pdf";
import { fillRirekishoTemplate, type RirekishoTemplateData } from "~/render/rirekisho-template";
import type { RenderContent } from "~/shared/render-content";

const METADATA = { title: "職務経歴書　架空 太郎", author: "架空 太郎" };
const IDENTITY = {
  nameLatin: "Taro Kakuu",
  nameKanji: "架空 太郎",
  email: "taro@example.invalid",
  resume: { headline: null, city: null, country: null, phone: null, linkedinUrl: null, githubUrl: null, portfolioUrl: null },
};
const EMPLOYERS: JapaneseEmployer[] = [
  {
    id: "emp_1",
    nameJa: "架空ペイ株式会社",
    nameLatin: "Kakuu Pay K.K.",
    employmentType: "contract",
    startedOn: "2019-01-01",
    endedOn: null,
    roles: [{ title: "バックエンドエンジニア", startedOn: "2019-01-01", endedOn: null }],
  },
];

const BULLET = "月次締めを5営業日から2営業日に短縮し、Spring Batchのジョブを並列化して締め処理の待ち時間を解消";

function shokumu(employerGroups: number): RenderContent {
  return {
    sections: [
      { key: "summary", heading: "経歴要約", blocks: [{ id: "b0", kind: "paragraph", text: "決済基盤の開発に携わってきました。", factIds: [] }] },
      {
        key: "experience",
        heading: "職務経歴",
        blocks: Array.from({ length: employerGroups }, (_, group) => [
          { id: `p${group}`, kind: "paragraph" as const, text: "架空ペイ株式会社", factIds: [] },
          { id: `r${group}`, kind: "row" as const, text: "主な実績：", factIds: [] },
          ...Array.from({ length: 6 }, (_, n) => ({ id: `b${group}.${n}`, kind: "bullet" as const, text: `${group + 1}-${n + 1}　${BULLET}`, factIds: [] })),
        ]).flat(),
      },
    ],
  };
}

const document = (groups: number) =>
  assembleJapanese({ kind: "shokumu_keirekisho", content: shokumu(groups), identity: IDENTITY, today: "2026-10-23", employers: EMPLOYERS });

describe("a face cut to the page", () => {
  it("keeps every glyph id, and the outlines of the characters asked for alone", async () => {
    const whole = fontkit.create(new Uint8Array(gothic));
    const cut = fontkit.create(subsetFont(gothic, "職務A"));
    expect(cut.numGlyphs).toBe(whole.numGlyphs);
    for (const char of "職務A") {
      const code = char.codePointAt(0)!;
      expect(cut.glyphForCodePoint(code).id).toBe(whole.glyphForCodePoint(code).id);
      expect(cut.glyphForCodePoint(code).path.toSVG()).not.toBe("");
    }
    // A character not asked for keeps its id and its width, and loses its outline.
    const other = "歴".codePointAt(0)!;
    expect(cut.glyphForCodePoint(other).advanceWidth).toBe(whole.glyphForCodePoint(other).advanceWidth);
    expect(cut.glyphForCodePoint(other).path.toSVG()).toBe("");
  });

  it("makes a PDF a small fraction of the face, whose text copies back", async () => {
    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit);
    const font = await embedFace(pdf, gothic, "履歴書と職務経歴書");
    pdf.addPage().drawText("履歴書と職務経歴書", { x: 50, y: 700, size: 12, font, color: rgb(0, 0, 0) });
    const bytes = await pdf.save();
    expect(bytes.length).toBeLessThan(gothic.byteLength / 10);
    expect((await extractText(bytes, { mergePages: true })).text).toContain("履歴書と職務経歴書");
  });
});

describe("Japanese line breaking", () => {
  const lines = async (text: string, characters: number) => {
    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit);
    const font = await embedFace(pdf, gothic, text);
    const run: PdfRun = { text, font, size: 10, color: rgb(0, 0, 0) };
    // A width of so many full-width characters.
    return breakLines([run], font.widthOfTextAtSize("あ", 10) * characters + 0.01).map((line) => line.map((r) => r.text).join(""));
  };

  it("breaks between Japanese characters, never before 、 or 」 and never after 「", async () => {
    const broken = await lines("あいうえ、かきくけこ「さしすせ」たち", 5);
    for (const line of broken) {
      expect(line[0]).not.toMatch(/[、」]/);
      expect(line.at(-1)).not.toBe("「");
    }
    expect(broken.join("")).toBe("あいうえ、かきくけこ「さしすせ」たち");
  });

  it("keeps a Latin word whole, and drops the space a line ends on", async () => {
    const broken = await lines("あいう Kubernetes えお", 8);
    expect(broken.some((line) => line.includes("Kubernetes"))).toBe(true);
    for (const line of broken) expect(line).toBe(line.trimEnd());
  });
});

describe("the 職務経歴書's PDF", () => {
  it("runs onto further pages in reading order, inside the 20 mm margins", async () => {
    const bytes = await japanesePdf(document(4), METADATA);
    const { totalPages, items } = await extractTextItems(bytes.slice());
    expect(totalPages).toBeGreaterThan(1);

    const text = (await extractText(bytes.slice(), { mergePages: true })).text.replace(/\s+/g, "");
    const bullets = [...text.matchAll(/(\d)-(\d)月次締め/g)].map((m) => `${m[1]}-${m[2]}`);
    expect(bullets).toEqual(Array.from({ length: 24 }, (_, i) => `${Math.floor(i / 6) + 1}-${(i % 6) + 1}`));

    const margin = 1134 / 20;
    for (const item of items.flat().filter((i) => i.str.trim() !== "")) {
      expect(item.x).toBeGreaterThanOrEqual(margin - 1);
      expect(item.x + item.width).toBeLessThanOrEqual(595.3 - margin + 1);
      expect(item.y).toBeGreaterThanOrEqual(margin - 1);
    }
  });

  it("is tagged, in Japanese", async () => {
    const pdf = await getDocumentProxy((await japanesePdf(document(1), METADATA)).slice());
    const tree = await (await pdf.getPage(1)).getStructTree();
    const roles = JSON.stringify(tree);
    for (const role of ["H1", "H2", "H3", "LI"]) expect(roles).toContain(`"role":"${role}"`);
    expect((await pdf.getMetadata()).info).toMatchObject({ Title: METADATA.title, Language: "ja-JP" });
  });
});

const DATA: RirekishoTemplateData = {
  submitYear: "2026",
  submitMonth: "10",
  submitDay: "23",
  nameKana: "かくう はなこ",
  nameKanji: "架空 花子",
  birthYear: "1990",
  birthMonth: "1",
  birthDay: "2",
  age: "36",
  gender: "",
  phone: "000-0000-0000",
  email: "kakuu@example.invalid",
  addressKana: "かくうけん かくうし",
  postalCode: "000-0000",
  address: "架空県架空市架空町1-2-3\n架空マンション404号室",
  contactPostalCode: "",
  contactLine: "同上",
  gakureki: [
    { year: "2008", month: "3", text: "架空高等学校 普通科 卒業" },
    { year: "2008", month: "4", text: "架空大学 工学部 入学" },
    { year: "2012", month: "3", text: "架空大学 工学部 卒業" },
  ],
  shokureki: [
    { year: "2012", month: "4", text: "架空株式会社 入社" },
    { year: "", month: "", text: "現在に至る" },
  ],
  shikaku: [{ year: "2016", month: "6", text: "架空技術者試験　合格" }],
  motivation: "架空の志望動機。",
  kibou: "貴社規定に従います。",
};

/** A 1 × 1 PNG, the smallest picture a 写真 cell can hold. */
const PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
);

/** The filled form with a picture in its 写真 cell, placed as Word places an inline one. */
function withPicture(docx: Uint8Array): Uint8Array {
  const zip = new PizZip(docx);
  zip.file("word/media/photo.png", PNG);
  const rels = zip.file("word/_rels/document.xml.rels")!.asText();
  zip.file(
    "word/_rels/document.xml.rels",
    rels.replace("</Relationships>", '<Relationship Id="rIdPhoto" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/photo.png"/></Relationships>'),
  );
  const picture =
    '<w:r><w:drawing><wp:inline><wp:extent cx="1080000" cy="1440000"/><a:graphic><a:graphicData><pic:pic>' +
    '<pic:blipFill><a:blip r:embed="rIdPhoto"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
  const xml = zip.file("word/document.xml")!.asText();
  const cell = /<w:tc>(?:(?!<\/w:tc>)[\s\S])*?<w:vMerge w:val="restart"\/>[\s\S]*?<\/w:tc>/.exec(xml)![0];
  zip.file("word/document.xml", xml.replace(cell, cell.replace(/<\/w:p>/, `${picture}</w:p>`)));
  return zip.generate({ type: "uint8array" });
}

describe("the 履歴書's PDF", () => {
  it("is the form on two A4 pages, the text of each cell in reading order", async () => {
    const bytes = await rirekishoPdf(fillRirekishoTemplate(DATA), { title: "履歴書　架空 花子", author: "架空 花子" });
    const pdf = await getDocumentProxy(bytes.slice());
    expect(pdf.numPages).toBe(2);
    const page = await pdf.getPage(1);
    const view = page.view;
    expect([Math.round(view[2]!), Math.round(view[3]!)]).toEqual([595, 842]);

    const text = (await extractText(bytes.slice(), { mergePages: true })).text.replace(/\s+/g, "");
    const order = ["履歴書", "2026年10月23日現在", "かくうはなこ", "架空花子", "1990年1月2日生（満36歳）", "架空県架空市架空町1-2-3",
      "学歴・職歴", "架空高等学校普通科卒業", "架空株式会社入社", "現在に至る", "以上", "免許・資格", "架空技術者試験合格",
      "志望動機・特技・アピールポイントなど", "架空の志望動機。", "本人希望欄", "貴社規定に従います。"];
    let at = -1;
    for (const part of order) {
      const found = text.indexOf(part, at + 1);
      expect(found, part).toBeGreaterThan(at);
      at = found;
    }
  });

  it("opens page 2 on the repeated 年 / 月 header", async () => {
    const bytes = await rirekishoPdf(fillRirekishoTemplate(DATA), { title: "履歴書", author: "" });
    const { items } = await extractTextItems(bytes.slice());
    const second = items[1]!.filter((i) => i.str.trim() !== "").sort((a, b) => b.y - a.y);
    expect(second.slice(0, 3).map((i) => i.str.trim())).toEqual(["年", "月", "学歴・職歴"]);
  });

  it("draws the photo the 写真 cell holds", async () => {
    const without = await rirekishoPdf(fillRirekishoTemplate(DATA), { title: "履歴書", author: "" });
    const withPhoto = await rirekishoPdf(withPicture(fillRirekishoTemplate(DATA)), { title: "履歴書", author: "" });
    const images = async (bytes: Uint8Array) =>
      (await PDFDocument.load(bytes)).context
        .enumerateIndirectObjects()
        .filter(([, object]) => object instanceof PDFRawStream && object.dict.get(PDFName.of("Subtype")) === PDFName.of("Image")).length;
    expect(await images(without)).toBe(0);
    // The picture, and its transparency as a soft mask beside it.
    expect(await images(withPhoto)).toBeGreaterThan(0);
  });
});
