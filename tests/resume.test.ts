/**
 * The English résumé's layout (issue #107): the model's summary and bullets,
 * set into a document whose every other line is read from the record.
 *
 * Pure: no database and no model. The route that reads the record and serves
 * the file is covered in `renders.test.ts`; what is asserted here is what the
 * file says given a version and a record.
 */
import { describe, expect, it } from "vitest";
import PizZip from "pizzip";
import { buildGenerationPrompt, parseGeneratedRender } from "~/model/generate";
import type { RenderSpec } from "~/model/types";
import {
  assembleResume,
  bulletBudget,
  monthSpan,
  projectKey,
  resumeFilename,
  resumeMarkdown,
  resumeSentPage,
  shapeResumeContent,
  ResumeAssemblyError,
  ResumeLanguageError,
  validateResumeEditShape,
  type ResumeRecord,
} from "~/render/resume";
import { resumeDocx } from "~/render/resume-docx";
import { employerChapterKey } from "~/render/chapters";
import type { RenderContent } from "~/shared/render-content";

const TODAY = "2026-10-18";

type Employer = RenderSpec["employers"][number];

const employer = (over: Partial<Employer> = {}): Employer => ({
  id: "emp_now",
  name: "Harbourline Systems Inc.",
  industry: "情報通信業",
  startedOn: "2024-01-01",
  endedOn: null,
  businessDescription: null,
  capitalYen: null,
  headcount: null,
  roles: [{ title: "Staff Engineer", startedOn: "2024-01-01", endedOn: null }],
  city: "Osaka",
  ...over,
});

const RECORD: ResumeRecord = {
  employers: [
    employer(),
    employer({
      id: "emp_before",
      name: "Pinecrest Retail K.K.",
      startedOn: "2019-07-01",
      endedOn: "2023-12-01",
      city: "Tokyo",
      roles: [
        { title: "Tech Lead", startedOn: "2021-04-01", endedOn: "2023-12-01" },
        { title: "Senior Engineer", startedOn: "2019-07-01", endedOn: "2021-03-01" },
      ],
    }),
  ],
  projects: [
    { id: "prj_oss", name: "tategaki-js", employerId: null, summary: "A vertical text library.", startedOn: "2020-05-01", endedOn: null },
    { id: "prj_work", name: "Ledger rebuild", employerId: "emp_before", summary: null, startedOn: null, endedOn: null },
  ],
  educations: [
    {
      id: "edu_high",
      institution: "Kitanomori High School",
      faculty: "普通科",
      degree: null,
      fieldOfStudy: null,
      startedOn: "2008-04-01",
      endedOn: "2011-03-01",
      outcome: "graduated",
      level: "secondary_upper",
    },
    {
      id: "edu_uni",
      institution: "Seaside Institute of Technology",
      faculty: "工学部 情報工学科",
      degree: "Bachelor of Engineering",
      fieldOfStudy: "Computer Science",
      startedOn: "2011-04-01",
      endedOn: "2015-03-01",
      outcome: "graduated",
      level: "tertiary",
    },
  ],
  certifications: [
    { id: "crt_k8s", name: "Certified Kubernetes Administrator", issuingOrganization: "CNCF", issuedOn: "2025-02-01", expiresOn: "2027-02-01", kind: "technical", technologies: [] },
    { id: "crt_old", name: "Cloud Associate", issuingOrganization: "Vendor", issuedOn: "2019-03-01", expiresOn: "2022-03-01", kind: "technical", technologies: [] },
    { id: "crt_lang", name: "TOEIC Listening & Reading 900", issuingOrganization: "IIBC", issuedOn: "2018-11-01", expiresOn: null, kind: "language", technologies: [] },
    { id: "crt_drive", name: "Ordinary driving licence", issuingOrganization: "Police", issuedOn: "2012-08-01", expiresOn: null, kind: "other", technologies: [] },
    { id: "crt_unset", name: "Information Security Exam", issuingOrganization: "IPA", issuedOn: "2016-06-01", expiresOn: null, kind: null, technologies: [] },
  ],
  skills: [
    { name: "Languages", skills: ["Go", "TypeScript"] },
    { name: "Data", skills: ["PostgreSQL"] },
  ],
};

const IDENTITY = {
  nameLatin: "Mika Tanabe",
  nameKanji: "田辺 美香",
  email: "mika@example.com",
  resume: { headline: null, city: null, country: null, phone: null, linkedinUrl: null, githubUrl: null, portfolioUrl: null },
};

