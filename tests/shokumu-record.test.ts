/**
 * The 職務経歴書 without English and without doubled verbs (issue #117).
 *
 * Three things the review found printed in a Japanese document, each traced to
 * an instruction rather than to the model: skill group names copied in English,
 * an English project summary copied into a プロジェクト row, and 保有資格 rows
 * that added 取得 to a name already carrying a verb. Plus the employer list,
 * which carried no 雇用形態 for the document to state.
 *
 * Asserted here: what the prompt is given, and the rows the renderer writes.
 * Whether a model then writes good Japanese is not something a test can say.
 */
import { describe, expect, it } from "vitest";
import { buildGenerationPrompt } from "~/model/generate";
import type { RenderSpec } from "~/model/types";
import { ENGLISH_ONLY_LABEL, JAPANESE_ONLY_LABEL } from "~/render/language";
import { shikakuRows, educationRows } from "~/render/rirekisho-rows";
import { RENDER_DEFINITIONS } from "~/render/spec";
import { recordSections, withRecordSections } from "~/render/shokumu";
import type { RenderContent } from "~/shared/render-content";

const TODAY = "2026-10-24";

type Education = RenderSpec["educations"][number];
type Certification = RenderSpec["certifications"][number];

const education = (over: Partial<Education>): Education => ({
  id: "edu_x",
  institution: "架空大学",
  faculty: "工学部",
  degree: null,
  fieldOfStudy: null,
  startedOn: "2012-04-01",
  endedOn: "2016-03-01",
  outcome: "graduated",
  level: "tertiary",
  ...over,
});

const certification = (over: Partial<Certification>): Certification => ({
  id: "crt_x",
  name: "架空情報処理試験",
  issuingOrganization: "架空振興機構",
  issuedOn: "2017-06-01",
  expiresOn: null,
  kind: "technical",
  technologies: [],
  ...over,
});

const spec = (over: Partial<RenderSpec> = {}): RenderSpec => ({
  kind: "shokumu_keirekisho",
  language: "ja",
  subjectName: "山田　太郎",
  register: RENDER_DEFINITIONS.shokumu_keirekisho.register,
  employers: [],
  projects: [],
  workOutsideEmployment: false,
  desiredRoleNote: null,
  educations: [],
  certifications: [],
  curatedSkills: null,
  jobDescription: null,
  ...over,
});

const texts = (sections: RenderContent["sections"], key: string) =>
  sections.find((s) => s.key === key)?.blocks.map((b) => b.text) ?? [];

