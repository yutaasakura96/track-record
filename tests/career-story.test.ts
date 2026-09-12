/**
 * The chapter plan, and what it buys (`docs/02` S11).
 *
 * S11's one structural requirement is that the chapters of the two stories
 * correspond one-to-one. `docs/11` §3 item 4 reads the two documents by hand
 * and judges whether they say the same thing; what is asserted here is the half
 * that is not a judgement — that both stories are planned from the same record
 * into the same keys in the same order, so that a pair which does NOT
 * correspond cannot be generated rather than being caught afterwards.
 *
 * Every fixture here is invented and visibly so — 架空 throughout. Test
 * fixtures are never sampled from the author's record (CLAUDE.md).
 */
import { describe, expect, it } from "vitest";
import {
  EMPLOYER_CHAPTER_PREFIX,
  chapterPlan,
  chaptersMatchPlan,
  employerChapterKey,
  employerIdOfChapter,
  isChapteredStory,
} from "~/render/chapters";
import {
  EMPLOYER_CHAPTER_PREFIX as ATTRIBUTED_PREFIX,
  checkAttribution,
  countByInvariant,
  employerGroups,
  type CareerRecord,
} from "~/render/attribution";
import { buildGenerationPrompt, parseRenderContent } from "~/model/generate";
import { RENDER_DEFINITIONS } from "~/render/spec";
import { RENDER_KINDS, type RenderContent } from "~/shared/render-content";
import type { RenderSpec } from "~/model/types";

const EMP_A = "emp_kakuu_shouji";
const EMP_B = "emp_kakuu_denki";

const EMPLOYERS = [
  { id: EMP_A, name: "架空商事株式会社" },
  { id: EMP_B, name: "架空電機株式会社" },
];

const spec = (over: Partial<RenderSpec> = {}): RenderSpec => ({
  kind: "career_story_en",
  language: "en",
  subjectName: "Taro Yamada",
  register: "REGISTER",
  employers: EMPLOYERS.map((e) => ({
    ...e,
    industry: null,
    startedOn: "2020-04-01",
    endedOn: null,
    businessDescription: null,
    capitalYen: null,
    headcount: null,
    roles: [],
  })),
  projects: [],
  workOutsideEmployment: false,
  desiredRoleNote: null,
  educations: [],
  certifications: [],
  ...over,
});

describe("which kinds are chaptered", () => {
  it("is exactly the two career stories", () => {
    expect(RENDER_KINDS.filter(isChapteredStory)).toEqual(["career_story_en", "career_story_ja"]);
  });

  it("leaves every other kind unplanned, so no other register is handed a structure it does not have", () => {
    for (const kind of RENDER_KINDS.filter((k) => !isChapteredStory(k))) {
      expect(chapterPlan(kind, EMPLOYERS, true)).toEqual([]);
    }
  });
});

describe("the chapter plan", () => {
  it("gives both stories the same keys in the same order — the whole of the one-to-one requirement", () => {
    const en = chapterPlan("career_story_en", EMPLOYERS, false);
    const ja = chapterPlan("career_story_ja", EMPLOYERS, false);
    expect(ja).toEqual(en);
    expect(en.length).toBeGreaterThan(0);
  });

  it("opens, runs one chapter per employer in the order given, and closes with the two tables", () => {
    expect(chapterPlan("career_story_en", EMPLOYERS, false).map((c) => c.key)).toEqual([
      "opening",
      employerChapterKey(EMP_A),
      employerChapterKey(EMP_B),
      "ahead",
      "anchors",
      "routing",
    ]);
  });

  it("adds the independent-work chapter only when the record holds work outside employment", () => {
    // Keyed off the facts as well as the projects. The first story generated
    // put six facts about a personal project into the current employer's
    // chapter, because this record holds that work as facts and no project row
    // and the chapter that would have taken them did not exist.
    expect(chapterPlan("career_story_en", EMPLOYERS, false).map((c) => c.key)).not.toContain(
      "independent",
    );
    expect(chapterPlan("career_story_en", EMPLOYERS, true).map((c) => c.key)).toContain(
      "independent",
    );
  });

  it("gives an employer a chapter whether or not any fact is filed under it", () => {
    // A story that skips an employment has a gap in it, and the gap is the
    // first thing an interviewer asks about. The plan is built from the
    // employer list and never from the facts.
    const chapters = chapterPlan("career_story_en", EMPLOYERS, false);
    expect(chapters.filter((c) => c.employerId !== null).map((c) => c.employerId)).toEqual([
      EMP_A,
      EMP_B,
    ]);
  });

  it("names the employer in the chapter's scope, so the model can tell two chapters apart", () => {
    const chapter = chapterPlan("career_story_en", EMPLOYERS, false).find(
      (c) => c.employerId === EMP_B,
    );
    expect(chapter?.scope).toContain("架空電機株式会社");
    expect(chapter?.scope).toContain(EMP_B);
  });

  it("round-trips an employer id through its key, and reads none out of a framing chapter", () => {
    expect(employerIdOfChapter(employerChapterKey(EMP_A))).toBe(EMP_A);
    expect(employerIdOfChapter("opening")).toBeNull();
    expect(employerIdOfChapter(EMPLOYER_CHAPTER_PREFIX)).toBeNull();
  });
});

