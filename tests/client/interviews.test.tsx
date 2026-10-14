/**
 * The Interviews panel of one application
 * (`docs/10-screen-specifications.md`, Screen 13; issue #72).
 *
 * What it can get wrong without looking wrong: questions sent as one string
 * instead of separate items, or in another order; the question still in the
 * field dropped on save; a status move said as a plain save, or an Undo that
 * takes the entry with it; a correction that sends a kept question without its
 * id, so it comes back as another one; a delete made without being asked.
 * Each test states the one write a click made and what it carried.
 *
 * The stubbed server answers with the same rules the real one uses
 * (`~/shared/application`, `~/shared/interview`). All fixtures are invented.
 */
import { describe, expect, it } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import type { Application, InterviewCorrection, InterviewFields } from "~/client/api";
import { figures, type Standing } from "~/shared/application";
import { standingAfterEdit, standingAfterInterview, type Interview } from "~/shared/interview";
import { mount, Refusal, type Call, type Routes } from "./harness";

const TODAY = "2026-10-10";
const ID = "app-test-fernhill";
const AT = `/api/applications/${ID}`;

/** At the second interview, last changed eight days ago. */
const FERNHILL: Standing = {
  step: "interview_2",
  closedAs: null,
  dates: {
    not_applied: "2026-09-01",
    applied: "2026-09-03",
    resume_passed: "2026-09-12",
    interview_1: "2026-09-24",
    interview_2: "2026-10-02",
  },
};

const FIRST: Interview = {
  id: "int-test-first",
  date: "2026-09-24",
  round: "interview_1",
  who: "Engineering manager and one senior engineer",
  howItWent: "Friendly and fast. Mostly about the fleet scheduler.",
  questions: [
    { id: "ivq-test-1", text: "What would you measure first on a service you inherit?" },
    { id: "ivq-test-2", text: "Tell us about an outage you caused." },
  ],
  recordings: [],
};
const SECOND: Interview = {
  id: "int-test-second",
  date: "2026-10-02",
  round: "interview_2",
  who: "",
  howItWent: "",
  questions: [{ id: "ivq-test-3", text: "Why robotics?" }],
  recordings: [],
};

const application = (standing: Standing, lastActivityOn: string, interviews: Interview[]): Application => ({
  id: ID,
  company: "Fernhill Robotics",
  position: "Senior Backend Engineer",
  postingUrl: null,
  lastActivityAt: `${lastActivityOn}T03:00:00.000Z`,
  ...standing,
  ...figures(standing, lastActivityOn, TODAY),
  requirements: [],
  jobDescription: "Senior backend engineer for the fernhill warehouse fleet.",
  documents: [],
  choices: [],
  sentCopies: [],
  canGenerate: true,
  interviews,
  today: TODAY,
});

/**
 * One application behind a server that keeps its standing and its entries: an
 * entry for a later round moves the status, a corrected day moves its step's
 * date, and a deleted entry is gone, as the real routes do.
 */
function open(start: Standing = FERNHILL, entries: Interview[] = [SECOND, FIRST], routes: Routes = {}) {
  let standing = start;
  let interviews = entries;
  let changedOn = "2026-10-02";
  return mount(`/applications/${ID}`, {
    "GET /api/applications": { items: [], today: TODAY },
    "GET /api/imports/summary": { openCandidates: 0, openFlags: 0, running: false },
    [`GET ${AT}`]: () => application(standing, changedOn, interviews),
    [`POST ${AT}/interviews`]: ({ body }: Call) => {
      const entry = body as InterviewFields;
      standing = standingAfterInterview(standing, entry.round, entry.date);
      changedOn = TODAY;
      interviews = [
        {
          id: `int-test-${interviews.length + 1}`,
          date: entry.date,
          round: entry.round,
          who: entry.who,
          howItWent: entry.howItWent,
          questions: entry.questions.map((text, index) => ({ id: `ivq-test-new-${index}`, text })),
          recordings: [],
        },
        ...interviews,
      ];
      return application(standing, changedOn, interviews);
    },
    [`PUT ${AT}/standing`]: ({ body }: Call) => {
      standing = body as Standing;
      return application(standing, TODAY, interviews);
    },
    ...Object.fromEntries(
      entries.flatMap((saved) => [
        [
          `PUT ${AT}/interviews/${saved.id}`,
          ({ body }: Call) => {
            const entry = body as InterviewCorrection;
            standing = standingAfterEdit(standing, saved, entry, interviews.some((item) =>
              item.id !== saved.id && item.round === saved.round && item.date === saved.date,
            ));
            changedOn = TODAY;
            interviews = interviews.map((item) =>
              item.id === saved.id
                ? { ...item, ...entry, questions: entry.questions.map((question, index) => ({ id: question.id ?? `ivq-test-new-${index}`, text: question.text })) }
                : item,
            );
            return application(standing, changedOn, interviews);
          },
        ],
        [
          `DELETE ${AT}/interviews/${saved.id}`,
          () => {
            changedOn = TODAY;
            interviews = interviews.filter((item) => item.id !== saved.id);
            return application(standing, changedOn, interviews);
          },
        ],
      ]),
    ),
    ...routes,
  });
}

