/**
 * The rules of an interview entry (`src/shared/interview.ts`, issue #72),
 * without a server or a screen: which entries move the status, which round a
 * new entry starts on, and how typed or pasted text becomes separate questions.
 * And what a corrected entry does to the status (issue #81).
 */
import { describe, expect, it } from "vitest";
import { defaultRound, questionsIn, standingAfterEdit, standingAfterInterview } from "~/shared/interview";
import type { Standing } from "~/shared/application";

describe("the standing after an interview entry", () => {
  const standing = (step: Standing["step"], closedAs: Standing["closedAs"] = null): Standing => ({
    step,
    closedAs,
    dates: { not_applied: "2026-02-01", [step]: "2026-02-02" },
  });

  it("is its round, when that round is later than the step it is at", () => {
    expect(standingAfterInterview(standing("applied"), "interview_1", "2026-02-10")).toMatchObject({
      step: "interview_1", dates: { interview_1: "2026-02-10" },
    });
    expect(standingAfterInterview(standing("not_applied"), "interview_final", "2026-02-10").step).toBe("interview_final");
    expect(standingAfterInterview(standing("interview_1"), "interview_2", "2026-02-10").step).toBe("interview_2");
  });

  it("fills an earlier skipped round once without moving the status", () => {
    const before = standing("interview_2");
    const filled = standingAfterInterview(before, "interview_1", "2026-02-10");
    expect(filled).toEqual({ ...before, dates: { ...before.dates, interview_1: "2026-02-10" } });
    expect(standingAfterInterview(filled, "interview_1", "2026-02-11")).toEqual(filled);
  });

  it("keeps dated rounds, Other conversation, and closed applications as they were", () => {
    const dated = standing("interview_2");
    expect(standingAfterInterview(dated, "interview_2", "2026-02-10")).toEqual(dated);
    expect(standingAfterInterview(standing("applied"), "other", "2026-02-10")).toEqual(standing("applied"));
    expect(standingAfterInterview(standing("applied", "rejected"), "interview_1", "2026-02-10")).toEqual(standing("applied", "rejected"));
    expect(standingAfterInterview(standing("interview_2", "withdrawn"), "interview_1", "2026-02-10")).toEqual(standing("interview_2", "withdrawn"));
  });
});

describe("the standing after an entry is corrected", () => {
  const at = (step: Standing["step"], dates: Standing["dates"], closedAs: Standing["closedAs"] = null): Standing => ({
    step,
    closedAs,
    dates: { not_applied: "2026-02-01", ...dates },
  });
  const first = (date: string) => ({ round: "interview_1" as const, date });

  it("moves the date of the entry's round with the entry's day", () => {
    const before = at("interview_2", { interview_1: "2026-02-10", interview_2: "2026-02-20" });
    expect(standingAfterEdit(before, first("2026-02-10"), first("2026-02-09"))).toEqual(
      at("interview_2", { interview_1: "2026-02-09", interview_2: "2026-02-20" }),
    );
  });

  it("leaves a date that is not the entry's old day, since the author set it", () => {
    const before = at("interview_1", { interview_1: "2026-02-12" });
    expect(standingAfterEdit(before, first("2026-02-10"), first("2026-02-09"))).toEqual(before);
  });

  it("does nothing when neither the round nor the day changed", () => {
    // Undone since: the entry's round is ahead of the status, and correcting its words must not move it again.
    const before = at("applied", { applied: "2026-02-02" });
    expect(standingAfterEdit(before, first("2026-02-10"), first("2026-02-10"))).toBe(before);
  });

  it("treats a changed round as a new entry would be: forward, a skipped date filled, never back", () => {
    const before = at("interview_1", { interview_1: "2026-02-10" });
    const later = standingAfterEdit(before, first("2026-02-10"), { round: "interview_final", date: "2026-02-18" });
    expect(later).toMatchObject({ step: "interview_final", dates: { interview_1: "2026-02-10", interview_final: "2026-02-18" } });

    const back = standingAfterEdit(later, { round: "interview_final", date: "2026-02-18" }, { round: "interview_2", date: "2026-02-15" });
    expect(back).toEqual({ ...later, dates: { ...later.dates, interview_2: "2026-02-15" } });
    expect(standingAfterEdit(later, { round: "interview_final", date: "2026-02-18" }, { round: "other", date: "2026-02-15" })).toBe(later);
  });

  it("moves to the round when the day is corrected on an entry ahead of the status", () => {
    const before = at("applied", { applied: "2026-02-02" });
    expect(standingAfterEdit(before, first("2026-02-10"), first("2026-02-09"))).toMatchObject({
      step: "interview_1",
      dates: { interview_1: "2026-02-09" },
    });
  });

  it("leaves a closed application alone", () => {
    const closed = at("interview_1", { interview_1: "2026-02-10", rejected: "2026-02-14" }, "rejected");
    expect(standingAfterEdit(closed, first("2026-02-10"), first("2026-02-09"))).toBe(closed);
  });
});

describe("the round a new entry starts on", () => {
  it("is the earliest round at or after the status that has no entry yet", () => {
    expect(defaultRound("applied", [])).toBe("interview_1");
    expect(defaultRound("applied", ["interview_1"])).toBe("interview_2");
    expect(defaultRound("interview_2", [])).toBe("interview_2");
    expect(defaultRound("interview_2", ["interview_1", "interview_2"])).toBe("interview_final");
    // A round before the status is behind it, entry or not.
    expect(defaultRound("interview_final", ["other"])).toBe("interview_final");
  });

  it("is a conversation that is not a round once none is left", () => {
    expect(defaultRound("interview_final", ["interview_final"])).toBe("other");
    expect(defaultRound("offer", [])).toBe("other");
  });
});

describe("the questions in typed or pasted text", () => {
  it("is one a line, in order, with empty lines left out", () => {
    expect(questionsIn("Why this team?\r\n\r\n  What would you change first?  \n")).toEqual([
      "Why this team?",
      "What would you change first?",
    ]);
    expect(questionsIn("   ")).toEqual([]);
  });

  it("drops a leading bullet or number, and nothing else", () => {
    expect(questionsIn("1. Why now?\n2) Why us?\n- What next?\n• And then?\n・ 志望動機は何ですか\n* Anything else?")).toEqual([
      "Why now?",
      "Why us?",
      "What next?",
      "And then?",
      "志望動機は何ですか",
      "Anything else?",
    ]);
    // A number that is part of the question stays.
    expect(questionsIn("3 years from now, where are you?")).toEqual(["3 years from now, where are you?"]);
    expect(questionsIn("What is 2.5 times your load today?")).toEqual(["What is 2.5 times your load today?"]);
    expect(questionsIn("3.5 years from now?\n3)years from now?")).toEqual(["3.5 years from now?", "3)years from now?"]);
    expect(questionsIn("-What does this flag do?\n*When should we retry?")).toEqual([
      "-What does this flag do?",
      "*When should we retry?",
    ]);
    expect(questionsIn("•And then?\n・志望動機は何ですか")).toEqual(["And then?", "志望動機は何ですか"]);
  });
});
