/**
 * The 履歴書 and the 職務経歴書 as files, through the API (issue #117): a PDF by
 * default and a Word file beside it, named in Japanese with an ASCII name for
 * a client that cannot read one, and text a reader can select and copy in
 * reading order. Every entry is INVENTED.
 */
import { beforeEach, describe, expect, it } from "vitest";
import PizZip from "pizzip";
import { extractText, getMeta } from "unpdf";
import { harness, settle, stubModel, type Client, type SeededUser, type StubModel } from "./helpers/harness";
import { EMPLOYER_FIXTURE, PROFILE_FIXTURE, ROLE_FIXTURE, seedAllowedUser, uploadForm } from "./helpers/seed";
import type { CandidateFact } from "~/model/types";
import { tokyoToday } from "~/render/rirekisho";
import type { RenderContent } from "~/shared/render-content";

const USABLE: CandidateFact = {
  claim: "Cut the nightly settlement run from 6 hours to 90 minutes",
  quote: "The nightly settlement run fell from 6 hours to 90 minutes.",
  technologies: ["Airflow"],
  provenance: "measured",
};

let model: StubModel;
let client: Client;
let user: SeededUser;

beforeEach(async () => {
  model = stubModel();
  user = await seedAllowedUser();
  client = harness(model).as(user);
});

async function seedRecord() {
  await client.put("/api/profile", PROFILE_FIXTURE);
  const employer = (await (await client.post("/api/employers", { ...EMPLOYER_FIXTURE, employmentType: "dispatch" })).json()) as { id: string };
  await client.post("/api/roles", { ...ROLE_FIXTURE, employerId: employer.id });
  await client.post("/api/roles", { ...ROLE_FIXTURE, titleJa: "テックリード", startedOn: "2023-10-01", endedOn: "2024-09-01", employerId: employer.id });
  model.extractions = [[USABLE]];
  await client.request("/api/imports", { method: "POST", body: uploadForm(`# Notes\n\n${USABLE.quote}\n`) });
  await settle();
  const { items } = await client.json<{ items: { id: string }[] }>("/api/facts");
  await client.patch(`/api/facts/${items[0]!.id}`, { employerId: employer.id });
  return { factId: items[0]!.id };
}

async function accepted(ref: string, content: RenderContent) {
  model.generations = [content];
  const { proposalId } = (await (await client.post(`/api/renders/${ref}/generate`)).json()) as { proposalId: string };
  await settle();
  const response = await client.post(`/api/proposals/${proposalId}/accept`);
  expect(response.status).toBe(200);
}

/** A 職務経歴書 whose 職務経歴 group opens on the employer's name alone, as the register now asks. */
const shokumu = (factId: string, opener = "株式会社アオゾラ物流"): RenderContent => ({
  sections: [
    { key: "summary", heading: "経歴要約", blocks: [{ id: "blk_1", kind: "paragraph", text: "物流システムのバックエンド開発に携わってきました。", factIds: [factId] }] },
    {
      key: "experience",
      heading: "職務経歴",
      blocks: [
        { id: "blk_2", kind: "paragraph", text: opener, factIds: [] },
        { id: "blk_3", kind: "row", text: "事業内容：中堅の国内向け物流事業者。", factIds: [] },
        { id: "blk_4", kind: "row", text: "主な実績：", factIds: [] },
        { id: "blk_5", kind: "bullet", text: "夜間の精算処理を6時間から90分に短縮", factIds: [factId] },
        { id: "blk_6", kind: "row", text: "技術スタック：Airflow", factIds: [factId] },
      ],
    },
    { key: "self_pr", heading: "自己PR", blocks: [{ id: "blk_7", kind: "paragraph", text: "数値で確かめられる改善を続けてきました。", factIds: [factId] }] },
  ],
});

const rirekisho = (factId: string): RenderContent => ({
  sections: [
    { key: "motivation", heading: "志望動機・特技・アピールポイントなど", blocks: [{ id: "blk_1", kind: "paragraph", text: "精算処理の短縮で培った経験を活かしたいと考えています。", factIds: [factId] }] },
    { key: "kibou", heading: "本人希望欄", blocks: [{ id: "blk_2", kind: "paragraph", text: "貴社規定に従います。", factIds: [] }] },
  ],
});

