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
import { alignmentKeys, diffRenders } from "~/diff";
import { segmentJapanese } from "~/segment";
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

/**
 * A Japanese phrase carries its particle, so a short bullet that changes one
 * particle loses half its phrase matches. All three pairs below scored under
 * the 0.4 threshold on phrases (0.14, 0.25, 0.23) and came back as one whole
 * line removed and another added (#117, review D1).
 */
describe("short Japanese bullets", () => {
  const reworded: [before: string, after: string][] = [
    // A particle changed and a noun inserted.
    ["受注処理を8時間から3時間へ短縮", "受注処理の所要時間を8時間から3時間に短縮"],
    // The same claim restructured around its verb.
    ["夜間バッチの分散処理への移行で、サーバー費用を35%削減", "夜間バッチの分散処理移行により、サーバーコストを35%削減"],
    // A compound noun replaced, and a clause added.
    [
      "検索画面の応答目標200msをCIで監視し、他の3チームにも展開",
      "検索画面の応答時間上限200msをCIで監視する仕組みを導入し、他の3チームでも採用",
    ],
  ];

  it.each(reworded)("aligns a light rewording of %s as one change", (before, after) => {
    const result = diffJa([before], [after]);
    expect(result.changes).toHaveLength(1);
    const change = result.changes[0]!;
    expect(change.currentBlockId).not.toBeNull();
    expect(change.proposedBlockId).not.toBeNull();
    expect(change.tokens.some((t) => t.op === "equal")).toBe(true);
  });

  it.each(reworded)("still marks whole BudouX phrases in %s", (before, after) => {
    // Alignment compares bigrams; what is SHOWN is phrases. Every mark must
    // start and end on a phrase boundary of the side it is read on.
    const tokens = diffJa([before], [after]).changes[0]!.tokens;
    const boundaries = (text: string) => {
      const at = new Set([0]);
      let offset = 0;
      for (const phrase of segmentJapanese(text)) at.add((offset += phrase.length));
      return at;
    };
    for (const [side, ops] of [
      [before, ["equal", "remove"]],
      [after, ["equal", "add"]],
    ] as const) {
      const at = boundaries(side);
      let offset = 0;
      for (const token of tokens.filter((t) => (ops as readonly string[]).includes(t.op))) {
        expect(at.has(offset)).toBe(true);
        offset += token.text.length;
        expect(at.has(offset)).toBe(true);
      }
      expect(offset).toBe(side.length);
    }
  });

  it("does not align two unrelated bullets", () => {
    const result = diffJa(["受注処理を8時間から3時間へ短縮"], ["社外向けの勉強会を企画・運営（参加者40名）"]);
    expect(result.additions).toBe(1);
    expect(result.removals).toBe(1);
    expect(result.changes.map((c) => [c.currentBlockId, c.proposedBlockId])).toEqual(
      expect.arrayContaining([
        ["blk_1", null],
        [null, "blk_1"],
      ]),
    );
  });

  it("pairs each reworded bullet with its own original when several change at once", () => {
    const result = diffJa(
      reworded.map(([before]) => before),
      reworded.map(([, after]) => after),
    );
    expect(result.changes.map((c) => [c.currentBlockId, c.proposedBlockId])).toEqual([
      ["blk_1", "blk_1"],
      ["blk_2", "blk_2"],
      ["blk_3", "blk_3"],
    ]);
  });

  it("leaves English aligned on words, as before", () => {
    // Character bigrams would pair these; words share nothing, and English
    // alignment is unchanged by the Japanese fix.
    expect(alignmentKeys("Reduced latency", "en")).toEqual(["Reduced", "latency"]);
    const result = diff(["Reduced latency"], ["Reduce latencies"]);
    expect(result.additions).toBe(1);
    expect(result.removals).toBe(1);
    expect(result.changes).toHaveLength(2);
  });
});

/**
 * The columns show changed blocks only. In a 職務経歴書 every employer is
 * inside the one `experience` section, so a change has to say which section
 * and which employer it sits under (#117, review D2).
 */
