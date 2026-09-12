/**
 * 職務経歴書 — the spec, and the parts of the register a reader downstream
 * depends on.
 *
 * The register itself is prose sent to a model, and no test can assert that
 * prose produced a good document. What CAN be asserted is the handful of things
 * something else in the codebase reads, where the register drifting apart from
 * that reader is silent:
 *
 *   - the section key `npm run measure` and `npm run check:attribution` look
 *     under, which is `experience` for this render as much as for the résumé;
 *   - the one-paragraph-per-employer rule, which is not a style preference but
 *     the thing that keeps `experienceGroups` splitting the section by employer;
 *   - the instruction not to convert 資本金, which is only safe because
 *     `capitalInJapanese` did the conversion first.
 *
 * The same reasoning as `tests/prompt.test.ts`: a value can pass the type check
 * all the way to the model and still never arrive.
 */
import { describe, expect, it } from "vitest";
import { RENDER_DEFINITIONS } from "~/render/spec";
import { REQUIRED_PROFILE_FIELDS } from "~/render/rirekisho";
import { EXPERIENCE_SECTION as MEASURED_SECTION } from "~/render/metrics";
import { EXPERIENCE_SECTION as ATTRIBUTED_SECTION } from "~/render/attribution";
import { capitalInJapanese } from "~/model/generate";
import { documentDate, isDated } from "~/render/identity";
import { checkAttribution, experienceGroups } from "~/render/attribution";
import { experienceBullets, measureBullets } from "~/render/metrics";
import type { RenderContent } from "~/shared/render-content";
import { RENDER_KINDS } from "~/shared/render-content";

const definition = RENDER_DEFINITIONS.shokumu_keirekisho;

describe("the 職務経歴書 spec", () => {
  it("is buildable, and its register is not empty", () => {
    // This asserted the refusal until 2026-09-12, exactly as the 履歴書's did:
    // `buildable` was false and the register was `""`, and the pair was the
    // guard against spending a generation on an empty prompt. The flip inverts
    // the guard rather than retiring it — the two move together, both ways.
    expect(definition.buildable).toBe(true);
    expect(definition.register.trim()).not.toBe("");
  });

  it("reads newest first, which the 履歴書 does not", () => {
    // 逆編年体. Asserted against the 履歴書 rather than alone, because the
    // interesting property is that two Japanese renders read in OPPOSITE
    // directions off one record — which is what `inDocumentOrder` exists for.
    expect(definition.chronology).toBe("newest_first");
    expect(RENDER_DEFINITIONS.rirekisho.chronology).toBe("oldest_first");
  });

  it("blocks generation on a kanji name and asks for no restricted PII", () => {
    expect(definition.requiredProfileFields).toEqual(["familyNameKanji", "givenNameKanji"]);
    // `docs/04` §3.2: 生年月日, 現住所 and 連絡先 are the 履歴書's alone. This
    // render is submitted alongside one and needs none of them. Asserted as a
    // difference from the 履歴書's list, so that a field added there cannot be
    // copied here by reflex.
    const restricted = REQUIRED_PROFILE_FIELDS.filter(
      (field) => !definition.requiredProfileFields.includes(field),
    );
    expect(restricted).toContain("dateOfBirth");
    expect(restricted).toContain("phone");
    expect(restricted).toContain("address");
    expect(restricted).toContain("postalCode");
  });
});

