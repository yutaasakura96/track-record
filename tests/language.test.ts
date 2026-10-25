/**
 * The check an English document is held to before it is offered for review
 * (issue #104). Pure: the route that runs it is `tests/english-story.test.ts`.
 *
 * Every fixture here is INVENTED. Nothing is sampled from `local/`.
 */
import { describe, expect, it } from "vitest";
import {
  MAX_JAPANESE_SHARE,
  englishDefect,
  hasJapaneseScript,
  japaneseOnlyNames,
  japaneseShare,
} from "~/render/language";
import { employerChapterKey } from "~/render/chapters";
import type { RenderSpec } from "~/model/types";
import type { RenderContent } from "~/shared/render-content";

const employer = (id: string, name: string): RenderSpec["employers"][number] => ({
  id,
  name,
  industry: null,
  employmentType: "full_time",
  startedOn: "2020-04-01",
  endedOn: null,
  businessDescription: null,
  capitalYen: null,
  headcount: null,
  roles: [],
  city: null,
});

const spec = (over: Partial<RenderSpec> = {}): RenderSpec => ({
  kind: "career_story_en",
  language: "en",
  subjectName: "Taro Yamada",
  register: "REGISTER",
  employers: [employer("emp_a", "Hayabusa Computing Co., Ltd."), employer("emp_b", "有限会社つばめ工房")],
  projects: [],
  workOutsideEmployment: false,
  desiredRoleNote: null,
  educations: [],
  certifications: [],
  curatedSkills: null,
  jobDescription: null,
  ...over,
});

const content = (sections: { key: string; heading: string; text: string }[]): RenderContent => ({
  sections: sections.map((s, i) => ({
    key: s.key,
    heading: s.heading,
    blocks: [{ id: `blk_${i + 1}`, kind: "paragraph", text: s.text, factIds: [] }],
  })),
});

const PROSE = "I joined in April and spent the first year moving 3,000 batch jobs off the mainframe. ".repeat(20);

describe("Japanese script", () => {
  it("is kana, kanji and the punctuation that comes with them, and nothing Latin", () => {
    for (const s of ["ひらがな", "カタカナ", "漢字", "、", "（"]) expect(hasJapaneseScript(s)).toBe(true);
    for (const s of ["Kawasemi Pay Inc.", "é ü — ’", "3,000 (yen)"]) expect(hasJapaneseScript(s)).toBe(false);
  });

  it("is measured over everything that is not whitespace", () => {
    expect(japaneseShare(["ab", "日本"])).toBe(0.5);
    expect(japaneseShare(["a b  c", "\n"])).toBe(0);
    expect(japaneseShare([])).toBe(0);
  });

  it("leaves out a name the record holds only in Japanese, and counts one it also holds in Latin", () => {
    const names = japaneseOnlyNames(spec());
    expect(names).toEqual(["有限会社つばめ工房"]);
    expect(japaneseShare(["I worked at 有限会社つばめ工房."], names)).toBe(0);
    // The respelling the first story made: a Latin name written back into kanji.
    expect(japaneseShare(["I worked at 隼計算機."], names)).toBeGreaterThan(0);
  });
});