describe("where a change sits", () => {
  const block = (id: string, kind: Block["kind"], text: string): Block => ({ id, kind, text, factIds: [] });
  const shokumu = (bullet: string, extra: Block[] = []): RenderContent => ({
    sections: [
      { key: "summary", heading: "職務要約", blocks: [block("blk_s", "paragraph", "架空の経歴を要約しています。")] },
      {
        key: "experience",
        heading: "職務経歴",
        blocks: [
          block("blk_e1", "paragraph", "架空商事株式会社（2018年4月〜2021年3月）"),
          block("blk_b1", "bullet", "受注処理を8時間から3時間へ短縮"),
          block("blk_e2", "paragraph", "空想工業株式会社（2021年4月〜現在）"),
          block("blk_r2", "row", "主な実績："),
          block("blk_b2", "bullet", bullet),
          ...extra,
        ],
      },
    ],
  });

  it("names the section heading and the employer the bullet falls under", () => {
    const result = diffRenders(
      shokumu("夜間バッチの分散処理への移行で、サーバー費用を35%削減"),
      shokumu("夜間バッチの分散処理移行により、サーバーコストを35%削減"),
      { language: "ja", explain: rationale },
    );
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]!.location).toEqual({
      section: "職務経歴",
      employer: "空想工業株式会社（2021年4月〜現在）",
    });
  });

  it("places a removal where it sat in the current version", () => {
    const extra = block("blk_b3", "bullet", "社外向けの勉強会を企画・運営（参加者40名）");
    const bullet = "夜間バッチの分散処理への移行で、サーバー費用を35%削減";
    const result = diffRenders(shokumu(bullet, [extra]), shokumu(bullet), { language: "ja", explain: rationale });
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]!.proposedBlockId).toBeNull();
    expect(result.changes[0]!.location.employer).toBe("空想工業株式会社（2021年4月〜現在）");
  });

  it("names no employer outside an experience section, or for the employer line itself", () => {
    const before = shokumu("夜間バッチの分散処理への移行で、サーバー費用を35%削減");
    const after: RenderContent = {
      sections: before.sections.map((s) => ({
        ...s,
        blocks: s.blocks.map((b) =>
          b.id === "blk_s"
            ? { ...b, text: "架空の経歴を要約しました。" }
            : b.id === "blk_e2"
              ? { ...b, text: "空想工業株式会社（2021年4月〜2025年3月）" }
              : b,
        ),
      })),
    };
    const result = diffRenders(before, after, { language: "ja", explain: rationale });
    expect(result.changes.map((c) => c.location)).toEqual([
      { section: "職務要約", employer: null },
      { section: "職務経歴", employer: null },
    ]);
  });

  it("does not pair one employer's template row with another's", () => {
    // Two employers' 資本金 rows share most of their bigrams. With one employer
    // dropped and another added, the dropped row must not read as the added
    // employer's row, edited.
    const experience = (...groups: [opening: Block, row: Block][]): RenderContent => ({
      sections: [{ key: "experience", heading: "職務経歴", blocks: groups.flat() }],
    });
    const alpha: [Block, Block] = [
      block("blk_a", "paragraph", "架空商事株式会社（2016年4月〜2018年3月）"),
      block("blk_a1", "row", "資本金：1億円 従業員数：300名"),
    ];
    const beta: [Block, Block] = [
      block("blk_b", "paragraph", "空想工業株式会社（2018年4月〜2021年3月）"),
      block("blk_b1", "row", "資本金：3億円 従業員数：800名"),
    ];
    const gamma: [Block, Block] = [
      block("blk_g", "paragraph", "夢見ソフト合同会社（2021年4月〜現在）"),
      block("blk_g1", "row", "資本金：5000万円 従業員数：120名"),
    ];
    const result = diffRenders(experience(alpha, beta), experience(beta, gamma), {
      language: "ja",
      explain: rationale,
    });
    const rows = result.changes.filter((c) => c.currentBlockId?.endsWith("1") || c.proposedBlockId?.endsWith("1"));
    expect(rows.map((c) => [c.currentBlockId, c.proposedBlockId, c.location.employer])).toEqual([
      ["blk_a1", null, "架空商事株式会社（2016年4月〜2018年3月）"],
      [null, "blk_g1", "夢見ソフト合同会社（2021年4月〜現在）"],
    ]);
  });

  describe("employer identity, with openings shaped as the spec writes them", () => {
    // Name, period, 雇用形態 and role titles, as src/render/spec.ts has every
    // opening paragraph carry them. Two employers share most of that.
    const group = (id: string, opening: string, ...rest: [kind: Block["kind"], text: string][]): Block[] => [
      block(id, "paragraph", opening),
      ...rest.map(([kind, text], i) => block(`${id}_${i + 1}`, kind, text)),
    ];
    const experience = (...groups: Block[][]): RenderContent => ({
      sections: [{ key: "experience", heading: "職務経歴", blocks: groups.flat() }],
    });
    const pairsOf = (before: RenderContent, after: RenderContent) =>
      diffRenders(before, after, { language: "ja", explain: rationale }).changes.map((c) => [
        c.currentBlockId,
        c.proposedBlockId,
        c.location.employer,
      ]);

    it.each([
      [
        "架空商事株式会社（2016年4月〜2018年3月）正社員／バックエンドエンジニア、テックリード",
        "空想工業株式会社（2018年4月〜2021年3月）正社員／バックエンドエンジニア、テックリード",
      ],
      [
        "架空商事株式会社（2016年4月〜2019年3月）正社員／バックエンドエンジニア、プロダクトマネージャー",
        "空想工業株式会社（2019年4月〜2023年9月）正社員／バックエンドエンジニア、スクラムマスター",
      ],
    ])("never pairs %s with another company's opening", (dropped, added) => {
      const before = experience(group("blk_a", dropped, ["row", "資本金：1億円　従業員数：300名"]));
      const after = experience(group("blk_c", added, ["row", "資本金：5000万円　従業員数：120名"]));
      expect(pairsOf(before, after)).toEqual([
        [null, "blk_c", null],
        [null, "blk_c_1", added],
        ["blk_a", null, null],
        ["blk_a_1", null, dropped],
      ]);
    });

    it("keeps one group when the same company's period changes", () => {
      const opening = "空想工業株式会社（2018年4月〜2021年3月）正社員／バックエンドエンジニア";
      const extended = "空想工業株式会社 (2018年4月〜現在) 正社員／バックエンドエンジニア、テックリード";
      const before = experience(
        group("blk_b", opening, ["row", "資本金：3億円　従業員数：800名"], ["bullet", "受注処理を8時間から3時間へ短縮"]),
      );
      const after = experience(
        group(
          "blk_b",
          extended,
          ["row", "資本金：3億円　従業員数：800名"],
          ["bullet", "受注処理の所要時間を8時間から3時間に短縮"],
        ),
      );
      expect(pairsOf(before, after)).toEqual([
        ["blk_b", "blk_b", null],
        ["blk_b_2", "blk_b_2", extended],
      ]);
    });
  });

  it("shows a bullet moved to another employer as a removal and an addition", () => {
    const opening = (id: string, text: string) => block(id, "paragraph", text);
    const first = opening("blk_e1", "架空商事株式会社（2018年4月〜2021年3月）");
    const second = opening("blk_e2", "空想工業株式会社（2021年4月〜現在）");
    const kept = block("blk_k", "bullet", "社外向けの勉強会を企画・運営（参加者40名）");
    const content = (blocks: Block[]): RenderContent => ({
      sections: [{ key: "experience", heading: "職務経歴", blocks }],
    });
    const result = diffRenders(
      content([first, block("blk_m", "bullet", "受注処理を8時間から3時間へ短縮"), second, kept]),
      content([first, second, kept, block("blk_m2", "bullet", "受注処理の所要時間を8時間から3時間に短縮")]),
      { language: "ja", explain: rationale },
    );
    expect(result.removals).toBe(1);
    expect(result.additions).toBe(1);
    expect(result.changes.map((c) => [c.currentBlockId, c.proposedBlockId, c.location.employer])).toEqual([
      ["blk_m", null, "架空商事株式会社（2018年4月〜2021年3月）"],
      [null, "blk_m2", "空想工業株式会社（2021年4月〜現在）"],
    ]);
  });

  it("names the heading a heading change would leave the section with", () => {
    const before = paragraphs(["The nightly batch."]);
    const after = { sections: [{ ...before.sections[0]!, heading: "Work" }] };
    const renamed = diffRenders(before, after, { language: "en", explain: rationale });
    expect(renamed.changes[0]!.target).toBe("heading");
    expect(renamed.changes[0]!.location).toEqual({ section: "Work", employer: null });
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