describe("the register's contract with the rest of the codebase", () => {
  it("writes the employer body under the key both instruments read", () => {
    // `metrics.ts` and `attribution.ts` hold the key separately and are kept in
    // step by test rather than by import. A third render writing its employer
    // body under some other key would measure as zero bullets and check as zero
    // groups — both instruments silently reporting nothing against nothing.
    expect(MEASURED_SECTION).toBe(ATTRIBUTED_SECTION);
    expect(definition.register).toContain(`"${MEASURED_SECTION}"`);
  });

  it("states the one-paragraph-per-employer rule the grouping depends on", () => {
    // `experienceGroups` opens a new employer group at every `paragraph` block.
    // A register that let a project heading be a paragraph would split one
    // employer into several groups, and the bullets under the second heading
    // would never be checked against the employer the heading does not name.
    expect(definition.register).toContain('exactly ONE block of kind "paragraph"');
    expect(definition.register).toContain("starts a new employer");
  });

  it("names every section it claims to write", () => {
    for (const key of ["summary", "skills", "experience", "certifications", "education", "self_pr"]) {
      expect(definition.register, `${key} is not named`).toContain(`"${key}"`);
    }
  });

  it("forbids converting the 資本金 figure, because the prompt converted it already", () => {
    // The rule is only safe in company with `capitalInJapanese`. Asserted here
    // so that removing the conversion from the prompt breaks a test naming the
    // register, rather than producing a 資本金 line a model divided by hand.
    expect(definition.register).toContain("never convert the yen figure yourself");
  });

  it("is the flat register, stated against the résumé rather than alone", () => {
    // S10's acceptance is a comparison — "not the impact-maximising register of
    // the English résumé, from the same underlying facts" — so the register
    // makes the comparison explicitly instead of hoping flatness is inferred.
    expect(definition.register).toContain("体言止め");
    expect(definition.register).toContain("English résumé");
    expect(RENDER_DEFINITIONS.english_resume.register).toContain("past-tense action verb");
  });

  it("puts a driving licence in 保有資格, which is where the résumé refuses it", () => {
    // The two registers contradict each other on purpose, and each says so.
    expect(definition.register).toContain("A driving licence DOES belong here");
    expect(RENDER_DEFINITIONS.english_resume.register).toContain(
      "A driving licence is not a technical certification",
    );
  });
});

describe("資本金, as a 職務経歴書 writes it", () => {
  it("writes a round 万 figure in 万円", () => {
    expect(capitalInJapanese(4_000_000)).toBe("400万円");
    expect(capitalInJapanese(10_000)).toBe("1万円");
    expect(capitalInJapanese(99_990_000)).toBe("9999万円");
  });

  it("writes 億 where 万 would run to five digits", () => {
    expect(capitalInJapanese(100_000_000)).toBe("1億円");
    expect(capitalInJapanese(150_000_000)).toBe("1億5000万円");
    expect(capitalInJapanese(30_000_000_000)).toBe("300億円");
  });

  it("writes a figure that does not divide into 万 out in full", () => {
    // Rounding a published capital figure to the nearest 万円 would be a
    // misstatement of a number a reader can look up, not a formatting choice.
    expect(capitalInJapanese(12_345)).toBe("12345円");
    expect(capitalInJapanese(4_000_001)).toBe("4000001円");
  });

  it("does not invent a reading for a figure that is not one", () => {
    expect(capitalInJapanese(0)).toBe("0円");
    expect(capitalInJapanese(-4_000_000)).toBe("-4000000円");
  });
});

describe("the 作成日", () => {
  it("is stamped on the 職務経歴書 and on nothing else", () => {
    // The 履歴書 is dated too, but stamps its own date into a template cell
    // rather than taking one from here. The English résumé is deliberately
    // undated: it is read months after it is written.
    const dated = RENDER_KINDS.filter(isDated);
    expect(dated).toEqual(["shokumu_keirekisho"]);
  });

  it("writes the date the way a Japanese document writes it", () => {
    // No leading zeros. The author's own 職務経歴書 is headed 2026年8月11日.
    expect(documentDate("shokumu_keirekisho", "2026-08-11")).toBe("2026年8月11日");
    expect(documentDate("shokumu_keirekisho", "2026-09-12")).toBe("2026年9月12日");
  });

  it("gives an undated kind nothing rather than a blank line", () => {
    expect(documentDate("english_resume", "2026-09-12")).toBeNull();
    expect(documentDate("rirekisho", "2026-09-12")).toBeNull();
  });
});

/**
 * The register describes a section shape in prose, and two instruments read
 * that shape. This asserts the shape the register asks for actually survives
 * both of them, on a document built the way the register says to build one.
 *
 * It is not a test of the model. It is a test that the instructions are
 * satisfiable — that a document obeying them groups one employer per group,
 * measures only its outcome bullets, and reports no attribution finding. The
 * failure it exists to catch is a register rewritten into a shape the readers
 * quietly return nothing for.
 */
const EMPLOYERS = [
  { id: "emp_a", names: ["架空商事株式会社"] },
  { id: "emp_b", names: ["有限会社山田製作所"] },
];

const block = (kind: string, text: string, factIds: string[] = []) => ({ kind, text, factIds });

