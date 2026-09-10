/**
 * The attribution invariants (`docs/06`).
 *
 * These three were checked by hand after every generation, against a record
 * that grows with every import. These cases pin the definition instead: what
 * counts as unknown, what counts as unfiled, and what it means for a fact to
 * sit under the wrong heading.
 *
 * Every fixture here is invented and visibly so — 架空 throughout. A render is
 * built from the author's real career record, and test fixtures are never
 * sampled from it (CLAUDE.md).
 */
import { describe, expect, it } from "vitest";
import {
  EXPERIENCE_SECTION,
  checkAttribution,
  countByInvariant,
  experienceGroups,
  resolveEmployer,
  type CareerRecord,
} from "~/render/attribution";
import { EXPERIENCE_SECTION as METRICS_EXPERIENCE_SECTION } from "~/render/metrics";
import type { RenderContent } from "~/shared/render-content";

const EMP_A = "emp_kakuu_shouji";
const EMP_B = "emp_kakuu_denki";

const RECORD: CareerRecord = {
  employers: [
    { id: EMP_A, names: ["架空商事株式会社", "Kakuu Trading"] },
    { id: EMP_B, names: ["架空電機株式会社", "Kakuu Electric"] },
  ],
  facts: [
    { id: "fct_a1", employerId: EMP_A },
    { id: "fct_a2", employerId: EMP_A },
    { id: "fct_b1", employerId: EMP_B },
    { id: "fct_loose", employerId: null },
  ],
};

/**
 * Typed as `RenderContent` and passed to functions that take the module's own
 * structural type. That assignability IS the coupling test: `attribution.ts`
 * has no imports so that Node can load it directly, and this is what stops the
 * two shapes drifting apart.
 */
const CLEAN: RenderContent = {
  sections: [
    {
      key: "summary",
      heading: "Summary",
      blocks: [{ id: "blk_1", kind: "paragraph", text: "架空の要約。", factIds: [] }],
    },
    {
      key: EXPERIENCE_SECTION,
      heading: "Experience",
      blocks: [
        { id: "blk_2", kind: "paragraph", text: "架空商事株式会社 — 架空の職務", factIds: [] },
        { id: "blk_3", kind: "bullet", text: "架空の成果その一。", factIds: ["fct_a1", "fct_a2"] },
        { id: "blk_4", kind: "paragraph", text: "架空電機株式会社 — 架空の職務", factIds: [] },
        { id: "blk_5", kind: "bullet", text: "架空の成果その二。", factIds: ["fct_b1"] },
      ],
    },
  ],
};

/** One experience block replaced, everything else held still. */
function withBlock(id: string, factIds: string[], text?: string): RenderContent {
  return {
    sections: CLEAN.sections.map((section) =>
      section.key !== EXPERIENCE_SECTION
        ? section
        : {
            ...section,
            blocks: section.blocks.map((block) =>
              block.id !== id ? block : { ...block, factIds, text: text ?? block.text },
            ),
          },
    ),
  };
}

describe("a render whose facts are all filed where they are used", () => {
  it("reports nothing", () => {
    expect(checkAttribution(CLEAN, RECORD).findings).toEqual([]);
  });

  it("still reports the denominators, so that a pass is distinguishable from a no-op", () => {
    const report = checkAttribution(CLEAN, RECORD);
    expect(report.blocksChecked).toBe(5);
    expect(report.factReferencesChecked).toBe(3);
    expect(report.groups).toBe(2);
    expect(report.resolvedGroups).toBe(2);
  });

  it("counts every invariant, including the ones that found nothing", () => {
    expect(countByInvariant(checkAttribution(CLEAN, RECORD))).toEqual({
      "unknown-fact": 0,
      "unfiled-fact": 0,
      "misfiled-fact": 0,
      "unresolved-heading": 0,
    });
  });
});

describe("invariant 1 — a fact id the record does not contain", () => {
  it("is reported against the block that cites it", () => {
    const report = checkAttribution(withBlock("blk_3", ["fct_a1", "fct_ghost"]), RECORD);
    expect(report.findings).toEqual([
      {
        invariant: "unknown-fact",
        blockId: "blk_3",
        factId: "fct_ghost",
        headingEmployerId: null,
        factEmployerId: null,
      },
    ]);
  });

  it("is reported outside the experience section too", () => {
    const content: RenderContent = {
      sections: [
        {
          key: "education",
          heading: "Education",
          blocks: [{ id: "blk_9", kind: "row", text: "架空大学", factIds: ["fct_ghost"] }],
        },
      ],
    };
    expect(checkAttribution(content, RECORD).findings.map((f) => f.invariant)).toEqual([
      "unknown-fact",
    ]);
  });

  it("is not ALSO reported as misfiled — an unknown fact has no employer to disagree with", () => {
    const report = checkAttribution(withBlock("blk_3", ["fct_ghost"]), RECORD);
    expect(report.findings).toHaveLength(1);
    expect(countByInvariant(report)["misfiled-fact"]).toBe(0);
  });
});

