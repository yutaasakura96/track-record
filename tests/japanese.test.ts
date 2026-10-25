/**
 * The check a Japanese document is held to before it is offered for review
 * (issue #117, review issue 5). Pure: the route that runs it is in
 * `tests/renders.test.ts`, "a Japanese document is checked before it is offered".
 *
 * Every fixture here is INVENTED. Nothing is sampled from `local/`.
 */
import { describe, expect, it } from "vitest";
import {
  MAX_SHOKUMU_BULLET_LENGTH,
  isEnglishLine,
  japaneseAdvisories,
  japaneseDefect,
  latinTerms,
} from "~/render/japanese";
import type { RenderSpec } from "~/model/types";
import type { Block, RenderContent } from "~/shared/render-content";

const spec = (over: Partial<RenderSpec> = {}): RenderSpec => ({
  kind: "shokumu_keirekisho",
  language: "ja",
  subjectName: "山田　太郎",
  register: "REGISTER",
  employers: [
    {
      id: "emp_a",
      name: "Hayabusa Computing Co., Ltd.",
      industry: null,
      startedOn: "2020-04-01",
      endedOn: null,
      businessDescription: "架空の受託開発会社。",
      capitalYen: null,
      headcount: null,
      roles: [{ title: "Software Engineer", startedOn: "2020-04-01", endedOn: null }],
      city: null,
    },
  ],
  projects: [{ id: "prj_a", name: "Settlement ledger rebuild", employerId: "emp_a", summary: "Replaced the balance table.", startedOn: null, endedOn: null }],
  workOutsideEmployment: false,
  desiredRoleNote: null,
  educations: [
    {
      id: "edu_a",
      institution: "Shirasagi University of Engineering",
      faculty: null,
      degree: "B.Eng.",
      fieldOfStudy: "Information Engineering",
      startedOn: "2016-04-01",
      endedOn: "2020-03-01",
      outcome: "graduated",
      level: "tertiary",
    },
  ],
  certifications: [
    { id: "cert_a", name: "Kumo Certified Architect – Associate", issuingOrganization: "Kumo Cloud", issuedOn: null, expiresOn: null, kind: "technical", technologies: [] },
  ],
  curatedSkills: [{ name: "Languages", skills: ["TypeScript", "Go"] }],
  jobPosting: null,
  ...over,
} as RenderSpec);

const block = (kind: Block["kind"], text: string, id = "blk"): Block => ({ id, kind, text, factIds: [] });

const doc = (...sections: { key: string; heading: string; blocks: Block[] }[]): RenderContent => ({ sections });

/** A 職務経歴書 written the way the register says: its own headings, Japanese throughout. */
const GOOD = doc(
  { key: "summary", heading: "経歴要約", blocks: [block("paragraph", "受託開発で決済基盤を6年担当してきました。")] },
  {
    key: "skills",
    heading: "活かせるスキル・経験",
    blocks: [block("row", "プログラミング言語"), block("paragraph", "TypeScript、Goによるバックエンド開発")],
  },
  {
    key: "experience",
    heading: "職務経歴",
    blocks: [
      block("paragraph", "Hayabusa Computing Co., Ltd.（2020年4月〜現在）　Software Engineer"),
      block("row", "プロジェクト：Settlement ledger rebuild　決済元帳を作り直したプロジェクト。"),
      block("row", "技術スタック：TypeScript, Go, PostgreSQL"),
      block("bullet", "夜間バッチの処理時間を6時間から90分に短縮"),
    ],
  },
  { key: "certifications", heading: "保有資格", blocks: [block("row", "Kumo Certified Architect – Associate")] },
  { key: "education", heading: "学歴", blocks: [block("row", "Shirasagi University of Engineering B.Eng.（2020年3月卒業）")] },
  { key: "self_pr", heading: "自己PR", blocks: [block("paragraph", "数字で確かめられる改善を続けてきました。")] },
);

const FACTS = [{ technologies: ["PostgreSQL"] }];

/** GOOD, with one block of one section replaced. */
function withBlock(key: string, index: number, replacement: Block): RenderContent {
  return {
    sections: GOOD.sections.map((s) =>
      s.key !== key ? s : { ...s, blocks: s.blocks.map((b, i) => (i === index ? replacement : b)) },
    ),
  };
}

