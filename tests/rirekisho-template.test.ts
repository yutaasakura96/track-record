/**
 * The 履歴書 template, loaded the way the Worker loads it.
 *
 * The template is a binary module: `[[rules]] type = "Data"` in
 * `wrangler.toml` for the deployed Worker, `modulesRules` in
 * `vitest.config.ts` for the suite. Both hand `src/render/rirekisho-template`
 * an `ArrayBuffer`, and this file is what proves the runtime — workerd, not
 * Node — actually receives one and can fill it.
 *
 * `docs/04-database-schema.md` §4 is the field contract; the template is the
 * authority on layout. Every value below is invented. None of it comes from
 * the author's record, and none of it is a template placeholder's default.
 */
import { describe, expect, it } from "vitest";
import PizZip from "pizzip";
import {
  RIREKISHO_TEMPLATE_BYTES,
  fillRirekishoTemplate,
  type RirekishoTemplateData,
} from "~/render/rirekisho-template";

const ZIP_LOCAL_HEADER = [0x50, 0x4b, 0x03, 0x04];

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
  // Two lines: the second is the building name `linebreaks: true` exists for.
  address: "架空県架空市架空町1-2-3\n架空マンション404号室",
  contactPostalCode: "",
  contactLine: "同上",
  gakureki: [
    { year: "2085", month: "3", text: "架空高等学校 卒業" },
    { year: "2085", month: "4", text: "架空大学 架空学部 入学" },
    { year: "2089", month: "3", text: "架空大学 架空学部 卒業" },
  ],
  shokureki: [
    { year: "2089", month: "4", text: "架空株式会社 入社" },
    { year: "2095", month: "3", text: "一身上の都合により架空株式会社を退社" },
  ],
  shikaku: [
    { year: "2090", month: "6", text: "架空技術者試験 合格 取得" },
    { year: "2092", month: "9", text: "架空講習課程 修了" },
  ],
  motivation: "架空の志望動機。",
  kibou: "架空の本人希望欄。",
};

function documentXml(zipped: Uint8Array | ArrayBuffer): string {
  return new PizZip(zipped).file("word/document.xml")!.asText();
}

/**
 * The compression method of every entry, read from the central directory
 * rather than from the library that wrote it. 8 is DEFLATE, 0 is STORE.
 */
function compressionMethods(zipped: Uint8Array): { method: number; size: number }[] {
  const view = new DataView(zipped.buffer, zipped.byteOffset, zipped.byteLength);
  let eocd = zipped.length - 22;
  while (eocd >= 0 && view.getUint32(eocd, true) !== 0x06054b50) eocd -= 1;
  expect(eocd).toBeGreaterThanOrEqual(0);

  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const entries: { method: number; size: number }[] = [];
  for (let i = 0; i < count; i += 1) {
    expect(view.getUint32(p, true)).toBe(0x02014b50);
    entries.push({ method: view.getUint16(p + 10, true), size: view.getUint32(p + 24, true) });
    p += 46 + view.getUint16(p + 28, true) + view.getUint16(p + 30, true) + view.getUint16(p + 32, true);
  }
  return entries;
}

describe("the 履歴書 template", () => {
  it("reaches the runtime as a binary module", () => {
    expect(RIREKISHO_TEMPLATE_BYTES).toBeInstanceOf(ArrayBuffer);
    const head = new Uint8Array(RIREKISHO_TEMPLATE_BYTES).subarray(0, 4);
    expect([...head]).toEqual(ZIP_LOCAL_HEADER);
  });

  it("carries every placeholder the fill function supplies, and no other", () => {
    const xml = documentXml(RIREKISHO_TEMPLATE_BYTES);
    const tags = new Set([...xml.matchAll(/\{[#/]?([A-Za-z]+)\}/g)].map((m) => m[1]!));
    const supplied = new Set([
      ...Object.keys(DATA).filter((k) => !Array.isArray(DATA[k as keyof RirekishoTemplateData])),
      "gakureki",
      "shokureki",
      "shikaku",
      // The three loop rows share one 年 / 月 / 内容 shape.
      "year",
      "month",
      "text",
    ]);
    expect([...tags].sort()).toEqual([...supplied].sort());
  });

  it("fills, expands its three loops, and leaves no placeholder behind", () => {
    const filled = fillRirekishoTemplate(DATA);
    expect([...filled.subarray(0, 4)]).toEqual(ZIP_LOCAL_HEADER);

    const xml = documentXml(filled);
    expect(xml).not.toMatch(/\{[#/]?[A-Za-z]+\}/);

    for (const row of [...DATA.gakureki, ...DATA.shokureki, ...DATA.shikaku]) {
      expect(xml).toContain(row.text);
    }
    expect(xml).toContain(DATA.nameKanji);
    expect(xml).toContain(DATA.contactLine);
    expect(xml).toContain(DATA.motivation);
  });

  it("keeps the form furniture the author's own document carries", () => {
    const xml = documentXml(fillRirekishoTemplate(DATA));
    for (const label of ["名前", "ふりがな", "学歴", "職歴", "以上", "免許"]) {
      expect(xml).toContain(label);
    }
  });

  it("turns the address's second line into a line break, not a second cell", () => {
    const xml = documentXml(fillRirekishoTemplate(DATA));
    expect(xml.match(/<w:br\/>/g) ?? []).toHaveLength(1);
    expect(xml).toContain("架空マンション404号室");
  });

  it("deflates every entry it writes", () => {
    const entries = compressionMethods(fillRirekishoTemplate(DATA));
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      if (entry.size === 0) continue;
      expect(entry.method).toBe(8);
    }
  });
});