const panel = async () => (await screen.findByRole("heading", { name: "Interviews" })).closest("section")!;
const openForm = async (user: ReturnType<typeof open>["user"]) => {
  await user.click(await screen.findByRole("button", { name: "Add an interview" }));
  return screen.getByRole("heading", { name: "New interview" }).parentElement!;
};

describe("the interview entries of an application", () => {
  it("shows one card an entry in the order the server gives, each with its questions numbered", async () => {
    open();
    const cards = within(await panel()).getAllByRole("listitem").filter((item) => item.querySelector("h3"));

    expect(cards.map((card) => card.querySelector("h3")!.textContent)).toEqual(["Second interview", "First interview"]);
    expect(within(cards[1]!).getByText("2026-09-24")).toBeTruthy();
    expect(within(cards[1]!).getByText("with Engineering manager and one senior engineer")).toBeTruthy();
    expect(within(cards[1]!).getByText("Friendly and fast. Mostly about the fleet scheduler.")).toBeTruthy();
    expect(
      within(within(cards[1]!).getByRole("list"))
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["What would you measure first on a service you inherit?", "Tell us about an outage you caused."]);
    // Nobody named, nothing written about how it went: neither line is drawn.
    expect(cards[0]!.textContent).toBe("Second interview2026-10-02EditDeleteQuestions askedWhy robotics?Attach a recording");
  });

  it("says what to note when there are none, and what to do next at an interview step", async () => {
    open(FERNHILL, []);
    expect(
      within(await panel()).getByText(
        "None yet. After each one, note the date, who you spoke with, how it went and the questions they asked.",
      ),
    ).toBeTruthy();
    expect(screen.getByText(/after the next interview, add how it went while you still remember it\./)).toBeTruthy();
  });
});

