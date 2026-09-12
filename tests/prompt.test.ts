/**
 * `buildGenerationPrompt` — the step between the render payload and the model.
 *
 * This file exists because of a defect it would have caught. `educations.level`
 * was added to the schema, to the API, to `RenderSpec` and to the payload
 * `render.ts` builds, the type check passed, and the field still never reached
 * the model: the prompt's education line is hand-formatted here, and it was not
 * updated. The register meanwhile had been rewritten to say "each entry states
 * its level", so the model was told to read a field it could not see and wrote
 * "level not stated" into two rows of a real document (`docs/06`, 2026-09-06).
 *
 * The general shape of that bug is a payload field that no formatter prints,
 * and TypeScript cannot see it: an object literal built inside `.map()` carries
 * an excess property to a typed destination without complaint. What catches it
 * is asserting that the value reaches the prompt TEXT.
 */
import { describe, expect, it } from "vitest";
import { buildGenerationPrompt } from "~/model/generate";
import type { RenderSpec } from "~/model/types";

type Education = RenderSpec["educations"][number];

const education = (over: Partial<Education> = {}): Education => ({
  id: "edu_test",
  institution: "Midorikawa Institute of Technology",
  faculty: null,
  degree: null,
  fieldOfStudy: null,
  startedOn: "2013-04-01",
  endedOn: "2017-03-01",
  outcome: "graduated",
  level: "tertiary",
  ...over,
});

type Employer = RenderSpec["employers"][number];

const employer = (over: Partial<Employer> = {}): Employer => ({
  id: "emp_test",
  name: "架空商事株式会社",
  industry: null,
  startedOn: "2024-10-01",
  endedOn: "2025-03-01",
  businessDescription: null,
  capitalYen: null,
  headcount: null,
  roles: [],
  ...over,
});

const spec = (educations: Education[], over: Partial<RenderSpec> = {}): RenderSpec => ({
  kind: "english_resume",
  language: "en",
  subjectName: "Taro Yamada",
  register: "REGISTER",
  employers: [],
  projects: [],
  workOutsideEmployment: false,
  desiredRoleNote: null,
  educations,
  certifications: [],
  ...over,
});

describe("the generation prompt", () => {
  it("states every education's level, so the register never has to read the institution's name", () => {
    // The register selects rows by level. A level that does not reach the
    // prompt leaves the institution name as the only signal, which is how a
    // senior high school whose name contains "College" survived three samples.
    const levels: NonNullable<Education["level"]>[] = [
      "secondary_lower",
      "secondary_upper",
      "vocational",
      "tertiary",
      "postgraduate",
    ];
    for (const level of levels) {
      const prompt = buildGenerationPrompt(spec([education({ level })]));
      const line = prompt.split("\n").find((l) => l.includes("edu_test"));
      expect(line, `no education line for level ${level}`).toBeDefined();
      expect(line, `level ${level} did not reach the prompt`).toMatch(/ · level: /);
    }
  });

  it("distinguishes the two levels an English résumé drops from the ones it keeps", () => {
    const below = (level: NonNullable<Education["level"]>) =>
      buildGenerationPrompt(spec([education({ level })]))
        .split("\n")
        .find((l) => l.includes("edu_test"))!;

    // Wording, not the enum value: the model is told what the rung MEANS, the
    // same way `withdrawn` is spelled out rather than passed through.
    expect(below("secondary_lower")).toContain("below university level");
    expect(below("secondary_upper")).toContain("below university level");
    expect(below("vocational")).not.toContain("below university level");
    expect(below("tertiary")).not.toContain("below university level");
    expect(below("postgraduate")).not.toContain("below university level");
  });

  it("tells the model to keep a row whose level was never recorded", () => {
    // Nullable, because a migration cannot classify rows that already exist.
    // Dropping a real education over a missing classification is the worse
    // failure, so an unstated level is explicitly a keep.
    const prompt = buildGenerationPrompt(spec([education({ level: null })]));
    const line = prompt.split("\n").find((l) => l.includes("edu_test"))!;
    expect(line).toContain("not recorded");
    expect(line).toContain("keep the row");
    expect(line).not.toContain("below university level");
  });

  it("still spells out an outcome, which is the invariant this line already carried", () => {
    const prompt = buildGenerationPrompt(spec([education({ outcome: "withdrawn" })]));
    const line = prompt.split("\n").find((l) => l.includes("edu_test"))!;
    // 中退 rendered as a graduation is a misrepresentation (`docs/04` §3.8).
    expect(line).toContain("never write this as a graduation");
  });
});

