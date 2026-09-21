/**
 * Screen 1, Fact Review (`docs/10-screen-specifications.md`).
 *
 * What is checked here is what looks right while being wrong: a write sent for
 * the wrong fact, a document that renders with a passage missing, a count that
 * disagrees with the cards under it. All fixtures are invented.
 */
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { Employer, Fact, ImportStatus } from "~/client/api";
import { mount, Refusal, type Routes } from "./harness";

const IMPORT = "imp-test-1";
const DOCUMENT = "doc-test-1";

const SOURCE = [
  "Qorvane Labs, platform group.",
  "Cut the zentrel batch from 40 minutes to 9 minutes.",
  "Ran the weekly plinth review with four teams.",
  "Likely improved morale on the floor.",
  "Pay was renegotiated in the second year.",
].join("\n");

function fact(id: string, quote: string, overrides: Partial<Fact> = {}): Fact {
  const start = SOURCE.indexOf(quote);
  if (start < 0) throw new Error(`Fixture quote not in the source: ${quote}`);
  return {
    id,
    claim: `Claim for ${id}`,
    provenance: "attested",
    disclosure: "public",
    status: "candidate",
    employerId: null,
    projectId: null,
    evidence: {
      sourceDocumentVersionId: "dv-test-1",
      lineNumber: SOURCE.slice(0, start).split("\n").length,
      quoteStart: start,
      quoteEnd: start + quote.length,
    },
    technologies: [],
    isClientIdentifying: false,
    ...overrides,
  };
}

function status(overrides: Partial<ImportStatus> = {}): ImportStatus {
  return {
    importId: IMPORT,
    sourceDocumentId: DOCUMENT,
    versionNo: 1,
    status: "ready",
    chunksTotal: 1,
    chunksDone: 1,
    candidatesExtracted: 4,
    candidatesDiscarded: 0,
    candidatesSuppressed: 0,
    wordCount: 42,
    changedRegionShare: null,
    error: null,
    failedAtChunk: null,
    ...overrides,
  };
}

const EMPLOYERS: Partial<Employer>[] = [{ id: "emp-test-1", nameLatin: "Qorvane Labs", nameJa: "コルヴェイン" }];

/** One of each kind of candidate, in an order that is NOT document order. */
const CANDIDATES = [
  fact("f-private", "Pay was renegotiated", { disclosure: "private" }),
  fact("f-measured", "from 40 minutes to 9 minutes", { provenance: "measured" }),
  fact("f-generated", "Likely improved morale", { provenance: "generated" }),
  fact("f-attested", "weekly plinth review", { disclosure: "restricted" }),
];

function open(facts: Fact[], overrides: { status?: Partial<ImportStatus>; routes?: Routes } = {}) {
  return mount(`/imports/${IMPORT}`, {
    [`GET /api/imports/${IMPORT}`]: status(overrides.status),
    [`GET /api/facts?importId=${IMPORT}`]: { items: facts },
    [`GET /api/source-documents/${DOCUMENT}/versions/1/text`]: {
      sourceDocumentVersionId: "dv-test-1",
      filename: "qorvane-notes.md",
      project: null,
      wordCount: 42,
      importedAt: "2026-09-01T00:00:00.000Z",
      text: SOURCE,
    },
    "GET /api/employers": { items: EMPLOYERS },
    ...overrides.routes,
  });
}

const card = async (id: string) => {
  await waitFor(() => expect(document.querySelector(`[data-fact-card="${id}"]`)).not.toBeNull());
  return document.querySelector<HTMLElement>(`[data-fact-card="${id}"]`)!;
};

/** The document text arrives after the facts, so wait for it rather than read an empty pane. */
const article = async () => {
  const pane = () => document.querySelector<HTMLElement>("article.whitespace-pre-wrap");
  await waitFor(() => expect(pane()?.textContent).toBeTruthy());
  return pane()!;
};