describe("a 職務経歴書 written the way its register says", () => {
  it("has no defect and no advisory, the owner's own headings included", () => {
    expect(japaneseDefect(GOOD, spec(), FACTS)).toBeNull();
    expect(japaneseAdvisories(GOOD, spec())).toEqual([]);
  });
});

describe("御社", () => {
  it("is a defect anywhere, in a heading as in a block, and in every Japanese document", () => {
    expect(japaneseDefect(withBlock("self_pr", 0, block("paragraph", "御社の決済基盤に貢献したいと考えています。")), spec(), FACTS)).toBe("onsha");
    const heading = { sections: GOOD.sections.map((s, i) => (i === 0 ? { ...s, heading: "御社への貢献" } : s)) };
    expect(japaneseDefect(heading, spec(), FACTS)).toBe("onsha");
    const kibou = doc({ key: "kibou", heading: "本人希望欄", blocks: [block("paragraph", "御社規定に従います。")] });
    expect(japaneseDefect(kibou, spec({ kind: "rirekisho" }))).toBe("onsha");
  });
});

describe("a line in English", () => {
  it("is a defect when a skill group's name is printed as given (E1)", () => {
    expect(japaneseDefect(withBlock("skills", 0, block("row", "Languages")), spec(), FACTS)).toBe("english");
    expect(japaneseDefect(withBlock("skills", 0, block("row", "Cloud and platform")), spec(), FACTS)).toBe("english");
  });

  it("is a defect when an English summary follows a Japanese label (E2)", () => {
    const leaked = block("row", "プロジェクト：決済元帳の再構築　Replaced an update-in-place balance table with a double-entry, append-only ledger.");
    expect(japaneseDefect(withBlock("experience", 1, leaked), spec(), FACTS)).toBe("english");
    for (const row of [
      "プロジェクト：決済元帳の再構築 Replaced an update-in-place balance table with a double-entry, append-only ledger.",
      "プロジェクト：決済元帳の再構築Replaced an update-in-place balance table with a double-entry, append-only ledger.",
      "プロジェクト：決済元帳の再構築（Replaced an update-in-place balance table with a double-entry, append-only ledger.）",
    ]) {
      expect(japaneseDefect(withBlock("experience", 1, block("row", row)), spec(), FACTS), row).toBe("english");
    }
  });

  it("is a defect in a heading", () => {
    const heading = doc({ key: "opening", heading: "Why I moved into payments", blocks: [block("paragraph", "決済に移った理由です。")] });
    expect(japaneseDefect(heading, spec({ kind: "career_story_ja" }))).toBe("english");
  });

  it("passes what a Japanese document is right to print in Latin script", () => {
    const terms = latinTerms(spec(), FACTS);
    for (const line of [
      "Hayabusa Computing Co., Ltd.",
      "hayabusa computing co., ltd.",
      "Kumo Certified Architect – Associate",
      "Shirasagi University of Engineering B.Eng.",
      "TypeScript、Go、PostgreSQL",
      "技術スタック：TypeScript, Go, PostgreSQL",
      "AWS LambdaとAPI Gatewayでサーバーレス化",
      "2020-2024　40件→2件",
    ]) {
      expect(isEnglishLine(line, terms), line).toBe(false);
    }
  });

  it("does not take a skill group's name as one of the record's terms", () => {
    expect(latinTerms(spec(), FACTS)).not.toContain("Languages");
    expect(latinTerms(spec(), FACTS)).toContain("TypeScript");
  });

  it("is not read into a technology list or a short Latin phrase inside Japanese", () => {
    const terms = latinTerms(spec(), FACTS);
    expect(isEnglishLine("REST APIとgRPCの設計", terms)).toBe(false);
    expect(isEnglishLine("技術スタック：Kubernetes, Terraform", terms)).toBe(false);
    for (const line of [
      "Infrastructure as Code（IaC）によるインフラ構築の自動化",
      "PoC（Proof of Concept）を実施",
      "POS（Point of Sale）システムの刷新",
      "Single Sign-Onを導入",
      "SaaS（Software as a Service）の導入支援",
      "SaaS (Software as a Service) の導入支援",
      "IaaS (Infrastructure as a Service) 基盤の構築",
      "Software as a Service (SaaS) 型の基盤",
    ]) {
      expect(isEnglishLine(line, terms), line).toBe(false);
    }
    // Three Latin words, one of them a function word, with no Japanese: a sentence.
    expect(isEnglishLine("担当：design of the ledger", terms)).toBe(true);
  });
});

