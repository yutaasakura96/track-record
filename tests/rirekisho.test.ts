/**
 * The 履歴書 assembly — everything between the record and the filled template
 * that is neither a placeholder (`rirekisho-template.test.ts`) nor a row
 * (`rirekisho-rows.test.ts`).
 *
 * `docs/04-database-schema.md` §4 is the contract. **Every value below is
 * invented** — 架空 throughout — and none of it is sampled from `local/`.
 */
import { describe, expect, it } from "vitest";
import PizZip from "pizzip";
import {
  GAP_MONTHS,
  PROSE_SECTION_KEYS,
  REQUIRED_PROFILE_FIELDS,
  ageOn,
  buildRirekisho,
  gapWarnings,
  rirekishoTemplateData,
  submissionStamp,
  tokyoToday,
  unexplainedGaps,
  type RirekishoProfile,
  type RirekishoRecord,
} from "~/render/rirekisho";
import { RENDER_DEFINITIONS } from "~/render/spec";
import type { RenderContent } from "~/shared/render-content";

const PROFILE: RirekishoProfile = {
  familyNameKanji: "架空",
  givenNameKanji: "花子",
  familyNameKana: "かくう",
  givenNameKana: "はなこ",
  dateOfBirth: "2070-05-20",
  gender: "女",
  phone: "000-0000-0000",
  email: "kakuu@example.invalid",
  postalCode: "000-0000",
  address: "架空県架空市架空町1-2-3\n架空マンション404号室",
  addressKana: "かくうけん かくうし",
  contactSameAsAddress: true,
  contactPostalCode: null,
  contactAddress: null,
};

const RECORD: RirekishoRecord = {
  educations: [
    {
      institution: "Kakuu High School",
      institutionJa: "架空高等学校",
      faculty: null,
      startedOn: "2086-04-01",
      endedOn: "2089-03-01",
      outcome: "graduated",
      level: "secondary_upper",
    },
    {
      institution: "Kakuu University",
      institutionJa: "架空大学",
      faculty: "架空学部",
      startedOn: "2089-04-01",
      endedOn: "2093-03-01",
      outcome: "graduated",
      level: "tertiary",
    },
  ],
  employers: [
    {
      nameJa: "架空株式会社",
      industryJa: "架空業",
      shokushuJa: "架空職",
      startedOn: "2093-04-01",
      endedOn: null,
      leavingReasonJa: null,
    },
  ],
  certifications: [
    { name: "Kakuu Certificate", nameJa: "架空技術者試験", issuedOn: "2094-06-01" },
  ],
};

const SUBMITTED = "2099-04-01";

const data = (over: Partial<Parameters<typeof rirekishoTemplateData>[0]> = {}) =>
  rirekishoTemplateData({
    profile: PROFILE,
    record: RECORD,
    submittedOn: SUBMITTED,
    ...over,
  });

describe("満N歳", () => {
  it("is computed against the submission date, not stored", () => {
    // Birthday still to come in the submission year.
    expect(ageOn("2070-05-20", "2099-04-01")).toBe(28);
    // Same year, after the birthday.
    expect(ageOn("2070-05-20", "2099-06-01")).toBe(29);
  });

  it("increments on the birthday itself", () => {
    expect(ageOn("2070-05-20", "2099-05-19")).toBe(28);
    expect(ageOn("2070-05-20", "2099-05-20")).toBe(29);
  });

  it("holds a 29 February birth back until 1 March in a common year", () => {
    expect(ageOn("2072-02-29", "2099-02-28")).toBe(26);
    expect(ageOn("2072-02-29", "2099-03-01")).toBe(27);
  });
});

describe("the submission date", () => {
  it("is stamped in Tokyo, not in the Worker's UTC", () => {
    // 15:30Z on the 9th is 00:30 on the 10th in Japan. A UTC stamp would put
    // yesterday's date on the document for nine hours of every day.
    expect(tokyoToday(new Date("2099-04-09T15:30:00Z"))).toBe("2099-04-10");
    expect(tokyoToday(new Date("2099-04-09T14:30:00Z"))).toBe("2099-04-09");
  });

  it("prints 年 / 月 / 日 without leading zeros", () => {
    expect(submissionStamp("2099-04-01")).toEqual({
      submitYear: "2099",
      submitMonth: "4",
      submitDay: "1",
    });
  });
});

describe("the identity block", () => {
  it("takes the conventional block from the profile row", () => {
    const filled = data();
    expect(filled.nameKanji).toBe("架空　花子");
    expect(filled.nameKana).toBe("かくう　はなこ");
    expect(filled.birthYear).toBe("2070");
    expect(filled.birthMonth).toBe("5");
    expect(filled.birthDay).toBe("20");
    expect(filled.age).toBe("28");
    expect(filled.gender).toBe("女");
    expect(filled.phone).toBe("000-0000-0000");
    expect(filled.email).toBe("kakuu@example.invalid");
    expect(filled.postalCode).toBe("000-0000");
    expect(filled.addressKana).toBe("かくうけん かくうし");
  });

  it("joins the name with an ideographic space, not an ASCII one", () => {
    expect(data().nameKanji).toContain("　");
    expect(data().nameKana).toContain("　");
  });

  it("keeps the address's second line, which the template turns into one", () => {
    expect(data().address).toContain("\n");
  });

  it("renders 同上 for a contact address that repeats the current one", () => {
    const filled = data();
    expect(filled.contactLine).toBe("同上");
    // The 〒 beside 同上 is left empty rather than repeated.
    expect(filled.contactPostalCode).toBe("");
  });

  it("prints a separate contact address when there is one", () => {
    const filled = data({
      profile: {
        ...PROFILE,
        contactSameAsAddress: false,
        contactPostalCode: "999-9999",
        contactAddress: "架空県架空郡架空村9-9-9",
      },
    });
    expect(filled.contactLine).toBe("架空県架空郡架空村9-9-9");
    expect(filled.contactPostalCode).toBe("999-9999");
  });

  it("leaves 性別 empty rather than guessing one", () => {
    expect(data({ profile: { ...PROFILE, gender: null } }).gender).toBe("");
  });
});