describe("an English document", () => {
  const english = content([
    { key: "opening", heading: "Where it started", text: PROSE },
    { key: employerChapterKey("emp_a"), heading: "Four years at Hayabusa Computing Co., Ltd.", text: PROSE },
    { key: employerChapterKey("emp_b"), heading: "A small shop", text: `At 有限会社つばめ工房, ${PROSE}` },
  ]);

  it("passes when it is English and names every employer as the record does", () => {
    expect(englishDefect(english, spec())).toBeNull();
  });

  it("fails on its blocks when the prose is Japanese", () => {
    const japanese = content([{ key: "opening", heading: "Where it started", text: "私は四月に入社し、最初の一年で三千本のバッチを移しました。" }]);
    expect(englishDefect(japanese, spec())).toBe("blocks");
  });

  it("fails on its headings when only the headings are Japanese, however long the English prose", () => {
    const headings = {
      sections: english.sections.map((s) => ({ ...s, heading: "情報工学から、壊れると困るものを作る側へ" })),
    };
    // The share across the whole document is well under the threshold, which
    // is why headings are measured on their own.
    const all = headings.sections.flatMap((s) => [s.heading, ...s.blocks.map((b) => b.text)]);
    expect(japaneseShare(all)).toBeLessThan(MAX_JAPANESE_SHARE);
    expect(englishDefect(headings, spec())).toBe("headings");
  });

  it("tolerates the odd Japanese term below the threshold", () => {
    const one = content([{ key: "opening", heading: "Where it started", text: `${PROSE} The team called it 夜間.` }]);
    expect(englishDefect(one, spec())).toBeNull();
  });

  it("fails when an employer's chapter does not name that employer exactly as the record writes it", () => {
    const respelt = {
      sections: english.sections.map((s) =>
        s.key === employerChapterKey("emp_a") ? { ...s, heading: "Four years at Hayabusa Computing" } : s,
      ),
    };
    expect(englishDefect(respelt, spec())).toBe("record_names");
  });

  it("rejects a misspelt story heading even when its paragraph has the exact name", () => {
    const respelt = {
      sections: english.sections.map((s) =>
        s.key === employerChapterKey("emp_a") ? { ...s, heading: "Four years at Hayabsa Computing Co., Ltd." } : s,
      ),
    };
    expect(englishDefect(respelt, spec())).toBe("record_names");
  });

  it("checks a short project name in a story heading and a short school name in a story row", () => {
    const named = spec({
      employers: [],
      projects: [{ id: "project", name: "Mira", employerId: null, summary: null, summaryJa: null, startedOn: null, endedOn: null }],
      educations: [{ id: "school", institution: "Aoi", faculty: null, degree: null, fieldOfStudy: null, startedOn: null, endedOn: null, outcome: "graduated", level: "tertiary" }],
    });
    expect(englishDefect(content([{ key: "opening", heading: "Miro project", text: PROSE }]), named)).toBe("record_names");
    const school = content([{ key: "anchors", heading: "Figures", text: "Aoi — graduated" }]);
    school.sections[0]!.blocks[0]!.kind = "row";
    expect(englishDefect(school, named)).toBeNull();
    school.sections[0]!.blocks[0]!.text = "Aui — graduated";
    expect(englishDefect(school, named)).toBe("record_names");
  });

  it("limits free-text near misses to longer names used as names", () => {
    const named = spec({ employers: [], projects: [{ id: "project", name: "Ledger", employerId: null, summary: null, summaryJa: null, startedOn: null, endedOn: null }] });
    expect(englishDefect(content([{ key: "opening", heading: "Work", text: "The ledgers reconciled nightly." }]), named)).toBeNull();
    expect(englishDefect(content([{ key: "opening", heading: "Work", text: "I worked at Ledgr." }]), named)).toBe("record_names");
    const short = spec({ employers: [], projects: [{ id: "project", name: "Mira", employerId: null, summary: null, summaryJa: null, startedOn: null, endedOn: null }] });
    expect(englishDefect(content([{ key: "opening", heading: "Work", text: "The team called it Miro." }]), short)).toBeNull();
  });

  it("reads prose built from a multi-word name's common words as prose unless it keeps the name's capitals", () => {
    const named = spec({
      employers: [],
      projects: [
        { id: "gateway", name: "Payment Gateway", employerId: null, summary: null, summaryJa: null, startedOn: null, endedOn: null },
        { id: "platform", name: "Data Platform", employerId: null, summary: null, summaryJa: null, startedOn: null, endedOn: null },
      ],
    });
    const story = (heading: string, text: string) => content([{ key: "opening", heading, text }]);
    expect(englishDefect(story("Work", "Payment gateways were the hard part of the year."), named)).toBeNull();
    expect(englishDefect(story("Work", "Data platform work began in April."), named)).toBeNull();
    expect(englishDefect(story("Work", "I led the Payment Gatway build."), named)).toBe("record_names");
  });

  it("checks a story row against the record name whatever the capitals of its later words", () => {
    const named = spec({
      employers: [],
      educations: [{ id: "school", institution: "Shirasagi University", faculty: null, degree: null, fieldOfStudy: null, startedOn: null, endedOn: null, outcome: "graduated", level: "tertiary" }],
    });
    const row = content([{ key: "anchors", heading: "Figures", text: "Shirasagi universty, 2011-2015" }]);
    row.sections[0]!.blocks[0]!.kind = "row";
    expect(englishDefect(row, named)).toBe("record_names");
  });

  it("exempts only letter case in prose, not dropped punctuation or spacing", () => {
    const named = spec({
      employers: [employer("emp_a", "Hayabusa Computing Co., Ltd.")],
      educations: [{ id: "school", institution: "St. Mary's College", faculty: null, degree: null, fieldOfStudy: null, startedOn: null, endedOn: null, outcome: "graduated", level: "tertiary" }],
      projects: [{ id: "platform", name: "Data-Platform", employerId: null, summary: null, summaryJa: null, startedOn: null, endedOn: null }],
    });
    const story = (text: string) => content([{ key: "opening", heading: "Work", text }]);
    expect(englishDefect(story("I joined hayabusa computing co., ltd. in 2019."), named)).toBeNull();
    expect(englishDefect(story("I joined Hayabusa Computing Co Ltd in 2019."), named)).toBe("record_names");
    expect(englishDefect(story("I studied at St Marys College."), named)).toBe("record_names");
    expect(englishDefect(story("I rebuilt the Data Platform."), named)).toBe("record_names");
  });

  it("accepts a résumé that omits vocational education but keeps an unclassified school", () => {
    const education = (id: string, institution: string, level: RenderSpec["educations"][number]["level"]): RenderSpec["educations"][number] =>
      ({ id, institution, faculty: null, degree: null, fieldOfStudy: null, startedOn: null, endedOn: null, outcome: "graduated", level });
    const named = spec({ kind: "english_resume", employers: [], educations: [education("v", "Mizuki Vocational School", "vocational"), education("u", "Aoi", null)] });
    const output = content([{ key: "education", heading: "Education", text: "Aoi — graduated" }]);
    output.sections[0]!.blocks[0]!.kind = "row";
    expect(englishDefect(output, named)).toBeNull();
  });

  it("checks a short project name in a résumé project header", () => {
    const named = spec({ kind: "english_resume", employers: [], projects: [{ id: "project", name: "Mira", employerId: null, summary: null, summaryJa: null, startedOn: null, endedOn: null }] });
    const output = content([{ key: "projects", heading: "Projects", text: "Mira — built a service" }]);
    output.sections[0]!.blocks[0]!.kind = "row";
    expect(englishDefect(output, named)).toBeNull();
    output.sections[0]!.blocks[0]!.text = "Miro — built a service";
    expect(englishDefect(output, named)).toBe("record_names");
  });

  it("checks résumé employer headings, education rows and project lines against record names", () => {
    const resumeSpec = spec({
      kind: "english_resume",
      employers: [employer("emp_a", "Hayabusa Computing Co., Ltd.")],
      educations: [{ id: "school", institution: "Shirasagi University", faculty: null, degree: null, fieldOfStudy: null, startedOn: null, endedOn: null, outcome: "graduated", level: "tertiary" }],
      projects: [{ id: "project", name: "Settlement ledger rebuild", employerId: null, summary: null, summaryJa: null, startedOn: null, endedOn: null }],
    });
    const resume = content([
      { key: "experience", heading: "Hayabusa Computing Co., Ltd. — Engineer", text: PROSE },
      { key: "education", heading: "Education", text: "Shirasagi University — B.Eng." },
      { key: "projects", heading: "Projects", text: "Settlement ledger rebuild — improved reconciliation." },
    ]);
    resume.sections[1]!.blocks[0]!.kind = "row";
    expect(englishDefect(resume, resumeSpec)).toBeNull();
    for (const [index, replacement] of [[0, "Hayabsa Computing Co., Ltd. — Engineer"], [1, "Shirasagi Universty — B.Eng."], [2, "Settlement ledgr rebuild — improved reconciliation."]] as const) {
      const changed = { sections: resume.sections.map((s, i) => i === index ? { ...s, ...(index === 0 ? { heading: replacement } : { blocks: [{ ...s.blocks[0]!, text: replacement }] }) } : s) };
      expect(englishDefect(changed, resumeSpec)).toBe("record_names");
    }
  });

  it("does not read one record name as a changed spelling of a longer one it begins", () => {
    const school = (id: string, institution: string): RenderSpec["educations"][number] =>
      ({ id, institution, faculty: null, degree: null, fieldOfStudy: null, startedOn: null, endedOn: null, outcome: "graduated", level: "tertiary" });
    const schools = spec({ employers: [], educations: [school("b", "Shirasagi University"), school("m", "Shirasagi University Graduate School")] });
    const row = content([{ key: "anchors", heading: "Figures", text: "Shirasagi University, 2011-2015" }]);
    row.sections[0]!.blocks[0]!.kind = "row";
    expect(englishDefect(row, schools)).toBeNull();

    const employers = spec({ employers: [employer("emp_a", "Hayabusa Computing"), employer("emp_b", "Hayabusa Computing Europe")] });
    const story = content([
      { key: employerChapterKey("emp_a"), heading: "Hayabusa Computing", text: `${PROSE} I joined Hayabusa Computing in 2019.` },
      { key: employerChapterKey("emp_b"), heading: "Hayabusa Computing Europe", text: `${PROSE} I moved to Hayabusa Computing Europe in 2022.` },
    ]);
    expect(englishDefect(story, employers)).toBeNull();
    const resume = content([{ key: "experience", heading: "Hayabusa Computing — Engineer", text: "Cut the nightly batch." }]);
    expect(englishDefect(resume, { ...employers, kind: "english_resume" })).toBeNull();
  });

  it("still sees a changed longer name when a shorter record name sits inside it", () => {
    const school = (id: string, institution: string): RenderSpec["educations"][number] =>
      ({ id, institution, faculty: null, degree: null, fieldOfStudy: null, startedOn: null, endedOn: null, outcome: "graduated", level: "tertiary" });
    const schools = spec({ employers: [], educations: [school("b", "Shirasagi University"), school("m", "Shirasagi University Graduate School")] });
    const row = content([{ key: "anchors", heading: "Figures", text: "Shirasagi University Graduate Schol, 2015-2017" }]);
    row.sections[0]!.blocks[0]!.kind = "row";
    expect(englishDefect(row, schools)).toBe("record_names");

    // "Data" is a word of its own, not the start of "Databse".
    const data = spec({
      employers: [employer("emp_a", "Database Systems Inc.")],
      projects: [{ id: "project", name: "Data", employerId: null, summary: null, summaryJa: null, startedOn: null, endedOn: null }],
    });
    expect(englishDefect(content([{ key: "opening", heading: "Databse Systems Inc. rollout", text: PROSE }]), data)).toBe("record_names");
    expect(englishDefect(content([{ key: "opening", heading: "Work", text: "I joined Databse Systems Inc. in 2019." }]), data)).toBe("record_names");

    const employers = spec({ employers: [employer("emp_a", "Hayabusa Computing"), employer("emp_b", "Hayabusa Computing Europe")] });
    expect(englishDefect(content([{ key: "opening", heading: "Work", text: "In 2022 I moved to Hayabusa Computing Eurpe." }]), employers)).toBe("record_names");
    const ledger = spec({
      employers: [employer("emp_a", "Hayabusa Computing")],
      projects: [{ id: "project", name: "Hayabusa Computing Ledger", employerId: "emp_a", summary: null, summaryJa: null, startedOn: null, endedOn: null }],
    });
    expect(englishDefect(content([{ key: "opening", heading: "Hayabusa Computing Ledger", text: PROSE }]), ledger)).toBeNull();
    expect(englishDefect(content([{ key: "opening", heading: "Hayabusa Computing Ledgr", text: PROSE }]), ledger)).toBe("record_names");
  });

  it("holds a heading or row to a short name's capitals, and the free text to a name after 'joined'", () => {
    const named = spec({
      employers: [],
      projects: [{ id: "project", name: "Mira", employerId: null, summary: null, summaryJa: null, startedOn: null, endedOn: null }],
      educations: [{ id: "school", institution: "Aoi", faculty: null, degree: null, fieldOfStudy: null, startedOn: null, endedOn: null, outcome: "graduated", level: "tertiary" }],
    });
    expect(englishDefect(content([{ key: "opening", heading: "The Mira project", text: PROSE }]), named)).toBeNull();
    expect(englishDefect(content([{ key: "opening", heading: "The mira project", text: PROSE }]), named)).toBe("record_names");
    expect(englishDefect(content([{ key: "opening", heading: "My Miro years", text: "I joined Mira in 2019." }]), named)).toBe("record_names");
    for (const cue of ["joined", "at", "for", "with", "left", "from"]) {
      expect(englishDefect(content([{ key: "opening", heading: "Work", text: `I ${cue} Miro in 2019.` }]), named), cue).toBe("record_names");
    }
    expect(englishDefect(content([{ key: "opening", heading: "Work", text: "The team called it Miro, then moved a mile to the next site." }]), named)).toBeNull();
    const row = content([{ key: "anchors", heading: "Figures", text: "aoi — graduated" }]);
    row.sections[0]!.blocks[0]!.kind = "row";
    expect(englishDefect(row, named)).toBe("record_names");
    const ledger = spec({ employers: [], projects: [{ id: "project", name: "Ledger", employerId: null, summary: null, summaryJa: null, startedOn: null, endedOn: null }] });
    expect(englishDefect(content([{ key: "opening", heading: "Work", text: "I joined Ledgr in 2019." }]), ledger)).toBe("record_names");
  });

  it("finds a record name only as a whole word, so a longer word that begins with it is not the name", () => {
    const mira = (kind: RenderSpec["kind"]) => spec({ kind, employers: [employer("emp_m", "Mira")] });
    expect(englishDefect(content([{ key: "experience", heading: "Mira — Engineer", text: "Did a thing." }]), mira("english_resume"))).toBeNull();
    expect(englishDefect(content([{ key: "experience", heading: "Mirage — Engineer", text: "Did a thing." }]), mira("english_resume"))).toBe("record_names");
    expect(englishDefect(content([{ key: employerChapterKey("emp_m"), heading: "Mirage years", text: PROSE }]), mira("career_story_en"))).toBe("record_names");

    const resume = spec({
      kind: "english_resume",
      employers: [],
      educations: [{ id: "school", institution: "Aoi", faculty: null, degree: null, fieldOfStudy: null, startedOn: null, endedOn: null, outcome: "graduated", level: "tertiary" }],
      projects: [{ id: "project", name: "Mira", employerId: null, summary: null, summaryJa: null, startedOn: null, endedOn: null }],
    });
    const output = content([
      { key: "education", heading: "Education", text: "Aoino University — B.Eng." },
      { key: "projects", heading: "Projects", text: "Mira — built a service" },
    ]);
    for (const s of output.sections) s.blocks[0]!.kind = "row";
    expect(englishDefect(output, resume)).toBe("record_names");
    output.sections[0]!.blocks[0]!.text = "Aoi — B.Eng.";
    expect(englishDefect(output, resume)).toBeNull();
    output.sections[1]!.blocks[0]!.text = "Mirage — built a service";
    expect(englishDefect(output, resume)).toBe("record_names");
  });

  it("does not read an ordinary heading word as a short name it resembles", () => {
    const named = spec({
      employers: [],
      projects: [
        { id: "data", name: "Data", employerId: null, summary: null, summaryJa: null, startedOn: null, endedOn: null },
        { id: "ledger", name: "Ledger", employerId: null, summary: null, summaryJa: null, startedOn: null, endedOn: null },
      ],
    });
    for (const heading of ["Date of the decision", "Moving data off the mainframe", "Rebuilding the ledger"]) {
      expect(englishDefect(content([{ key: "opening", heading, text: PROSE }]), named), heading).toBeNull();
    }
    // Where a name stands — a field of its own, or beside "project" — it is still the name.
    const row = content([{ key: "anchors", heading: "Figures", text: "Date, 2019-2020" }]);
    row.sections[0]!.blocks[0]!.kind = "row";
    expect(englishDefect(row, named)).toBeNull();
    for (const date of ["2019", "2019-2020", "June 2019", "Jun 2019", "06/2019", "2019-06", "2019–Present", "June 2019–Now"]) {
      row.sections[0]!.blocks[0]!.text = `Date: ${date}`;
      expect(englishDefect(row, named), `row: ${date}`).toBeNull();
      expect(englishDefect(content([{ key: "opening", heading: `Date: ${date}`, text: PROSE }]), named), `heading: ${date}`).toBeNull();
    }
    row.sections[0]!.blocks[0]!.text = "Date — project";
    expect(englishDefect(row, named)).toBe("record_names");
    expect(englishDefect(content([{ key: "opening", heading: "Date — project", text: PROSE }]), named)).toBe("record_names");
    expect(englishDefect(content([{ key: "opening", heading: "Dta project", text: PROSE }]), named)).toBe("record_names");
  });

  it("passes a résumé experience heading made only of generic words", () => {
    const resumeSpec = spec({ kind: "english_resume", employers: [employer("emp_a", "Hayabusa Computing Co., Ltd.")] });
    for (const heading of ["Selected Experience", "Recent Work", "Career Highlights"]) {
      const output = content([{ key: "experience", heading, text: "Cut the nightly batch from 6 hours to 90 minutes." }]);
      expect(englishDefect(output, resumeSpec), heading).toBeNull();
    }
    const named = content([{ key: "experience", heading: "Selected Experience at Kawasemi Pay", text: "Cut the nightly batch." }]);
    expect(englishDefect(named, resumeSpec)).toBe("record_names");
  });

  it("passes over a generic section title, which names no employer, school or project", () => {
    const resumeSpec = spec({ kind: "english_resume", employers: [employer("emp_a", "Hayabusa Computing Co., Ltd."), employer("emp_b", "Kawasemi Pay Inc.")] });
    for (const heading of ["Experience", "Work Experience", "Skills", "Projects", "Summary", "Certifications", "Languages", "Education"]) {
      const output = content([{ key: "experience", heading, text: "Cut the nightly batch from 6 hours to 90 minutes." }]);
      expect(englishDefect(output, resumeSpec), heading).toBeNull();
    }
    // A heading that is more than a title names somebody, and must name them exactly.
    const named = content([{ key: "experience", heading: "Experience at Hayabsa Computing Co., Ltd.", text: "Cut the nightly batch." }]);
    expect(englishDefect(named, resumeSpec)).toBe("record_names");
    const translated = content([{ key: "experience", heading: "Hayabusa Keisanki — Engineer", text: "Cut the nightly batch." }]);
    expect(englishDefect(translated, resumeSpec)).toBe("record_names");
  });

  it("does not look for an employer name in a chapter keyed to no employer the spec holds", () => {
    const unknown = content([{ key: employerChapterKey("emp_gone"), heading: "Elsewhere", text: PROSE }]);
    expect(englishDefect(unknown, spec())).toBeNull();
  });
});