const block = (id: string, text: string, kind: "paragraph" | "bullet" = "bullet") => ({ id, kind, text, factIds: [] });

const CONTENT: RenderContent = {
  sections: [
    { key: "summary", heading: "Summary", blocks: [block("b1", "Platform engineer who ships.", "paragraph")] },
    { key: employerChapterKey("emp_now"), heading: "Harbourline Systems Inc.", blocks: [block("b2", "Cut deploys to 5 minutes.")] },
    { key: employerChapterKey("emp_before"), heading: "Pinecrest Retail K.K.", blocks: [block("b3", "Raised conversion 9%.")] },
    { key: projectKey("prj_oss"), heading: "tategaki-js", blocks: [block("b4", "Wrote a layout library with 1,400 stars.")] },
  ],
};

const assembled = (content: RenderContent = CONTENT, record: ResumeRecord = RECORD) =>
  assembleResume({ content, record, identity: IDENTITY, today: TODAY });

describe("the English résumé document", () => {
  it("has no title, and runs Summary → Skills → Experience → Projects → Education → Certifications → Languages", () => {
    const doc = assembled();
    expect(doc.name).toBe("Mika Tanabe");
    expect(doc.contact).toEqual(["mika@example.com"]);
    expect(doc.sections.map((s) => s.heading)).toEqual([
      "Summary",
      "Skills",
      "Experience",
      "Projects",
      "Education",
      "Certifications",
      "Languages",
    ]);
    expect(resumeMarkdown(doc)).not.toContain("Résumé (English)");
  });

  it("refuses Japanese script in record names and generated prose", () => {
    expect(() => assembled(CONTENT, { ...RECORD, employers: [employer({ name: "架空株式会社" })] })).toThrow(/employer 架空株式会社 name/);
    expect(() => assembled({ sections: [{ key: "summary", heading: "Summary", blocks: [block("j1", "日本語", "paragraph")] }] })).toThrow(/summary/);
  });

  it("refuses an old version whose experience heading names no employer the record includes", () => {
    const unmatched: RenderContent = {
      sections: [{ key: "experience", heading: "Experience", blocks: [
        block("h1", "Unknown company · Jan 2020 – Present", "paragraph"),
        block("b1", "Built a service."),
      ] }],
    };
    expect(() => assembled(unmatched)).toThrow(ResumeAssemblyError);
    const headless: RenderContent = {
      sections: [{ key: "experience", heading: "Experience", blocks: [block("b1", "Built a service.")] }],
    };
    expect(() => assembled(headless)).toThrow(/names no employer/);
  });

  it("refuses an employer, project, school or profile name with no Latin script", () => {
    const tertiary = RECORD.educations[1]!;
    const records: ResumeRecord[] = [
      { ...RECORD, employers: [employer({ name: "Компания" })] },
      { ...RECORD, employers: [employer({ name: "Harbourline Компания" })] },
      { ...RECORD, projects: [{ ...RECORD.projects[0]!, name: "Проект" }] },
      { ...RECORD, educations: [{ ...tertiary, institution: "Πανεπιστήμιο" }] },
    ];
    for (const record of records) expect(() => assembled(CONTENT, record)).toThrow(/Latin-script name/);
    expect(() => assembleResume({ content: CONTENT, record: RECORD, identity: { ...IDENTITY, nameLatin: "Мика Танабе" }, today: TODAY }))
      .toThrow(/Latin-script name for profile name/);
    expect(() => assembled(CONTENT, { ...RECORD, employers: [employer({ name: "Société Générale Zürich" })] })).not.toThrow();
  });

  it("heads each job from the record: company, city, Mon YYYY dates, and every title held there", () => {
    const experience = assembled().sections.find((s) => s.key === "experience")!.blocks;
    expect(experience).toEqual([
      { kind: "entry", lead: "Harbourline Systems Inc.", detail: "Osaka", dates: "Jan 2024 – Present" },
      { kind: "subtitle", text: "Staff Engineer" },
      { kind: "bullet", text: "Cut deploys to 5 minutes." },
      { kind: "entry", lead: "Pinecrest Retail K.K.", detail: "Tokyo", dates: "Jul 2019 – Dec 2023" },
      { kind: "subtitle", text: "Tech Lead (Apr 2021 – Dec 2023) · Senior Engineer (Jul 2019 – Mar 2021)" },
      { kind: "bullet", text: "Raised conversion 9%." },
    ]);
  });

  it("prints an employer the version wrote nothing for, so the history has no gap", () => {
    const content = { sections: CONTENT.sections.filter((s) => s.key !== employerChapterKey("emp_before")) };
    const experience = assembled(content).sections.find((s) => s.key === "experience")!.blocks;
    expect(experience.filter((b) => b.kind === "entry").map((b) => (b as { lead: string }).lead)).toEqual([
      "Harbourline Systems Inc.",
      "Pinecrest Retail K.K.",
    ]);
  });

  it("joins an old version's heading-led experience section to the record by name", () => {
    const legacy: RenderContent = {
      sections: [
        {
          key: "experience",
          heading: "Experience",
          blocks: [
            block("p1", "Pinecrest Retail K.K. · Tech Lead (2021-04 – 2023-12) · 2019-07 – 2023-12", "paragraph"),
            block("p2", "Raised conversion 9%."),
          ],
        },
      ],
    };
    const experience = assembled(legacy).sections.find((s) => s.key === "experience")!.blocks;
    const pinecrest = experience.findIndex((b) => b.kind === "entry" && b.lead === "Pinecrest Retail K.K.");
    expect(experience[pinecrest + 2]).toEqual({ kind: "bullet", text: "Raised conversion 9%." });
    expect(resumeMarkdown(assembled(legacy))).not.toContain("2019-07");
  });

  it("lists independent projects only, with their bullets", () => {
    const projects = assembled().sections.find((s) => s.key === "projects")!.blocks;
    expect(projects).toEqual([
      { kind: "entry", lead: "tategaki-js", detail: null, dates: "May 2020 – Present" },
      { kind: "bullet", text: "Wrote a layout library with 1,400 stars." },
    ]);
  });

  it("leaves out schooling below university, the 学部・学科, expired and other certifications, and puts a language score on its own line", () => {
    const doc = assembled();
    expect(doc.sections.find((s) => s.key === "education")!.blocks).toEqual([
      { kind: "entry", lead: "Seaside Institute of Technology", detail: "Bachelor of Engineering, Computer Science", dates: "2015" },
    ]);
    expect(doc.sections.find((s) => s.key === "certifications")!.blocks).toEqual([
      { kind: "paragraph", text: "Certified Kubernetes Administrator, 2025 · Information Security Exam, 2016" },
    ]);
    expect(doc.sections.find((s) => s.key === "languages")!.blocks).toEqual([
      { kind: "paragraph", text: "TOEIC Listening & Reading 900 (2018)" },
    ]);
    expect(resumeMarkdown(doc)).not.toMatch(/Cloud Associate|driving licence|Kitanomori/);
  });

  it("keeps a vocational programme and a row whose level is not recorded", () => {
    const doc = assembled(CONTENT, {
      ...RECORD,
      educations: [
        ...RECORD.educations,
        { ...RECORD.educations[0]!, id: "edu_voc", institution: "Harbour Design Academy", faculty: null, degree: "Diploma", fieldOfStudy: "Web Design", startedOn: "2015-04-01", endedOn: "2016-03-01", level: "vocational" },
        { ...RECORD.educations[0]!, id: "edu_unknown", institution: "Northgate Evening School", faculty: null, level: null },
      ],
    });
    expect(doc.sections.find((s) => s.key === "education")!.blocks.map((b) => b.kind === "entry" && b.lead)).toEqual([
      "Seaside Institute of Technology",
      "Harbour Design Academy",
      "Northgate Evening School",
    ]);
  });

  it("says an unfinished course is unfinished, and when one in progress is expected", () => {
    const doc = assembled(CONTENT, {
      ...RECORD,
      educations: [
        { ...RECORD.educations[1]!, id: "edu_left", outcome: "withdrawn", startedOn: "2011-04-01", endedOn: "2013-03-01" },
        { ...RECORD.educations[1]!, id: "edu_now", outcome: "expected", startedOn: "2025-04-01", endedOn: "2027-03-01" },
      ],
    });
    expect(doc.sections.find((s) => s.key === "education")!.blocks).toEqual([
      { kind: "entry", lead: "Seaside Institute of Technology", detail: "Bachelor of Engineering, Computer Science, not completed", dates: "2011 – 2013" },
      { kind: "entry", lead: "Seaside Institute of Technology", detail: "Bachelor of Engineering, Computer Science", dates: "Expected Mar 2027" },
    ]);
  });

  it("refuses a Japanese-script field that would reach the English résumé", () => {
    expect(() => assembled(CONTENT, {
      ...RECORD,
      employers: [employer({ city: "大阪", roles: [{ title: "主任", startedOn: "2024-01-01", endedOn: null }] })],
      skills: [{ name: "言語", skills: ["Go", "日本語組版"] }],
    })).toThrow(ResumeLanguageError);
  });

  it("writes the skills groups with their names, and an ungrouped list without one", () => {
    const grouped = assembled().sections.find((s) => s.key === "skills")!.blocks;
    expect(grouped[0]).toEqual({ kind: "labelled", label: "Languages", text: "Go, TypeScript" });
    const plain = assembled(CONTENT, { ...RECORD, skills: [{ name: "", skills: ["Go", "Kafka"] }] });
    expect(plain.sections.find((s) => s.key === "skills")!.blocks).toEqual([{ kind: "paragraph", text: "Go, Kafka" }]);
    expect(assembled(CONTENT, { ...RECORD, skills: [] }).sections.some((s) => s.key === "skills")).toBe(false);
  });

  it("gives a sent copy's screen the same text in the same order", () => {
    const page = resumeSentPage(assembled());
    expect(page.stamp).toBeNull();
    expect(page.sections[2]!.blocks[0]).toEqual({ kind: "row", text: "Harbourline Systems Inc. · Osaka · Jan 2024 – Present" });
  });
});

