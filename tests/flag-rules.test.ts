/**
 * What the importer's grade turns into: the label a fact is accepted with, and
 * the flags it carries (`src/pipeline/flags.ts`, issue #57).
 *
 * Pure, so every rule is stated here once and the API tests in `flags.test.ts`
 * only have to show the rules are applied. Every claim here is invented.
 */
import { describe, expect, it } from "vitest";
import { repeatFlag, sortFact, statesNumber } from "~/pipeline/flags";
import type { FactGrade } from "~/model/types";

const QUOTE = "The intake queue was moved onto a job runner.";
const fact = (claim: string, extra: Partial<{ quote: string | null; technologies: string[] }> = {}) => ({
  claim,
  quote: QUOTE as string | null,
  technologies: [] as string[],
  ...extra,
});
const grade = (extra: Partial<FactGrade> = {}): FactGrade => ({
  provenance: "attested",
  confidential: false,
  unsure: false,
  note: "",
  ...extra,
});
const kinds = (sorted: ReturnType<typeof sortFact>) => sorted.flags.map((flag) => flag.kind);

describe("a fact the importer graded plainly", () => {
  it("is accepted with that grade, Restricted, and carries no flag", () => {
    const sorted = sortFact(fact("Moved the intake queue onto a job runner"), grade());
    expect(sorted).toEqual({ provenance: "attested", disclosure: "restricted", isClientIdentifying: false, flags: [] });
  });

  it("is never Public, whatever the grade", () => {
    for (const provenance of ["measured", "attested", "generated"] as const) {
      expect(sortFact(fact("Moved the intake queue"), grade({ provenance })).disclosure).not.toBe("public");
    }
  });
});

describe("a confidential fact", () => {
  it("is kept Private and says which kind of identifier was found, never the identifier", () => {
    const sorted = sortFact(
      fact("Owned the escalation path", { quote: "Escalations went to desk-lead@vendor.example.invalid." }),
      grade(),
    );
    expect(sorted.disclosure).toBe("private");
    expect(sorted.isClientIdentifying).toBe(true);
    expect(sorted.flags).toEqual([
      {
        kind: "confidential",
        reason: "It contains what looks like an email address. It is kept Private and out of every document.",
      },
    ]);
    expect(sorted.flags[0]!.reason).not.toContain("desk-lead");
  });

  it("is kept Private on the importer's reading alone, with the importer's sentence as the reason", () => {
    const sorted = sortFact(
      fact("Rebuilt the settlement ledger for the client"),
      grade({ confidential: true, note: "It names a client's internal system" }),
    );
    expect(sorted.disclosure).toBe("private");
    expect(sorted.flags).toEqual([
      {
        kind: "confidential",
        reason:
          "The importer read it as confidential. It names a client's internal system. It is kept Private and out of every document.",
      },
    ]);
  });

  it("still has a reason when the importer gave none", () => {
    const [flag] = sortFact(fact("Rebuilt the ledger"), grade({ confidential: true })).flags;
    expect(flag!.reason).toBe(
      "The importer read it as naming a client, a person or an internal system. It is kept Private and out of every document.",
    );
  });

  it("stays Private when a shape matched and the importer read it as fine", () => {
    const sorted = sortFact(
      fact("Ran the batch host", { quote: "The scheduler ran on harbor-batch01.corp." }),
      grade({ confidential: false }),
    );
    expect(sorted.disclosure).toBe("private");
    expect(kinds(sorted)).toEqual(["confidential"]);
  });
});

describe("a fact the importer was unsure of", () => {
  it("is kept with its grade and flagged with the importer's sentence", () => {
    const sorted = sortFact(fact("Led the migration"), grade({ unsure: true, note: "The passage says the team did" }));
    expect(sorted.provenance).toBe("attested");
    expect(sorted.disclosure).toBe("restricted");
    expect(sorted.flags).toEqual([
      { kind: "unsure", reason: "The importer was not sure about it. The passage says the team did." },
    ]);
  });

  it("is flagged when graded Generated, and the reason says it stays out of documents", () => {
    const sorted = sortFact(fact("Improved morale"), grade({ provenance: "generated" }));
    expect(sorted.provenance).toBe("generated");
    expect(sorted.flags).toEqual([
      {
        kind: "unsure",
        reason:
          "The importer could not find it stated in the passage. It is kept as Generated and out of every document until you grade it.",
      },
    ]);
  });

  it("is kept as Generated and flagged when the importer returned no grade at all", () => {
    const sorted = sortFact(fact("Moved the intake queue"), null);
    expect(sorted.provenance).toBe("generated");
    expect(sorted.disclosure).toBe("restricted");
    expect(sorted.flags).toEqual([
      {
        kind: "unsure",
        reason: "The importer gave it no grade. It is kept as Generated and out of every document until you grade it.",
      },
    ]);
  });

  it("cannot be Measured without a passage, the rule the author is held to", () => {
    const sorted = sortFact(fact("Cut the build time", { quote: null }), grade({ provenance: "measured" }));
    expect(sorted.provenance).toBe("attested");
  });
});

describe("a claim that states a number", () => {
  it("is flagged and still usable", () => {
    const sorted = sortFact(fact("Cut the nightly run from 6 hours to 90 minutes"), grade({ provenance: "measured" }));
    expect(sorted.provenance).toBe("measured");
    expect(sorted.disclosure).toBe("restricted");
    expect(sorted.flags).toEqual([
      { kind: "number", reason: "It states a number. Check the number against the passage it was read from." },
    ]);
  });

  it("carries every flag that applies, the one that keeps it out of documents first", () => {
    const sorted = sortFact(
      fact("Cut the client's run by 40%"),
      grade({ confidential: true, unsure: true, note: "It names a client" }),
    );
    expect(kinds(sorted)).toEqual(["confidential", "number", "unsure"]);
  });

  const stated: [string, string, string[]][] = [
    ["a figure in digits", "Cut the run from 6 hours to 90 minutes", []],
    ["a percentage", "Raised coverage to 85%", []],
    ["full-width digits", "応答時間を３秒に短縮した", []],
    ["a figure in kanji with its counter", "五名のチームを率いた", []],
    ["a kanji ratio", "処理時間を三割削減した", []],
    ["a number beside a technology that also has one", "Moved 40 buckets to S3", ["S3"]],
  ];
  for (const [label, claim, technologies] of stated) {
    it(`reads ${label} as a number`, () => expect(statesNumber(claim, technologies)).toBe(true));
  }

  const notStated: [string, string, string[]][] = [
    ["a technology name with a digit in it", "Moved the archive to S3 and EC2", ["S3", "EC2"]],
    ["a versioned technology", "Upgraded the service to Java 17", ["Java 17"]],
    ["a technology named in another case", "Stored snapshots in s3", ["S3"]],
    ["a claim with no figure", "Introduced code review for the billing service", []],
    ["a kanji numeral that is part of a word", "一部の画面を再設計した", []],
  ];
  for (const [label, claim, technologies] of notStated) {
    it(`does not read ${label} as a number`, () => expect(statesNumber(claim, technologies)).toBe(false));
  }
});

describe("a likely repeat", () => {
  it("says a number differs when one does, and tells the author what to do either way", () => {
    expect(repeatFlag(false)).toEqual({
      kind: "repeat",
      reason:
        "It likely restates a fact already in your record. Open it to see both, and reject one if they say the same thing.",
    });
    expect(repeatFlag(true).reason).toContain("the number differs");
  });
});
