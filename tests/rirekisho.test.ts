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
  MOTIVATION_NOTICE,
  TAILORED_MOTIVATION_NOTICE,
  gapWarnings,
  rirekishoTemplateData,
  rirekishoWarnings,
  submissionStamp,
  tokyoToday,
  unexplainedGaps,
  explainedGaps,
  type RirekishoProfile,
  type RirekishoRecord,
} from "~/render/rirekisho";
import { RENDER_DEFINITIONS } from "~/render/spec";
import type { RenderContent } from "~/shared/render-content";
import { PHOTO_NOTICE } from "~/shared/photo";
import { gapLabelEn, gapLabelJa } from "~/shared/career-gap";
import { pngPhoto } from "./helpers/photo";

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
    { name: "Kakuu Certificate", nameJa: "架空技術者試験", issuedOn: "2094-06-01", expiresOn: null },
  ],
  gapNotes: [],
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
    expect(filled.shokureki.map((r) => r.text)).toEqual([
      "架空株式会社　架空業　架空職として入社",
      "現在に至る",
    ]);
    expect(filled.shikaku.map((r) => r.text)).toEqual(["架空技術者試験　合格"]);
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
    expect(gaps).toEqual([{ after: "2096-06", before: "2096-10", from: "2096-07", to: "2096-09", months: GAP_MONTHS }]);
  });

  it("names the months nobody covers, in Japanese and in English, and never blocks", () => {
    // A job left in 2096-01 and the next begun in 2096-07: February to June
    // are the gap, and the warning says so rather than naming the months
    // either side of it (issue #117, review §5 G3).
    const warnings = gapWarnings({
      educations: [],
      employers: [span("2093-04-01", "2096-01-01"), span("2096-07-01", null)],
    });
    expect(warnings).toEqual([
      "2096年2月〜6月（5か月）は、学歴・職歴のどの行にも含まれていません。 February–June 2096 (5 months) is covered by no 学歴・職歴 entry.",
    ]);
  });

  it("writes the year again only when the gap crosses one", () => {
    const [gap] = unexplainedGaps({
      educations: [],
      employers: [span("2093-04-01", "2094-10-01"), span("2095-03-01", null)],
    });
    expect(gapLabelJa(gap!)).toBe("2094年11月〜2095年2月（4か月）");
    expect(gapLabelEn(gap!)).toBe("November 2094–February 2095 (4 months)");
  });

  it("stops warning about a gap the author has explained, and only that one", () => {
    const record = {
      educations: [],
      employers: [span("2093-04-01", "2094-03-01"), span("2095-04-01", "2096-01-01"), span("2096-07-01", null)],
    };
    const note = { fromOn: "2094-04-01", toOn: "2095-03-01", text: "資格取得のため学習" };
    expect(unexplainedGaps({ ...record, gapNotes: [note] }).map((g) => g.from)).toEqual(["2096-02"]);
    expect(explainedGaps({ ...record, gapNotes: [note] }).map((e) => e.note)).toEqual([note]);
    expect(gapWarnings({ ...record, gapNotes: [note] })).toHaveLength(1);
  });

  it("does not count a note whose months are no longer the gap's", () => {
    const record = { educations: [], employers: [span("2093-04-01", "2094-03-01"), span("2095-04-01", null)] };
    // One month off at either end is a different gap: its months are printed.
    for (const note of [
      { fromOn: "2094-05-01", toOn: "2095-03-01", text: "資格取得のため学習" },
      { fromOn: "2094-04-01", toOn: "2095-02-01", text: "資格取得のため学習" },
    ]) {
      expect(unexplainedGaps({ ...record, gapNotes: [note] })).toHaveLength(1);
      expect(explainedGaps({ ...record, gapNotes: [note] })).toEqual([]);
    }
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

/**
 * The ※ row (issue #117, review §5 G2): doda's note under the 退社 line,
 * 「※2020年2月〜2020年6月　資格取得のため学習」, with the 年 and 月 cells empty.
 */
describe("an explained gap in 学歴・職歴", () => {
  const JOB_GAP: RirekishoRecord = {
    ...RECORD,
    employers: [
      { ...RECORD.employers[0]!, endedOn: "2096-01-01", leavingReasonJa: "一身上の都合により" },
      { nameJa: "架空商事株式会社", industryJa: null, shokushuJa: null, startedOn: "2096-07-01", endedOn: null, leavingReasonJa: null },
    ],
    gapNotes: [{ fromOn: "2096-02-01", toOn: "2096-06-01", text: "資格取得のため学習" }],
  };

  it("is a row under the 退社 line, its months in its text and its date cells empty", () => {
    expect(data({ record: JOB_GAP }).shokureki).toEqual([
      { year: "2093", month: "4", text: "架空株式会社　架空業　架空職として入社" },
      { year: "2096", month: "1", text: "一身上の都合により退社" },
      { year: "", month: "", text: "※2096年2月〜2096年6月　資格取得のため学習" },
      { year: "2096", month: "7", text: "架空商事株式会社　入社" },
      { year: "", month: "", text: "現在に至る" },
    ]);
  });

  it("goes under the 卒業 row in 学歴 when the gap follows schooling", () => {
    const record: RirekishoRecord = {
      ...RECORD,
      employers: [{ ...RECORD.employers[0]!, startedOn: "2094-04-01" }],
      gapNotes: [{ fromOn: "2093-04-01", toOn: "2094-03-01", text: "就職活動" }],
    };
    const filled = data({ record });
    expect(filled.gakureki.map((r) => r.text).slice(-2)).toEqual(["架空大学　架空学部　卒業", "※2093年4月〜2094年3月　就職活動"]);
    expect(filled.shokureki.some((r) => r.text.startsWith("※"))).toBe(false);
  });

  it("is not printed once its months are no longer the gap's", () => {
    const moved = { ...JOB_GAP, gapNotes: [{ fromOn: "2096-03-01", toOn: "2096-06-01", text: "資格取得のため学習" }] };
    expect(data({ record: moved }).shokureki.some((r) => r.text.startsWith("※"))).toBe(false);
  });

  it("reaches the .docx", () => {
    const document = new PizZip(buildRirekisho({ profile: PROFILE, record: JOB_GAP, submittedOn: SUBMITTED, content: null }))
      .file("word/document.xml")!
      .asText();
    expect(document).toContain("※2096年2月〜2096年6月　資格取得のため学習");
  });
});

describe("the spec", () => {
  it("blocks generation on the fields §4 names", () => {
    expect(RENDER_DEFINITIONS.rirekisho.requiredProfileFields).toEqual([
      ...REQUIRED_PROFILE_FIELDS,
    ]);
  });

  it("is buildable, and its register is not empty", () => {
    // This asserted the refusal until 2026-09-11: `buildable` was false and the
    // register was `""`, and the pair was the guard against spending a
    // generation on an empty prompt. The flip does not retire the guard, it
    // inverts it — the two must move together, in either direction.
    expect(RENDER_DEFINITIONS.rirekisho.buildable).toBe(true);
    expect(RENDER_DEFINITIONS.rirekisho.register.trim()).not.toBe("");
  });

  it("writes the two prose cells and claims nothing else", () => {
    const register = RENDER_DEFINITIONS.rirekisho.register;
    // Both keys the reader looks under, and the refusal that keeps a 志望動機
    // from being written against a company the record does not hold.
    expect(register).toContain('"motivation"');
    expect(register).toContain('"kibou"');
    expect(register).toContain("do not write a 志望動機");
    // The conventional 本人希望欄 wording, so an unstated preference is a
    // correct cell rather than an empty one.
    expect(register).toContain("貴社規定に従います。");
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

describe("the 写真 (issue #117)", () => {
  const record = {
    educations: [{ startedOn: "2093-04-01", endedOn: "2094-03-01" }],
    employers: [{ startedOn: "2095-04-01", endedOn: null }],
  };

  it("says the cell is empty, in the owner's words and after everything else, only while there is no photo", () => {
    const without = rirekishoWarnings(record, { hasPhoto: false });
    expect(without.at(-1)).toBe("写真欄は空欄です。必要な場合はWordで貼付してください");
    expect(without.at(-1)).toBe(PHOTO_NOTICE);
    expect(without.at(-2)).toBe(MOTIVATION_NOTICE);
    expect(rirekishoWarnings(record, { hasPhoto: true })).not.toContain(PHOTO_NOTICE);
  });

  it("says a tailored 履歴書's 志望動機 is drafted when the application holds no reason, and says nothing when it does", () => {
    // Whatever the record's gaps say comes first, as on the main 履歴書.
    const gaps = rirekishoWarnings(record, { hasPhoto: true }).filter((w) => w !== MOTIVATION_NOTICE);
    expect(rirekishoWarnings(record, { hasPhoto: true, tailored: { motivationNote: null } })).toEqual([...gaps, TAILORED_MOTIVATION_NOTICE]);
    expect(rirekishoWarnings(record, { hasPhoto: true, tailored: { motivationNote: "  " } })).toEqual([...gaps, TAILORED_MOTIVATION_NOTICE]);
    expect(rirekishoWarnings(record, { hasPhoto: true, tailored: { motivationNote: "決済に関わり続けたいからです。" } })).toEqual(gaps);
    // Once nothing is left drafted the notice has nothing to say; while a part is, or before one exists, it does.
    expect(rirekishoWarnings(record, { hasPhoto: true, tailored: { motivationNote: null, drafted: false } })).toEqual(gaps);
    expect(rirekishoWarnings(record, { hasPhoto: true, tailored: { motivationNote: null, drafted: true } })).toEqual([...gaps, TAILORED_MOTIVATION_NOTICE]);
    // The photo notice applies to a tailored one as to the main one.
    expect(rirekishoWarnings(record, { hasPhoto: false, tailored: { motivationNote: "理由" } })).toEqual([...gaps, PHOTO_NOTICE]);
  });

  it("is placed by the whole chain when the inputs carry one, and only then", () => {
    const inputs = { profile: PROFILE, record: RECORD, submittedOn: SUBMITTED, content: null };
    const media = (bytes: Uint8Array) => new PizZip(bytes).file(/word\/media\//).map((file) => file.name);
    expect(media(buildRirekisho(inputs))).toEqual([]);
    expect(media(buildRirekisho({ ...inputs, photo: { bytes: pngPhoto(300, 400), type: "image/png" } }))).toEqual(["word/media/photo.png"]);
  });
});