describe("the bullet budget", () => {
  it("is 4–5 for the two most recent employers, 1–2 past eight years, and 2–3 between", () => {
    expect(bulletBudget(0, null, TODAY)).toEqual({ min: 4, max: 5 });
    expect(bulletBudget(1, "2023-12-01", TODAY)).toEqual({ min: 4, max: 5 });
    expect(bulletBudget(2, "2020-06-01", TODAY)).toEqual({ min: 2, max: 3 });
    expect(bulletBudget(3, "2017-03-01", TODAY)).toEqual({ min: 1, max: 2 });
    // Age wins over position: a second employer that ended before a long gap.
    expect(bulletBudget(1, "2016-01-01", TODAY)).toEqual({ min: 1, max: 2 });
  });

  it("reaches the prompt on each employer's line, and on no other render", () => {
    const spec = {
      kind: "english_resume",
      language: "en",
      subjectName: "Mika Tanabe",
      register: "REGISTER",
      employers: [employer({ bullets: { min: 4, max: 5 } })],
      projects: [],
      workOutsideEmployment: false,
      desiredRoleNote: null,
      educations: [],
      certifications: [],
      curatedSkills: null,
      jobDescription: null,
    } satisfies RenderSpec;
    expect(buildGenerationPrompt(spec)).toMatch(/id emp_now · .* · bullet budget 4–5/);
    expect(buildGenerationPrompt({ ...spec, employers: [employer()] })).not.toContain("bullet budget");
  });
});