describe("the form for a new interview", () => {
  it("opens on today and on the earliest round at or after the status that has no entry yet", async () => {
    const { user } = open();
    const form = await openForm(user);

    expect((within(form).getByLabelText("Date") as HTMLInputElement).value).toBe(TODAY);
    expect((within(form).getByLabelText("Date") as HTMLInputElement).max).toBe(TODAY);
    // First and second have entries, so it is the final one.
    expect((within(form).getByLabelText("Round") as HTMLInputElement).value).toBe("interview_final");
    expect(within(form).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "First interview",
      "Second interview",
      "Final interview",
      "Other conversation",
    ]);
    // While it is open there is nothing to open.
    expect(screen.queryByRole("button", { name: "Add an interview" })).toBeNull();
  });

  it("opens on Other conversation once every round from the status on has an entry", async () => {
    const { user } = open({ ...FERNHILL, step: "offer", dates: { ...FERNHILL.dates, offer: "2026-10-08" } });
    const form = await openForm(user);
    expect((within(form).getByLabelText("Round") as HTMLInputElement).value).toBe("other");
  });

  it("takes questions one at a time, several pasted lines at once, and lets one be removed", async () => {
    const { api, user } = open();
    const form = await openForm(user);
    const field = within(form).getByLabelText("A question they asked") as HTMLInputElement;

    await user.type(field, "How do you roll back a bad release?{Enter}");
    expect(field.value).toBe("");
    await user.type(field, "What is your notice period?");
    await user.click(within(form).getByRole("button", { name: "Add" }));
    await user.click(field);
    await user.paste("1. Design a job queue for 2,000 robots\n\n- Where does it fall over first?\n・ Who would you page?");

    const typed = () =>
      within(within(form).getByRole("list"))
        .getAllByRole("listitem")
        .map((item) => item.textContent!.replace(/\s*Remove$/, ""));
    expect(typed()).toEqual([
      "How do you roll back a bad release?",
      "What is your notice period?",
      "Design a job queue for 2,000 robots",
      "Where does it fall over first?",
      "Who would you page?",
    ]);

    await user.click(within(form).getByRole("button", { name: "Remove question 2" }));
    expect(typed()).toHaveLength(4);

    // A pasted list follows what was being typed.
    await user.type(field, "Half a question");
    await user.paste("Why now?\nWhy us?");
    expect(typed().slice(4)).toEqual(["Half a question", "Why now?", "Why us?"]);
    expect(field.value).toBe("");
    // Nothing is written until it is saved.
    expect(api.writes()).toEqual([]);
    await user.type(within(form).getByLabelText("How it went"), "A useful discussion.");
    await user.click(within(form).getByRole("button", { name: "Save interview" }));
    expect(api.bodyOf("POST", `${AT}/interviews`)).toMatchObject({
      questions: [
        "How do you roll back a bad release?",
        "Design a job queue for 2,000 robots",
        "Where does it fall over first?",
        "Who would you page?",
        "Half a question",
        "Why now?",
        "Why us?",
      ],
    });
  });

  it("saves the entry with one write, its questions as separate items in order, the one still in the field among them", async () => {
    const { api, user } = open();
    const form = await openForm(user);

    fireEvent.change(within(form).getByLabelText("Date"), { target: { value: "2026-10-09" } });
    await user.selectOptions(within(form).getByLabelText("Round"), "Second interview");
    await user.type(within(form).getByLabelText("Who you spoke with"), "The VP of engineering");
    await user.type(within(form).getByLabelText("How it went"), "Slower than the first.");
    const field = within(form).getByLabelText("A question they asked");
    await user.type(field, "How do you roll back a bad release?{Enter}");
    await user.type(field, "What is your notice period?");
    await user.click(within(form).getByRole("button", { name: "Save interview" }));

    // The round it is already at: saved, and the status left alone.
    expect((await screen.findByRole("status")).textContent).toBe("Interview saved.");
    expect(api.writes()).toEqual([`POST ${AT}/interviews`]);
    expect(api.bodyOf("POST", `${AT}/interviews`)).toEqual({
      date: "2026-10-09",
      round: "interview_2",
      who: "The VP of engineering",
      howItWent: "Slower than the first.",
      questions: ["How do you roll back a bad release?", "What is your notice period?"],
    });
    expect(screen.queryByRole("heading", { name: "New interview" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
    expect(within(await panel()).getByText("with The VP of engineering")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add an interview" })).toBeTruthy();
  });

  it("writes nothing for an entry with neither how it went nor a question, and says what it needs", async () => {
    const { api, user } = open();
    const form = await openForm(user);
    await user.type(within(form).getByLabelText("Who you spoke with"), "The VP of engineering");
    await user.click(within(form).getByRole("button", { name: "Save interview" }));

    expect(within(form).getByRole("alert").textContent).toBe("Write how it went, or add at least one question.");
    expect(api.writes()).toEqual([]);
  });

  it("refuses an empty date instead of replacing it with today", async () => {
    const { api, user } = open();
    const form = await openForm(user);
    fireEvent.change(within(form).getByLabelText("Date"), { target: { value: "" } });
    await user.type(within(form).getByLabelText("How it went"), "A useful discussion.");
    await user.click(within(form).getByRole("button", { name: "Save interview" }));

    expect(within(form).getByRole("alert").textContent).toBe("Give the interview a date.");
    expect(api.writes()).toEqual([]);
  });

  it("keeps what was typed and shows the server's words when it is refused", async () => {
    const { user } = open(FERNHILL, [], {
      [`POST ${AT}/interviews`]: new Refusal(422, "validation_failed", "A date cannot be in the future."),
    });
    const form = await openForm(user);
    await user.type(within(form).getByLabelText("How it went"), "Slower than the first.");
    await user.click(within(form).getByRole("button", { name: "Save interview" }));

    expect((await within(form).findByRole("alert")).textContent).toBe("A date cannot be in the future.");
    expect((within(form).getByLabelText("How it went") as HTMLTextAreaElement).value).toBe("Slower than the first.");
  });

  it("closes without a write on Cancel", async () => {
    const { api, user } = open();
    const form = await openForm(user);
    await user.type(within(form).getByLabelText("How it went"), "Slower than the first.");
    await user.click(within(form).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("heading", { name: "New interview" })).toBeNull();
    expect(api.writes()).toEqual([]);
  });
});

describe("an entry saved for a later round", () => {
  const saveFinal = async () => {
    const mounted = open();
    const form = await openForm(mounted.user);
    fireEvent.change(within(form).getByLabelText("Date"), { target: { value: "2026-10-08" } });
    await mounted.user.type(within(form).getByLabelText("How it went"), "A design exercise, then questions.");
    await mounted.user.click(within(form).getByRole("button", { name: "Save interview" }));
    return mounted;
  };

  it("moves the status to that round and says so where a status change is said, with the entry's date", async () => {
    await saveFinal();

    const said = await screen.findByText(/^Interview saved, and the status moved/);
    expect(said.textContent).toBe(
      "Interview saved, and the status moved to Final interview to match. Date saved as 2026-10-08.",
    );
    expect(said.closest("section")!.querySelector("h2")!.textContent).toBe("Where it stands");
    expect(screen.getByRole("button", { name: "Final interview, 2026-10-08. Correct this date" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Move to Offer" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Change the date" })).toBeTruthy();
  });

  it("says which documents were frozen as sent when the entry takes it out of Not applied", async () => {
    const before: Standing = { step: "not_applied", closedAs: null, dates: { not_applied: "2026-09-20" } };
    const mounted = open(before, [], {
      [`POST ${AT}/interviews`]: () => ({
        ...application(standingAfterInterview(before, "interview_1", "2026-10-08"), TODAY, [FIRST]),
        frozen: [{ title: "Main résumé", versionNo: 3 }],
      }),
    });
    const form = await openForm(mounted.user);
    fireEvent.change(within(form).getByLabelText("Date"), { target: { value: "2026-10-08" } });
    await mounted.user.type(within(form).getByLabelText("How it went"), "A first conversation.");
    await mounted.user.click(within(form).getByRole("button", { name: "Save interview" }));

    const said = await screen.findByText(/^Interview saved, and the status moved/);
    expect(said.textContent).toBe(
      "Interview saved, and the status moved to First interview to match. Date saved as 2026-10-08. Main résumé v3 was frozen as sent.",
    );
  });

  it("is undone by putting back the standing from before it, and the entry stays", async () => {
    const { api, user } = await saveFinal();
    await user.click(await screen.findByRole("button", { name: "Undo" }));

    await screen.findByRole("button", { name: "Move to Final interview" });
    expect(api.writes()).toEqual([`POST ${AT}/interviews`, `PUT ${AT}/standing`]);
    expect(api.bodyOf("PUT", `${AT}/standing`)).toEqual(FERNHILL);
    expect(within(await panel()).getByText("A design exercise, then questions.")).toBeTruthy();
  });
});

describe("an entry for an earlier skipped round", () => {
  it("adds its date, updates the figure, and offers Undo without moving the status", async () => {
    const dates = { ...FERNHILL.dates };
    delete dates.interview_1;
    const before: Standing = { ...FERNHILL, dates };
    const { api, user } = open(before, []);
    const form = await openForm(user);
    await user.selectOptions(within(form).getByLabelText("Round"), "First interview");
    fireEvent.change(within(form).getByLabelText("Date"), { target: { value: "2026-09-24" } });
    await user.type(within(form).getByLabelText("How it went"), "A useful discussion.");
    await user.click(within(form).getByRole("button", { name: "Save interview" }));

    const said = await screen.findByText(/^Interview saved, and the First interview date was added/);
    expect(said.textContent).toBe("Interview saved, and the First interview date was added. Date saved as 2026-09-24.");
    expect(screen.getByRole("button", { name: "Change the date" })).toBeTruthy();
    expect(screen.getByText("since the first interview").parentElement!.textContent).toContain("16 days");
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(api.bodyOf("PUT", `${AT}/standing`)).toEqual(before);
    expect(within(await panel()).getByText("A useful discussion.")).toBeTruthy();
  });
});

describe("correcting a saved entry", () => {
  const openEdit = async (user: ReturnType<typeof open>["user"], name = "Edit the First interview entry of 2026-09-24") => {
    await user.click(await screen.findByRole("button", { name }));
    return screen.getByRole("heading", { name: "Edit interview" }).parentElement!;
  };

  it("opens the form in place of the card, holding what was saved, each question in a field of its own", async () => {
    const { api, user } = open();
    const form = await openEdit(user);

    expect((within(form).getByLabelText("Date") as HTMLInputElement).value).toBe("2026-09-24");
    expect((within(form).getByLabelText("Date") as HTMLInputElement).max).toBe(TODAY);
    expect((within(form).getByLabelText("Round") as HTMLInputElement).value).toBe("interview_1");
    expect((within(form).getByLabelText("Who you spoke with") as HTMLInputElement).value).toBe(FIRST.who);
    expect((within(form).getByLabelText("How it went") as HTMLTextAreaElement).value).toBe(FIRST.howItWent);
    expect((within(form).getByLabelText("Question 1") as HTMLInputElement).value).toBe(FIRST.questions[0]!.text);
    expect((within(form).getByLabelText("Question 2") as HTMLInputElement).value).toBe(FIRST.questions[1]!.text);
    // The card it replaces is not drawn twice, and the other entry is still a card.
    expect(screen.queryByRole("button", { name: "Edit the First interview entry of 2026-09-24" })).toBeNull();
    expect(screen.getByRole("button", { name: "Edit the Second interview entry of 2026-10-02" })).toBeTruthy();
    // A recording is attached from the card, which this entry already has.
    expect(within(form).queryByText(/A recording is attached after you save/)).toBeNull();
    expect(api.writes()).toEqual([]);
  });

  it("saves with one write: a kept question under its id, a reworded one too, a removed one gone and a new one without", async () => {
    const { api, user } = open();
    const form = await openEdit(user);

    await user.selectOptions(within(form).getByLabelText("Round"), "Other conversation");
    await user.clear(within(form).getByLabelText("Who you spoke with"));
    await user.type(within(form).getByLabelText("Who you spoke with"), "The recruiter");
    await user.clear(within(form).getByLabelText("Question 2"));
    await user.type(within(form).getByLabelText("Question 2"), "Tell us about an outage you fixed.");
    await user.click(within(form).getByRole("button", { name: "Remove question 1" }));
    await user.type(within(form).getByLabelText("A question they asked"), "What is your notice period?");
    await user.click(within(form).getByRole("button", { name: "Save changes" }));

    expect((await screen.findByRole("status")).textContent).toBe("Interview saved.");
    expect(api.writes()).toEqual([`PUT ${AT}/interviews/${FIRST.id}`]);
    expect(api.bodyOf("PUT", `${AT}/interviews/${FIRST.id}`)).toEqual({
      date: "2026-09-24",
      round: "other",
      who: "The recruiter",
      howItWent: FIRST.howItWent,
      questions: [{ id: "ivq-test-2", text: "Tell us about an outage you fixed." }, { text: "What is your notice period?" }],
    });
    // Shown at once, as a card again.
    expect(screen.queryByRole("heading", { name: "Edit interview" })).toBeNull();
    expect(within(await panel()).getByText("with The recruiter")).toBeTruthy();
    expect(within(await panel()).getByText("Tell us about an outage you fixed.")).toBeTruthy();
    expect(within(await panel()).queryByText("What would you measure first on a service you inherit?")).toBeNull();
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("says in Where it stands that the step's date followed a corrected day, and the figure follows it", async () => {
    const { api, user } = open();
    expect((await screen.findByText("since the first interview")).parentElement!.textContent).toContain("16 days");
    const form = await openEdit(user);
    fireEvent.change(within(form).getByLabelText("Date"), { target: { value: "2026-09-22" } });
    await user.click(within(form).getByRole("button", { name: "Save changes" }));

    const said = await screen.findByText(/^Interview saved, and the First interview date was changed/);
    expect(said.textContent).toBe("Interview saved, and the First interview date was changed to match. Date saved as 2026-09-22.");
    expect(said.closest("section")!.querySelector("h2")!.textContent).toBe("Where it stands");
    expect(screen.getByText("since the first interview").parentElement!.textContent).toContain("18 days");
    expect(within(await panel()).getByText("2026-09-22")).toBeTruthy();

    // Undo puts the step's date back and leaves the entry as corrected.
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(api.bodyOf("PUT", `${AT}/standing`)).toEqual(FERNHILL);
    expect(within(await panel()).getByText("2026-09-22")).toBeTruthy();
  });

  it("writes nothing for an entry emptied of how it went and every question, and nothing on Cancel", async () => {
    const { api, user } = open();
    const form = await openEdit(user, "Edit the Second interview entry of 2026-10-02");
    await user.clear(within(form).getByLabelText("Question 1"));
    await user.click(within(form).getByRole("button", { name: "Save changes" }));
    expect(within(form).getByRole("alert").textContent).toBe("Write how it went, or add at least one question.");

    await user.click(within(form).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("heading", { name: "Edit interview" })).toBeNull();
    expect(within(await panel()).getByText("Why robotics?")).toBeTruthy();
    expect(api.writes()).toEqual([]);
  });

  it("keeps the form and what was typed, and shows the server's words, when it is refused", async () => {
    const { user } = open(FERNHILL, [SECOND, FIRST], {
      [`PUT ${AT}/interviews/${FIRST.id}`]: new Refusal(409, "conflict", "This application was changed somewhere else. Reload it and try again."),
    });
    const form = await openEdit(user);
    await user.type(within(form).getByLabelText("How it went"), " And long.");
    await user.click(within(form).getByRole("button", { name: "Save changes" }));

    expect((await within(form).findByRole("alert")).textContent).toBe(
      "This application was changed somewhere else. Reload it and try again.",
    );
    expect((within(form).getByLabelText("How it went") as HTMLTextAreaElement).value).toBe(`${FIRST.howItWent} And long.`);
  });

  it("keeps the form it was sent from, and every other entry closed, until a pending save answers", async () => {
    let answer!: (refusal: Refusal) => void;
    const { user } = open(FERNHILL, [SECOND, FIRST], {
      [`PUT ${AT}/interviews/${FIRST.id}`]: () => new Promise<Refusal>((resolve) => (answer = resolve)),
    });
    const form = await openEdit(user);
    await user.click(within(form).getByRole("button", { name: "Save changes" }));

    const other = screen.getByRole("button", { name: "Edit the Second interview entry of 2026-10-02" }) as HTMLButtonElement;
    expect(other.disabled).toBe(true);
    expect(other.title).toBe("Saving…");
    expect((within(form).getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(other);
    expect(screen.getAllByRole("heading", { name: "Edit interview" })).toHaveLength(1);

    answer(new Refusal(409, "conflict", "This application was changed somewhere else. Reload it and try again."));
    expect((await within(form).findByRole("alert")).textContent).toBe(
      "This application was changed somewhere else. Reload it and try again.",
    );
    expect(other.disabled).toBe(false);
  });
});

describe("deleting a saved entry", () => {
  const ask = async (user: ReturnType<typeof open>["user"]) => {
    await user.click(await screen.findByRole("button", { name: "Delete the First interview entry of 2026-09-24" }));
    return screen.getByRole("alertdialog", { name: "Delete this interview" });
  };

  it("asks once in the card, and writes nothing until it is answered or when it is kept", async () => {
    const { api, user } = open();
    const dialog = await ask(user);

    expect(dialog.textContent).toContain(
      "Delete this entry? Its notes and questions are taken off this application, and there is no undo. The status and its dates stay as they are.",
    );
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Keep it" }));
    // What is about to go is still on the page to be read.
    expect(within(await panel()).getByText(FIRST.howItWent)).toBeTruthy();

    await user.click(within(dialog).getByRole("button", { name: "Keep it" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Delete the First interview entry of 2026-09-24" })).toBeTruthy();
    expect(api.writes()).toEqual([]);
  });

  it("deletes it with one write, and leaves where the application stands as it was", async () => {
    const { api, user } = open();
    await user.click(within(await ask(user)).getByRole("button", { name: "Delete it" }));

    expect((await screen.findByRole("status")).textContent).toBe("Interview deleted.");
    expect(api.writes()).toEqual([`DELETE ${AT}/interviews/${FIRST.id}`]);
    expect(within(await panel()).queryByText(FIRST.howItWent)).toBeNull();
    expect(within(await panel()).getByText("Why robotics?")).toBeTruthy();
    // The first interview's date is the status's, not the entry's: it stays.
    expect(screen.getByText("since the first interview").parentElement!.textContent).toContain("16 days");
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("says its recording links go with it when it has one", async () => {
    const { user } = open(FERNHILL, [
      { ...FIRST, recordings: [{ id: "rec-test-1", kind: "link", url: "https://calls.example.invalid/rec/one", label: "" }] },
    ]);
    expect((await ask(user)).textContent).toContain("there is no undo. Its recording links are removed with it. The status");
  });

  it("keeps the entry and says why when the server refuses", async () => {
    const { user } = open(FERNHILL, [SECOND, FIRST], {
      [`DELETE ${AT}/interviews/${FIRST.id}`]: new Refusal(409, "conflict", "This application was changed somewhere else. Reload it and try again."),
    });
    const dialog = await ask(user);
    await user.click(within(dialog).getByRole("button", { name: "Delete it" }));

    expect((await within(dialog).findByRole("alert")).textContent).toBe(
      "This application was changed somewhere else. Reload it and try again.",
    );
    expect(within(await panel()).getByText(FIRST.howItWent)).toBeTruthy();
  });
});
