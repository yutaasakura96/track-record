/**
 * The 履歴書 derived rows.
 *
 * `docs/04-database-schema.md` §4 is the contract; this file is what holds the
 * render to it. The rules under test are the ones whose breach is **invisible
 * to the author and obvious to a Japanese reader** (`docs/03` §12): a
 * withdrawal printed as a graduation, a 免許・資格 row that stops at the name,
 * a 退社 row with the reason trailing, a record silently dropped for having no
 * entry month.
 *
 * Every value below is invented and visibly so. None of it comes from the
 * author's record or from `local/`.
 */
import { describe, expect, it } from "vitest";
import {
  educationRows,
  employmentRows,
  rirekishoTables,
  shikakuRows,
  type RirekishoCertification,
  type RirekishoEducation,
  type RirekishoEmployer,
} from "~/render/rirekisho-rows";

const SEP = "　";

function education(over: Partial<RirekishoEducation> = {}): RirekishoEducation {
  return {
    institution: "架空大学",
    institutionJa: null,
    faculty: null,
    startedOn: "2085-04-01",
    endedOn: "2089-03-01",
    outcome: "graduated",
    level: "tertiary",
    ...over,
  };
}

function employer(over: Partial<RirekishoEmployer> = {}): RirekishoEmployer {
  return {
    nameJa: "架空株式会社",
    industryJa: "架空製造業",
    shokushuJa: "架空技術者",
    startedOn: "2089-04-01",
    endedOn: "2095-03-01",
    leavingReasonJa: "一身上の都合により",
    ...over,
  };
}

function certification(over: Partial<RirekishoCertification> = {}): RirekishoCertification {
  return { name: "Kakuu Engineer", nameJa: null, issuedOn: "2090-06-01", ...over };
}

const texts = (rows: { text: string }[]) => rows.map((r) => r.text);

describe("学歴 rows", () => {
  it("emits two rows per record — 入学 from the start, the outcome verb from the end", () => {
    expect(educationRows([education()])).toEqual([
      { year: "2085", month: "4", text: `架空大学${SEP}入学` },
      { year: "2089", month: "3", text: `架空大学${SEP}卒業` },
    ]);
  });

  it.each([
    ["graduated", "卒業"],
    ["completed", "修了"],
    ["withdrawn", "中退"],
  ] as const)("closes a %s record with %s", (outcome, verb) => {
    const rows = educationRows([education({ outcome })]);
    expect(rows[1]?.text).toBe(`架空大学${SEP}${verb}`);
  });

  /**
   * The misrepresentation this column exists to prevent. A 中退 printed as 卒業
   * is a false statement on a signed document, not a formatting slip.
   */
  it("never prints a withdrawal as a graduation", () => {
    expect(texts(educationRows([education({ outcome: "withdrawn" })]))).not.toContain(
      `架空大学${SEP}卒業`,
    );
  });

  it("appends the faculty to both rows", () => {
    const rows = educationRows([education({ faculty: "架空情報学科" })]);
    expect(texts(rows)).toEqual([
      `架空大学${SEP}架空情報学科${SEP}入学`,
      `架空大学${SEP}架空情報学科${SEP}卒業`,
    ]);
  });

  it("prefers the Japanese institution name where the record holds one", () => {
    const rows = educationRows([education({ institutionJa: "架空日本語大学" })]);
    expect(rows[0]?.text).toBe(`架空日本語大学${SEP}入学`);
  });

  /**
   * The live rule (`docs/04` §4). The English résumé cannot exercise it — its
   * register drops every entry below university level — so this is the only
   * place it is held. A record the author holds only as a completion month
   * contributes its closing row and is not dropped.
   */
  it("gives a record with no start month its closing row alone", () => {
    const rows = educationRows([
      education({ institution: "架空中学校", startedOn: null, endedOn: "2081-03-01" }),
    ]);
    expect(rows).toEqual([{ year: "2081", month: "3", text: `架空中学校${SEP}卒業` }]);
  });

  /**
   * The mirror case: an unfinished course has an entry and no completion. Its
   * `endedOn` is an expectation rather than an event, so it prints no closing
   * row — and the 入学 row says so.
   */
  it("marks an unfinished course 在学中 and closes nothing", () => {
    const rows = educationRows([
      education({ outcome: "expected", startedOn: "2098-09-01", endedOn: "2102-09-01" }),
    ]);
    expect(rows).toEqual([{ year: "2098", month: "9", text: `架空大学${SEP}入学（在学中）` }]);
  });

  it("orders records ascending regardless of the order given", () => {
    const rows = educationRows([
      education({ institution: "架空大学", startedOn: "2085-04-01", endedOn: "2089-03-01" }),
      education({
        institution: "架空高等学校",
        startedOn: "2082-04-01",
        endedOn: "2085-03-01",
      }),
    ]);
    expect(rows.map((r) => `${r.year}-${r.month}`)).toEqual([
      "2082-4",
      "2085-3",
      "2085-4",
      "2089-3",
    ]);
  });
});