describe("what the model returned", () => {
  const spec = {
    kind: "english_resume",
    language: "en",
    subjectName: "Mika Tanabe",
    register: "REGISTER",
    employers: RECORD.employers,
    projects: RECORD.projects,
    workOutsideEmployment: true,
    desiredRoleNote: null,
    educations: [],
    certifications: [],
    curatedSkills: null,
    jobDescription: null,
  } satisfies RenderSpec;

  it("uses the record's headings for valid model sections", () => {
    const shaped = shapeResumeContent(
      {
        sections: [
          { key: employerChapterKey("emp_before"), heading: "Invented header", blocks: [block("x2", "Raised conversion 9%.")] },
          { key: "summary", heading: "Profile", blocks: [block("x3", "Platform engineer.", "paragraph")] },
          { key: projectKey("prj_oss"), heading: "Project", blocks: [block("x4", "Built a library.")] },
        ],
      },
      spec,
    );
    expect(shaped.sections.map((s) => [s.key, s.heading, s.blocks.map((b) => `${b.kind}:${b.text}`)])).toEqual([
      ["summary", "Summary", ["paragraph:Platform engineer."]],
      [employerChapterKey("emp_before"), "Pinecrest Retail K.K.", ["bullet:Raised conversion 9%."]],
      [projectKey("prj_oss"), "tategaki-js", ["bullet:Built a library."]],
    ]);
  });

  it("refuses unexpected, duplicate, wrongly typed, and over-bound model sections", () => {
    const valid = [
      { key: "summary", heading: "Summary", blocks: [{ kind: "paragraph", text: "Platform engineer.", factIds: [] }] },
      { key: projectKey("prj_oss"), heading: "Project", blocks: [{ kind: "bullet", text: "Built a library.", factIds: [] }] },
    ];
    const invalid = [
      [...valid, { key: "education", heading: "Education", blocks: [{ kind: "row", text: "School", factIds: [] }] }],
      [...valid, valid[0]!],
      [{ ...valid[0]!, blocks: [{ kind: "bullet", text: "Wrong kind.", factIds: [] }] }, valid[1]!],
      [valid[0]!],
      [{ ...valid[0]!, blocks: [{ kind: "paragraph", text: Array(50).fill("word").join(" "), factIds: [] }] }, valid[1]!],
      [valid[0]!, { ...valid[1]!, blocks: [{ kind: "bullet", text: "x".repeat(241), factIds: [] }] }],
    ];
    for (const sections of invalid) {
      expect(() => parseGeneratedRender({ sections }, spec)).toThrow();
    }
  });

  it("requires a nonempty Summary paragraph", () => {
    expect(() => parseGeneratedRender({ sections: [
      { key: employerChapterKey("emp_before"), heading: "Employer", blocks: [{ kind: "bullet", text: "Improved delivery.", factIds: [] }] },
      { key: projectKey("prj_oss"), heading: "Project", blocks: [{ kind: "bullet", text: "Built a library.", factIds: [] }] },
    ] }, spec)).toThrow(/Summary/);
  });

  it("rejects edited section conversions while preserving legacy experience edits", () => {
    const current = { sections: [
      { key: "summary", heading: "Summary", blocks: [block("s1", "Platform engineer.", "paragraph")] },
      { key: employerChapterKey("emp_before"), heading: "Employer", blocks: [block("e1", "Improved delivery.")] },
    ] } satisfies RenderContent;
    const invalid = [
      { ...current, sections: [current.sections[0]!, { ...current.sections[1]!, blocks: [block("e1", "Improved delivery.", "paragraph")] }] },
      { ...current, sections: [{ ...current.sections[0]!, blocks: [block("s1", "Platform engineer.")] }, current.sections[1]!] },
      { ...current, sections: [...current.sections, current.sections[1]!] },
      { ...current, sections: [...current.sections, { key: "education", heading: "Education", blocks: [block("x1", "School")] }] },
    ];
    for (const content of invalid) expect(() => validateResumeEditShape(content, current)).toThrow();
    const legacy = { sections: [{ key: "experience", heading: "Experience", blocks: [block("h1", "Old heading", "paragraph"), block("b1", "Old bullet")] }] } satisfies RenderContent;
    expect(() => validateResumeEditShape({ sections: [{ ...legacy.sections[0]!, blocks: [block("h1", "Revised heading", "paragraph"), block("b1", "Revised bullet")] }] }, legacy)).not.toThrow();
  });

  it("edits older résumé sections even without an experience section", () => {
    const legacy: RenderContent = { sections: [
      { key: "summary", heading: "Summary", blocks: [block("s1", "Engineer.", "paragraph")] },
      { key: "skills", heading: "Skills", blocks: [block("s2", "TypeScript", "paragraph")] },
      { key: "education", heading: "Education", blocks: [{ id: "s3", kind: "row", text: "Example University", factIds: [] }] },
    ] };
    const edited: RenderContent = { sections: legacy.sections.map((section) =>
      section.key === "summary"
        ? { ...section, blocks: [block("s1", "Experienced engineer.", "paragraph")] }
        : section,
    ) };
    expect(() => validateResumeEditShape(edited, legacy)).not.toThrow();
    const withExperience: RenderContent = { sections: [...legacy.sections,
      { key: "experience", heading: "Experience", blocks: [block("s4", "Old role", "paragraph")] },
    ] };
    expect(() => validateResumeEditShape({ sections: [...edited.sections, withExperience.sections[3]!] }, withExperience)).not.toThrow();
    expect(() => validateResumeEditShape({ sections: edited.sections.slice(0, 2) }, legacy)).toThrow();
    expect(() => validateResumeEditShape({ sections: [edited.sections[0]!, edited.sections[1]!, edited.sections[1]!] }, legacy)).toThrow();
    expect(() => validateResumeEditShape({ sections: [edited.sections[0]!, edited.sections[1]!,
      { ...edited.sections[2]!, key: "certifications" }] }, legacy)).toThrow();
    expect(() => validateResumeEditShape({ sections: [edited.sections[0]!, edited.sections[1]!,
      { ...edited.sections[2]!, blocks: [block("s3", "Example University", "paragraph")] }] }, legacy)).toThrow();
  });

  it("recognises an older version that holds only keys this layout still uses", () => {
    const projectsAsParagraphs: RenderContent = { sections: [
      { key: "summary", heading: "Summary", blocks: [block("s1", "Engineer.", "paragraph")] },
      { key: "projects", heading: "Projects", blocks: [block("p1", "tategaki-js: a vertical text library.", "paragraph")] },
    ] };
    const reworded = (content: RenderContent, id: string, text: string): RenderContent => ({
      sections: content.sections.map((section) => ({
        ...section,
        blocks: section.blocks.map((b) => (b.id === id ? { ...b, text } : b)),
      })),
    });
    expect(() => validateResumeEditShape(reworded(projectsAsParagraphs, "s1", "Platform engineer."), projectsAsParagraphs)).not.toThrow();
    const noSummary: RenderContent = { sections: [
      { key: "projects", heading: "Projects", blocks: [block("p1", "Wrote a layout library.")] },
    ] };
    expect(() => validateResumeEditShape(reworded(noSummary, "p1", "Wrote a vertical layout library."), noSummary)).not.toThrow();
    expect(() => validateResumeEditShape({ sections: [
      { ...projectsAsParagraphs.sections[0]!, blocks: [block("s1", "Engineer.")] },
      projectsAsParagraphs.sections[1]!,
    ] }, projectsAsParagraphs)).toThrow();
  });
});

