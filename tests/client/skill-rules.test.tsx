/**
 * The Skills rules both sides apply (issue #114): the moves behind a picked-up
 * chip, the fold under the suggestions, and the résumé's own Skills section,
 * which the screen previews. Pure, so each position and each threshold is
 * pinned here rather than inferred from a click. All names are invented.
 */
import { describe, expect, it } from "vitest";
import { isFolded, laterUse, placeSkill, stepSkill, type CuratedGroup } from "~/shared/skills";
import { rankedSkills, resumeSkills, skillsSectionPage } from "~/render/resume";

const GROUPS: CuratedGroup[] = [
  { name: "Qorvane stack", nameJa: null, skills: ["Plinth", "Quillset", "Vorbit"] },
  { name: "Zentrel tools", nameJa: null, skills: ["Zentrel CLI"] },
  { name: "Nimbrel", nameJa: null, skills: ["Halvane", "Ostrum"] },
];

describe("a picked-up skill's steps", () => {
  it("moves one place earlier or later in its group", () => {
    expect(stepSkill(GROUPS, "Quillset", "earlier")![0]!.skills).toEqual(["Quillset", "Plinth", "Vorbit"]);
    expect(stepSkill(GROUPS, "Quillset", "later")![0]!.skills).toEqual(["Plinth", "Vorbit", "Quillset"]);
  });

  it("stops at either end of its group rather than leaving it", () => {
    expect(stepSkill(GROUPS, "Plinth", "earlier")).toBeNull();
    expect(stepSkill(GROUPS, "Vorbit", "later")).toBeNull();
  });

  it("goes to the end of the group above or below, and the others keep their order", () => {
    const down = stepSkill(GROUPS, "Quillset", "next group")!;
    expect(down.map((g) => g.skills)).toEqual([["Plinth", "Vorbit"], ["Zentrel CLI", "Quillset"], ["Halvane", "Ostrum"]]);
    const up = stepSkill(GROUPS, "Halvane", "previous group")!;
    expect(up.map((g) => g.skills)).toEqual([["Plinth", "Quillset", "Vorbit"], ["Zentrel CLI", "Halvane"], ["Ostrum"]]);
  });

  it("stops at the first and the last group", () => {
    expect(stepSkill(GROUPS, "Plinth", "previous group")).toBeNull();
    expect(stepSkill(GROUPS, "Ostrum", "next group")).toBeNull();
  });

  it("leaves a group it empties in place, for the save to drop", () => {
    const moved = stepSkill(GROUPS, "Zentrel CLI", "next group")!;
    expect(moved[1]).toEqual({ name: "Zentrel tools", nameJa: null, skills: [] });
  });
});

describe("placing a skill", () => {
  it("puts a dragged skill before the one it was dropped on, in another group", () => {
    expect(placeSkill(GROUPS, "Vorbit", { group: 2, index: 1 })[2]!.skills).toEqual(["Halvane", "Vorbit", "Ostrum"]);
  });

  it("adds a suggestion, which was in no group, at the end", () => {
    expect(placeSkill(GROUPS, "Brennic", { group: 1, index: Infinity })[1]!.skills).toEqual(["Zentrel CLI", "Brennic"]);
  });
});

describe("the fold under the suggestions", () => {
  const THIS_YEAR = 2026;
  const one = (lastUsed: number | "now" | null) => ({ factCount: 1, certificationCount: 0, lastUsed });

  it("folds a skill named once and not in the last five years, or never dated", () => {
    expect(isFolded(one(2020), THIS_YEAR)).toBe(true);
    expect(isFolded(one(null), THIS_YEAR)).toBe(true);
  });

  it("keeps a skill named once in the last five years, or still in use, in view", () => {
    expect(isFolded(one(2021), THIS_YEAR)).toBe(false);
    expect(isFolded(one("now"), THIS_YEAR)).toBe(false);
  });

  it("keeps a skill named twice in view however old", () => {
    expect(isFolded({ factCount: 1, certificationCount: 1, lastUsed: 2012 }, THIS_YEAR)).toBe(false);
    expect(isFolded({ factCount: 2, certificationCount: 0, lastUsed: 2012 }, THIS_YEAR)).toBe(false);
  });

  it("takes the later of two uses, with now the latest", () => {
    expect(laterUse(2019, 2022)).toBe(2022);
    expect(laterUse(null, 2019)).toBe(2019);
    expect(laterUse(2025, "now")).toBe("now");
  });
});

describe("the résumé's Skills section, as the screen previews it", () => {
  it("prints the curation in its order, a group per line, leaving out what the résumé may not name", () => {
    const ranked = rankedSkills([{ technologies: ["Plinth", "Halvane"] }, { technologies: ["Plinth", "Vorbit"] }]);
    expect(ranked).toEqual(["Plinth", "Halvane", "Vorbit"]);
    expect(skillsSectionPage(resumeSkills(GROUPS, ranked))).toEqual([
      {
        heading: "Skills",
        blocks: [
          { kind: "row", text: "Qorvane stack: Plinth, Vorbit" },
          { kind: "row", text: "Nimbrel: Halvane" },
        ],
      },
    ]);
  });

  it("prints one line of everything the résumé may name when nothing is curated", () => {
    expect(skillsSectionPage(resumeSkills([], ["Plinth", "Vorbit"]))).toEqual([
      { heading: "Skills", blocks: [{ kind: "paragraph", text: "Plinth, Vorbit" }] },
    ]);
  });

  it("prints no section for a curation that leaves the résumé nothing", () => {
    expect(skillsSectionPage(resumeSkills(GROUPS, ["Brennic"]))).toEqual([]);
  });
});