describe("invariant 2 — a fact filed to no employer, used under one", () => {
  it("is reported with the heading's employer and no filed employer", () => {
    const report = checkAttribution(withBlock("blk_5", ["fct_loose"]), RECORD);
    expect(report.findings).toEqual([
      {
        invariant: "unfiled-fact",
        blockId: "blk_5",
        factId: "fct_loose",
        headingEmployerId: EMP_B,
        factEmployerId: null,
      },
    ]);
  });

  it("is not reported when the same fact is used outside the experience section", () => {
    const content: RenderContent = {
      sections: [
        {
          key: "skills",
          heading: "Skills",
          blocks: [{ id: "blk_8", kind: "bullet", text: "架空の技能。", factIds: ["fct_loose"] }],
        },
      ],
    };
    expect(checkAttribution(content, RECORD).findings).toEqual([]);
  });
});

describe("invariant 3 — a fact under a heading naming a different employer", () => {
  it("reports both employers, so the finding says which way round it is", () => {
    const report = checkAttribution(withBlock("blk_5", ["fct_a1"]), RECORD);
    expect(report.findings).toEqual([
      {
        invariant: "misfiled-fact",
        blockId: "blk_5",
        factId: "fct_a1",
        headingEmployerId: EMP_B,
        factEmployerId: EMP_A,
      },
    ]);
  });

  it("reports every offending citation in a welded bullet, not just the first", () => {
    const report = checkAttribution(withBlock("blk_3", ["fct_a1", "fct_b1", "fct_loose"]), RECORD);
    expect(report.findings.map((f) => [f.invariant, f.factId])).toEqual([
      ["misfiled-fact", "fct_b1"],
      ["unfiled-fact", "fct_loose"],
    ]);
  });
});

describe("a heading whose employer cannot be identified", () => {
  it("is reported rather than skipped in silence", () => {
    const report = checkAttribution(withBlock("blk_4", [], "架空の見出し"), RECORD);
    expect(report.findings).toEqual([
      {
        invariant: "unresolved-heading",
        blockId: "blk_4",
        factId: null,
        headingEmployerId: null,
        factEmployerId: null,
      },
    ]);
    expect(report.resolvedGroups).toBe(1);
    expect(report.groups).toBe(2);
  });

  it("suppresses the employer invariants under it, because there is nothing to check against", () => {
    const misfiled = withBlock("blk_5", ["fct_a1"]);
    const alsoUnresolved: RenderContent = {
      sections: misfiled.sections.map((section) =>
        section.key !== EXPERIENCE_SECTION
          ? section
          : {
              ...section,
              blocks: section.blocks.map((block) =>
                block.id !== "blk_4" ? block : { ...block, text: "架空の見出し" },
              ),
            },
      ),
    };
    expect(countByInvariant(checkAttribution(alsoUnresolved, RECORD))).toMatchObject({
      "misfiled-fact": 0,
      "unresolved-heading": 1,
    });
  });

  it("still reports an unknown fact id under it — invariant 1 does not depend on the heading", () => {
    const content = withBlock("blk_4", [], "架空の見出し");
    const withGhost: RenderContent = {
      sections: content.sections.map((section) =>
        section.key !== EXPERIENCE_SECTION
          ? section
          : {
              ...section,
              blocks: section.blocks.map((block) =>
                block.id !== "blk_5" ? block : { ...block, factIds: ["fct_ghost"] },
              ),
            },
      ),
    };
    expect(countByInvariant(checkAttribution(withGhost, RECORD))).toMatchObject({
      "unknown-fact": 1,
      "unresolved-heading": 1,
    });
  });
});