describe("the file", () => {
  const xmlOf = async (paper: "a4" | "letter" = "a4") => {
    const bytes = await resumeDocx(assembled(), paper, { title: "Mika Tanabe – Résumé", author: "Mika Tanabe" });
    const zip = new PizZip(bytes);
    return { zip, document: zip.file("word/document.xml")!.asText() };
  };

  it("has nothing in a header or footer, real list paragraphs, one sans-serif family and no table", async () => {
    const { zip, document } = await xmlOf();
    expect(Object.keys(zip.files).filter((name) => /header|footer/.test(name))).toEqual([]);
    expect(document).not.toContain("<w:tbl>");
    expect(document).toContain("<w:numPr>");
    const styles = zip.file("word/styles.xml")!.asText();
    const fonts = new Set([...styles.matchAll(/w:ascii="([^"]+)"/g)].map((m) => m[1]));
    expect(fonts).toEqual(new Set(["Calibri"]));
    expect(document).not.toContain("Résumé (English)");
  });

  it("is laid out on the profile's paper, with margins inside 15–16 mm", async () => {
    expect((await xmlOf("a4")).document).toMatch(/<w:pgSz w:w="11906" w:h="16838"/);
    expect((await xmlOf("letter")).document).toMatch(/<w:pgSz w:w="12240" w:h="15840"/);
    const margin = Number(/<w:pgMar w:top="(\d+)"/.exec((await xmlOf()).document)![1]);
    expect(margin / 56.7).toBeGreaterThanOrEqual(15);
    expect(margin / 56.7).toBeLessThanOrEqual(16);
  });

  it("names its author in its properties", async () => {
    const { zip } = await xmlOf();
    expect(zip.file("docProps/core.xml")!.asText()).toContain("<dc:creator>Mika Tanabe</dc:creator>");
  });
});

describe("the file name", () => {
  it("is <First>-<Last>-Resume-<YYYY-MM>, in the month the version was accepted in Tokyo", () => {
    expect(resumeFilename("Mika Tanabe", "docx", new Date("2026-10-31T16:00:00Z"))).toBe("Mika-Tanabe-Resume-2026-11.docx");
    expect(resumeFilename("Zoë  O'Brien-Smith", "md", new Date("2026-10-10T00:00:00Z"))).toBe("Zoe-OBrien-Smith-Resume-2026-10.md");
    expect(resumeFilename("田辺", "docx", new Date("2026-10-10T00:00:00Z"))).toBe("Resume-2026-10.docx");
  });

  it("writes months as words, never numerically", () => {
    expect(monthSpan("2021-04-01", "2023-12-01")).toBe("Apr 2021 – Dec 2023");
  });
});