describe("the source pane", () => {
  it("renders the whole document, in order, with each quote marked for its own fact", async () => {
    open(CANDIDATES);
    const pane = await article();

    expect(pane.textContent).toBe(SOURCE);
    const marks = [...pane.querySelectorAll("mark")].map((m) => [m.dataset.fact, m.textContent]);
    expect(marks).toEqual([
      ["f-measured", "from 40 minutes to 9 minutes"],
      ["f-attested", "weekly plinth review"],
      ["f-generated", "Likely improved morale"],
      ["f-private", "Pay was renegotiated"],
    ]);
  });

  it("keeps the text when two quotes overlap, marking only the first", async () => {
    open([
      fact("f-wide", "Ran the weekly plinth review"),
      fact("f-inner", "plinth review with four teams"),
    ]);
    const pane = await article();

    expect(pane.textContent).toBe(SOURCE);
    expect([...pane.querySelectorAll("mark")].map((m) => m.dataset.fact)).toEqual(["f-wide"]);
  });

  it("selects the fact's card when its passage is clicked", async () => {
    const { user } = open(CANDIDATES);
    await user.click((await article()).querySelector('[data-fact="f-attested"]')!);

    expect((await card("f-attested")).getAttribute("aria-current")).toBe("true");
    expect((await card("f-measured")).getAttribute("aria-current")).toBe("false");
  });
});

describe("a candidate card", () => {
  it("accepts a Generated fact, and sends the accept for that fact", async () => {
    const { api, user } = open(CANDIDATES, {
      routes: { "POST /api/facts/f-generated/accept": fact("f-generated", "Likely improved morale") },
    });
    const generated = await card("f-generated");

    expect(within(generated).getByText("Draft · not usable")).toBeTruthy();
    const accept = within(generated).getByRole("button", { name: "Accept" });
    expect((accept as HTMLButtonElement).disabled).toBe(false);
    await user.click(accept);

    await waitFor(() => expect(api.writes()).toEqual(["POST /api/facts/f-generated/accept"]));
  });

  it("labels the accept on a Private fact and sends it for that fact", async () => {
    const { api, user } = open(CANDIDATES, {
      routes: { "POST /api/facts/f-private/accept": fact("f-private", "Pay was renegotiated") },
    });
    const privateCard = await card("f-private");

    expect(within(privateCard).queryByRole("button", { name: "Accept" })).toBeNull();
    await user.click(within(privateCard).getByRole("button", { name: "Accept · private" }));

    await waitFor(() => expect(api.writes()).toEqual(["POST /api/facts/f-private/accept"]));
  });

  it("sends a reject for the card it was pressed on and no other", async () => {
    const { api, user } = open(CANDIDATES, {
      routes: { "POST /api/facts/f-attested/reject": fact("f-attested", "weekly plinth review") },
    });

    await user.click(within(await card("f-attested")).getByRole("button", { name: "Reject" }));

    await waitFor(() => expect(api.writes()).toEqual(["POST /api/facts/f-attested/reject"]));
  });

  it("saves an edited claim on blur, trimmed, and saves nothing when it did not change", async () => {
    const { api } = open(CANDIDATES, {
      routes: { "PATCH /api/facts/f-measured": fact("f-measured", "from 40 minutes to 9 minutes") },
    });
    const editor = within(await card("f-measured")).getByRole("textbox", { name: "Fact claim" });

    fireEvent.blur(editor);
    editor.textContent = "   ";
    fireEvent.blur(editor);
    expect(api.writes()).toEqual([]);

    editor.textContent = "  Cut the zentrel batch to 9 minutes  ";
    fireEvent.blur(editor);

    await waitFor(() => expect(api.writes()).toEqual(["PATCH /api/facts/f-measured"]));
    expect(api.bodyOf("PATCH", "/api/facts/f-measured")).toEqual({ claim: "Cut the zentrel batch to 9 minutes" });
  });

  it("sends worth, who and employer changes as patches to that fact", async () => {
    const { api, user } = open(CANDIDATES, {
      routes: {
        "PATCH /api/facts/f-attested": fact("f-attested", "weekly plinth review"),
        "PATCH /api/facts/f-measured": fact("f-measured", "from 40 minutes to 9 minutes"),
      },
    });
    const attested = await card("f-attested");

    await user.click(within(attested).getByRole("radio", { name: "Measured" }));
    await user.click(within(attested).getByRole("radio", { name: "Private" }));
    const picker = await within(attested).findByRole("combobox", { name: "Employer" });
    await user.selectOptions(picker, "emp-test-1");

    await waitFor(() => expect(api.writes()).toHaveLength(3));
    expect(api.calls.filter((c) => c.method === "PATCH").map((c) => [c.path, c.body])).toEqual([
      ["/api/facts/f-attested", { provenance: "measured" }],
      ["/api/facts/f-attested", { disclosure: "private" }],
      ["/api/facts/f-attested", { employerId: "emp-test-1" }],
    ]);
  });

  it("files a fact back to Unfiled as a null employer, not an empty string", async () => {
    const filed = fact("f-measured", "from 40 minutes to 9 minutes", { employerId: "emp-test-1" });
    const { api, user } = open([filed], { routes: { "PATCH /api/facts/f-measured": filed } });

    const picker = await within(await card("f-measured")).findByRole("combobox", { name: "Employer" });
    await user.selectOptions(picker, "");

    await waitFor(() => expect(api.writes()).toEqual(["PATCH /api/facts/f-measured"]));
    expect(api.bodyOf("PATCH", "/api/facts/f-measured")).toEqual({ employerId: null });
  });

  it("shows a refused patch on the card that made it", async () => {
    const { user } = open(CANDIDATES, {
      routes: {
        "PATCH /api/facts/f-attested": new Refusal(422, "validation", "That claim is too long to save."),
      },
    });
    const attested = await card("f-attested");

    await user.click(within(attested).getByRole("radio", { name: "Measured" }));

    expect((await within(attested).findByRole("alert")).textContent).toBe("That claim is too long to save.");
    expect(within(await card("f-measured")).queryByRole("alert")).toBeNull();
  });
});