/** The PDF's text as a reader copies it, white space dropped: Japanese has none to keep. */
async function pdfText(bytes: ArrayBuffer) {
  const { text } = await extractText(new Uint8Array(bytes), { mergePages: true });
  return text.replace(/\s+/g, "");
}

const today = () => tokyoToday().replace(/-/g, "");
const encoded = (name: string) => encodeURIComponent(name);

describe("the 職務経歴書's PDF", () => {
  it("is the default download: a PDF named in Japanese, with an ASCII name beside it and its properties set", async () => {
    const { factId } = await seedRecord();
    await accepted("shokumu_keirekisho", shokumu(factId));

    const response = await client.get("/api/renders/shokumu_keirekisho/download?format=pdf");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="shokumu-keirekisho_Yosuke-Aoki_${today()}.pdf"; ` +
        `filename*=UTF-8''${encoded(`職務経歴書_青木陽介_${today()}.pdf`)}`,
    );
    const bytes = await response.arrayBuffer();
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const { info } = await getMeta(new Uint8Array(bytes));
    expect(info.Title).toBe("職務経歴書　青木 陽介");
    expect(info.Author).toBe("青木 陽介");
  });

  it("holds the document's text, selectable and in reading order, with each employer's header from the record", async () => {
    const { factId } = await seedRecord();
    await accepted("shokumu_keirekisho", shokumu(factId));
    const text = await pdfText(await (await client.get("/api/renders/shokumu_keirekisho/download?format=pdf")).arrayBuffer());

    const [year, month, day] = tokyoToday().split("-").map(Number);
    const order = [
      "職務経歴書",
      `${year}年${month}月${day}日現在`,
      "青木陽介",
      "経歴要約",
      "職務経歴",
      // 会社名, then its 雇用形態, then the period set at the right margin.
      "株式会社アオゾラ物流派遣社員2022年4月～2024年9月",
      "バックエンドエンジニア（2022年4月～2023年9月）、テックリード（2023年10月～2024年9月）",
      "事業内容：中堅の国内向け物流事業者。",
      "夜間の精算処理を6時間から90分に短縮",
      "技術スタック：Airflow",
      "自己PR",
    ];
    let at = -1;
    for (const part of order) {
      const found = text.indexOf(part, at + 1);
      expect(found, part).toBeGreaterThan(at);
      at = found;
    }
  });

  it("prints a version written before the change, whose opener carries its own period, under the record's header", async () => {
    const { factId } = await seedRecord();
    await accepted("shokumu_keirekisho", shokumu(factId, "株式会社アオゾラ物流（2022年4月〜2024年9月）　システムエンジニア"));
    const text = await pdfText(await (await client.get("/api/renders/shokumu_keirekisho/download?format=pdf")).arrayBuffer());
    expect(text).toContain("株式会社アオゾラ物流派遣社員2022年4月～2024年9月");
    expect(text).not.toContain("システムエンジニア");
  });

  it("refuses a character its face cannot draw, naming it and where it is, and leaves the Word file", async () => {
    const { factId } = await seedRecord();
    const content = shokumu(factId);
    content.sections[0]!.blocks[0]!.text = "物流システムの開発に携わってきました🚚";
    await accepted("shokumu_keirekisho", content);

    const refused = await client.get("/api/renders/shokumu_keirekisho/download?format=pdf");
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: { message: string } }).error.message).toBe(
      "The PDF cannot show “🚚” (U+1F69A) in the 経歴要約 section. Remove it, or download the Word file instead.",
    );
    expect((await client.get("/api/renders/shokumu_keirekisho/download?format=docx")).status).toBe(200);
  });
});

describe("the 職務経歴書's Word file", () => {
  it("names one Japanese face for every script, marks the text ja-JP, and names Times New Roman nowhere", async () => {
    const { factId } = await seedRecord();
    await accepted("shokumu_keirekisho", shokumu(factId));
    const response = await client.get("/api/renders/shokumu_keirekisho/download?format=docx");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain(`filename*=UTF-8''${encoded(`職務経歴書_青木陽介_${today()}.docx`)}`);

    const zip = new PizZip(await response.arrayBuffer());
    const parts = Object.keys(zip.files).filter((name) => name.endsWith(".xml"));
    for (const part of parts) expect(zip.file(part)!.asText(), part).not.toContain("Times New Roman");

    const styles = zip.file("word/styles.xml")!.asText();
    const defaults = /<w:rPrDefault>[\s\S]*?<\/w:rPrDefault>/.exec(styles)![0];
    expect(defaults).toMatch(/<w:rFonts (?=[^>]*w:ascii="BIZ UDPGothic")(?=[^>]*w:hAnsi="BIZ UDPGothic")(?=[^>]*w:eastAsia="BIZ UDPGothic")[^>]*\/>/);
    expect(defaults).toMatch(/<w:lang (?=[^>]*w:val="ja-JP")(?=[^>]*w:eastAsia="ja-JP")[^>]*\/>/);
    // A Word without the face substitutes a Japanese gothic by this entry.
    expect(zip.file("word/fontTable.xml")!.asText()).toMatch(/<w:font w:name="BIZ UDPGothic"><w:altName w:val="BIZ UDPゴシック"\/>[\s\S]*<w:charset w:val="80"\/>/);

    const document = zip.file("word/document.xml")!.asText();
    // Headings: black, bold, ruled. Nothing uses the library's blue built-in heading.
    expect(document).not.toMatch(/w:pStyle w:val="(Heading|Title)/);
    expect(document).toMatch(/<w:pBdr><w:bottom [^>]*w:val="single"[^>]*w:color="000000"/);
    // The employer's header: the name in bold, then a tab to the period at the right margin.
    expect(document).toMatch(/<w:tab w:val="right" w:pos="9638"\/>/);
    expect(document).toMatch(/<w:b\/>[\s\S]*?<w:t[^>]*>株式会社アオゾラ物流<\/w:t>[\s\S]*?<w:t[^>]*>　派遣社員<\/w:t>[\s\S]*?<w:tab\/><w:t[^>]*>2022年4月～2024年9月<\/w:t>/);
  });

  it("reads the same in Markdown", async () => {
    const { factId } = await seedRecord();
    await accepted("shokumu_keirekisho", shokumu(factId));
    const markdown = await (await client.get("/api/renders/shokumu_keirekisho/download?format=md")).text();
    expect(markdown).toContain("### 株式会社アオゾラ物流（派遣社員）　2022年4月～2024年9月");
    expect(markdown).toMatch(/\d{4}年\d{1,2}月\d{1,2}日現在/);
  });
});

describe("the 履歴書's PDF", () => {
  it("is a PDF of the filled form, named in Japanese, its text selectable in reading order", async () => {
    const { factId } = await seedRecord();
    await accepted("rirekisho", rirekisho(factId));

    const response = await client.get("/api/renders/rirekisho/download?format=pdf");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="rirekisho_Yosuke-Aoki_${today()}.pdf"; filename*=UTF-8''${encoded(`履歴書_青木陽介_${today()}.pdf`)}`,
    );
    const bytes = await response.arrayBuffer();
    // A copy: the reader takes the buffer it is handed.
    const { info } = await getMeta(new Uint8Array(bytes.slice(0)));
    expect(info.Title).toBe("履歴書　青木 陽介");

    const text = await pdfText(bytes);
    const order = [
      "履歴書",
      "あおきようすけ",
      "青木陽介",
      "学歴・職歴",
      "職歴",
      "株式会社アオゾラ物流運輸業システムエンジニアとして入社",
      "免許・資格",
      "志望動機・特技・アピールポイントなど",
      "精算処理の短縮で培った経験を活かしたいと考えています。",
      "本人希望欄",
      "貴社規定に従います。",
    ];
    let at = -1;
    for (const part of order) {
      const found = text.indexOf(part, at + 1);
      expect(found, part).toBeGreaterThan(at);
      at = found;
    }
  });

  it("downloads its Word file beside it, under the same Japanese name", async () => {
    const { factId } = await seedRecord();
    await accepted("rirekisho", rirekisho(factId));
    const response = await client.get("/api/renders/rirekisho/download?format=docx");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="rirekisho_Yosuke-Aoki_${today()}.docx"; filename*=UTF-8''${encoded(`履歴書_青木陽介_${today()}.docx`)}`,
    );
  });
});