describe("職歴 rows", () => {
  it("opens with employer, industry and the entry 職種", () => {
    const rows = employmentRows([employer()]);
    expect(rows[0]).toEqual({
      year: "2089",
      month: "4",
      text: `架空株式会社${SEP}架空製造業${SEP}架空技術者として入社`,
    });
  });

  it("omits an industry the record does not hold", () => {
    const rows = employmentRows([employer({ industryJa: null })]);
    expect(rows[0]?.text).toBe(`架空株式会社${SEP}架空技術者として入社`);
  });

  it("falls back to a bare 入社 when no 職種 is recorded", () => {
    const rows = employmentRows([employer({ shokushuJa: null })]);
    expect(rows[0]?.text).toBe(`架空株式会社${SEP}架空製造業${SEP}入社`);
  });

  /** The reason comes FIRST (`docs/04` §4) — trailing it is the common error. */
  it("leads the 退社 row with the reason", () => {
    const rows = employmentRows([employer()]);
    expect(rows[1]).toEqual({
      year: "2095",
      month: "3",
      text: "一身上の都合により架空株式会社を退社",
    });
  });

  /**
   * `一身上の都合により` asserts a voluntary departure. Supplying it as a
   * default would state that about a contract that simply ended, on a document
   * that is signed.
   */
  it("invents no reason when the record holds none", () => {
    const rows = employmentRows([employer({ leavingReasonJa: null })]);
    expect(rows[1]?.text).toBe("架空株式会社を退社");
  });

  it("gives the current employer no 退社 row", () => {
    const rows = employmentRows([employer({ endedOn: null })]);
    expect(rows).toHaveLength(1);
    expect(texts(rows).join()).not.toContain("退社");
  });

  /**
   * The table is a chronology, not a grouping. Two overlapping employments
   * interleave — the second 入社 falls before the first 退社.
   */
  it("interleaves overlapping employments by date rather than grouping them", () => {
    const rows = employmentRows([
      employer({ nameJa: "架空一社", startedOn: "2089-04-01", endedOn: "2096-04-01" }),
      employer({ nameJa: "架空二社", startedOn: "2095-05-01", endedOn: "2099-03-01" }),
    ]);
    expect(texts(rows)).toEqual([
      `架空一社${SEP}架空製造業${SEP}架空技術者として入社`,
      `架空二社${SEP}架空製造業${SEP}架空技術者として入社`,
      "一身上の都合により架空一社を退社",
      "一身上の都合により架空二社を退社",
    ]);
  });
});

