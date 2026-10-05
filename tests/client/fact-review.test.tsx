/**
 * Screen 1, Fact Review (`docs/10-screen-specifications.md`).
 *
 * What is checked here is what looks right while being wrong: a write sent for
 * the wrong fact, a document that renders with a passage missing, a count that
 * disagrees with the cards under it. All fixtures are invented.
 */
import { describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { Employer, Fact, ImportStatus } from "~/client/api";
import { mount, Refusal, toneOf, type Routes } from "./harness";

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
    employerSetByHand: false,
    projectId: null,
    evidence: {
      sourceDocumentVersionId: "dv-test-1",
      lineNumber: SOURCE.slice(0, start).split("\n").length,
      quoteStart: start,
      quoteEnd: start + quote.length,
    },
    technologies: [],
    isClientIdentifying: false,
    graded: false,
    likelyMatches: [],
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
const rendered = async () => {
  const pane = () => document.querySelector<HTMLElement>("article.md-doc");
  await waitFor(() => expect(pane()?.textContent).toBeTruthy());
  return pane()!;
};

/**
 * The stored text, which is one press from the rendered view of a Markdown
 * document and the only view of a plain-text one.
 */
const article = async (user?: ReturnType<typeof open>["user"]) => {
  if (user) {
    await rendered();
    await user.click(screen.getByRole("radio", { name: "Source" }));
  }
  const pane = () => document.querySelector<HTMLElement>("article.whitespace-pre-wrap");
  await waitFor(() => expect(pane()?.textContent).toBeTruthy());
  return pane()!;
};

/** A portfolio in miniature: headings, emphasis, a list and a table. All invented. */
const PORTFOLIO = [
  "# Qorvane Labs",
  "",
  "## Batch platform",
  "",
  "Cut the zentrel batch from **40 minutes** to 9 minutes.",
  "",
  "- Ran the weekly plinth review",
  "- Mentored two engineers",
  "",
  "### Numbers",
  "",
  "| Measure | Before | After |",
  "|---|---|---|",
  "| Batch time | 40 min | 9 min |",
  "",
  "## Hiring",
  "",
  "Interviewed for the platform group.",
].join("\n");

function portfolioFact(id: string, quote: string, overrides: Partial<Fact> = {}): Fact {
  const start = PORTFOLIO.indexOf(quote);
  if (start < 0) throw new Error(`Fixture quote not in the portfolio: ${quote}`);
  return {
    ...fact(id, "Qorvane Labs", overrides),
    evidence: {
      sourceDocumentVersionId: "dv-test-1",
      lineNumber: PORTFOLIO.slice(0, start).split("\n").length,
      quoteStart: start,
      quoteEnd: start + quote.length,
    },
  };
}

const openPortfolio = (facts: Fact[], filename = "qorvane-portfolio.md") =>
  open(facts, {
    routes: {
      [`GET /api/source-documents/${DOCUMENT}/versions/1/text`]: {
        sourceDocumentVersionId: "dv-test-1",
        filename,
        project: null,
        wordCount: 42,
        importedAt: "2026-09-01T00:00:00.000Z",
        text: PORTFOLIO,
      },
    },
  });

describe("a rendered Markdown document", () => {
  it("reads as a document, with no markup characters left in it", async () => {
    openPortfolio([]);
    const pane = await rendered();

    expect(pane.querySelector("h1")?.textContent).toBe("Qorvane Labs");
    expect([...pane.querySelectorAll("h2")].map((h) => h.textContent)).toEqual(["Batch platform", "Hiring"]);
    expect([...pane.querySelectorAll("li")].map((li) => li.textContent)).toEqual([
      "Ran the weekly plinth review",
      "Mentored two engineers",
    ]);
    expect([...pane.querySelectorAll("th")].map((th) => th.textContent)).toEqual(["Measure", "Before", "After"]);
    expect(pane.querySelector("strong")?.textContent).toBe("40 minutes");
    expect(pane.textContent).not.toMatch(/[#*|]/);
  });

  it("marks a quote that crosses bold text as runs of one fact, without its markup", async () => {
    openPortfolio([portfolioFact("f-bold", "from **40 minutes** to 9 minutes")]);
    const pane = await rendered();

    const marks = [...pane.querySelectorAll<HTMLElement>('mark[data-fact="f-bold"]')];
    expect(marks.map((m) => m.textContent)).toEqual(["from ", "40 minutes", " to 9 minutes"]);
  });

  it("marks a quote that is a table row, cell by cell", async () => {
    openPortfolio([portfolioFact("f-row", "| Batch time | 40 min | 9 min |")]);
    const pane = await rendered();

    const marks = [...pane.querySelectorAll<HTMLElement>('mark[data-fact="f-row"]')];
    expect(marks.map((m) => m.textContent)).toEqual(["Batch time", "40 min", "9 min"]);
    expect(marks.every((m) => m.closest("td"))).toBe(true);
  });

  it("selects the fact's card when any run of its passage is clicked", async () => {
    const { user } = openPortfolio([
      portfolioFact("f-bold", "from **40 minutes** to 9 minutes"),
      portfolioFact("f-list", "Mentored two engineers"),
    ]);
    const pane = await rendered();
    await user.click(pane.querySelectorAll('mark[data-fact="f-bold"]')[1]!);

    expect((await card("f-bold")).getAttribute("aria-current")).toBe("true");
    expect((await card("f-list")).getAttribute("aria-current")).toBe("false");
  });

  it("shows the stored text exactly, with the same marks, on Source", async () => {
    const { user } = openPortfolio([portfolioFact("f-bold", "from **40 minutes** to 9 minutes")]);
    const pane = await article(user);

    expect(pane.textContent).toBe(PORTFOLIO);
    expect([...pane.querySelectorAll("mark")].map((m) => [m.dataset.fact, m.textContent])).toEqual([
      ["f-bold", "from **40 minutes** to 9 minutes"],
    ]);
    // And back: the choice is a view, not a one-way door.
    await user.click(screen.getByRole("radio", { name: "Rendered" }));
    expect((await rendered()).querySelector("h1")?.textContent).toBe("Qorvane Labs");
  });

  it("shows a plain-text document as stored, with no view to choose", async () => {
    openPortfolio([], "qorvane-notes.txt");
    const pane = await article();

    expect(pane.textContent).toBe(PORTFOLIO);
    expect(screen.queryByRole("radio", { name: "Rendered" })).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Contents" })).toBeNull();
  });
});

describe("the contents of a rendered document", () => {
  it("lists the headings down to level 3, in order", async () => {
    openPortfolio([]);
    await rendered();

    const entries = within(screen.getByRole("navigation", { name: "Contents" })).getAllByRole("button");
    expect(entries.map((b) => b.textContent)).toEqual([
      "Hide",
      "Qorvane Labs",
      "Batch platform",
      "Numbers",
      "Hiring",
    ]);
  });

  it("scrolls the pane to the heading its entry names", async () => {
    const { user } = openPortfolio([]);
    const pane = await rendered();
    const scrolled: Element[] = [];
    pane.parentElement!.scrollTo = function scrollTo(this: Element) {
      scrolled.push(this);
    } as typeof Element.prototype.scrollTo;

    await user.click(within(screen.getByRole("navigation", { name: "Contents" })).getByRole("button", { name: "Hiring" }));

    expect(scrolled).toEqual([pane.parentElement]);
  });

  it("hides, and comes back from the label strip", async () => {
    const { user } = openPortfolio([]);
    await rendered();

    await user.click(within(screen.getByRole("navigation", { name: "Contents" })).getByRole("button", { name: "Hide" }));
    expect(screen.queryByRole("navigation", { name: "Contents" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Contents" }));
    expect(screen.getByRole("navigation", { name: "Contents" })).toBeTruthy();
  });

  it("is absent for a document with a single heading, and on Source", async () => {
    const { user } = open(CANDIDATES);
    await rendered();
    expect(screen.queryByRole("navigation", { name: "Contents" })).toBeNull();

    await user.click(screen.getByRole("radio", { name: "Source" }));
    expect(screen.queryByRole("button", { name: "Contents" })).toBeNull();
  });
});

describe("the quoted passage on a card", () => {
  it("shows a card's passage rendered, and its stored characters on Exact text", async () => {
    const { user } = openPortfolio([
      portfolioFact("f-bold", "from **40 minutes** to 9 minutes"),
      portfolioFact("f-list", "Mentored two engineers"),
    ]);
    await rendered();

    const passage = within(await card("f-bold")).getByRole("region", { name: "Quoted passage" });
    expect(passage.querySelector("p")?.textContent).toBe("from 40 minutes to 9 minutes");
    expect(passage.querySelector("strong")?.textContent).toBe("40 minutes");

    await user.click(within(passage).getByRole("button", { name: "Exact text" }));
    expect(passage.querySelector("p")?.textContent).toBe("from **40 minutes** to 9 minutes");
  });

  // A passage that mounted on selection would move the grade out from under the
  // press that selected the card; the browser smoke test is what loses the click.
  it("is on every open card whichever is selected, and on no resolved one", async () => {
    const { user } = openPortfolio([
      portfolioFact("f-bold", "from **40 minutes** to 9 minutes"),
      portfolioFact("f-list", "Mentored two engineers"),
      portfolioFact("f-done", "Hiring", { status: "accepted" }),
    ]);
    await rendered();
    const passages = async () =>
      Promise.all(
        ["f-bold", "f-list", "f-done"].map(async (id) =>
          within(await card(id)).queryAllByRole("region", { name: "Quoted passage" }).length,
        ),
      );

    expect(await passages()).toEqual([1, 1, 0]);
    await user.click(await card("f-list"));
    expect(await passages()).toEqual([1, 1, 0]);
  });

  it("flattens a table row to its cells", async () => {
    openPortfolio([portfolioFact("f-row", "| Batch time | 40 min | 9 min |")]);
    await rendered();

    const passage = within(await card("f-row")).getByRole("region", { name: "Quoted passage" });
    expect(passage.querySelector("p")?.textContent).toBe("Batch time · 40 min · 9 min");
  });
});

describe("the wait while a document is read", () => {
  const extracting = { status: { status: "extracting", chunksTotal: 150, chunksDone: 9 } as Partial<ImportStatus> };

  it("says work is under way, how far along it is, and that review can start", async () => {
    open(CANDIDATES, extracting);
    await card("f-measured");

    const bar = screen.getByRole("progressbar", { name: "Reading the document" });
    expect(bar.getAttribute("aria-valuenow")).toBe("6");
    const block = bar.parentElement!;
    expect(within(block).getByText("6%")).toBeTruthy();
    expect(
      within(block).getByText(
        "9 of 150 sections read. Still working, please wait: a long document takes several minutes. You can review the facts already found.",
      ),
    ).toBeTruthy();
    // Pinned above the cards, not among them: scrolling the list cannot lose it.
    expect(block.closest("[data-fact-card]")).toBeNull();
    expect((await card("f-measured")).parentElement!.contains(block)).toBe(false);
  });

  it("never reads 100% while a section is still out", async () => {
    open(CANDIDATES, { status: { status: "extracting", chunksTotal: 150, chunksDone: 149 } });
    await card("f-measured");

    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("99");
  });

  it("claims no percentage before the document has been split", async () => {
    open([], { status: { status: "queued", chunksTotal: 0, chunksDone: 0, candidatesExtracted: 0 } });

    const bar = await screen.findByRole("progressbar", { name: "Getting ready to read this document" });
    expect(bar.hasAttribute("aria-valuenow")).toBe(false);
    expect(within(bar.parentElement!).queryByText(/%/)).toBeNull();
    expect(screen.getByText("Still working, please wait. This page updates on its own.")).toBeTruthy();
  });

  it("does not ask for a review of facts that have not been found yet", async () => {
    open([], { status: { status: "extracting", chunksTotal: 150, chunksDone: 2, candidatesExtracted: 0 } });

    await screen.findByRole("progressbar", { name: "Reading the document" });
    expect(screen.getByText("wait for the first facts. They appear here as they are found.")).toBeTruthy();
    expect(screen.queryByText(/review the facts found so far/)).toBeNull();
  });

  it("is gone once the import is ready", async () => {
    open(CANDIDATES);
    await card("f-measured");

    expect(screen.queryByRole("progressbar")).toBeNull();
  });
});

describe("the guide to this screen", () => {
  it("says what to do and what each control asks, and names the next step", async () => {
    open(CANDIDATES);
    await card("f-measured");

    const guide = screen.getByRole("region", { name: "How to review" });
    expect(within(guide).getByText("Read the highlighted passage on the left. It is the evidence.")).toBeTruthy();
    expect(within(guide).getByText("Worth")).toBeTruthy();
    expect(guide.textContent).toContain("Generated: the importer's guess.");
    expect(screen.getByText("4 facts left to review.")).toBeTruthy();
  });

  it("stays hidden once hidden, for this browser", async () => {
    const first = open(CANDIDATES);
    await card("f-measured");
    await first.user.click(within(screen.getByRole("region", { name: "How to review" })).getByRole("button", { name: "Hide" }));
    expect(screen.queryByText("Read the highlighted passage on the left. It is the evidence.")).toBeNull();
    cleanup();

    open(CANDIDATES);
    await card("f-measured");
    const guide = screen.getByRole("region", { name: "How to review" });
    expect(within(guide).getByRole("button", { name: "Show" })).toBeTruthy();
    expect(within(guide).queryByRole("list")).toBeNull();
  });

  it("says to finish when nothing is left to review", async () => {
    open(CANDIDATES.map((f) => ({ ...f, status: "accepted" as const })));
    await card("f-measured");

    expect(screen.getByText("everything here is reviewed. Press Finish review.")).toBeTruthy();
  });
});

describe("the source pane", () => {
  it("renders the whole document, in order, with each quote marked for its own fact", async () => {
    const { user } = open(CANDIDATES);
    const pane = await article(user);

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
    const { user } = open([
      fact("f-wide", "Ran the weekly plinth review"),
      fact("f-inner", "plinth review with four teams"),
    ]);
    const pane = await article(user);

    expect(pane.textContent).toBe(SOURCE);
    expect([...pane.querySelectorAll("mark")].map((m) => m.dataset.fact)).toEqual(["f-wide"]);
  });

  it("selects the fact's card when its passage is clicked", async () => {
    const { user } = open(CANDIDATES);
    await user.click((await article(user)).querySelector('[data-fact="f-attested"]')!);

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
    expect(toneOf(within(attested).getByRole("alert"))).toBe("removed");
    expect(within(await card("f-measured")).queryByRole("alert")).toBeNull();
  });

  it("says so on the card when a patch never reaches the server", async () => {
    const { user } = open(CANDIDATES, {
      routes: {
        "PATCH /api/facts/f-attested": () => {
          throw new TypeError("Failed to fetch");
        },
      },
    });
    const attested = await card("f-attested");

    await user.click(within(attested).getByRole("radio", { name: "Measured" }));

    expect((await within(attested).findByRole("alert")).textContent).toBe(
      "The server could not be reached. Try again.",
    );
  });

  it.each([
    ["Accept", "accept", new Refusal(409, "conflict", "That fact was already decided.")],
    ["Reject", "reject", new Refusal(409, "conflict", "That fact was already decided.")],
    [
      "Reject",
      "reject",
      () => {
        throw new TypeError("Failed to fetch");
      },
    ],
  ])("says why on the card when %s fails, and leaves it open", async (button, action, answer) => {
    const said = answer instanceof Refusal ? answer.message : "The server could not be reached. Try again.";
    const { api, user } = open(CANDIDATES, { routes: { [`POST /api/facts/f-attested/${action}`]: answer } });
    const attested = await card("f-attested");

    await user.click(within(attested).getByRole("button", { name: button }));

    expect((await within(attested).findByRole("alert")).textContent).toBe(said);
    expect(within(await card("f-measured")).queryByRole("alert")).toBeNull();
    expect(within(await card("f-attested")).getByRole("button", { name: "Accept" })).toBeTruthy();
    expect(api.writes()).toEqual([`POST /api/facts/f-attested/${action}`]);
  });

  it("clears a refused decision when the next edit goes through", async () => {
    const { user } = open(CANDIDATES, {
      routes: {
        "POST /api/facts/f-attested/accept": new Refusal(409, "conflict", "That fact was already decided."),
        "PATCH /api/facts/f-attested": fact("f-attested", "weekly plinth review", { provenance: "measured" }),
      },
    });
    const attested = await card("f-attested");

    await user.click(within(attested).getByRole("button", { name: "Accept" }));
    await within(attested).findByRole("alert");
    await user.click(within(attested).getByRole("radio", { name: "Measured" }));

    await waitFor(() => expect(within(attested).queryByRole("alert")).toBeNull());
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

  it("filters to facts to review and to reviewed ones, with counts that match the cards", async () => {
    const { user } = open(RESOLVED);
    await card("f-open");
    const shown = () => [...document.querySelectorAll<HTMLElement>("[data-fact-card]")].map((c) => c.dataset.factCard);

    await user.click(screen.getByRole("button", { name: "To review 1" }));
    expect(shown()).toEqual(["f-open"]);

    await user.click(screen.getByRole("button", { name: "Reviewed 4" }));
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

  it("says why on a resolved card when Undo is refused", async () => {
    const { user } = open(RESOLVED, {
      routes: { "POST /api/facts/f-attested/undo": new Refusal(409, "conflict", "This import is finished.") },
    });
    const attested = await card("f-attested");

    await user.click(within(attested).getByRole("button", { name: "Undo" }));

    expect((await within(attested).findByRole("alert")).textContent).toBe("This import is finished.");
    expect(toneOf(within(attested).getByRole("alert"))).toBe("removed");
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
      expect(toneOf(alert)).toBe("removed");
      expect(screen.getAllByRole("alert")).toHaveLength(1);
      expect(api.writes()).toEqual([`POST /api/imports/${IMPORT}/finish`]);
      expect(pathname()).toBe(`/imports/${IMPORT}`);
    },
  );

  it.each([
    ["Add 3 facts to record", "Finish review"],
    ["Finish review", "Add 3 facts to record"],
  ])("keeps one refusal: pressing %s and then %s says only the second reason, beside it", async (first, second) => {
    const reasons = ["This import is still running.", "This import is already finished."];
    let call = 0;
    const { api, user } = open(RESOLVED, {
      routes: {
        [`POST /api/imports/${IMPORT}/finish`]: () => new Refusal(409, "conflict", reasons[call++]!),
      },
    });
    await card("f-open");

    await user.click(screen.getByRole("button", { name: first }));
    expect((await screen.findByRole("alert")).textContent).toBe(reasons[0]);

    const pressed = screen.getByRole("button", { name: second });
    await user.click(pressed);

    await waitFor(() => expect(screen.getAllByRole("alert").map((a) => a.textContent)).toEqual([reasons[1]]));
    expect(pressed.parentElement!.contains(screen.getByRole("alert"))).toBe(true);
    expect(api.writes()).toHaveLength(2);
  });
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

  it.each([
    ["no facts yet", [] as Fact[]],
    ["every found fact reviewed", [fact("f-accepted", "weekly plinth review", { status: "accepted" })]],
  ])("tells the author to retry a failed import with %s", async (_case, facts) => {
    open(facts, {
      status: {
        status: "failed",
        candidatesExtracted: facts.length,
        error: { code: "model_unavailable", message: "The model stopped answering." },
        failedAtChunk: 2,
      },
    });

    expect(
      await screen.findByText(/this import stopped before it finished\. Press Retry to read the rest\./),
    ).toBeTruthy();
    expect(screen.queryByText(/nothing was found to review/)).toBeNull();
    expect(screen.queryByText(/Press Finish review/)).toBeNull();
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

describe("likely matches on the card", () => {
  const MATCHED = fact("f-measured", "from 40 minutes to 9 minutes", {
    employerId: "emp-test-1",
    likelyMatches: [
      {
        id: "f-old-1",
        claim: "Brought the zentrel batch down to 12 minutes",
        provenance: "attested",
        graded: true,
        document: { importId: "imp-old-1", filename: "qorvane-retelling.md", versionNo: 1 },
        conflict: true,
      },
      {
        id: "f-old-2",
        claim: "Rewrote the zentrel batch",
        provenance: "measured",
        graded: true,
        document: { importId: "imp-old-2", filename: "zentrel-portfolio.md", versionNo: 3 },
        conflict: false,
      },
    ],
  });

  it("shows each match's claim and document under the claim, and marks the conflict", async () => {
    open([MATCHED, fact("f-attested", "weekly plinth review")]);
    const block = within(await card("f-measured")).getByRole("region", { name: "Likely already in your record" });

    const rows = [...block.querySelectorAll(":scope > div")].map((row) => row.textContent);
    expect(rows).toEqual([
      "Conflict · number differsBrought the zentrel batch down to 12 minutesqorvane-retelling.md",
      "Rewrote the zentrel batchzentrel-portfolio.md · v3",
    ]);
    // The document links to where the other fact is settled.
    expect(within(block).getByRole("link", { name: "qorvane-retelling.md" }).getAttribute("href")).toBe(
      "/imports/imp-old-1",
    );
    // No semantic colour on the marker: red, amber and green mean removed,
    // Generated and Measured, and a conflict is none of them (`docs/05` §9).
    expect(within(block).getByText("Conflict · number differs").className).not.toMatch(/removed|generated|measured/);

    expect(within(await card("f-attested")).queryByRole("region", { name: "Likely already in your record" })).toBeNull();
  });

  it("leaves Accept and Reject as they are", async () => {
    const { api, user } = open([MATCHED], {
      routes: {
        "POST /api/facts/f-measured/accept": { ...MATCHED, status: "accepted", likelyMatches: [] },
        "POST /api/facts/f-measured/reject": { ...MATCHED, status: "rejected", likelyMatches: [] },
      },
    });
    const matched = await card("f-measured");

    await user.click(within(matched).getByRole("button", { name: "Accept" }));
    await user.click(within(matched).getByRole("button", { name: "Reject" }));

    await waitFor(() =>
      expect(api.writes()).toEqual(["POST /api/facts/f-measured/accept", "POST /api/facts/f-measured/reject"]),
    );
  });
});

describe("re-grading an accepted fact (issue #37)", () => {
  const UNGRADED_MATCH = {
    id: "f-old-3",
    claim: "Brought the zentrel batch down to 9 minutes",
    provenance: "attested" as const,
    graded: false,
    document: { importId: "imp-old-1", filename: "qorvane-retelling.md", versionNo: 1 },
    conflict: false,
  };
  const PORTFOLIO = fact("f-measured", "from 40 minutes to 9 minutes", {
    employerId: "emp-test-1",
    likelyMatches: [UNGRADED_MATCH],
  });

  it("offers the re-grade under a match graded by default, with no grade marked as chosen", async () => {
    open([PORTFOLIO]);
    const block = within(await card("f-measured")).getByRole("region", { name: "Likely already in your record" });

    expect(within(block).getByText("Graded by default · attested")).toBeTruthy();
    const grades = within(block).getByRole("group", { name: "Re-grade" });
    expect(within(grades).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Measured",
      "Attested",
      "Generated",
      "Reject",
    ]);
    // Actions, not a radio group: nothing reads as already chosen.
    expect(within(block).queryAllByRole("radio")).toEqual([]);
  });

  it("re-grades the match, not the card, and confirming the default is a re-grade", async () => {
    const { api, user } = open([PORTFOLIO], {
      routes: { "POST /api/facts/f-old-3/regrade": { ...fact("f-old-3", "Cut the zentrel batch"), status: "accepted", graded: true } },
    });
    const grades = within(await card("f-measured")).getByRole("group", { name: "Re-grade" });

    await user.click(within(grades).getByRole("button", { name: "Attested" }));

    await waitFor(() => expect(api.writes()).toEqual(["POST /api/facts/f-old-3/regrade"]));
    expect(api.bodyOf("POST", "/api/facts/f-old-3/regrade")).toEqual({ provenance: "attested" });
  });

  it("rejects the match where it stands, and leaves the candidate open", async () => {
    const { api, user } = open([PORTFOLIO], {
      routes: { "POST /api/facts/f-old-3/reject": { ...fact("f-old-3", "Cut the zentrel batch"), status: "rejected" } },
    });
    const grades = within(await card("f-measured")).getByRole("group", { name: "Re-grade" });

    await user.click(within(grades).getByRole("button", { name: "Reject" }));

    await waitFor(() => expect(api.writes()).toEqual(["POST /api/facts/f-old-3/reject"]));
  });

  it("says a refused grade on the line", async () => {
    const { user } = open([PORTFOLIO], {
      routes: {
        "POST /api/facts/f-old-3/regrade": new Refusal(422, "validation_failed", "A Measured fact needs a passage in the source that proves it."),
      },
    });
    const block = within(await card("f-measured")).getByRole("region", { name: "Likely already in your record" });

    await user.click(within(block).getByRole("button", { name: "Measured" }));

    expect((await within(block).findByRole("alert")).textContent).toBe(
      "A Measured fact needs a passage in the source that proves it.",
    );
  });

  it("shows nothing to re-grade under a match the author has graded", async () => {
    open([{ ...PORTFOLIO, likelyMatches: [{ ...UNGRADED_MATCH, graded: true }] }]);
    const block = within(await card("f-measured")).getByRole("region", { name: "Likely already in your record" });

    expect(within(block).queryByRole("group", { name: "Re-grade" })).toBeNull();
    expect(within(block).queryByText(/Graded by default/)).toBeNull();
  });

  it("lists the import's accepted facts with no grade under To re-grade", async () => {
    const { user } = open([
      fact("f-default", "weekly plinth review", { status: "accepted" }),
      fact("f-graded", "from 40 minutes to 9 minutes", { status: "accepted", graded: true }),
      fact("f-open", "Likely improved morale"),
    ]);

    await user.click(await screen.findByRole("button", { name: "To re-grade 1" }));

    expect(within(await card("f-default")).getByRole("group", { name: "Re-grade" })).toBeTruthy();
    expect(document.querySelector('[data-fact-card="f-graded"]')).toBeNull();
    expect(document.querySelector('[data-fact-card="f-open"]')).toBeNull();
  });

  it("offers no To re-grade filter when every accepted fact is graded", async () => {
    open([fact("f-graded", "weekly plinth review", { status: "accepted", graded: true })]);

    await card("f-graded");
    expect(screen.queryByRole("button", { name: /To re-grade/ })).toBeNull();
  });

  it("reads every page of the import, not only the first", async () => {
    mount(`/imports/${IMPORT}`, {
      [`GET /api/imports/${IMPORT}`]: status(),
      [`GET /api/facts?importId=${IMPORT}`]: {
        items: [fact("f-page-1", "weekly plinth review", { status: "accepted" })],
        nextCursor: "f-page-1",
      },
      [`GET /api/facts?importId=${IMPORT}&cursor=f-page-1`]: {
        items: [fact("f-page-2", "from 40 minutes to 9 minutes", { status: "accepted" })],
        nextCursor: null,
      },
      [`GET /api/source-documents/${DOCUMENT}/versions/1/text`]: {
        sourceDocumentVersionId: "dv-test-1",
        filename: "qorvane-notes.md",
        project: null,
        wordCount: 42,
        importedAt: "2026-09-01T00:00:00.000Z",
        text: SOURCE,
      },
      "GET /api/employers": { items: EMPLOYERS },
    });

    expect(await screen.findByRole("button", { name: "To re-grade 2" })).toBeTruthy();
  });
});