describe("bullets that precede every heading", () => {
  const ORPHANED: RenderContent = {
    sections: [
      {
        key: EXPERIENCE_SECTION,
        heading: "Experience",
        blocks: [
          { id: "blk_first", kind: "bullet", text: "架空の成果。", factIds: ["fct_a1"] },
          { id: "blk_head", kind: "paragraph", text: "架空商事株式会社", factIds: [] },
        ],
      },
    ],
  };

  it("form a group with no heading, and report against their first block", () => {
    const report = checkAttribution(ORPHANED, RECORD);
    expect(report.findings).toEqual([
      {
        invariant: "unresolved-heading",
        blockId: "blk_first",
        factId: null,
        headingEmployerId: null,
        factEmployerId: null,
      },
    ]);
  });

  it("are not silently dropped from the grouping", () => {
    const [orphans, ...rest] = experienceGroups(ORPHANED, RECORD.employers);
    expect(rest).toHaveLength(1);
    expect(orphans?.headingBlockId).toBeNull();
    expect(orphans?.blocks.map((b) => b.id)).toEqual(["blk_first"]);
  });
});

describe("matching a heading to an employer", () => {
  const NESTED = [
    { id: "emp_short", names: ["架空商事"] },
    { id: "emp_long", names: ["架空商事ホールディングス"] },
  ];

  it("takes the longest matching name, so a contained name does not win", () => {
    expect(resolveEmployer("架空商事ホールディングス 開発部", NESTED)).toBe("emp_long");
  });

  it("still matches the shorter one when only it is present", () => {
    expect(resolveEmployer("架空商事 開発部", NESTED)).toBe("emp_short");
  });

  it("matches a Latin name case-insensitively", () => {
    expect(resolveEmployer("KAKUU TRADING — Engineer", RECORD.employers)).toBe(EMP_A);
  });

  it("resolves to nothing when two different employers match equally well", () => {
    const tied = [
      { id: "emp_1", names: ["架空ソフト"] },
      { id: "emp_2", names: ["架空ハード"] },
    ];
    expect(resolveEmployer("架空ソフトと架空ハードの共同案件", tied)).toBeNull();
  });

  it("ignores an employer whose name is blank rather than matching everything", () => {
    expect(resolveEmployer("架空の見出し", [{ id: "emp_blank", names: ["", "  "] }])).toBeNull();
  });

  it("ignores an employer named only for its corporate form, which normalises to nothing", () => {
    expect(resolveEmployer("架空の見出し", [{ id: "emp_form", names: ["株式会社", "Ltd."] }])).toBeNull();
  });
});

/**
 * A record stores an employer's legal name; a document writes what its layout
 * has room for. The second pass is what closes that gap — and running second is
 * what stops it loosening anything the first pass already settled.
 */
describe("a heading that abbreviates the employer's name", () => {
  it("resolves when the heading drops the Japanese corporate form", () => {
    expect(resolveEmployer("架空商事 — 架空の職務", RECORD.employers)).toBe(EMP_A);
  });

  it("resolves when the heading drops the Latin corporate form", () => {
    const employers = [{ id: "emp_x", names: ["Kakuu Trading Co., Ltd."] }];
    expect(resolveEmployer("Kakuu Trading — Engineer", employers)).toBe("emp_x");
  });

  it("resolves when the heading carries the corporate form and the record does not", () => {
    const employers = [{ id: "emp_x", names: ["架空商事"] }];
    expect(resolveEmployer("架空商事株式会社 開発部", employers)).toBe("emp_x");
  });

  it("keeps two employers distinct when only the corporate form separates them", () => {
    const employers = [
      { id: "emp_kk", names: ["架空商事株式会社"] },
      { id: "emp_yk", names: ["架空商事有限会社"] },
    ];
    // The exact pass settles it. Normalising would collapse both to 架空商事
    // and lose the only thing telling them apart.
    expect(resolveEmployer("架空商事株式会社 開発部", employers)).toBe("emp_kk");
    expect(resolveEmployer("架空商事有限会社 開発部", employers)).toBe("emp_yk");
    // With neither form written out there is genuinely nothing to choose by.
    expect(resolveEmployer("架空商事 開発部", employers)).toBeNull();
  });

  it("does not match a short name across a word boundary", () => {
    // Whitespace is collapsed rather than removed, so `abc` is not found
    // inside `lab candidate`.
    expect(resolveEmployer("lab candidate review", [{ id: "emp_abc", names: ["ABC"] }])).toBeNull();
  });

  it("still resolves to nothing when the heading names no employer at all", () => {
    expect(resolveEmployer("架空の見出し", RECORD.employers)).toBeNull();
  });
});

describe("the section key", () => {
  it("is the same one the measurement uses", () => {
    expect(EXPERIENCE_SECTION).toBe(METRICS_EXPERIENCE_SECTION);
  });

  it("means a render with no experience section has no groups to check", () => {
    const report = checkAttribution({ sections: [] }, RECORD);
    expect(report.groups).toBe(0);
    expect(report.findings).toEqual([]);
  });
});