/**
 * The same class of defect as the education level, on the field the 履歴書's
 * 本人希望欄 is seeded from: it reaches `RenderSpec` and the payload, and the
 * only thing that proves it reaches the MODEL is asserting on the prompt text.
 */
describe("the author's stated preference", () => {
  it("reaches the prompt in the author's own words", () => {
    const prompt = buildGenerationPrompt(
      spec([], { kind: "rirekisho", language: "ja", desiredRoleNote: "在宅勤務を希望します。" }),
    );
    expect(prompt).toContain("在宅勤務を希望します。");
    // Labelled as the author's, not as a fact — the register writes it with no
    // factIds, and a preference presented as evidence would be a lie about
    // where it came from.
    expect(prompt).toMatch(/Their words, not a fact/);
  });

  it("says nothing at all when the author has stated no preference", () => {
    // The four other renders have no cell to put one in. A labelled
    // "none recorded" would reach every prompt for a field only one uses.
    const prompt = buildGenerationPrompt(spec([], { desiredRoleNote: null }));
    expect(prompt).not.toContain("stated preference");
  });

  it("names the language the document is written in", () => {
    // The one line that tells the model which language to write. It carried a
    // garbled instruction — "Use the call it \"English\" register" — for as long
    // as only one render was buildable and English was the only answer.
    expect(buildGenerationPrompt(spec([]))).toContain("Write the document in English.");
    expect(
      buildGenerationPrompt(spec([], { kind: "rirekisho", language: "ja" })),
    ).toContain("Write the document in Japanese.");
  });
});

/**
 * 資本金 and 従業員数 — the same bug shape this file was opened for, on the
 * fields S10's acceptance names. Both columns have been on `employers` since
 * the schema was first drawn and were read by nothing for a month; a register
 * that names them is worth nothing if the formatter here does not print them.
 */
describe("the employer line", () => {
  it("states 資本金 and 従業員数 when the record holds them", () => {
    const prompt = buildGenerationPrompt(
      spec([], { employers: [employer({ capitalYen: 4_000_000, headcount: 12 })] }),
    );
    expect(prompt).toContain("資本金 400万円");
    expect(prompt).toContain("従業員数 12");
  });

  it("gives the 万円 wording as well as the yen, so the model never divides", () => {
    // The prompt forbids introducing a total the facts do not state, and the
    // 万円 form IS a total computed from the yen figure. Doing the arithmetic
    // here makes the register's job a copy rather than a calculation.
    const prompt = buildGenerationPrompt(
      spec([], { employers: [employer({ capitalYen: 4_000_000 })] }),
    );
    expect(prompt).toContain("400万円");
    expect(prompt).toContain("4000000 yen");
  });

  it("prints nothing at all for a figure the record does not hold", () => {
    // Not "capital: not recorded". A labelled absence on a line about company
    // scale is an invitation to supply one, and a private company genuinely
    // may not publish either figure.
    const prompt = buildGenerationPrompt(spec([], { employers: [employer()] }));
    expect(prompt).not.toContain("資本金");
    expect(prompt).not.toContain("従業員数");
  });

  it("prints the figure the record holds when it holds only one of the two", () => {
    const prompt = buildGenerationPrompt(spec([], { employers: [employer({ headcount: 12 })] }));
    expect(prompt).toContain("従業員数 12");
    expect(prompt).not.toContain("資本金");
  });
});

/**
 * The dated lists arrive already in the order the document reads them, so the
 * prompt labels them by position. They named a direction until 2026-09-12,
 * which was true for one render and false for the other.
 */
describe("the list labels", () => {
  it("names no direction it cannot keep for every render", () => {
    const prompt = buildGenerationPrompt(spec([education()]));
    expect(prompt).toContain("in the order this document lists them");
    expect(prompt).not.toContain("oldest first");
    expect(prompt).not.toContain("most recent first");
    expect(prompt).not.toContain("most recently awarded first");
  });
});
