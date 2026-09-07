/**
 * The measurement the decision log argues against (`docs/06`, 2026-09-08).
 *
 * This is what a committed instrument buys. Before it, the script was rebuilt
 * from prose at the start of every session and the only check on the rebuild
 * was that the log happened to record enough prior readings to reproduce. These
 * cases pin the definition instead — what counts as a bullet, what counts as
 * carrying a number, and how each figure rounds.
 *
 * Every fixture here is invented. A render is built from the author's real
 * career record, and test fixtures are never sampled from it (CLAUDE.md).
 */
import { describe, expect, it } from "vitest";
import { bulletsFromLines, experienceBullets, measureBullets } from "~/render/metrics";
import type { RenderContent } from "~/shared/render-content";

/** Lengths are exact and distinct, so a wrong figure cannot look plausible. */
const WITH_A_NUMBER = `1${"a".repeat(99)}`; // 100 characters
const PLAIN = "b".repeat(200); // 200
const OVERLONG = "c".repeat(300); // 300, past the 250 threshold

/**
 * Typed as `RenderContent` and passed to a function that takes the module's own
 * structural type. That assignability IS the coupling test: `metrics.ts` has no
 * imports so that Node can load it directly, and this is what stops the two
 * shapes drifting apart.
 */
const CONTENT: RenderContent = {
  sections: [
    {
      key: "summary",
      heading: "Summary",
      // A bullet in another section. Never counted.
      blocks: [{ id: "b1", kind: "bullet", text: `9${"z".repeat(999)}`, factIds: [] }],
    },
    {
      key: "experience",
      heading: "Experience",
      blocks: [
        // A heading paragraph and a table row sit in this section too, and the
        // measure is of bullets alone.
        { id: "b2", kind: "paragraph", text: `7${"y".repeat(9)}`, factIds: [] },
        { id: "b3", kind: "row", text: `8${"x".repeat(9)}`, factIds: [] },
        { id: "b4", kind: "bullet", text: WITH_A_NUMBER, factIds: ["f1", "f2"] },
        { id: "b5", kind: "bullet", text: PLAIN, factIds: ["f3"] },
        { id: "b6", kind: "bullet", text: OVERLONG, factIds: [] },
      ],
    },
  ],
};

describe("measuring a render's experience section", () => {
  it("counts the bullets of the experience section and nothing else", () => {
    expect(experienceBullets(CONTENT).map((b) => b.text.length)).toEqual([100, 200, 300]);
  });

  it("reads nothing from a document with no experience section", () => {
    expect(experienceBullets({ sections: [] })).toEqual([]);
  });

  it("produces the triple the log records, and the tail underneath it", () => {
    const measured = measureBullets(experienceBullets(CONTENT));

    expect(measured.bullets).toBe(3);
    // (100 + 200 + 300) / 3.
    expect(measured.meanCharacters).toBe(200);
    // One of three carries a digit: 33.3% rounds down, and every recorded
    // figure is an integer percentage.
    expect(measured.quantifiedPercent).toBe(33);
    expect(measured.longestCharacters).toBe(300);
    expect(measured.overLongBullets).toBe(1);
  });

  it("counts composition, which is what welding moves", () => {
    const measured = measureBullets(experienceBullets(CONTENT));

    expect(measured.factReferences).toBe(3);
    expect(measured.factsPerBullet).toBe(1);
    expect(measured.multiFactBullets).toBe(1);
  });

  it("rounds facts per bullet to two places, as the log writes it", () => {
    const bullets = [
      { kind: "bullet", text: "one", factIds: ["a", "b", "c"] },
      { kind: "bullet", text: "two", factIds: ["d", "e"] },
      { kind: "bullet", text: "three", factIds: ["f", "g", "h"] },
    ];
    // 8 / 3 = 2.666…
    expect(measureBullets(bullets).factsPerBullet).toBe(2.67);
  });

  it("returns zeros rather than NaN when there is nothing to measure", () => {
    const measured = measureBullets([]);

    expect(measured.bullets).toBe(0);
    expect(measured.meanCharacters).toBe(0);
    expect(measured.quantifiedPercent).toBe(0);
    expect(measured.longestCharacters).toBe(0);
  });

  /**
   * A digit anywhere, deliberately crude: `two thirds` has counted as
   * unquantified in every reading the log holds, and a cleverer rule would make
   * the next reading incomparable with all of them.
   */
  it("treats a written-out quantity as carrying no number", () => {
    const bullets = [
      { kind: "bullet", text: "Cut the nightly batch by two thirds.", factIds: [] },
      { kind: "bullet", text: "Cut the nightly batch from 6h to 90m.", factIds: [] },
    ];
    expect(measureBullets(bullets).quantifiedPercent).toBe(50);
  });
});

/**
 * The hand-written document is the target every generated render is compared
 * against, and it has no sections and no fact ids. It is read as bullet LINES.
 */
describe("reading a hand-written document", () => {
  it("takes list lines and leaves prose alone", () => {
    const document = [
      "Experience",
      "",
      "Acme Corporation — Engineer",
      "- Cut the nightly batch from 6 hours to 90 minutes.",
      "* Rebuilt the deployment pipeline.",
      "・日本語の行も箇条書きとして数える。",
      "1. A numbered line is a bullet too.",
      "",
      "A closing paragraph that is not a bullet.",
    ].join("\n");

    expect(bulletsFromLines(document).map((b) => b.text)).toEqual([
      "Cut the nightly batch from 6 hours to 90 minutes.",
      "Rebuilt the deployment pipeline.",
      "日本語の行も箇条書きとして数える。",
      "A numbered line is a bullet too.",
    ]);
  });

  it("carries no fact ids, because a hand-written document has none", () => {
    const measured = measureBullets(bulletsFromLines("- One line.\n- 2 lines."));

    expect(measured.bullets).toBe(2);
    expect(measured.quantifiedPercent).toBe(50);
    expect(measured.factReferences).toBe(0);
  });

  it("ignores a marker with nothing after it", () => {
    expect(bulletsFromLines("-\n-   \n- Real.")).toHaveLength(1);
  });
});
