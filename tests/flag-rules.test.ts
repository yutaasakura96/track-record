/**
 * What the importer's grade turns into: the label a fact is accepted with, and
 * the flags it carries (`src/pipeline/flags.ts`, issue #57).
 *
 * Pure, so every rule is stated here once and the API tests in `flags.test.ts`
 * only have to show the rules are applied. Every claim here is invented.
 */
import { describe, expect, it } from "vitest";
import { repeatFlag, sortFact, unsourcedNumber } from "~/pipeline/flags";
import type { FactGrade } from "~/model/types";
import { DOCUMENTS } from "../scripts/demo-seed/documents";
import { CAPTURED } from "../scripts/demo-seed/fixture";

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

describe("a claim that states a number its passage does not", () => {
  it("is flagged and still usable", () => {
    const sorted = sortFact(fact("Cut the nightly run from 6 hours to 90 minutes"), grade({ provenance: "measured" }));
    expect(sorted.provenance).toBe("measured");
    expect(sorted.disclosure).toBe("restricted");
    expect(sorted.flags).toEqual([
      { kind: "number", reason: "It states a number the passage it was read from does not. Check where the number came from." },
    ]);
  });

  it("carries every flag that applies, the one that keeps it out of documents first", () => {
    const sorted = sortFact(
      fact("Cut the client's run by 40%"),
      grade({ confidential: true, unsure: true, note: "It names a client" }),
    );
    expect(kinds(sorted)).toEqual(["confidential", "number", "unsure"]);
  });

  it("is not flagged when its passage states the same number", () => {
    const sorted = sortFact(
      fact("Cut the nightly run from 6 hours to 90 minutes", { quote: "The nightly run went from 6 hours to 90 minutes." }),
      grade({ provenance: "measured" }),
    );
    expect(kinds(sorted)).toEqual([]);
  });

  const unsourced: [string, string, string | null, string[]][] = [
    ["a figure the passage does not have", "Raised coverage to 85%", "Coverage was raised across the service.", []],
    ["one figure of two missing", "Cut the run from 6 hours to 90 minutes", "The run took 6 hours before the change.", []],
    ["a number only inside a longer one", "Served 40 teams", "Served 140 teams.", []],
    ["a number only as a decimal's whole part", "Cut latency by 3 seconds", "Latency fell by 3.5 seconds.", []],
    ["a different scale", "Served 5 million users", "Served 5 users.", []],
    ["a word scale inserted before the unit", "Mentored five engineers", "Mentored five hundred engineers.", []],
    ["a word scale missing from the passage", "Mentored five hundred engineers", "Mentored five engineers.", []],
    ["a scale inserted before a numeric unit", "Served 5 users", "Served 5 million active users.", []],
    ["a different numeric scale", "Served 5 million users", "Served 5 billion active users.", []],
    ["a different unlisted next word", "Processed 5 tickets", "Processed 5 orders.", []],
    ["a number joined to a word", "Processed 5 tickets", "Processed 5tickets.", []],
    ["a year-shaped count with an unlisted word", "Processed 2023 tickets", "Processed tickets.", []],
    ["a year-shaped count with a listed word", "Mentored 2023 engineers", "Mentored engineers.", []],
    ["a rate denominator inside a longer number", "Resolved one in 5 reports", "Resolved one in 50 reports.", []],
    ["a bare number inside a percentage", "Handled 5", "Handled 5% of requests.", []],
    ["a complete unit inside a longer word", "Reached 50 percent", "Reached 50 percentage points.", []],
    ["a different word number", "Mentored five engineers", "Mentored fifteen engineers.", []],
    ["a kanji number inside another", "五名のチームを率いた", "十五名のチームを率いた。", []],
    ["a figure in kanji the passage writes another way", "処理時間を三割削減した", "処理時間を30%削減した。", []],
    ["a number beside a technology that also has one", "Moved 40 buckets to S3", "Moved the buckets to S3.", ["S3"]],
    ["an abbreviated scale", "Saved $2.5M", "Saved money.", []],
    ["an abbreviated scale before a unit", "Served 5M users", "Served users.", []],
    ["a thousands abbreviation", "Handled 10k requests", "Handled requests.", []],
    ["an abbreviated scale the passage writes in words", "Saved $2.5M", "Saved $2.5 million.", []],
    ["a percentage range", "Cut response time by 30-40%", "Cut response time.", []],
    ["a range of a count", "Grew the team from 5-10 engineers", "Grew the team.", []],
    ["one side of a range missing", "Grew the team from 5-10 engineers", "Grew the team from 5 engineers.", []],
    ["a word number inside a compound one", "Mentored five engineers", "Mentored twenty-five engineers.", []],
    ["a number inside a hyphenated name", "Treated 19 patients", "Treated COVID-19 patients.", []],
    ["a compound quantity", "Led a 5-person team", "Led a team.", []],
    ["a compound duration", "Built a 10-minute pipeline", "Built a pipeline.", []],
    ["a compound period", "Ran 2-week sprints", "Ran sprints.", []],
    ["a compound with a different word", "Led a 5-person team", "Led a 5-member team.", []],
    ["any figure, when there is no passage", "Led a team of 5 engineers", null, []],
    // Each case the #115 review named, the other way round too.
    ["a scale the claim adds", "Served 5 million users", "Served 5 users.", []],
    ["a word scale the passage adds", "Mentored five engineers", "Mentored five hundred engineers.", []],
    ["a rate's denominator the passage shortens", "Resolved one in 50 reports", "Resolved one in 5 reports.", []],
    ["a percentage the passage states as a bare number", "Handled 5%", "Handled 5 of the requests.", []],
    ["a kanji number the passage shortens", "十五名のチームを率いた", "五名のチームを率いた。", []],
    ["a counter of months the passage counts in countries", "3カ月で導入した", "3カ国で導入した。", []],
    ["a counter of countries the passage counts in months", "3カ国で導入した", "3カ月で導入した。", []],
    ["a different unit the other way", "Processed 5 orders", "Processed 5 tickets.", []],
    ["a year-shaped count the passage has as a year", "Processed 2023 tickets", "Processed tickets in 2023.", []],
    // What stays flagged because it is not the same quantity.
    ["a quantity-changing word before the unit", "Served 5 users", "Served 5 more users.", []],
    ["a modifier before a different unit", "Served 5 active users", "Served 5 active orders.", []],
    ["a scale written as a word in the claim and a letter in the passage", "Saved $2.5 million", "Saved $2.5M.", []],
    ["a currency sign the claim does not have", "Handled 5 requests", "Saved $5 requests.", []],
    ["a count the passage has only as a rate's denominator", "Resolved 5 reports", "Resolved one in 5 reports.", []],
    ["a hyphenated word that only starts the same", "Hired 5 full-time engineers", "Hired 5 full-stack engineers.", []],
    ["a kanji counter the passage spells as a longer one", "3人の作業", "3人月の作業。", []],
    ["a kanji number inside a longer one, before its counter", "五名のチームを率いた", "五十名のチームを率いた。", []],
    ["a word number followed by a modifier and its unit", "Mentored five senior engineers", "Mentored senior engineers.", []],
    ["a kanji count of countries", "三カ国で展開した", "展開した。", []],
    ["a sign after the number", "Grew to 5+ teams", "Grew to 5 teams.", []],
    ["daily scope against monthly scope", "Served 5 daily users", "Served 5 monthly users.", []],
    ["monthly scope against daily scope", "Served 5 monthly users", "Served 5 daily users.", []],
    ["unique scope against new scope", "Served 5 unique users", "Served 5 new users.", []],
    ["new scope against unique scope", "Served 5 new users", "Served 5 unique users.", []],
    ["a word number with a daily scope", "Served five daily users", "Served five monthly users.", []],
    ["a word number with a monthly scope", "Served five monthly users", "Served five daily users.", []],
    ["a concurrent scope", "Served 5 concurrent users", "Served 5 users.", []],
    ["a concurrent scope in the passage", "Served 5 users", "Served 5 concurrent users.", []],
    ["a monthly rate against a yearly rate", "Served 5 users per month", "Served 5 users per year.", []],
    ["a yearly rate against a monthly rate", "Served 5 users per year", "Served 5 users per month.", []],
    ["a daily rate absent from the passage", "Served 5 users a day", "Served 5 users.", []],
    ["a daily rate absent from the claim", "Served 5 users", "Served 5 users a day.", []],
    ["a word number with a different rate", "Served five users per month", "Served five users per year.", []],
    ["a word number with the opposite rate", "Served five users per year", "Served five users per month.", []],
    ["a bare monthly rate against a yearly rate", "Served 5 per month", "Served 5 per year.", []],
    ["a bare yearly rate against a monthly rate", "Served 5 per year", "Served 5 per month.", []],
    ["a slash rate against another", "Served 5 users/month", "Served 5 users/year.", []],
    ["the opposite slash rate", "Served 5 users/year", "Served 5 users/month.", []],
    ["a Japanese monthly rate against a yearly rate", "5件毎月処理した", "5件毎年処理した。", []],
    ["a Japanese yearly rate against a monthly rate", "5件毎年処理した", "5件毎月処理した。", []],
    ["a Japanese month period absent from the passage", "5件月間処理した", "5件処理した。", []],
    ["a Japanese month period absent from the claim", "5件処理した", "5件月間処理した。", []],
    ["requests per user against per server", "Handled 5 requests per user", "Handled 5 requests per server.", []],
    ["requests per server against per user", "Handled 5 requests per server", "Handled 5 requests per user.", []],
    ["monthly users against daily users", "Served 5 users monthly", "Served 5 users daily.", []],
    ["daily users against monthly users", "Served 5 users daily", "Served 5 users monthly.", []],
    ["a count found only in a word ratio", "Resolved 5 reports", "Resolved two in 5 reports.", []],
    ["a count found only in a digit ratio", "Resolved 5 reports", "Resolved 2 of 5 reports.", []],
    ["a word ratio missing from the passage", "Resolved two in 5 reports", "Resolved 5 reports.", []],
    ["a digit ratio missing from the passage", "Resolved 2 of 5 reports", "Resolved 5 reports.", []],
    ["a word ratio against a different denominator", "Resolved two in 5 reports", "Resolved two in 50 reports.", []],
    ["a digit ratio against a different denominator", "Resolved 2 of 5 reports", "Resolved 2 of 50 reports.", []],
    ["a Japanese daily divisor against monthly", "Handled 5件/日", "Handled 5件/月.", []],
    ["a Japanese monthly divisor against daily", "Handled 5件/月", "Handled 5件/日.", []],
    ["a percentage of users against revenue", "Reached 5% of users", "Reached 5% of revenue.", []],
    ["a percentage of revenue against users", "Reached 5% of revenue", "Reached 5% of users.", []],
    ["a percentage qualifier absent from the passage", "Reached 5% of users", "Reached 5%.", []],
    ["a percentage qualifier absent from the claim", "Reached 5%", "Reached 5% of users.", []],
    ["a count found only in an out-of ratio", "Resolved 5 reports", "Resolved 3 out of 5 reports.", []],
    ["a word count found only in an out-of ratio", "Resolved 5 reports", "Resolved three out of 5 reports.", []],
    ["an out-of ratio absent from the passage", "Resolved 3 out of 5 reports", "Resolved 5 reports.", []],
    ["an out-of ratio with a different denominator", "Resolved 3 out of 5 reports", "Resolved 3 out of 50 reports.", []],
    // A ratio is one figure: neither of its numbers sources a plain count.
    ["a count found only as a slash ratio's denominator", "Resolved 5 reports", "Resolved 2/5 reports.", []],
    ["a count found only as a slash ratio's numerator", "Resolved 2 reports", "Resolved 2/5 reports.", []],
    ["a slash ratio missing from the passage", "Resolved 2/5 reports", "Resolved 5 reports.", []],
    ["a slash ratio against a different denominator", "Resolved 2/5 reports", "Resolved 2/50 reports.", []],
    ["a bare count found only as a word ratio's numerator", "Resolved one", "Resolved one in 5 reports.", []],
    ["a count found only as a word ratio's numerator", "Resolved two reports", "Resolved two in 5 reports.", []],
    ["a count found only as an out-of ratio's numerator", "Resolved 3 reports", "Resolved 3 out of 5 reports.", []],
    // A bound after a counter is part of the quantity.
    ["a Japanese lower bound against an upper bound", "5件以上を処理した", "5件以下を処理した。", []],
    ["a Japanese upper bound against a lower bound", "5件以下を処理した", "5件以上を処理した。", []],
    ["a Japanese lower bound absent from the passage", "5件以上を処理した", "5件を処理した。", []],
    ["a Japanese lower bound absent from the claim", "5件を処理した", "5件以上を処理した。", []],
    // Every other word before the unit is held to the passage.
    ["a different word before the same unit", "Wrote 5 clinic reports", "Wrote 5 hospital reports.", []],
    ["the other different word before the same unit", "Wrote 5 hospital reports", "Wrote 5 clinic reports.", []],
    ["a word before the unit the passage never uses", "Wrote 5 clinic reports", "Wrote 5 reports.", []],
    ["a word the passage adds before the unit", "Wrote 5 reports", "Wrote 5 clinic reports.", []],
    ["a word the passage adds before a word number's unit", "Mentored five engineers", "Mentored five platform engineers.", []],
    ["a percentage of all users against all revenue", "Reached 5% of all users", "Reached 5% of all revenue.", []],
    ["a percentage of all revenue against all users", "Reached 5% of all revenue", "Reached 5% of all users.", []],
    ["a percentage of all clinic reports against revenue", "Reached 5% of all clinic reports", "Reached 5% of all clinic revenue.", []],
    ["a percentage of all clinic revenue against reports", "Reached 5% of all clinic revenue", "Reached 5% of all clinic reports.", []],
    ["a percentage with a different attached rate", "Reached 5% of all clinic reports per month", "Reached 5% of all clinic reports per year.", []],
    ["a separate count in the passage", "Wrote 5 reports", "Wrote 5 separate reports.", []],
    ["a descriptive word the passage adds before a period", "Stayed clean for 21 days", "Stayed clean for 21 consecutive days.", []],
    ["a descriptive word before a bare rate the passage never uses", "Hired 5 within a year", "Hired 5 a year.", []],
    ["a descriptive word the passage adds before a bare rate", "Hired 5 a year", "We hired 5 within a year.", []],
  ];
  for (const [label, claim, quote, technologies] of unsourced) {
    it(`flags ${label}`, () => expect(unsourcedNumber(claim, quote, technologies)).toBe(true));
  }

  const sourced: [string, string, string | null, string[]][] = [
    ["a figure the passage states", "Raised coverage to 85%", "Coverage rose to 85% by spring.", []],
    ["a figure the passage writes with a thousands comma", "Served 1200 users", "It served 1,200 users.", []],
    ["a full-width thousands comma", "Served １，２００ users", "It served 1,200 users.", []],
    ["full-width digits against half-width", "応答時間を３秒に短縮した", "応答時間を3秒に短縮した。", []],
    ["a figure in kanji the passage also has", "五名のチームを率いた", "五名のチームを率いた。", []],
    ["a figure in words the passage also has", "Mentored five engineers", "I mentored five engineers.", []],
    ["a scaled figure in words", "Mentored five hundred engineers", "I mentored five hundred engineers.", []],
    ["an unlisted next word", "Processed 5 tickets", "Processed 5 tickets in total.", []],
    ["a sourced year-shaped count", "Processed 2023 tickets", "Processed 2023 tickets in total.", []],
    ["a matching scale", "Served 5 million users", "The service reached 5 million users.", []],
    ["a matching rate", "Resolved one in 5 reports", "We resolved one in 5 reports.", []],
    ["a matching bare number", "Handled 5", "Handled 5.", []],
    ["a matching kanji number in context", "五名のチームを率いた", "当時は五名のチームを率いた。", []],
    ["a digit inside a word", "Used K8s for deployment", "Deployment changed.", []],
    ["a version", "Upgraded to version 3.12.1", "Upgraded the service.", []],
    ["a year alone, absent from the passage", "Gave a talk on queue design in 2023", "Gave a talk on queue design.", []],
    ["a year alone, with no passage", "Gave a talk on queue design in 2023", null, []],
    ["a year with its 年, absent from the passage", "2023年に社内勉強会で登壇した", "社内勉強会で登壇した。", []],
    ["a technology name with a digit in it", "Moved the archive to S3 and EC2", "Moved the archive.", ["S3", "EC2"]],
    ["a versioned technology", "Upgraded the service to Java 17", "Upgraded the service.", ["Java 17"]],
    ["an abbreviated scale the passage states", "Saved $2.5M", "We saved $2.5M.", []],
    ["a thousands abbreviation the passage states", "Handled 10k requests", "It handled 10k requests.", []],
    ["a range the passage states", "Cut response time by 30-40%", "Response time fell by 30-40% overall.", []],
    ["a count range the passage states", "Grew the team from 5-10 engineers", "The team grew from 5-10 engineers.", []],
    ["digits inside names and words", "Enabled 2FA on EC2 and K8s", "Enabled sign-in checks.", []],
    ["a compound quantity the passage states", "Led a 5-person team", "I led a 5-person team.", []],
    ["a compound duration the passage states", "Ran 24-hour on-call", "We ran 24-hour on-call.", []],
    ["a number joined to a name by a hyphen", "Deployed to prd-01", "Deployed the service.", []],
    ["a number inside a hyphenated name in the claim", "Treated COVID-19 patients", "Treated patients.", []],
    ["a claim with no figure", "Introduced code review for the billing service", null, []],
    ["a kanji numeral that is part of a word", "一部の画面を再設計した", "画面を再設計した。", []],
    // A plain descriptive word may stand between a number and its unit, on either side.
    ["a scaled figure the passage gives a modifier", "Served 5 million users", "The service reached 5 million active users.", []],
    ["a scaled figure with a modifier the passage leaves out", "Served 5 million active users", "The service reached 5 million users.", []],
    ["a word figure the passage gives a modifier", "Mentored five engineers", "Mentored five senior engineers.", []],
    ["a numeric figure the passage gives a modifier", "Served 5 users", "The service reached 5 active users.", []],
    ["a word figure with its modifier in both", "Mentored five senior engineers", "I mentored five senior engineers.", []],
    ["a counter of countries the passage states", "3カ国で導入した", "3カ国で導入した。", []],
    ["a counter of months the passage states", "3カ月で導入した", "期間は3カ月で導入した。", []],
    ["a kanji counter the passage follows with more kanji", "3名のチームを率いた", "3名体制のチームを率いた。", []],
    ["a scale in kanji before its counter", "3万人が利用した", "3万人が利用した。", []],
    ["a sign after the number the passage states", "Grew to 5+ teams", "Grew to 5+ teams.", []],
    ["the same monthly rate", "Served 5 users per month", "Served 5 users per month.", []],
    ["the same daily rate", "Served 5 users a day", "Served 5 users a day.", []],
    ["the same bare rate", "Served 5 per month", "Served 5 per month.", []],
    ["the same slash rate", "Served 5 users/month", "Served 5 users/month.", []],
    ["the same Japanese monthly rate", "5件毎月処理した", "5件毎月処理した。", []],
    ["the same Japanese month period", "5件月間処理した", "5件月間処理した。", []],
    ["the same per-user rate", "Handled 5 requests per user", "Handled 5 requests per user.", []],
    ["the same monthly suffix", "Served 5 users monthly", "Served 5 users monthly.", []],
    ["the same word ratio", "Resolved two in 5 reports", "Resolved two in 5 reports.", []],
    ["the same digit ratio", "Resolved 2 of 5 reports", "Resolved 2 of 5 reports.", []],
    ["the same Japanese divisor", "Handled 5件/日", "Handled 5件/日.", []],
    ["the same percentage qualifier", "Reached 5% of users", "Reached 5% of users.", []],
    ["the same bare percentage with an adverb", "Reached 5%", "Reached 5% overall.", []],
    ["the same out-of ratio", "Resolved 3 out of 5 reports", "Resolved 3 out of 5 reports.", []],
    ["the same word out-of ratio", "Resolved three out of 5 reports", "Resolved three out of 5 reports.", []],
    ["a quantity followed by different predicates", "5 engineers built APIs", "5 engineers maintained APIs.", []],
    ["the opposite predicate direction", "5 engineers maintained APIs", "5 engineers built APIs.", []],
    ["the same slash ratio", "Resolved 2/5 reports", "Resolved 2/5 reports.", []],
    ["the same Japanese lower bound", "5件以上を処理した", "5件以上を処理した。", []],
    ["the same Japanese upper bound", "5件以下を処理した", "5件以下を処理した。", []],
    ["a word before the unit the passage uses elsewhere", "Wrote 5 clinic reports", "For the clinic, I wrote 5 reports.", []],
    ["the same word before the unit", "Wrote 5 clinic reports", "Wrote 5 clinic reports.", []],
    ["the same percentage of all users", "Reached 5% of all users", "Reached 5% of all users.", []],
    ["the same percentage of all clinic reports", "Reached 5% of all clinic reports per month", "Reached 5% of all clinic reports per month.", []],
    ["a percentage of users against active users", "Reached 5% of users", "Reached 5% of active users.", []],
    ["a percentage of active users against users", "Reached 5% of active users", "Reached 5% of users.", []],
    ["a percentage of all active users against all users", "Reached 5% of all active users", "Reached 5% of all users.", []],
    ["a percentage of all users against all active users", "Reached 5% of all users", "Reached 5% of all active users.", []],
  ];
  for (const [label, claim, quote, technologies] of sourced) {
    it(`does not flag ${label}`, () => expect(unsourcedNumber(claim, quote, technologies)).toBe(false));
  }

  it("keeps the demo record's cited quantities off the attention list", () => {
    const claims = [
      "Wrote the runbook and trained two on-call engineers to take over the service",
      "Led a team of three building a fraud rules engine the risk team could edit without a deploy",
      "Reduced the chargeback rate from 0.42% to 0.18% over two quarters",
      "The engine evaluates about 1,200 payments per second at peak with 18 ms p99 latency",
      "Led the five-engineer checkout squad as tech lead",
      "Set a 170 KB checkout bundle budget enforced in CI",
      "Reduced mobile checkout abandonment from 31% to 22%, valued at about ¥140 million in annual GMV",
      "Built an offline search evaluation set from six months of logs, labelled by click-through and purchase",
      "Moved search ranking to learning-to-rank, raising search conversion by 9% in a four-week A/B test",
      "Twelve teams adopted the design system within a year",
      "Led a team of four migrating the platform from hand-managed VMs to Azure Kubernetes Service",
      "Moved the booking API behind a traffic split, sending 5% of requests to the new cluster first",
      "Moved all 23 services to AKS over nine months with no unplanned downtime",
      "Defined the first five clinic reports with the operations team at Sakura Family Clinic",
    ];
    const candidates = DOCUMENTS.flatMap((document) => document.candidates);
    for (const claim of claims) {
      const candidate = candidates.find((entry) => entry.claim === claim);
      expect(candidate, claim).toBeDefined();
      expect(unsourcedNumber(claim, candidate!.quote, candidate!.technologies), claim).toBe(false);
    }
    for (const claim of [
      "Co-founded the frontend guild and led the replacement of three component libraries with one design system",
      "Ran a three-phase migration: six weeks of dual-write, a nightly comparison job, and cut-over after 21 clean days",
    ]) {
      const candidate = candidates.find((entry) => entry.claim === claim);
      expect(candidate, claim).toBeDefined();
      expect(unsourcedNumber(claim, candidate!.quote, candidate!.technologies), claim).toBe(true);
    }
    expect(unsourcedNumber(CAPTURED[0]!.claim, null, CAPTURED[0]!.technologies)).toBe(true);
  });
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