describe("保有資格 and 学歴, filled from the record", () => {
  it("prints the 履歴書's own rows, so the two documents cannot disagree", () => {
    const educations = [education({})];
    const certifications = [certification({})];
    const sections = recordSections(spec({ educations, certifications }), TODAY);
    const asRirekisho = (rows: { year: string; month: string; text: string }[]) =>
      rows.map((r) => `${r.year}年${r.month}月　${r.text}`).reverse();
    expect(texts(sections, "certifications")).toEqual(
      asRirekisho(shikakuRows(certifications.map((c) => ({ ...c, nameJa: null })), [], TODAY)),
    );
    expect(texts(sections, "education")).toEqual(
      asRirekisho(educationRows(educations.map((e) => ({ ...e, institutionJa: null })))),
    );
  });

  it("reads newest first, as the rest of the 職務経歴書 does", () => {
    const sections = recordSections(spec({ educations: [education({})] }), TODAY);
    expect(texts(sections, "education")).toEqual(["2016年3月　架空大学　工学部　卒業", "2012年4月　架空大学　工学部　入学"]);
  });

  it("writes a withdrawal as 中退 and a course still running as 在学中", () => {
    const sections = recordSections(
      spec({
        educations: [
          education({ id: "a", outcome: "withdrawn", endedOn: "2014-09-01" }),
          education({ id: "b", institution: "架空大学院", faculty: null, startedOn: "2025-04-01", endedOn: "2027-03-01", outcome: "expected", level: "postgraduate" }),
        ],
      }),
      TODAY,
    );
    expect(texts(sections, "education")).toEqual([
      "2025年4月　架空大学院　入学（在学中）",
      "2014年9月　架空大学　工学部　中退",
      "2012年4月　架空大学　工学部　入学",
    ]);
  });

  it("leaves out lower secondary and keeps a row whose level is unrecorded", () => {
    const sections = recordSections(
      spec({
        educations: [
          education({ id: "a", institution: "架空中学校", faculty: null, level: "secondary_lower", startedOn: "2006-04-01", endedOn: "2009-03-01" }),
          education({ id: "b", level: null }),
        ],
      }),
      TODAY,
    );
    expect(texts(sections, "education").join("\n")).not.toContain("架空中学校");
    expect(texts(sections, "education")).toHaveLength(2);
  });

  it("leaves a lapsed certification off, and keeps one expiring this month", () => {
    const sections = recordSections(
      spec({
        certifications: [
          certification({ id: "a", name: "架空クラウド認定", expiresOn: "2022-03-01" }),
          certification({ id: "b", name: "普通自動車第一種運転免許", kind: "other", expiresOn: "2026-10-01" }),
        ],
      }),
      TODAY,
    );
    expect(texts(sections, "certifications")).toEqual(["2017年6月　普通自動車第一種運転免許　取得"]);
  });

  it("keeps an undated certification, after the dated ones and with no date", () => {
    const sections = recordSections(
      spec({ certifications: [certification({ id: "a", issuedOn: null, name: "架空検定" }), certification({ id: "b" })] }),
      TODAY,
    );
    expect(texts(sections, "certifications")).toEqual(["2017年6月　架空情報処理試験　合格", "架空検定　合格"]);
  });

  it("never doubles a verb the name already carries, and reads a score as 取得", () => {
    const sections = recordSections(
      spec({
        certifications: [
          certification({ id: "a", name: "架空情報処理試験 合格", issuedOn: "2018-06-01" }),
          certification({ id: "b", name: "架空英語テスト 820点", kind: "language", issuedOn: "2019-01-01" }),
        ],
      }),
      TODAY,
    );
    expect(texts(sections, "certifications")).toEqual([
      "2019年1月　架空英語テスト 820点　取得",
      "2018年6月　架空情報処理試験 合格",
    ]);
  });

  it("prints no section for an empty list", () => {
    expect(recordSections(spec(), TODAY)).toEqual([]);
  });

  it("replaces anything the model wrote for them, before 自己PR, with ids unique", () => {
    const generated: RenderContent = {
      sections: [
        { key: "summary", heading: "経歴要約", blocks: [{ id: "blk_1", kind: "paragraph", text: "要約です。", factIds: ["f1"] }] },
        { key: "certifications", heading: "保有資格", blocks: [{ id: "blk_2", kind: "row", text: "架空情報処理試験 合格（2017年6月取得）", factIds: [] }] },
        { key: "self_pr", heading: "自己PR", blocks: [{ id: "blk_3", kind: "paragraph", text: "自己PRです。", factIds: ["f1"] }] },
      ],
    };
    const content = withRecordSections(generated, spec({ certifications: [certification({})], educations: [education({})] }), TODAY);
    expect(content.sections.map((s) => s.key)).toEqual(["summary", "certifications", "education", "self_pr"]);
    expect(texts(content.sections, "certifications")).toEqual(["2017年6月　架空情報処理試験　合格"]);
    const ids = content.sections.flatMap((s) => s.blocks.map((b) => b.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(content.sections.find((s) => s.key === "education")!.blocks.every((b) => b.kind === "row" && b.factIds.length === 0)).toBe(true);
  });

  it("closes the document with them when the model wrote no 自己PR", () => {
    const generated: RenderContent = {
      sections: [{ key: "summary", heading: "経歴要約", blocks: [{ id: "blk_1", kind: "paragraph", text: "要約です。", factIds: [] }] }],
    };
    const content = withRecordSections(generated, spec({ educations: [education({})] }), TODAY);
    expect(content.sections.map((s) => s.key)).toEqual(["summary", "education"]);
  });
});

describe("the Japanese prompt and the English the record holds", () => {
  const project = { id: "prj_a", name: "架空台帳", employerId: null, summaryJa: null, startedOn: null, endedOn: null };

  it("marks an English-only summary, and leaves a Japanese one alone", () => {
    const english = buildGenerationPrompt(spec({ projects: [{ ...project, summary: "Rebuilt the ledger as append-only." }] }));
    expect(english).toContain(`${ENGLISH_ONLY_LABEL} Rebuilt the ledger as append-only.`);
    const japanese = buildGenerationPrompt(spec({ projects: [{ ...project, summary: "台帳を追記型に再構築" }] }));
    expect(japanese).toContain("· 台帳を追記型に再構築");
    expect(japanese).not.toContain(`${ENGLISH_ONLY_LABEL} 台帳`);
  });

  it("prints the author's Japanese summary as written, even with no kana or kanji in it", () => {
    const prompt = buildGenerationPrompt(
      spec({ projects: [{ ...project, summary: "Rebuilt the ledger as append-only.", summaryJa: "Web/API" }] }),
    );
    expect(prompt).toContain("· independent · Web/API");
    expect(prompt).not.toContain(`${ENGLISH_ONLY_LABEL} Web/API`);
    expect(prompt).not.toContain("Rebuilt the ledger");
  });

  it("keeps the English prompt's label the other way round", () => {
    const prompt = buildGenerationPrompt(
      spec({ kind: "english_resume", language: "en", register: "REGISTER", projects: [{ ...project, summary: "台帳を追記型に再構築" }] }),
    );
    expect(prompt).toContain(`${JAPANESE_ONLY_LABEL} 台帳を追記型に再構築`);
    expect(prompt).not.toContain(ENGLISH_ONLY_LABEL);
  });

  it("gives a curated group its Japanese name, and marks the English one where there is none", () => {
    const prompt = buildGenerationPrompt(
      spec({
        curatedSkills: [
          { name: "Languages", nameJa: "言語", skills: ["Java"] },
          { name: "Cloud and platform", nameJa: null, skills: ["AWS"] },
        ],
      }),
    );
    expect(prompt).toContain("- 言語: Java");
    expect(prompt).not.toContain("Languages");
    expect(prompt).toContain(`- ${ENGLISH_ONLY_LABEL} Cloud and platform: AWS`);
  });

  it("prints the author's Japanese group name as written, even with no kana or kanji in it", () => {
    const prompt = buildGenerationPrompt(spec({ curatedSkills: [{ name: "Operations", nameJa: "DevOps", skills: ["Docker"] }] }));
    expect(prompt).toContain("- DevOps: Docker");
    expect(prompt).not.toContain(`${ENGLISH_ONLY_LABEL} DevOps`);
  });

  it("gives an English render the group's English name", () => {
    const prompt = buildGenerationPrompt(
      spec({ kind: "english_resume", language: "en", curatedSkills: [{ name: "Languages", nameJa: "言語", skills: ["Java"] }] }),
    );
    expect(prompt).toContain("- Languages: Java");
    expect(prompt).not.toContain("言語");
  });

  it("states each employer's 雇用形態", () => {
    const employer = {
      id: "emp_a",
      name: "架空派遣株式会社",
      industry: null,
      startedOn: "2020-04-01",
      endedOn: null,
      businessDescription: null,
      employmentType: "dispatch" as const,
      capitalYen: null,
      headcount: null,
      roles: [],
      city: null,
    };
    expect(buildGenerationPrompt(spec({ employers: [employer] }))).toContain("2020-04 – present · 雇用形態 派遣");
    expect(buildGenerationPrompt(spec({ kind: "english_resume", language: "en", employers: [employer] }))).toContain(
      "2020-04 – present · agency dispatch",
    );
  });

  it("marks an English-only business description, and leaves a Japanese one alone", () => {
    const employer = {
      id: "emp_a",
      name: "架空派遣株式会社",
      industry: null,
      startedOn: "2020-04-01",
      endedOn: null,
      employmentType: "dispatch" as const,
      capitalYen: null,
      headcount: null,
      roles: [],
      city: null,
    };
    const english = buildGenerationPrompt(
      spec({ employers: [{ ...employer, businessDescription: "Provides fictional payroll software." }] }),
    );
    expect(english).toContain(`· ${ENGLISH_ONLY_LABEL} Provides fictional payroll software.`);
    const japanese = buildGenerationPrompt(spec({ employers: [{ ...employer, businessDescription: "架空の給与計算ソフトを提供" }] }));
    expect(japanese).toContain("· 架空の給与計算ソフトを提供");
    expect(japanese).not.toContain(`${ENGLISH_ONLY_LABEL} 架空の給与計算ソフトを提供`);
  });

  it("copies an English-only role title and certification name unlabelled, and still labels Japanese ones in English", () => {
    const employer = {
      id: "emp_a",
      name: "架空派遣株式会社",
      industry: null,
      startedOn: "2020-04-01",
      endedOn: null,
      businessDescription: null,
      employmentType: "dispatch" as const,
      capitalYen: null,
      headcount: null,
      roles: [{ title: "Tech Lead", startedOn: "2020-04-01", endedOn: null }],
      city: null,
    };
    const japanese = buildGenerationPrompt(
      spec({ employers: [employer], certifications: [certification({ name: "Fictional Cloud Architect" })] }),
    );
    expect(japanese).toContain("    - Tech Lead · 2020-04 – present");
    expect(japanese).toContain(" · Fictional Cloud Architect · ");
    expect(japanese).not.toContain(`${ENGLISH_ONLY_LABEL} Tech Lead`);
    expect(japanese).not.toContain(`${ENGLISH_ONLY_LABEL} Fictional Cloud Architect`);

    const english = buildGenerationPrompt(
      spec({
        kind: "english_resume",
        language: "en",
        register: "REGISTER",
        employers: [{ ...employer, roles: [{ ...employer.roles[0]!, title: "主任" }] }],
        certifications: [certification({ name: "架空情報技術者試験" })],
      }),
    );
    expect(english).toContain(`${JAPANESE_ONLY_LABEL} 主任`);
    expect(english).toContain(`${JAPANESE_ONLY_LABEL} 架空情報技術者試験`);
  });
});