describe("the prompt", () => {
  it("prints the chapters a story is planned for", () => {
    const prompt = buildGenerationPrompt(spec());
    expect(prompt).toContain('key "opening"');
    expect(prompt).toContain(`key "${employerChapterKey(EMP_A)}"`);
    expect(prompt).toContain('key "routing"');
  });

  it("prints no chapter list for a render that has none", () => {
    expect(buildGenerationPrompt(spec({ kind: "english_resume" }))).not.toContain("Chapters, in this order");
  });
});

/** A story as the model returns it, before ids are assigned. */
const emitted = (keys: string[]) => ({
  sections: keys.map((key) => ({
    key,
    heading: `架空の章 ${key}`,
    blocks: [{ kind: "paragraph", text: "架空の段落。", factIds: [] }],
  })),
});

const PLAN = chapterPlan("career_story_en", EMPLOYERS, false);

describe("a generated story is refused when its chapters do not match the plan", () => {
  it("accepts the planned chapters in the planned order", () => {
    const content = parseRenderContent(emitted(PLAN.map((c) => c.key)), PLAN);
    expect(content.sections.map((s) => s.key)).toEqual(PLAN.map((c) => c.key));
  });

  it("refuses a chapter more, a chapter fewer, and the same chapters reordered", () => {
    const keys = PLAN.map((c) => c.key);
    const reordered = [keys[1]!, keys[0]!, ...keys.slice(2)];
    for (const returned of [[...keys, "extra"], keys.slice(1), reordered]) {
      expect(() => parseRenderContent(emitted(returned), PLAN)).toThrow(/chapters/);
    }
  });

  it("says nothing about the document in the refusal beyond how many chapters came back", () => {
    // The message reaches the proposal row and the screen. Renders are built
    // from a real career record, and a generation error is not an exception to
    // the rule that a diagnostic carries counts and never content.
    try {
      parseRenderContent(emitted(PLAN.map((c) => c.key).slice(1)), PLAN);
      expect.unreachable();
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain(String(PLAN.length));
      expect(message).not.toContain("架空");
    }
  });

  it("leaves a render with no plan exactly as it was", () => {
    const content = parseRenderContent(emitted(["summary", "experience"]));
    expect(content.sections.map((s) => s.key)).toEqual(["summary", "experience"]);
  });
});

const RECORD: CareerRecord = {
  employers: [
    { id: EMP_A, names: ["架空商事株式会社"], copy: [] },
    { id: EMP_B, names: ["架空電機株式会社"], copy: [] },
  ],
  facts: [
    { id: "fct_a1", employerId: EMP_A },
    { id: "fct_b1", employerId: EMP_B },
    { id: "fct_loose", employerId: null },
  ],
};