describe("免許・資格 rows", () => {
  /** A row that stops at the name is the failure `docs/03` §12 describes. */
  it("ends a certification row in 取得", () => {
    expect(shikakuRows([certification()])).toEqual([
      { year: "2090", month: "6", text: `Kakuu Engineer${SEP}取得` },
    ]);
  });

  it("prefers the Japanese certification name where the record holds one", () => {
    const rows = shikakuRows([certification({ nameJa: "架空技術者試験" })]);
    expect(rows[0]?.text).toBe(`架空技術者試験${SEP}取得`);
  });

  /** The table is dated by construction (`docs/04` §4). */
  it("omits a certification with no issue date", () => {
    expect(shikakuRows([certification({ issuedOn: null })])).toEqual([]);
  });

  /**
   * A completed non-degree course is a credential, and the 履歴書 prints it
   * here rather than in 学歴 (`docs/06`, 2026-09-06). 修了 is the verb for a
   * course; 取得 is for an examination or a licence.
   */
  it("prints a finished vocational course here, ending in 修了", () => {
    const course = education({
      institution: "架空ウェブ講習",
      faculty: "架空開発課程",
      level: "vocational",
      outcome: "completed",
      startedOn: "2090-07-01",
      endedOn: "2090-08-01",
    });
    expect(shikakuRows([], [course])).toEqual([
      { year: "2090", month: "8", text: `架空ウェブ講習${SEP}架空開発課程${SEP}修了` },
    ]);
    expect(educationRows([course])).toEqual([]);
  });

  /** 免許・資格 lists what is held. An unfinished course is chronology. */
  it("leaves an unfinished vocational course in 学歴", () => {
    const course = education({
      institution: "架空ウェブ講習",
      level: "vocational",
      outcome: "withdrawn",
      startedOn: "2090-07-01",
      endedOn: "2090-08-01",
    });
    expect(shikakuRows([], [course])).toEqual([]);
    expect(texts(educationRows([course]))).toEqual([
      `架空ウェブ講習${SEP}入学`,
      `架空ウェブ講習${SEP}中退`,
    ]);
  });

  it("merges courses and certifications into one ascending list", () => {
    const rows = shikakuRows(
      [certification({ nameJa: "架空後試験", issuedOn: "2092-01-01" })],
      [
        education({
          institution: "架空講習",
          level: "vocational",
          outcome: "completed",
          startedOn: "2090-07-01",
          endedOn: "2090-08-01",
        }),
      ],
    );
    expect(texts(rows)).toEqual([`架空講習${SEP}修了`, `架空後試験${SEP}取得`]);
  });
});

describe("the three tables together", () => {
  const record = {
    educations: [
      education({ institution: "架空中学校", startedOn: null, endedOn: "2081-03-01" }),
      education({
        institution: "架空講習",
        level: "vocational",
        outcome: "completed",
        startedOn: "2090-07-01",
        endedOn: "2090-08-01",
      }),
      education(),
      education({ outcome: "expected", startedOn: "2098-09-01", endedOn: "2102-09-01" }),
    ],
    employers: [employer()],
    certifications: [certification()],
  };

  /**
   * The template already carries the column headers, the centred 学歴 and 職歴
   * bands and the closing 以上. A render that emitted them would print them
   * twice.
   */
  it("emits no furniture the template already holds", () => {
    const tables = rirekishoTables(record);
    const all = [...tables.gakureki, ...tables.shokureki, ...tables.shikaku];
    for (const banned of ["以上", "学歴", "職歴", "年", "月", "免許・資格"]) {
      expect(texts(all)).not.toContain(banned);
    }
  });

  /**
   * Every row ends in a verb. The name alone is not a row (`docs/04` §4).
   * `入学（在学中）` is the one row that closes on a bracket, and it closes on a
   * bracket around a state rather than trailing off after a name — so it is
   * listed here explicitly rather than admitted by a loose pattern.
   */
  it("ends every row in a verb", () => {
    const tables = rirekishoTables(record);
    const all = [...tables.gakureki, ...tables.shokureki, ...tables.shikaku];
    expect(texts(all)).toContain(`架空大学${SEP}入学（在学中）`);
    for (const { text } of all) {
      expect(text).toMatch(/(入学（在学中）|入学|卒業|修了|中退|入社|退社|取得)$/);
    }
  });

  /**
   * Calendar columns are month precision with the day pinned to `01`, and the
   * day is never rendered (CLAUDE.md). The month carries no leading zero.
   */
  it("renders the month without a leading zero and never the day", () => {
    const tables = rirekishoTables({
      ...record,
      certifications: [certification({ issuedOn: "2090-06-01" })],
    });
    const all = [...tables.gakureki, ...tables.shokureki, ...tables.shikaku];
    for (const { year, month, text } of all) {
      expect(year).toMatch(/^\d{4}$/);
      expect(month).toMatch(/^([1-9]|1[0-2])$/);
      expect(text).not.toContain("01");
    }
  });
});