/** One 職務経歴 section, written the way SHOKUMU_REGISTER says to write one. */
const SHOKUMU: RenderContent = {
  sections: [
    {
      key: "summary",
      heading: "経歴要約",
      blocks: [{ id: "blk_1", ...block("paragraph", "経歴の要約です。", ["fct_1"]) }],
    },
    {
      key: "experience",
      heading: "職務経歴",
      blocks: [
        // Employer A: heading, two copied rows, a project, its bullets, the stack.
        { id: "blk_2", ...block("paragraph", "架空商事株式会社　2024年10月〜2025年3月　フルスタック開発者") },
        { id: "blk_3", ...block("row", "事業内容：架空の受託開発。") },
        { id: "blk_4", ...block("row", "資本金：400万円　従業員数：12名") },
        { id: "blk_5", ...block("row", "プロジェクト：備品貸出システム") },
        { id: "blk_6", ...block("row", "技術的成果：") },
        { id: "blk_7", ...block("bullet", "社内向け備品貸出システムを単独で設計・実装", ["fct_1", "fct_2"]) },
        { id: "blk_8", ...block("row", "技術スタック：TypeScript、PostgreSQL", ["fct_2"]) },
        // Employer B: no projects, so its bullets sit under 主な実績.
        { id: "blk_9", ...block("paragraph", "有限会社山田製作所　2023年4月〜2024年9月") },
        { id: "blk_10", ...block("row", "主な実績：") },
        { id: "blk_11", ...block("bullet", "月次集計の所要時間を8分から30秒へ短縮", ["fct_3"]) },
      ],
    },
    {
      key: "education",
      heading: "学歴",
      blocks: [{ id: "blk_12", ...block("row", "架空大学　情報工学科　2016年4月入学〜2020年3月卒業") }],
    },
  ],
} as RenderContent;

const RECORD = {
  employers: EMPLOYERS,
  facts: [
    { id: "fct_1", employerId: "emp_a" },
    { id: "fct_2", employerId: "emp_a" },
    { id: "fct_3", employerId: "emp_b" },
  ],
};

describe("a document written the way the register says", () => {
  it("groups one employer per group, rows and all", () => {
    // The rows between the heading and the bullets must NOT split the group.
    // Only a second `paragraph` would, which is why the register forbids one.
    const groups = experienceGroups(SHOKUMU, EMPLOYERS);
    expect(groups.map((g) => g.employerId)).toEqual(["emp_a", "emp_b"]);
    expect(groups[0]!.blocks.map((b) => b.id)).toEqual([
      "blk_3",
      "blk_4",
      "blk_5",
      "blk_6",
      "blk_7",
      "blk_8",
    ]);
  });

  it("reports no attribution finding, and checks something while doing so", () => {
    // A report of nothing against nothing is not a pass, so the denominators
    // are asserted too.
    const report = checkAttribution(SHOKUMU, RECORD);
    expect(report.findings).toEqual([]);
    expect(report.groups).toBe(2);
    expect(report.resolvedGroups).toBe(2);
    expect(report.factReferencesChecked).toBeGreaterThan(0);
  });

  it("measures the outcome bullets and none of the rows", () => {
    // 事業内容, 資本金, the プロジェクト line, the labels and 技術スタック are
    // rows, so the mean length is the mean of the OUTCOMES rather than of the
    // scaffolding around them.
    const measured = measureBullets(experienceBullets(SHOKUMU));
    expect(measured.bullets).toBe(2);
    expect(measured.factReferences).toBe(3);
    expect(measured.multiFactBullets).toBe(1);
  });

  it("catches a fact placed under the wrong employer's heading", () => {
    // The invariant the structure exists to keep checkable. Without the
    // one-paragraph rule this finding would be an `unresolved-heading` instead,
    // and the misfiling would go unreported.
    const misfiled = {
      sections: SHOKUMU.sections.map((section) =>
        section.key !== "experience"
          ? section
          : {
              ...section,
              blocks: section.blocks.map((b) =>
                b.id === "blk_11" ? { ...b, factIds: ["fct_1"] } : b,
              ),
            },
      ),
    } as RenderContent;
    const report = checkAttribution(misfiled, RECORD);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toMatchObject({
      invariant: "misfiled-fact",
      blockId: "blk_11",
      factId: "fct_1",
      headingEmployerId: "emp_b",
      factEmployerId: "emp_a",
    });
  });
});
