/**
 * The diff engine's alignment pass.
 *
 * Asserted against the engine rather than over HTTP because a proposal that
 * restructures a document cannot be produced through the API without a second
 * generation, and alignment is the half that is unreadable when it regresses.
 * The English token behaviour is also asserted over HTTP, in `renders.test.ts`.
 *
 * `docs/11-testing-plan.md` §2.5 additionally requires phrase-level marks on
 * JAPANESE prose, which the second half of this file asserts. All Japanese
 * fixtures are INVENTED and visibly so.
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

const diffJa = (before: string[], after: string[]) =>
  diffRenders(paragraphs(before), paragraphs(after), { language: "ja", explain: rationale });

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

/**
 * The half that was out of scope until the 履歴書 became buildable. Japanese has
 * no inter-word spaces, so the English tokenizer returns a whole paragraph as
 * one token and every edit reads as "all of it changed" — which is not a
 * cosmetic difference on a review screen whose entire job is showing what
 * moved.
 */
describe("Japanese tokens", () => {
  const before = "社内システムの移行を担当し、処理時間を40%短縮しました。";
  const after = "社内システムの移行を担当し、処理時間を55%短縮しました。";

  it("marks a changed figure as one phrase, not the whole paragraph", () => {
    const change = diffJa([before], [after]).changes[0]!;

    // The opening survives as `equal` — the assertion that fails under the
    // English tokenizer, which cannot find a boundary to keep it on.
    expect(change.tokens.some((t) => t.op === "equal" && t.text.includes("社内システム"))).toBe(true);
    expect(change.tokens.some((t) => t.op === "remove" && t.text.includes("40%"))).toBe(true);
    expect(change.tokens.some((t) => t.op === "add" && t.text.includes("55%"))).toBe(true);
  });

  it("marks spans no wider than the phrase that changed", () => {
    const change = diffJa([before], [after]).changes[0]!;
    const marked = change.tokens.filter((t) => t.op !== "equal");

    // Every mark is a phrase, not the paragraph. Without segmentation each of
    // these is the full 27 characters.
    for (const token of marked) expect(token.text.length).toBeLessThan(before.length / 2);
  });

  it("reproduces both texts exactly from the tokens", () => {
    // The contract the whole engine rests on: a segmenter that dropped or
    // normalised a character would rewrite the document on the review screen.
    const change = diffJa([before], [after]).changes[0]!;
    const join = (ops: string[]) =>
      change.tokens.filter((t) => ops.includes(t.op)).map((t) => t.text).join("");
    expect(join(["equal", "remove"])).toBe(before);
    expect(join(["equal", "add"])).toBe(after);
  });

  it("aligns Japanese paragraphs by similarity, as it does English ones", () => {
    const a = "架空商事での担当は、受発注データの整備です。";
    const b = "帳票の出力処理をまとめて書き直しました。";
    const inserted = "着手前に、現行の処理を計測しました。";

    const result = diffJa([a, b], [a, inserted, b]);
    expect(result.additions).toBe(1);
    expect(result.removals).toBe(0);
    expect(result.changes).toHaveLength(1);
  });

  it("keeps an edited Japanese paragraph one change rather than a rewrite", () => {
    const a = "架空商事での担当は、受発注データの整備です。";
    const edited = "架空商事での担当は、受発注データの移行です。";
    const result = diffJa([a], [edited]);

    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]!.currentBlockId).not.toBeNull();
    expect(result.changes[0]!.proposedBlockId).not.toBeNull();
    expect(result.changes[0]!.tokens.some((t) => t.op === "equal")).toBe(true);
  });
});

describe("section headings", () => {
  const block = (id: string, text: string): Block => ({ id, kind: "paragraph", text, factIds: [] });
  const doc = (...sections: [key: string, heading: string, blocks: Block[]][]): RenderContent => ({
    sections: sections.map(([key, heading, blocks]) => ({ key, heading, blocks })),
  });
  const run = (before: RenderContent | null, after: RenderContent) =>
    diffRenders(before, after, { language: "en", explain: rationale });

  const body = block("blk_1", "The nightly settlement batch had grown to six hours.");

  it("reports a rewritten heading as a change of its own, with its own rationale", () => {
    const result = run(doc(["ch1", "Where it started", [body]]), doc(["ch1", "Building the ledger", [body]]));
    expect(result.changes).toHaveLength(1);
    const [change] = result.changes;
    expect(change!.target).toBe("heading");
    expect(change!.currentBlockId).toBeNull();
    expect(change!.proposedBlockId).toBeNull();
    expect(change!.rationale.kind).toBe("heading_changed");
    expect(change!.rationale.text).toMatch(/heading rewritten/i);
    expect(change!.tokens.some((t) => t.op === "remove")).toBe(true);
    expect(change!.tokens.some((t) => t.op === "add")).toBe(true);
    expect(result.additions).toBe(1);
    expect(result.removals).toBe(1);
  });

  it("reports every chapter title when all of them change, ahead of that chapter's blocks", () => {
    const other = block("blk_2", "A later pass added partition pruning.");
    const result = run(
      doc(["ch1", "One", [body]], ["ch2", "Two", [other]]),
      doc(["ch1", "Uno", [body, block("blk_3", "A brand new paragraph about tracing.")]], ["ch2", "Dos", [other]]),
    );
    expect(result.changes.map((c) => c.target)).toEqual(["heading", "block", "heading"]);
    expect(result.changes.map((c) => c.sectionKey)).toEqual(["ch1", "ch1", "ch2"]);
  });

  it("reports nothing when a heading is unchanged", () => {
    expect(run(doc(["ch1", "Same", [body]]), doc(["ch1", "Same", [body]])).changes).toEqual([]);
  });

  it("explains a new section's heading and a removed section's heading", () => {
    const added = run(doc(["a", "Kept", [body]]), doc(["a", "Kept", [body]], ["b", "New", [block("blk_9", "Fresh.")]]));
    expect(added.changes.map((c) => [c.target, c.rationale.kind])).toEqual([
      ["heading", "heading_changed"],
      ["block", "from_facts"],
    ]);
    expect(added.changes[0]!.tokens).toEqual([{ op: "add", text: "New" }]);

    const removed = run(doc(["a", "Kept", [body]], ["b", "Gone", [block("blk_9", "Fresh.")]]), doc(["a", "Kept", [body]]));
    expect(removed.changes[0]!.target).toBe("heading");
    expect(removed.changes[0]!.tokens).toEqual([{ op: "remove", text: "Gone" }]);
    expect(removed.changes[0]!.rationale.text).toMatch(/removed with its section/i);
  });

  it("ignores the heading of a section with no blocks, which is not in the document", () => {
    expect(run(doc(["a", "Old", []]), doc(["a", "New", []])).changes).toEqual([]);
  });

  it("shows a first version's headings as additions", () => {
    const result = run(null, doc(["ch1", "Building the ledger", [body]]));
    expect(result.changes.map((c) => c.target)).toEqual(["heading", "block"]);
  });
});
