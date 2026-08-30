/**
 * The diff engine (`docs/11-testing-plan.md` §2.5).
 *
 * This is the most likely thing to regress silently when a dependency updates:
 * a character-level Japanese diff still *renders*, it is just unreadable.
 *
 * The Japanese cases are asserted against the engine rather than over HTTP
 * because M1 builds no Japanese render — `GET /api/proposals/:id/diff` cannot
 * be handed a Japanese document until 職務経歴書 exists. The English behaviour
 * IS asserted over HTTP, in `renders.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { diffRenders } from "~/diff";
import type { Block, RenderContent } from "~/shared/render-content";
import { segmentJapanese } from "~/segment";

const rationale = () => ({ kind: "from_facts" as const, text: "From 1 measured fact", factIds: [] });

const paragraphs = (texts: string[]): RenderContent => ({
  sections: [
    {
      key: "body",
      heading: "職務経歴",
      blocks: texts.map(
        (text, i): Block => ({ id: `blk_${i + 1}`, kind: "paragraph", text, factIds: [] }),
      ),
    },
  ],
});

const diff = (before: string[], after: string[], language: "en" | "ja") =>
  diffRenders(paragraphs(before), paragraphs(after), { language, explain: rationale });

describe("Japanese diffing produces phrase-level marks", () => {
  const before = "ベンダー依存の既存システムを内製プラットフォームへ置き換えるDX推進に従事し、レイテンシを40%削減しました。";
  const after = "ベンダー依存の既存システムをイベント駆動型の内製プラットフォームへ置き換えるDX推進に従事し、レイテンシを55%削減しました。";

  it("marks whole phrases, never single characters", () => {
    const result = diff([before], [after], "ja");
    expect(result.changes).toHaveLength(1);

    const phrases = new Set(segmentJapanese(before).concat(segmentJapanese(after)));
    for (const token of result.changes[0]!.tokens) {
      if (token.op === "equal") continue;
      // Every mark is a run of whole 文節-scale phrases.
      expect(token.text.length).toBeGreaterThan(1);
      const covered = segmentJapanese(token.text);
      for (const phrase of covered) expect(phrases.has(phrase)).toBe(true);
    }
  });

  it("replaces one phrase when a figure changes", () => {
    const result = diff([before], [after], "ja");
    const removed = result.changes[0]!.tokens.filter((t) => t.op === "remove").map((t) => t.text);
    const added = result.changes[0]!.tokens.filter((t) => t.op === "add").map((t) => t.text);
    expect(removed.join("")).toContain("40%削減しました。");
    expect(added.join("")).toContain("55%削減しました。");
  });

  it("reports no changes for identical paragraphs", () => {
    const result = diff([before], [before], "ja");
    expect(result.changes).toHaveLength(0);
    expect(result.additions).toBe(0);
    expect(result.removals).toBe(0);
  });
});

describe("paragraph alignment", () => {
  const a = "The nightly settlement batch had grown to six hours.";
  const b = "The team replaced the row-by-row loop with a set-based rewrite.";
  const c = "A later pass added partition pruning on the ledger table.";
  const inserted = "Before any of that, the team instrumented the job end to end.";

  it("leaves later paragraphs unchanged when one is inserted in the middle", () => {
    // Without alignment by similarity, an insertion shifts everything after it
    // and the whole document reads as changed.
    const result = diff([a, b, c], [a, inserted, b, c], "en");
    expect(result.additions).toBe(1);
    expect(result.removals).toBe(0);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]!.currentBlockId).toBeNull();
    expect(result.changes[0]!.tokens.map((t) => t.text).join("")).toContain("instrumented");
  });

  it("reports an edited paragraph as one change, not a removal and an addition", () => {
    const edited = "The nightly settlement batch had grown to seven hours.";
    const result = diff([a, b], [edited, b], "en");
    expect(result.changes).toHaveLength(1);
    const change = result.changes[0]!;
    expect(change.currentBlockId).not.toBeNull();
    expect(change.proposedBlockId).not.toBeNull();
    expect(change.tokens.some((t) => t.op === "equal")).toBe(true);
  });

  it("reports a genuinely removed paragraph as a removal with an explanation", () => {
    const result = diff([a, b, c], [a, c], "en");
    expect(result.removals).toBe(1);
    const removal = result.changes.find((ch) => ch.proposedBlockId === null)!;
    expect(removal.tokens.every((t) => t.op === "remove")).toBe(true);
    expect(removal.rationale.text.length).toBeGreaterThan(0);
  });

  it("renders a wholly rewritten document normally", () => {
    const result = diff([a, b, c], ["Totally different.", "Nothing alike.", "Not a word shared."], "en");
    expect(result.changes.length).toBeGreaterThan(0);
    for (const change of result.changes) expect(change.rationale.text.length).toBeGreaterThan(0);
  });
});

describe("English tokens", () => {
  it("diffs at word granularity, keeping unchanged words as equal runs", () => {
    const result = diff(
      ["Reduced nightly batch runtime from 6 hours to 3 hours"],
      ["Reduced nightly batch runtime from 6 hours to 90 minutes"],
      "en",
    );
    const tokens = result.changes[0]!.tokens;
    expect(tokens[0]!.op).toBe("equal");
    expect(tokens[0]!.text).toContain("Reduced nightly batch runtime");
    expect(tokens.map((t) => t.text).join("")).toContain("90 minutes");
  });
});
