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
  startedOn: "2020-04-01",
  endedOn: null,
  businessDescription: null,
  capitalYen: null,
  headcount: null,
  roles: [],
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
    expect(englishDefect(respelt, spec())).toBe("employer_names");
  });

  it("does not look for an employer name in a chapter keyed to no employer the spec holds", () => {
    const unknown = content([{ key: employerChapterKey("emp_gone"), heading: "Elsewhere", text: PROSE }]);
    expect(englishDefect(unknown, spec())).toBeNull();
  });
});
