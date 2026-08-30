/**
 * The diff engine's alignment pass.
 *
 * Asserted against the engine rather than over HTTP because a proposal that
 * restructures a document cannot be produced through the API without a second
 * generation, and alignment is the half that is unreadable when it regresses.
 * The English token behaviour is also asserted over HTTP, in `renders.test.ts`.
 *
 * `docs/11-testing-plan.md` §2.5 additionally requires phrase-level marks on
 * JAPANESE prose. That is not tested here because it is not built: Japanese
 * diffing and the BudouX wrapper arrive with the first Japanese render (issue
 * #1, Out of Scope).
 */
import { describe, expect, it } from "vitest";
import { diffRenders } from "~/diff";
import type { Block, RenderContent } from "~/shared/render-content";

const rationale = () => ({ kind: "from_facts" as const, text: "From 1 measured fact", factIds: [] });

const paragraphs = (texts: string[]): RenderContent => ({
  sections: [
    {
      key: "body",
      heading: "Experience",
      blocks: texts.map(
        (text, i): Block => ({ id: `blk_${i + 1}`, kind: "paragraph", text, factIds: [] }),
      ),
    },
  ],
});

const diff = (before: string[], after: string[]) =>
  diffRenders(paragraphs(before), paragraphs(after), { language: "en", explain: rationale });

describe("paragraph alignment", () => {
  const a = "The nightly settlement batch had grown to six hours.";
  const b = "The team replaced the row-by-row loop with a set-based rewrite.";
  const c = "A later pass added partition pruning on the ledger table.";
  const inserted = "Before any of that, the team instrumented the job end to end.";

  it("leaves later paragraphs unchanged when one is inserted in the middle", () => {
    // Without alignment by similarity, an insertion shifts everything after it
    // and the whole document reads as changed.
    const result = diff([a, b, c], [a, inserted, b, c]);
    expect(result.additions).toBe(1);
    expect(result.removals).toBe(0);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]!.currentBlockId).toBeNull();
    expect(result.changes[0]!.tokens.map((t) => t.text).join("")).toContain("instrumented");
  });

  it("reports an edited paragraph as one change, not a removal and an addition", () => {
    const edited = "The nightly settlement batch had grown to seven hours.";
    const result = diff([a, b], [edited, b]);
    expect(result.changes).toHaveLength(1);
    const change = result.changes[0]!;
    expect(change.currentBlockId).not.toBeNull();
    expect(change.proposedBlockId).not.toBeNull();
    expect(change.tokens.some((t) => t.op === "equal")).toBe(true);
  });

  it("reports a genuinely removed paragraph as a removal with an explanation", () => {
    const result = diff([a, b, c], [a, c]);
    expect(result.removals).toBe(1);
    const removal = result.changes.find((ch) => ch.proposedBlockId === null)!;
    expect(removal.tokens.every((t) => t.op === "remove")).toBe(true);
    expect(removal.rationale.text.length).toBeGreaterThan(0);
  });

  it("renders a wholly rewritten document normally", () => {
    const result = diff([a, b, c], ["Totally different.", "Nothing alike.", "Not a word shared."]);
    expect(result.changes.length).toBeGreaterThan(0);
    for (const change of result.changes) expect(change.rationale.text.length).toBeGreaterThan(0);
  });
});

describe("English tokens", () => {
  it("diffs at word granularity, keeping unchanged words as equal runs", () => {
    const result = diff(
      ["Reduced nightly batch runtime from 6 hours to 3 hours"],
      ["Reduced nightly batch runtime from 6 hours to 90 minutes"],
    );
    const tokens = result.changes[0]!.tokens;
    expect(tokens[0]!.op).toBe("equal");
    expect(tokens[0]!.text).toContain("Reduced nightly batch runtime");
    expect(tokens.map((t) => t.text).join("")).toContain("90 minutes");
  });
});