const story = (chapterKey: string, factIds: string[]): RenderContent => ({
  sections: [
    {
      key: "opening",
      heading: "架空の始まり",
      blocks: [{ id: "blk_1", kind: "paragraph", text: "架空の導入。", factIds: [] }],
    },
    {
      key: chapterKey,
      heading: "架空の章",
      blocks: [{ id: "blk_2", kind: "paragraph", text: "架空の本文。", factIds }],
    },
  ],
});

describe("the attribution invariants reach a story's employer chapters", () => {
  it("resolves the employer from the key rather than from the heading", () => {
    // A chapter heading is a line of the story and may not name the employer at
    // all, which is why a plan that knows the id is worth more here than the
    // name matching the experience section has to fall back on.
    const groups = employerGroups(story(employerChapterKey(EMP_A), ["fct_a1"]), RECORD.employers);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.employerId).toBe(EMP_A);
    expect(checkAttribution(story(employerChapterKey(EMP_A), ["fct_a1"]), RECORD).findings).toEqual(
      [],
    );
  });

  it("reports a fact used in the chapter of a different employer", () => {
    const report = checkAttribution(story(employerChapterKey(EMP_A), ["fct_b1"]), RECORD);
    expect(countByInvariant(report)["misfiled-fact"]).toBe(1);
    expect(report.findings[0]).toMatchObject({
      blockId: "blk_2",
      headingEmployerId: EMP_A,
      factEmployerId: EMP_B,
    });
  });

  it("reports a fact filed to no employer used under one", () => {
    const report = checkAttribution(story(employerChapterKey(EMP_A), ["fct_loose"]), RECORD);
    expect(countByInvariant(report)["unfiled-fact"]).toBe(1);
  });

  it("reports a chapter keyed to an employer the record does not hold, rather than passing over it", () => {
    const report = checkAttribution(story(employerChapterKey("emp_ghost"), ["fct_a1"]), RECORD);
    expect(countByInvariant(report)["unresolved-heading"]).toBe(1);
    expect(report.resolvedGroups).toBe(0);
    expect(report.findings[0]?.blockId).toBe("blk_2");
  });

  it("leaves the framing chapters out of the employer groups entirely", () => {
    const content = story("ahead", ["fct_loose"]);
    expect(employerGroups(content, RECORD.employers)).toEqual([]);
    // Invariant 1 still runs over every section, so nothing goes unchecked.
    expect(checkAttribution(content, RECORD).blocksChecked).toBe(2);
  });

  it("keeps the key prefix in step between the plan and the checker", () => {
    // `attribution.ts` has no imports so that plain Node can load it, so the
    // prefix is duplicated there. This is what stops the two drifting apart.
    expect(ATTRIBUTED_PREFIX).toBe(EMPLOYER_CHAPTER_PREFIX);
  });
});

describe("both stories are buildable on the same terms", () => {
  it("states a direction, and the same one, because the plan is built after the ordering", () => {
    const en = RENDER_DEFINITIONS.career_story_en;
    const ja = RENDER_DEFINITIONS.career_story_ja;
    expect(en.buildable).toBe(true);
    expect(ja.buildable).toBe(true);
    expect(en.chronology).toBe("oldest_first");
    expect(ja.chronology).toBe(en.chronology);
  });

  it("carries a register that is not empty, in the language the story is written in", () => {
    expect(RENDER_DEFINITIONS.career_story_en.register).toContain("First person");
    expect(RENDER_DEFINITIONS.career_story_ja.register).toContain("です・ます体");
  });

  it("shares one structure between the two registers, so a chapter rule cannot be edited into one alone", () => {
    const structure = "The chapters are given to you.";
    expect(RENDER_DEFINITIONS.career_story_en.register).toContain(structure);
    expect(RENDER_DEFINITIONS.career_story_ja.register).toContain(structure);
  });

  it("matches the plan exactly, in order", () => {
    const keys = PLAN.map((c) => c.key);
    expect(chaptersMatchPlan(keys, PLAN)).toBe(true);
    expect(chaptersMatchPlan([...keys].reverse(), PLAN)).toBe(false);
    expect(chaptersMatchPlan(keys.slice(1), PLAN)).toBe(false);
  });
});