describe("the prose blocks", () => {
  const content: RenderContent = {
    sections: [
      {
        key: PROSE_SECTION_KEYS.motivation,
        heading: "志望動機",
        blocks: [
          { id: "b1", kind: "paragraph", text: "架空の志望動機です。", factIds: [] },
          { id: "b2", kind: "paragraph", text: "架空の特技です。", factIds: [] },
        ],
      },
      {
        key: PROSE_SECTION_KEYS.kibou,
        heading: "本人希望欄",
        blocks: [{ id: "b3", kind: "paragraph", text: "架空の希望です。", factIds: [] }],
      },
    ],
  };

  it("reads the two generated sections by key", () => {
    const filled = data({ content });
    expect(filled.motivation).toBe("架空の志望動機です。\n架空の特技です。");
    expect(filled.kibou).toBe("架空の希望です。");
  });

  it("renders an empty cell when nothing has been generated", () => {
    const filled = data({ content: null });
    expect(filled.motivation).toBe("");
    expect(filled.kibou).toBe("");
  });
});

describe("the three tables", () => {
  it("arrive derived, ascending, and with no template furniture", () => {
    const filled = data();
    expect(filled.gakureki.map((r) => r.text)).toEqual([
      "架空高等学校　入学",
      "架空高等学校　卒業",
      "架空大学　架空学部　入学",
      "架空大学　架空学部　卒業",
    ]);
    expect(filled.shokureki.map((r) => r.text)).toEqual(["架空株式会社　架空業　架空職として入社"]);
    expect(filled.shikaku.map((r) => r.text)).toEqual(["架空技術者試験　取得"]);
    expect(filled.gakureki.every((r) => r.text !== "以上")).toBe(true);
  });
});

describe("the unexplained-gap warning", () => {
  const span = (startedOn: string | null, endedOn: string | null) => ({ startedOn, endedOn });

  it("does not warn about a 3月 finish followed by a 4月 start", () => {
    expect(
      unexplainedGaps({
        educations: [span("2089-04-01", "2093-03-01")],
        employers: [span("2093-04-01", null)],
      }),
    ).toEqual([]);
  });

  it("does not warn about an ordinary two-month job change", () => {
    expect(
      unexplainedGaps({
        educations: [],
        employers: [span("2093-04-01", "2096-06-01"), span("2096-09-01", null)],
      }),
    ).toEqual([]);
  });

  it("warns once the uncovered stretch reaches the threshold", () => {
    const gaps = unexplainedGaps({
      educations: [],
      employers: [span("2093-04-01", "2096-06-01"), span("2096-10-01", null)],
    });
    expect(gaps).toEqual([{ after: "2096-06", before: "2096-10", months: GAP_MONTHS }]);
  });

  it("says how long the gap is and never blocks", () => {
    const warnings = gapWarnings({
      educations: [],
      employers: [span("2093-04-01", "2094-03-01"), span("2095-04-01", null)],
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("2094-03");
    expect(warnings[0]).toContain("2095-04");
    expect(warnings[0]).toContain("12");
  });

  it("treats two overlapping employments as one covered stretch", () => {
    expect(
      unexplainedGaps({
        educations: [],
        employers: [
          span("2093-04-01", "2096-06-01"),
          span("2095-01-01", "2096-08-01"),
          span("2096-09-01", null),
        ],
      }),
    ).toEqual([]);
  });

  it("treats an entry with no end as covering everything after it", () => {
    expect(
      unexplainedGaps({
        educations: [span("2089-04-01", null)],
        employers: [span("2099-04-01", null)],
      }),
    ).toEqual([]);
  });

  it("reads a record held only as a finishing month as a point in time", () => {
    // The null-`started_on` row: it covers its own month and nothing before it,
    // and the stretch before the first entry is not a gap.
    expect(
      unexplainedGaps({
        educations: [span(null, "2086-03-01")],
        employers: [span("2086-04-01", null)],
      }),
    ).toEqual([]);
  });
});

describe("the spec", () => {
  it("blocks generation on the fields §4 names", () => {
    expect(RENDER_DEFINITIONS.rirekisho.requiredProfileFields).toEqual([
      ...REQUIRED_PROFILE_FIELDS,
    ]);
  });

  it("is not buildable until the register is written", () => {
    // The register is the one part a model does. Flipping `buildable` before it
    // exists would let a generation be spent on an empty prompt.
    expect(RENDER_DEFINITIONS.rirekisho.register).toBe("");
    expect(RENDER_DEFINITIONS.rirekisho.buildable).toBe(false);
  });
});

describe("the whole chain", () => {
  it("fills the committed template and yields a .docx", () => {
    const bytes = buildRirekisho({
      profile: PROFILE,
      record: RECORD,
      submittedOn: SUBMITTED,
      content: null,
    });
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);

    const document = new PizZip(bytes).file("word/document.xml")!.asText();
    expect(document).toContain("架空　花子");
    expect(document).toContain("架空大学　架空学部　卒業");
    // Every placeholder is consumed: none survives into the output.
    expect(document).not.toMatch(/\{[a-zA-Z#/]/);
  });
});