describe("the rail", () => {
  const RESOLVED = [
    fact("f-measured", "from 40 minutes to 9 minutes", { provenance: "measured", status: "accepted" }),
    fact("f-private", "Pay was renegotiated", { disclosure: "private", status: "accepted" }),
    fact("f-generated", "Likely improved morale", { provenance: "generated", status: "accepted" }),
    fact("f-attested", "weekly plinth review", { status: "rejected" }),
    fact("f-open", "Qorvane Labs, platform group."),
  ];

  it("counts only accepted facts in the footer, each in one bucket", async () => {
    open(RESOLVED);
    await card("f-open");

    expect(screen.getByText("1 shareable")).toBeTruthy();
    expect(screen.getByText("1 private")).toBeTruthy();
    expect(screen.getByText("1 need promotion")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add 3 facts to record" })).toBeTruthy();
    expect(screen.getByText("4 of 5 reviewed")).toBeTruthy();
  });

  it("will not finish with nothing accepted, and says why", async () => {
    open(CANDIDATES);
    await card("f-measured");

    const finish = screen.getByRole("button", { name: "Nothing accepted yet" }) as HTMLButtonElement;
    expect(finish.disabled).toBe(true);
    expect(finish.title).toBe("Nothing accepted yet");
  });

  it("filters to open and to resolved facts, with counts that match the cards", async () => {
    const { user } = open(RESOLVED);
    await card("f-open");
    const shown = () => [...document.querySelectorAll<HTMLElement>("[data-fact-card]")].map((c) => c.dataset.factCard);

    await user.click(screen.getByRole("button", { name: "Open 1" }));
    expect(shown()).toEqual(["f-open"]);

    await user.click(screen.getByRole("button", { name: "Resolved 4" }));
    expect(shown()).toEqual(["f-measured", "f-private", "f-generated", "f-attested"]);

    await user.click(screen.getByRole("button", { name: "All 5" }));
    expect(shown()).toHaveLength(5);
  });

  it("undoes a resolved fact through its own card", async () => {
    const { api, user } = open(RESOLVED, {
      routes: { "POST /api/facts/f-attested/undo": fact("f-attested", "weekly plinth review") },
    });

    await user.click(within(await card("f-attested")).getByRole("button", { name: "Undo" }));

    await waitFor(() => expect(api.writes()).toEqual(["POST /api/facts/f-attested/undo"]));
  });

  it("finishes the import and then goes home", async () => {
    const { api, user, pathname } = open(RESOLVED, {
      routes: { [`POST /api/imports/${IMPORT}/finish`]: { acceptedFacts: 3 } },
    });
    await card("f-open");

    await user.click(screen.getByRole("button", { name: "Add 3 facts to record" }));

    await waitFor(() => expect(pathname()).toBe("/"));
    expect(api.writes()).toEqual([`POST /api/imports/${IMPORT}/finish`]);
  });

  it.each(["Add 3 facts to record", "Finish review"])(
    "says so beside %s when finishing is refused, and stays",
    async (button) => {
      const { api, user, pathname } = open(RESOLVED, {
        routes: { [`POST /api/imports/${IMPORT}/finish`]: new Refusal(409, "conflict", "This import is still running.") },
      });
      await card("f-open");

      const pressed = screen.getByRole("button", { name: button });
      await user.click(pressed);

      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toBe("This import is still running.");
      // Beside the button that was pressed, not the other one.
      expect(pressed.parentElement!.contains(alert)).toBe(true);
      expect(screen.getAllByRole("alert")).toHaveLength(1);
      expect(api.writes()).toEqual([`POST /api/imports/${IMPORT}/finish`]);
      expect(pathname()).toBe(`/imports/${IMPORT}`);
    },
  );
});

describe("the keyboard", () => {
  it("moves between cards with the arrows, and the selection follows focus", async () => {
    const { user } = open(CANDIDATES);
    const first = await card("f-private");

    first.focus();
    await user.keyboard("{ArrowDown}");

    const second = await card("f-measured");
    expect(document.activeElement).toBe(second);
    expect(second.getAttribute("aria-current")).toBe("true");
    expect(second.tabIndex).toBe(0);
    expect(first.tabIndex).toBe(-1);

    await user.keyboard("{End}");
    expect(document.activeElement).toBe(await card("f-attested"));
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(first);
  });

  it("leaves the arrows to the claim editor while it has focus", async () => {
    const { user } = open(CANDIDATES);
    const editor = within(await card("f-private")).getByRole("textbox", { name: "Fact claim" });

    editor.focus();
    await user.keyboard("{ArrowDown}");

    expect(document.activeElement).toBe(editor);
    expect((await card("f-private")).getAttribute("aria-current")).toBe("true");
  });
});

describe("import states", () => {
  it("retries a failed import from the chunk it stopped at", async () => {
    const { api, user } = open([], {
      status: {
        status: "failed",
        candidatesExtracted: 0,
        error: { code: "model_unavailable", message: "The model stopped answering." },
        failedAtChunk: 2,
      },
      routes: { [`POST /api/imports/${IMPORT}/retry`]: status({ status: "queued" }) },
    });

    expect(await screen.findByText("This import stopped before it finished.")).toBeTruthy();
    expect(screen.getByText(/Retrying picks up at section 3; everything before it is kept\./)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(api.writes()).toEqual([`POST /api/imports/${IMPORT}/retry`]));
  });

  it("says a re-import with nothing changed has nothing to review", async () => {
    mount(`/imports/${IMPORT}`, {
      [`GET /api/imports/${IMPORT}`]: status({ versionNo: 2, chunksTotal: 0, chunksDone: 0, candidatesExtracted: 0 }),
      [`GET /api/facts?importId=${IMPORT}`]: { items: [] },
      [`GET /api/source-documents/${DOCUMENT}/versions/2/text`]: {
        sourceDocumentVersionId: "dv-test-2",
        filename: "qorvane-notes.md",
        project: null,
        wordCount: 42,
        importedAt: "2026-09-01T00:00:00.000Z",
        text: SOURCE,
      },
      "GET /api/employers": { items: [] },
    });

    expect(await screen.findByText("Nothing new to review")).toBeTruthy();
    expect(screen.getByText(/v2 adds no new or changed passages since v1/)).toBeTruthy();
  });

  it("states how many candidates were discarded and suppressed, in the right number", async () => {
    open(CANDIDATES, { status: { candidatesDiscarded: 1, candidatesSuppressed: 2 } });

    expect(await screen.findByText("1 candidate did not quote the document exactly and was discarded.")).toBeTruthy();
    expect(screen.getByText("2 candidates repeated facts already in your record and were not offered again.")).toBeTruthy();
  });
});
