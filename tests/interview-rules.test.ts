/**
 * The rules of an interview entry (`src/shared/interview.ts`, issue #72),
 * without a server or a screen: which entries move the status, which round a
 * new entry starts on, and how typed or pasted text becomes separate questions.
 */
import { describe, expect, it } from "vitest";
import { defaultRound, newestFirst, questionsIn, stepFor } from "~/shared/interview";

describe("the step an entry moves the application to", () => {
  it("is its round, when that round is later than the step it is at", () => {
    expect(stepFor({ step: "applied", closedAs: null }, "interview_1")).toBe("interview_1");
    expect(stepFor({ step: "not_applied", closedAs: null }, "interview_final")).toBe("interview_final");
    expect(stepFor({ step: "interview_1", closedAs: null }, "interview_2")).toBe("interview_2");
  });

  it("is none for a round at or before the step, a conversation that is not a round, or a closed application", () => {
    expect(stepFor({ step: "interview_2", closedAs: null }, "interview_2")).toBeNull();
    expect(stepFor({ step: "interview_final", closedAs: null }, "interview_1")).toBeNull();
    expect(stepFor({ step: "offer", closedAs: null }, "interview_final")).toBeNull();
    expect(stepFor({ step: "applied", closedAs: null }, "other")).toBeNull();
    expect(stepFor({ step: "applied", closedAs: "rejected" }, "interview_1")).toBeNull();
    expect(stepFor({ step: "applied", closedAs: "withdrawn" }, "interview_final")).toBeNull();
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
  });
});

describe("the order entries are shown in", () => {
  it("is newest day first, and of two on one day the one noted later first", () => {
    const entries = [
      { id: "a", date: "2026-02-20", createdAt: "2026-02-20T03:00:00.000Z" },
      { id: "b", date: "2026-02-27", createdAt: "2026-02-27T03:00:00.000Z" },
      { id: "c", date: "2026-02-20", createdAt: "2026-03-01T03:00:00.000Z" },
    ];
    expect(newestFirst(entries).map((entry) => entry.id)).toEqual(["b", "c", "a"]);
  });
});