describe("advisories", () => {
  it("name 貴社 outside the 履歴書's 本人希望欄, and pass it inside", () => {
    const rirekisho = (motivation: string, kibou: string) =>
      doc(
        { key: "motivation", heading: "志望動機・特技・アピールポイントなど", blocks: [block("paragraph", motivation)] },
        { key: "kibou", heading: "本人希望欄", blocks: [block("paragraph", kibou)] },
      );
    expect(japaneseAdvisories(rirekisho("決済基盤の改善を続けてきました。", "貴社規定に従います。"), spec({ kind: "rirekisho" }))).toEqual([]);
    const [advisory, ...rest] = japaneseAdvisories(rirekisho("貴社の決済基盤に貢献します。", "貴社規定に従います。"), spec({ kind: "rirekisho" }));
    expect(rest).toEqual([]);
    expect(advisory).toContain("貴社");
    expect(advisory).toContain("志望動機・特技・アピールポイントなど");
    // Not a defect: the document is still offered.
    expect(japaneseDefect(rirekisho("貴社の決済基盤に貢献します。", "貴社規定に従います。"), spec({ kind: "rirekisho" }))).toBeNull();

    const shokumu = withBlock("self_pr", 0, block("paragraph", "貴社でも決済基盤の改善に取り組みたいと考えています。"));
    expect(japaneseAdvisories(shokumu, spec())).toEqual([expect.stringContaining("自己PR")]);
  });

  it("name full-width digits", () => {
    const wide = withBlock("experience", 3, block("bullet", "夜間バッチの処理時間を６時間から９０分に短縮"));
    expect(japaneseAdvisories(wide, spec())).toEqual([expect.stringMatching(/^Full-width digits in 職務経歴\./)]);
    const story = doc({ key: "opening", heading: "２０２０年、決済へ", blocks: [block("paragraph", "決済に移りました。")] });
    expect(japaneseAdvisories(story, spec({ kind: "career_story_ja" }))).toEqual([expect.stringContaining("section 1")]);
  });

  it(`count 職務経歴書 bullets over ${MAX_SHOKUMU_BULLET_LENGTH} characters, and only those`, () => {
    const at = "あ".repeat(MAX_SHOKUMU_BULLET_LENGTH);
    expect(japaneseAdvisories(withBlock("experience", 3, block("bullet", at)), spec())).toEqual([]);
    const over = withBlock("experience", 3, block("bullet", `${at}い`));
    expect(japaneseAdvisories(over, spec())).toEqual([`1 bullet in 職務経歴 runs over ${MAX_SHOKUMU_BULLET_LENGTH} characters.`]);
    // A paragraph is not a bullet, and the story has no bound.
    expect(japaneseAdvisories(withBlock("self_pr", 0, block("paragraph", `${at}い`)), spec())).toEqual([]);
    const story = doc({ key: "opening", heading: "決済へ", blocks: [block("bullet", `${at}い`)] });
    expect(japaneseAdvisories(story, spec({ kind: "career_story_ja" }))).toEqual([]);
  });

  it("count experience bullets ending in です・ます, which 体言止め never does", () => {
    for (const text of ["夜間バッチを短縮しました。", "夜間バッチを短縮しました", "設計を担当しています。", "主担当です。"]) {
      expect(japaneseAdvisories(withBlock("experience", 3, block("bullet", text)), spec()), text).toEqual([
        "1 bullet in 職務経歴 ends in です・ます. 職務経歴 bullets are written 体言止め.",
      ]);
    }
    expect(japaneseAdvisories(withBlock("experience", 3, block("bullet", "夜間バッチの処理時間を短縮")), spec())).toEqual([]);
    // 経歴要約 and 自己PR are です・ます体 by the register.
    expect(japaneseAdvisories(withBlock("summary", 0, block("paragraph", "担当しました。")), spec())).toEqual([]);
  });

  it("never quote the document", () => {
    const text = "貴社の夜間バッチを６時間" + "あ".repeat(MAX_SHOKUMU_BULLET_LENGTH) + "短縮しました。";
    const all = japaneseAdvisories(withBlock("experience", 3, block("bullet", text)), spec());
    expect(all).toHaveLength(4);
    for (const advisory of all) expect(advisory).not.toContain("夜間バッチ");
  });
});
