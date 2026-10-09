/**
 * Screen 3, Home (`docs/10-screen-specifications.md`).
 *
 * One write starts here: Generate, which asks the server for a proposal and
 * opens it. What matters is that the write names the document it was made
 * from, that a document which cannot be generated offers no write at all, that
 * a refusal the server explains is shown in the server's words, and that a
 * write which never reached the server says so.
 *
 * The rest is what issue #58 asked of the screen: that it says what to do next,
 * that it says it in plain words, that a zero never reads as broken, and that
 * its frame is on screen before any read has answered. All fixtures are invented.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import type { Employer, Overview, RenderRow } from "~/client/api";
import { mount, Refusal, toneOf, type Routes } from "./harness";

const UNREACHABLE = () => {
  throw new TypeError("Failed to fetch");
};
const NOT_REACHED = "The server could not be reached. Try again.";
/** A read has a Retry beside it, so its line does not also say to try again. */
const NOT_READ = "The server could not be reached.";

const row = (over: Partial<RenderRow> = {}): RenderRow => ({
  id: null,
  // A main document is addressed by its kind.
  ref: over.kind ?? "english_resume",
  tailored: null,
  kind: "english_resume",
  language: "en",
  title: "English résumé",
  buildable: true,
  currentVersionId: null,
  currentVersionNo: null,
  generatedAt: null,
  status: "never_generated",
  newFactsSince: null,
  withdrawnFactsSince: null,
  pendingProposalId: null,
  ...over,
});

const overview = (documents: RenderRow[], canGenerate = true): Overview => ({
  lastImportAt: null,
  activeImport: null,
  tiles: {
    employers: { count: 1, note: null },
    roles: { count: 1, note: null },
    projects: { count: 0, note: null },
    credentials: { count: 0, note: null },
  },
  factsByProvenance: { measured: 3, attested: 1, generated: 0 },
  flagged: 0,
  review: null,
  unconfirmed: null,
  documents,
  tailored: [],
  canGenerate,
  isEmpty: false,
});

const open = (documents: RenderRow[], routes: Routes = {}, canGenerate = true) =>
  mount("/", {
    "GET /api/overview": overview(documents, canGenerate),
    "GET /api/imports/summary": { openCandidates: 0, running: false },
    ...routes,
  });

const file = () => new File(["# zentrel"], "quillset-notes.md", { type: "text/markdown" });

const documentRow = async (title = "English résumé") => (await screen.findByText(title)).closest("li")!;
const nextStep = () => screen.findByRole("region", { name: "Next step" });
/** Every section of the populated screen, by its heading. */
const SECTIONS = ["Your record", "Facts in your record", "Your career documents"];

describe("generating a document", () => {
  const POST = "POST /api/renders/english_resume/generate";

  it("asks for the row's document and opens the proposal it made", async () => {
    const { api, user, pathname } = open([row()], { [POST]: { proposalId: "prop-test-plinth" } });
    await user.click(within(await documentRow()).getByRole("button", { name: "Generate" }));

    await waitFor(() => expect(pathname()).toBe("/proposals/prop-test-plinth"));
    expect(api.writes()).toEqual([POST]);
  });

  it("shows the server's refusal and stays on the overview", async () => {
    const { api, user, pathname } = open([row()], {
      [POST]: new Refusal(409, "proposal_pending", "A proposal for this document is already waiting."),
    });
    await user.click(within(await documentRow()).getByRole("button", { name: "Generate" }));

    expect((await screen.findByRole("alert")).textContent).toBe("A proposal for this document is already waiting.");
    expect(toneOf(screen.getByRole("alert"))).toBe("text-secondary");
    expect(pathname()).toBe("/");
    expect(api.writes()).toEqual([POST]);
  });

  it("says so when the server could not be reached", async () => {
    const { api, user, pathname } = open([row()], { [POST]: UNREACHABLE });
    await user.click(within(await documentRow()).getByRole("button", { name: "Generate" }));

    expect((await screen.findByRole("alert")).textContent).toBe(NOT_REACHED);
    expect(pathname()).toBe("/");
    expect(api.writes()).toEqual([POST]);
  });

  it("clears the last failure when Generate is pressed again", async () => {
    let attempt = 0;
    const { user, pathname } = open([row()], {
      [POST]: () => (++attempt === 1 ? UNREACHABLE() : { proposalId: "prop-test-quillset" }),
    });
    const button = within(await documentRow()).getByRole("button", { name: "Generate" });
    await user.click(button);
    await screen.findByRole("alert");

    await user.click(button);
    await waitFor(() => expect(pathname()).toBe("/proposals/prop-test-quillset"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("offers no write when no fact can be used, and says why once above the rows", async () => {
    const { api } = open([row(), row({ kind: "rirekisho", language: "ja", title: "Qorvane 履歴書" })], {}, false);
    const list = (await documentRow()).closest("section")!;

    expect(within(list).queryByRole("button", { name: "Generate" })).toBeNull();
    expect(
      within(list).getByText("Nothing can be generated until your record holds an accepted fact a document may use."),
    ).toBeTruthy();
    expect(api.writes()).toEqual([]);
  });

  it("offers no write for a document that is not built, and says so on its row", async () => {
    open([row({ buildable: false })]);
    const item = await documentRow();

    expect(within(item).queryByRole("button")).toBeNull();
    expect(within(item).getByText("Not available yet")).toBeTruthy();
  });

  it("opens the waiting proposal instead of asking for another", async () => {
    const { api, user, pathname } = open([
      row({ status: "proposal_pending", pendingProposalId: "prop-test-zentrel" }),
    ]);
    const item = await documentRow();
    expect(within(item).queryByRole("button", { name: "Generate" })).toBeNull();
    await user.click(within(item).getByRole("link", { name: "Review changes" }));

    await waitFor(() => expect(pathname()).toBe("/proposals/prop-test-zentrel"));
    expect(api.writes()).toEqual([]);
  });

  it("says a proposal is still being written rather than waiting, and still opens it", async () => {
    const { api, user, pathname } = open([
      row({ status: "proposal_generating", pendingProposalId: "prop-test-vorbit" }),
    ]);
    const item = await documentRow();

    expect(within(item).getByText("Writing a new version")).toBeTruthy();
    expect(within(item).queryByText("New version waiting")).toBeNull();
    expect(within(item).queryByRole("link", { name: "Review changes" })).toBeNull();
    expect(within(item).queryByRole("button", { name: "Generate" })).toBeNull();
    await user.click(within(item).getByRole("link", { name: "Open it" }));

    await waitFor(() => expect(pathname()).toBe("/proposals/prop-test-vorbit"));
    expect(api.writes()).toEqual([]);
  });
});

describe("the next step", () => {
  const POST = "POST /api/renders/english_resume/generate";
  const waiting = (over: Partial<Overview>, documents: RenderRow[] = [row()]): Routes => ({
    "GET /api/overview": { ...overview(documents), ...over },
  });
  const REVIEW = { openCandidates: 1085, documents: 1, importId: "imp-test-vorbit", filename: "vorbit-rollout.md" };

  /**
   * Facts from before the importer accepted on its own (issue #57). They are
   * sorted where they stand, in as many requests as it takes, and never by
   * sending the author to review them one at a time.
   */
  it("leads with the facts still waiting, and sorts them in one press", async () => {
    let left = 1085;
    const { api, user, pathname } = open(
      [],
      {
        ...waiting({ review: REVIEW }),
        "POST /api/facts/sort": () => {
          const sorted = Math.min(600, left);
          left -= sorted;
          return { sorted, flagged: 40, remaining: left };
        },
      },
    );
    const step = await nextStep();

    expect(within(step).getByRole("heading", { name: "Sort 1,085 waiting facts" })).toBeTruthy();
    expect(
      within(step).getByText(
        "Found in vorbit-rollout.md before facts were accepted for you. One press grades each, keeps every one, and flags the ones worth a look.",
      ),
    ).toBeTruthy();
    expect(within(step).queryByRole("link")).toBeNull();
    await user.click(within(step).getByRole("button", { name: "Sort them" }));

    await waitFor(() => expect(api.writes()).toEqual(["POST /api/facts/sort", "POST /api/facts/sort"]));
    // Every import's facts, so no `importId` narrows it.
    expect(api.calls.filter((c) => c.method === "POST").map((c) => c.body)).toEqual([{}, {}]);
    expect(pathname()).toBe("/");
  });

  it("says where the sort stopped, and keeps what it had sorted", async () => {
    let calls = 0;
    const { user } = open(
      [],
      {
        ...waiting({ review: REVIEW }),
        "POST /api/facts/sort": () =>
          ++calls === 1
            ? { sorted: 25, flagged: 3, remaining: 1060 }
            : new Refusal(503, "upstream_unavailable", "The facts could not be sorted just now. Nothing was changed; try again."),
      },
    );
    const step = await nextStep();
    await user.click(within(step).getByRole("button", { name: "Sort them" }));

    // The overview is read again after the sort, so the step is found afresh.
    expect(
      await screen.findByText("The facts could not be sorted just now. Nothing was changed; try again."),
    ).toBeTruthy();
    expect(within(await nextStep()).getByText("25 sorted, 3 flagged.")).toBeTruthy();
  });

  it("says how many documents the waiting facts sit in when it is more than one", async () => {
    open([], waiting({ review: { ...REVIEW, openCandidates: 1, documents: 3 } }));
    const step = await nextStep();

    expect(within(step).getByRole("heading", { name: "Sort 1 waiting fact" })).toBeTruthy();
    expect(
      within(step).getByText(
        "Found in 3 documents before facts were accepted for you. One press grades each, keeps every one, and flags the ones worth a look.",
      ),
    ).toBeTruthy();
  });

  it("lists everything else that is waiting under it, in the order to take it", async () => {
    open(
      [],
      waiting(
        {
          review: REVIEW,
          factsByProvenance: { measured: 0, attested: 96, generated: 16 },
          unconfirmed: { importId: "imp-test-quillset", count: 3, total: 3 },
        },
        [
          row({ status: "stale", currentVersionId: "ver-test-1", newFactsSince: 12 }),
          row({ kind: "rirekisho", language: "ja", title: "Qorvane 履歴書", status: "proposal_pending", pendingProposalId: "prop-test-zentrel" }),
        ],
      ),
    );
    const step = await nextStep();

    expect(within(step).getByText("Also waiting")).toBeTruthy();
    const rest = within(step).getAllByRole("listitem");
    expect(rest.map((item) => item.querySelector("span")!.textContent)).toEqual([
      "Check the new Qorvane 履歴書",
      "Confirm 3 facts",
      "Update your English résumé",
    ]);
    expect(within(rest[0]!).getByRole("link", { name: "Review changes" }).getAttribute("href")).toBe(
      "/proposals/prop-test-zentrel",
    );
    expect(within(rest[1]!).getByRole("link", { name: "Open them" }).getAttribute("href")).toBe(
      "/imports/imp-test-quillset",
    );
    expect(within(rest[2]!).getByRole("button", { name: "Update" })).toBeTruthy();
  });

  it("counts the facts to confirm in the import it opens, and says how many sit in older ones", async () => {
    open(
      [],
      waiting({
        factsByProvenance: { measured: 0, attested: 96, generated: 20 },
        // Sixteen the author accepted while still Generated, three of them in
        // the newest import. The other four the importer accepted, and flagged.
        unconfirmed: { importId: "imp-test-quillset", count: 3, total: 16 },
      }),
    );
    const step = await nextStep();

    expect(within(step).getByRole("heading", { name: "Confirm 3 facts" })).toBeTruthy();
    expect(
      within(step).getByText(
        "The importer wrote them and you have not confirmed them, so no document uses them. 13 more are in older imports.",
      ),
    ).toBeTruthy();
    expect(within(step).getByRole("link", { name: "Open them" }).getAttribute("href")).toBe(
      "/imports/imp-test-quillset",
    );
  });

  it("generates the first document from the step itself, and says a refusal beside it", async () => {
    const { api, user, pathname } = open([row()], {
      [POST]: new Refusal(409, "proposal_pending", "A proposal for this document is already waiting."),
    });
    const step = await nextStep();
    expect(within(step).getByRole("heading", { name: "Generate your English résumé" })).toBeTruthy();
    await user.click(within(step).getByRole("button", { name: "Generate" }));

    expect((await within(step).findByRole("alert")).textContent).toBe(
      "A proposal for this document is already waiting.",
    );
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(pathname()).toBe("/");
    expect(api.writes()).toEqual([POST]);
  });

  it("updates the first document that is out of date", async () => {
    const { api, user, pathname } = open(
      [row({ status: "stale", currentVersionId: "ver-test-1", newFactsSince: 1 })],
      { [POST]: { proposalId: "prop-test-plinth" } },
    );
    const step = await nextStep();
    expect(within(step).getByRole("heading", { name: "Update your English résumé" })).toBeTruthy();
    expect(within(step).getByText("1 new fact since it was generated.")).toBeTruthy();
    await user.click(within(step).getByRole("button", { name: "Update" }));

    await waitFor(() => expect(pathname()).toBe("/proposals/prop-test-plinth"));
    expect(api.writes()).toEqual([POST]);
  });

  // Issue #62: a document is out of date by a fact it can no longer use, too.
  it("says a document lost a fact it was generated from", async () => {
    open([row({ status: "stale", currentVersionId: "ver-test-1", newFactsSince: 0, withdrawnFactsSince: 1 })]);
    const step = await nextStep();
    expect(within(step).getByRole("heading", { name: "Update your English résumé" })).toBeTruthy();
    expect(within(step).getByText("1 fact it was generated from can no longer be used.")).toBeTruthy();
    expect(screen.getByText("1 fact no longer usable")).toBeTruthy();
  });

  it("says both when facts arrived and one it was generated from left", async () => {
    open([row({ status: "stale", currentVersionId: "ver-test-1", newFactsSince: 2, withdrawnFactsSince: 1 })]);
    expect(
      within(await nextStep()).getByText(
        "2 new facts since it was generated, and 1 it was generated from can no longer be used.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("2 new facts, 1 no longer usable")).toBeTruthy();
  });

  it("offers the import when no fact can be used and nothing is waiting", async () => {
    open([row()], {}, false);
    const step = await nextStep();

    expect(within(step).getByRole("heading", { name: "Import a document" })).toBeTruthy();
    expect(within(step).getByRole("button", { name: "Import a document" })).toBeTruthy();
    expect(within(step).queryByText("Also waiting")).toBeNull();
  });

  it("says so when nothing is waiting, and offers nothing to press", async () => {
    open([row({ status: "up_to_date", currentVersionId: "ver-test-1", newFactsSince: 0 })]);
    const step = await nextStep();

    expect(within(step).getByRole("heading", { name: "You are up to date" })).toBeTruthy();
    expect(within(step).queryByRole("button")).toBeNull();
    expect(within(step).queryByRole("link")).toBeNull();
  });
});

describe("the facts, in plain words", () => {
  const facts = (factsByProvenance: Overview["factsByProvenance"], over: Partial<Overview> = {}): Routes => ({
    "GET /api/overview": { ...overview([row()]), factsByProvenance, ...over },
  });
  const factRow = async (plain: string) => (await screen.findByText(plain)).closest("li")!;

  it("leads each row with plain words and names the card's term second", async () => {
    open([], facts({ measured: 3, attested: 1, generated: 0 }));
    const item = await factRow("Backed by a number");

    expect(within(item).getByText("Measured")).toBeTruthy();
    expect(within(item).getByText("A result with a figure, and the passage that proves it.")).toBeTruthy();
    expect(within(item).getByText("3")).toBeTruthy();
    expect(screen.queryByText("Facts by provenance")).toBeNull();
    expect(screen.getByText(/4 accepted\./)).toBeTruthy();
  });

  it("writes a zero as words, never as 0", async () => {
    open([], facts({ measured: 0, attested: 96, generated: 0 }));

    const measured = await factRow("Backed by a number");
    expect(within(measured).getByText("None yet")).toBeTruthy();
    expect(within(measured).queryByText("0")).toBeNull();
    const generated = await factRow("Not confirmed");
    expect(within(generated).getByText("Nothing waiting")).toBeTruthy();
    expect(within(generated).queryByRole("link")).toBeNull();
  });

  it("opens the review holding the facts that are not confirmed", async () => {
    open(
      [],
      facts(
        { measured: 0, attested: 96, generated: 16 },
        { unconfirmed: { importId: "imp-test-quillset", count: 3, total: 3 } },
      ),
    );
    const item = await factRow("Not confirmed");

    expect(within(item).getByText("16")).toBeTruthy();
    expect(within(item).getByRole("link", { name: "Confirm 3" }).getAttribute("href")).toBe(
      "/imports/imp-test-quillset",
    );
  });

  it("says there are none yet rather than three empty rows", async () => {
    open([], facts({ measured: 0, attested: 0, generated: 0 }));

    expect(
      await screen.findByText("No accepted facts yet. They are accepted for you as a document you import is read."),
    ).toBeTruthy();
    expect(screen.queryByText("Backed by a number")).toBeNull();
  });

  it("says a tile at zero in words", async () => {
    open([row()]);
    await documentRow();

    // Projects and credentials are at zero in the fixture; employers and roles are not.
    expect(screen.getAllByText("None added yet")).toHaveLength(2);
  });
});

describe("which document to act on", () => {
  const JA = { kind: "rirekisho", language: "ja", title: "Qorvane 履歴書" } as const;
  const STORY = { kind: "career_story_en", title: "Career story" } as const;
  // The line speaks for the rows of the tab that is open (issue #59).
  const line = async (title?: string) => (await documentRow(title)).closest('[role="tabpanel"]')!.querySelector("p")!;

  it("says how many are out of date and that the rest can wait", async () => {
    open([
      row({ status: "stale", currentVersionId: "ver-test-1", newFactsSince: 12 }),
      row({ ...STORY, status: "stale", currentVersionId: "ver-test-2", newFactsSince: 12 }),
      // Out of date too, and under the other tab: it is not this line's to count.
      row({ ...JA, status: "stale", currentVersionId: "ver-test-3", newFactsSince: 12 }),
    ]);

    expect((await line()).textContent).toBe(
      "2 of 2 are out of date. Update the one you need next; each is updated on its own, and the rest can wait.",
    );
    const item = await documentRow();
    expect(within(item).getByText("12 new facts")).toBeTruthy();
    // One button a row; history and the download are links beside it.
    expect(within(item).getAllByRole("button").map((b) => b.textContent)).toEqual(["Download", "Update"]);
    expect(within(item).getByRole("link", { name: "History" }).getAttribute("href")).toBe(
      "/renders/english_resume/history",
    );
  });

  it("says to wait for a proposal still being written, then to check it once it is ready", async () => {
    let reads = 0;
    const WRITING = row({ status: "proposal_generating", pendingProposalId: "prop-test-vorbit" });
    open([], {
      "GET /api/overview": () =>
        overview([++reads === 1 ? WRITING : { ...WRITING, status: "proposal_pending" }]),
    });
    const step = await nextStep();

    expect(within(step).getByRole("heading", { name: "Wait for the new English résumé" })).toBeTruthy();
    expect(within(step).getByText("It is still being written. Open it to watch it arrive.")).toBeTruthy();
    expect(within(step).queryByText("A new version is ready. Nothing changes until you accept it.")).toBeNull();
    expect(within(step).getByRole("link", { name: "Open it" }).getAttribute("href")).toBe(
      "/proposals/prop-test-vorbit",
    );

    // Nothing is pressed: the screen asks again on its own while one is being written.
    await waitFor(
      () => expect(within(step).getByRole("heading", { name: "Check the new English résumé" })).toBeTruthy(),
      { timeout: 4_000 },
    );
    expect(within(step).getByRole("link", { name: "Review changes" }).getAttribute("href")).toBe(
      "/proposals/prop-test-vorbit",
    );
  });

  it("puts a proposal ready to check before one still being written", async () => {
    open([
      row({ status: "proposal_generating", pendingProposalId: "prop-test-vorbit" }),
      row({ kind: "rirekisho", language: "ja", title: "Qorvane 履歴書", status: "proposal_pending", pendingProposalId: "prop-test-zentrel" }),
    ]);
    const step = await nextStep();

    expect(within(step).getByRole("heading", { name: "Check the new Qorvane 履歴書" })).toBeTruthy();
    expect(within(step).getByRole("link", { name: "Review changes" }).getAttribute("href")).toBe(
      "/proposals/prop-test-zentrel",
    );
  });

  it("names the one document that is out of date", async () => {
    open([row({ status: "stale", currentVersionId: "ver-test-1", newFactsSince: 3 }), row(JA)]);

    expect((await line()).textContent).toBe("English résumé is out of date. Update it when you next need it.");
  });

  it("points at the document with a version waiting", async () => {
    open([
      row({ status: "stale", currentVersionId: "ver-test-1", newFactsSince: 12 }),
      row({ ...STORY, status: "proposal_pending", pendingProposalId: "prop-test-zentrel" }),
    ]);

    expect((await line()).textContent).toBe("Career story has a new version waiting for you. Check it first.");
  });

  it("says on the other tab that a version is waiting under it, and points at it once that tab is open", async () => {
    const { user } = open([
      row({ status: "stale", currentVersionId: "ver-test-1", newFactsSince: 12 }),
      row({ ...JA, status: "proposal_pending", pendingProposalId: "prop-test-zentrel" }),
    ]);

    // The English tab speaks for the English rows only.
    expect((await line()).textContent).toBe("English résumé is out of date. Update it when you next need it.");
    expect(screen.getByRole("tab", { name: "English" })).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: "日本語 new version waiting" }));

    expect((await line(JA.title)).textContent).toBe("Qorvane 履歴書 has a new version waiting for you. Check it first.");
  });

  it("points at a waiting version when no fact remains usable", async () => {
    open([row({ status: "proposal_pending", pendingProposalId: "prop-test-waiting" })], {}, false);

    expect((await line()).textContent).toBe("English résumé has a new version waiting for you. Check it first.");
  });

  it("says a new version is being written, not that it is waiting", async () => {
    open([row({ status: "proposal_generating", pendingProposalId: "prop-test-vorbit" }), row(JA)]);

    expect((await line()).textContent).toBe(
      "A new version of English résumé is being written. Check it when it is ready.",
    );
  });

  it("points at the version that is ready when another is still being written", async () => {
    open([
      row({ status: "proposal_generating", pendingProposalId: "prop-test-vorbit" }),
      row({ ...STORY, status: "proposal_pending", pendingProposalId: "prop-test-zentrel" }),
    ]);

    expect((await line()).textContent).toBe("Career story has a new version waiting for you. Check it first.");
  });

  it("says none is generated yet", async () => {
    open([row(), row(JA)]);

    expect((await line()).textContent).toBe(
      "None generated yet. Generate the one you need first; each is made on its own.",
    );
  });

  it("says so when every generated document is up to date", async () => {
    open([row({ status: "up_to_date", currentVersionId: "ver-test-1", newFactsSince: 0 }), row(JA)]);

    expect((await line()).textContent).toBe("Every document you have generated is up to date with your record.");
    expect(within(await documentRow()).getByRole("button", { name: "Regenerate" })).toBeTruthy();
  });
});

/**
 * Issue #59. One mixed list of five became two tabs, English and 日本語, each
 * led by the master document every document on it is written from.
 */
describe("the English documents and the Japanese ones, apart", () => {
  const ROWS = [
    row(),
    row({ kind: "rirekisho", language: "ja", title: "履歴書" }),
    row({ kind: "shokumu_keirekisho", language: "ja", title: "職務経歴書" }),
    row({ kind: "career_story_en", title: "Career story" }),
    row({ kind: "career_story_ja", language: "ja", title: "職務経歴ストーリー" }),
  ];
  // `Master document` is a sidebar row too; this is the one that leads a tab.
  const masterRow = async (title: string) => {
    return (await within(await screen.findByRole("tabpanel")).findByText(title)).closest("li")!;
  };
  const titles = () =>
    within(screen.getByRole("tabpanel"))
      .getAllByRole("listitem")
      .map((item) => item.querySelector("div > div")!.textContent);

  it("shows the English documents first, under the English master document", async () => {
    open(ROWS);
    await documentRow();

    expect(screen.getAllByRole("tab").map((tab) => [tab.textContent, tab.getAttribute("aria-selected")])).toEqual([
      ["English", "true"],
      ["日本語", "false"],
    ]);
    expect(titles()).toEqual(["Master document", "English résumé", "Career story"]);
    expect(screen.queryByText("履歴書")).toBeNull();
    // The panel is named by the tab that is open.
    expect(screen.getByRole("tabpanel", { name: "English" })).toBeTruthy();
  });

  it("shows the Japanese documents under 日本語, led by the Japanese master document", async () => {
    const { user } = open(ROWS);
    await documentRow();
    await user.click(screen.getByRole("tab", { name: "日本語" }));

    expect(titles()).toEqual(["マスタードキュメント", "履歴書", "職務経歴書", "職務経歴ストーリー"]);
    expect(screen.queryByText("English résumé")).toBeNull();
    expect(screen.getByRole("tabpanel", { name: "日本語" })).toBeTruthy();
    expect(within(await documentRow("履歴書")).getByRole("button", { name: "Generate" })).toBeTruthy();
  });

  it("moves between the tabs with the arrow keys, from one tab stop", async () => {
    const { user } = open(ROWS);
    await documentRow();
    const [english, japanese] = screen.getAllByRole("tab");
    expect([english!.tabIndex, japanese!.tabIndex]).toEqual([0, -1]);

    english!.focus();
    await user.keyboard("{ArrowRight}");
    expect(japanese!.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(japanese);
    expect(titles()[0]).toBe("マスタードキュメント");

    await user.keyboard("{ArrowRight}");
    expect(english!.getAttribute("aria-selected")).toBe("true");
  });

  it("keeps the chosen language for the next visit", async () => {
    const { user } = open(ROWS);
    await documentRow();
    await user.click(screen.getByRole("tab", { name: "日本語" }));

    expect(localStorage.getItem("track-record:document-language")).toBe("ja");
  });

  it("leads each tab with a master document row: how many facts it lists, and one way in", async () => {
    const { user } = open(ROWS);
    const english = await masterRow("Master document");

    expect(within(english).getByText("4 facts")).toBeTruthy();
    expect(within(english).getByText(/^English · everything in your record/)).toBeTruthy();
    expect(within(english).getByRole("link", { name: "Open the English master document" }).getAttribute("href")).toBe("/master");
    // Not a generated document: nothing to generate, no history, and no download from here.
    expect(within(english).queryAllByRole("button")).toEqual([]);

    await user.click(screen.getByRole("tab", { name: "日本語" }));
    const japanese = await masterRow("マスタードキュメント");
    expect(within(japanese).getByRole("link", { name: "Open the Japanese master document" }).getAttribute("href")).toBe("/master");
  });

  it("opens the master document of the tab it was opened from", async () => {
    const { api, user, pathname } = open(ROWS, {
      "GET /api/master-document?language=ja": {
        language: "ja",
        builtAt: "2026-10-10T03:00:00.000Z",
        subjectName: null,
        counts: { facts: 0, usable: 0, private: 0, generated: 0, flagged: 0, waiting: 0 },
        employers: [],
        independent: { projects: [], facts: [] },
        educations: [],
        certifications: [],
      },
    });
    await documentRow();
    await user.click(screen.getByRole("tab", { name: "日本語" }));
    await user.click(screen.getByRole("link", { name: "Open the Japanese master document" }));

    await waitFor(() => expect(pathname()).toBe("/master"));
    await waitFor(() => expect(api.calls.map((call) => call.path)).toContain("/api/master-document?language=ja"));
    expect(api.calls.map((call) => call.path)).not.toContain("/api/master-document");
    expect((await screen.findByRole("tab", { name: "日本語" })).getAttribute("aria-selected")).toBe("true");
  });

  it("says the master document has no facts yet rather than a zero", async () => {
    open([], { "GET /api/overview": { ...overview(ROWS), factsByProvenance: { measured: 0, attested: 0, generated: 0 } } });

    expect(within(await masterRow("Master document")).getByText("No facts yet")).toBeTruthy();
  });
});

/**
 * Issue #57. A flag is advice, so it is a line under the facts and never the
 * Next step; the master document is one link from the facts it lists; and a
 * tailored résumé is a row of its own, addressed by its id.
 */
describe("what automatic acceptance adds to Home", () => {
  const with57 = (over: Partial<Overview>, documents: RenderRow[] = [row()]): Routes => ({
    "GET /api/overview": { ...overview(documents), ...over },
  });
  const tailored = (n: number, over: Partial<RenderRow> = {}): RenderRow =>
    row({
      id: `rnd-test-${n}`,
      ref: `rnd-test-${n}`,
      title: `Résumé for Quillset ${n}`,
      tailored: { label: `Quillset role ${n}`, createdAt: "2026-10-07T03:00:00.000Z" },
      ...over,
    });

  it("says how many facts are flagged and where the list is, and makes no step of them", async () => {
    open(
      [],
      with57(
        { factsByProvenance: { measured: 3, attested: 20, generated: 5 }, flagged: 9 },
        [row({ status: "up_to_date", currentVersionId: "ver-test-1", currentVersionNo: 1, newFactsSince: 0 })],
      ),
    );
    // Found by its own words: the frame shown before the read answers has the
    // section's heading and none of its content.
    const line = await screen.findByText("9 are flagged for you to check when you want. Each says why.");
    expect(within(line.closest("p")!).getByRole("link", { name: "Open the list" }).getAttribute("href")).toBe("/flagged");
    // Five Generated facts the importer accepted: counted, flagged, and not a
    // thing the author is told to do next.
    const generated = (await screen.findByText("Not confirmed")).closest("li")!;
    expect(within(generated).getByText("5")).toBeTruthy();
    expect(within(generated).queryByRole("link")).toBeNull();
    const step = await nextStep();
    expect(within(step).queryByText(/Confirm/)).toBeNull();
    expect(within(step).queryByText(/flagged/)).toBeNull();
  });

  it("says nothing about flags when there are none", async () => {
    open([], with57({ flagged: 0 }));
    await screen.findByText("Not confirmed");
    expect(screen.queryByRole("link", { name: "Open the list" })).toBeNull();
  });

  it("opens the master document from the facts it lists", async () => {
    open([], with57({}));
    expect((await screen.findByRole("link", { name: "Open master document" })).getAttribute("href")).toBe("/master");
  });

  it("names the main résumé as the one tailored to no job", async () => {
    open([row()]);
    expect(within(await documentRow()).getByText("English · your main résumé, tailored to no job")).toBeTruthy();
  });

  it("lists the newest tailored résumés by name, and says how many more there are", async () => {
    open([], with57({ tailored: [1, 2, 3, 4, 5].map((n) => tailored(n)) }));
    const section = (await screen.findByText("Quillset role 1")).closest("section")!;

    expect(within(section).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      expect.stringContaining("Quillset role 1"),
      expect.stringContaining("Quillset role 2"),
      expect.stringContaining("Quillset role 3"),
    ]);
    expect(within(section).getByText("And 2 more on the Tailored résumés screen.")).toBeTruthy();
    expect(within(section).getByRole("link", { name: "Open tailored résumés" }).getAttribute("href")).toBe("/tailored");
  });

  it("generates the tailored résumé whose row was pressed, by its own id", async () => {
    const POST = "POST /api/renders/rnd-test-2/generate";
    const { api, user, pathname } = open([], {
      ...with57({ tailored: [tailored(1), tailored(2)] }),
      [POST]: { proposalId: "prop-test-orrery" },
    });
    const item = (await screen.findByText("Quillset role 2")).closest("li")!;
    await user.click(within(item).getByRole("button", { name: "Generate" }));

    await waitFor(() => expect(pathname()).toBe("/proposals/prop-test-orrery"));
    expect(api.writes()).toEqual([POST]);
  });

  it("offers to make the first tailored résumé when there are none", async () => {
    open([], with57({ tailored: [] }));
    const link = await screen.findByRole("link", { name: "Make one" });

    expect(link.getAttribute("href")).toBe("/tailored");
    expect(within(link.closest("section")!).queryAllByRole("listitem")).toEqual([]);
  });
});

describe("the sidebar", () => {
  it("says what its count counts", async () => {
    open([row()], { "GET /api/imports/summary": { openCandidates: 1085, running: false } });

    // jsdom joins the two lines of the row without the space a browser reads between them.
    const link = await screen.findByRole("link", { name: /^Documents\s*1,085 facts to sort$/ });
    expect(link.getAttribute("href")).toBe("/documents");
  });

  it("counts the flags still to check beside Flagged, and none once all are checked", async () => {
    open([row()], { "GET /api/imports/summary": { openCandidates: 0, running: false, openFlags: 212 } });

    const link = await screen.findByRole("link", { name: /^Flagged\s*212 to check$/ });
    expect(link.getAttribute("href")).toBe("/flagged");
    expect(screen.getByRole("link", { name: "Documents" })).toBeTruthy();
  });

  it("shows no count at zero, and no row for a screen that is not built", async () => {
    open([row()]);
    await documentRow();

    const nav = screen.getByRole("navigation");
    expect(within(nav).getAllByRole("link").map((a) => a.textContent)).toEqual([
      "Home",
      "Record",
      "Skills",
      "Documents",
      "Flagged",
      "Master document",
      "Tailored résumés",
    ]);
    expect(within(nav).queryByText("Facts")).toBeNull();
  });
});

/**
 * Loads the overview, leaves for Documents and comes back, so the overview is
 * read again, and answers that second read with `second`. Any read after it
 * gets `third`.
 */
async function failLaterRead(
  second: () => unknown,
  third: () => unknown = second,
  first: Overview = overview([row()]),
) {
  let attempt = 0;
  const mounted = open([], {
    "GET /api/overview": () => (++attempt === 1 ? first : attempt === 2 ? second() : third()),
    "GET /api/imports": { openCandidates: 0, documents: [] },
  });
  const nav = await screen.findByRole("navigation");
  await waitFor(() => expect(attempt).toBe(1));
  await mounted.user.click(within(nav).getByRole("link", { name: "Documents" }));
  await mounted.user.click(within(screen.getByRole("navigation")).getByRole("link", { name: "Home" }));
  await waitFor(() => expect(attempt).toBe(2));
  return { ...mounted, reads: () => attempt };
}

describe("an overview that could not be read", () => {
  it("says so rather than loading forever", async () => {
    open([], { "GET /api/overview": UNREACHABLE });

    expect((await screen.findByRole("alert")).textContent).toBe(NOT_READ);
    expect(toneOf(screen.getByRole("alert"))).toBe("text-secondary");
    expect(screen.queryByText("Loading your record…")).toBeNull();
  });

  it("reads it again on Retry and shows it once it arrives", async () => {
    let attempt = 0;
    const { api, user } = open([], {
      "GET /api/overview": () => (++attempt === 1 ? UNREACHABLE() : overview([row()])),
    });
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "Retry" }));

    await documentRow();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(api.writes()).toEqual([]);
  });

  it("shows the loading state again while Retry reads", async () => {
    let attempt = 0;
    const { user } = open([], {
      "GET /api/overview": () => (++attempt === 1 ? UNREACHABLE() : new Promise(() => {})),
    });
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "Retry" }));

    await screen.findByText("Loading your record…");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("keeps the overview it has when a later read fails, and says it may be out of date", async () => {
    await failLaterRead(() => UNREACHABLE());

    expect(await documentRow()).toBeTruthy();
    expect((await screen.findByRole("status")).textContent).toBe(
      `Could not refresh: ${NOT_READ} What is shown may be out of date.`,
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("says it may be out of date on an empty record too", async () => {
    await failLaterRead(() => UNREACHABLE(), undefined, { ...overview([]), isEmpty: true });

    await screen.findByRole("heading", { name: "Your record is empty" });
    expect((await screen.findByRole("status")).textContent).toBe(
      `Could not refresh: ${NOT_READ} What is shown may be out of date.`,
    );
  });

  it("reads again on Retry after a later read fails, and the line goes once one arrives", async () => {
    const { api, user } = await failLaterRead(
      () => UNREACHABLE(),
      () => overview([row(), row({ kind: "rirekisho", language: "ja", title: "Qorvane 履歴書" })]),
    );
    await screen.findByRole("status");
    await user.click(screen.getByRole("button", { name: "Retry" }));

    await screen.findByText("English résumé");
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(api.writes()).toEqual([]);
  });

  it("keeps the overview and disables Retry while it reads again after a later read fails", async () => {
    const { user, reads } = await failLaterRead(
      () => UNREACHABLE(),
      () => new Promise(() => {}),
    );
    await screen.findByRole("status");
    await user.click(screen.getByRole("button", { name: "Retry" }));

    const retry = await screen.findByRole("button", { name: "Retry" });
    await waitFor(() => expect((retry as HTMLButtonElement).disabled).toBe(true));
    expect(retry.getAttribute("title")).toBe("Retrying…");
    expect(await documentRow()).toBeTruthy();
    expect(reads()).toBe(3);
  });

  it("keeps the sidebar, so the author can leave for another screen", async () => {
    open([], { "GET /api/overview": UNREACHABLE });

    await screen.findByRole("alert");
    const nav = screen.getByRole("navigation");
    expect(within(nav).getByRole("link", { name: "Record" }).getAttribute("href")).toBe("/record");
  });

  it("keeps the sidebar while the overview is loading", async () => {
    open([], { "GET /api/overview": () => new Promise(() => {}) });

    await screen.findByText("Loading your record…");
    expect(within(screen.getByRole("navigation")).getByRole("link", { name: "Documents" })).toBeTruthy();
  });
});

describe("an overview a write has made untrue", () => {
  const IMPORT = "imp-test-1";
  const READING: Overview = {
    ...overview([row()]),
    activeImport: {
      importId: IMPORT,
      sourceDocumentId: "doc-test-1",
      versionNo: 1,
      status: "extracting",
      chunksTotal: 4,
      chunksDone: 0,
      candidatesExtracted: 0,
      candidatesDiscarded: 0,
      candidatesSuppressed: 0,
      wordCount: 42,
      changedRegionShare: null,
      error: null,
      failedAtChunk: null,
      filename: "quillset-notes.md",
    },
  };
  const SOURCE = "Cut the zentrel batch from 40 minutes to 9 minutes.";

  it("holds the next step and the progress panel back until the read after it answers", async () => {
    let finished = false;
    let answer!: (fresh: Overview) => void;
    const { api, user, pathname } = mount("/", {
      // The read after the write is slow, as it is in production (issue #58).
      "GET /api/overview": () =>
        finished ? new Promise<Overview>((resolve) => (answer = resolve)) : READING,
      "GET /api/imports/summary": { openCandidates: 0, running: true },
      [`GET /api/imports/${IMPORT}`]: { ...READING.activeImport, status: "ready", chunksDone: 4 },
      [`GET /api/facts?importId=${IMPORT}`]: {
        items: [
          {
            id: "fact-test-1",
            claim: "Cut the zentrel batch to 9 minutes",
            provenance: "measured",
            disclosure: "public",
            status: "accepted",
            employerId: null,
            employerSetByHand: false,
            projectId: null,
            evidence: {
              sourceDocumentVersionId: "dv-test-1",
              lineNumber: 1,
              quoteStart: 0,
              quoteEnd: SOURCE.length,
            },
            technologies: [],
            isClientIdentifying: false,
            graded: true,
            autoAccepted: false,
            gradedBy: "author",
            flags: [],
            likelyMatches: [],
          },
        ],
      },
      "GET /api/source-documents/doc-test-1/versions/1/text": {
        sourceDocumentVersionId: "dv-test-1",
        filename: "quillset-notes.md",
        project: null,
        wordCount: 42,
        importedAt: "2026-09-01T00:00:00.000Z",
        text: SOURCE,
      },
      "GET /api/employers": { items: [] },
      [`POST /api/imports/${IMPORT}/finish`]: () => {
        finished = true;
        return { acceptedFacts: 1 };
      },
    });
    await screen.findByText(/Still working, please wait\./);
    expect(within(await nextStep()).getByRole("heading").textContent).toBe("Wait for the first facts");

    await user.click(within(await nextStep()).getByRole("link", { name: "Open review" }));
    await user.click(await screen.findByRole("button", { name: "Add 1 facts to record" }));
    await waitFor(() => expect(pathname()).toBe("/"));
    expect(api.writes()).toEqual([`POST /api/imports/${IMPORT}/finish`]);

    // Home is back with the overview it had, and the read after the write is still out.
    expect((await screen.findByRole("status")).textContent).toBe("Checking what is waiting for you now…");
    expect(screen.queryByText(/Still working, please wait\./)).toBeNull();
    expect(screen.queryByText("Wait for the first facts")).toBeNull();
    expect(screen.queryByRole("region", { name: "Next step" })).toBeNull();
    // Only those two are held: the rest of the page stands.
    for (const heading of SECTIONS) expect(screen.getByRole("heading", { name: heading })).toBeTruthy();

    answer(overview([row()]));

    expect(within(await nextStep()).getByRole("heading").textContent).toBe("Generate your English résumé");
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText(/Still working, please wait\./)).toBeNull();
  });

  it("holds the next step back after Generate, on a return to Home before the proposal is decided", async () => {
    const POST = "POST /api/renders/english_resume/generate";
    let reads = 0;
    let answer!: (fresh: Overview) => void;
    const after = new Promise<Overview>((resolve) => (answer = resolve));
    const { api, user, pathname, back } = mount("/", {
      "GET /api/overview": () => (++reads === 1 ? overview([row()]) : after),
      "GET /api/imports/summary": { openCandidates: 0, running: false },
      [POST]: { proposalId: "prop-test-plinth" },
      "GET /api/proposals/prop-test-plinth": {
        id: "prop-test-plinth",
        renderKind: "english_resume",
        status: "pending",
        generationStatus: "generating",
        error: null,
        basedOnVersionNo: null,
        proposedVersionNo: 1,
        generatedAt: "2026-09-01T00:00:00.000Z",
        reason: null,
        warnings: [],
        unchanged: false,
        withheld: { privateFactCount: 0, generatedFactCount: 0 },
      },
    });
    await user.click(within(await nextStep()).getByRole("button", { name: "Generate" }));
    await waitFor(() => expect(pathname()).toBe("/proposals/prop-test-plinth"));
    await screen.findByText("Writing the first version. Nothing is saved until you accept it.");
    expect(api.writes()).toEqual([POST]);

    back();
    await waitFor(() => expect(pathname()).toBe("/"));

    // The overview Home had still says to generate, and the read after the write is still out.
    expect((await screen.findByRole("status")).textContent).toBe("Checking what is waiting for you now…");
    expect(screen.queryByText("Generate your English résumé")).toBeNull();
    expect(screen.queryByRole("region", { name: "Next step" })).toBeNull();

    answer(overview([row({ status: "proposal_generating", pendingProposalId: "prop-test-plinth" })]));

    expect(within(await nextStep()).getByRole("heading").textContent).toBe("Wait for the new English résumé");
    expect(screen.queryByRole("status")).toBeNull();
    expect(api.writes()).toEqual([POST]);
  });

  it("holds the next step back after a failed import is retried, on a return to Home", async () => {
    const RETRY = `POST /api/imports/${IMPORT}/retry`;
    const { activeImport } = READING;
    const { filename, ...queued } = { ...activeImport!, status: "queued" as const };
    let reads = 0;
    let answer!: (fresh: Overview) => void;
    const after = new Promise<Overview>((resolve) => (answer = resolve));
    const { api, user, pathname } = mount("/", {
      "GET /api/overview": () => (++reads === 1 ? overview([row({ status: "up_to_date", currentVersionId: "ver-test-1" })]) : after),
      "GET /api/imports/summary": { openCandidates: 0, running: false },
      "GET /api/imports": {
        openCandidates: 0,
        documents: [
          {
            sourceDocumentId: "doc-test-1",
            filename,
            mimeType: "text/markdown",
            project: null,
            employer: null,
            lastImportedAt: "2026-09-02T00:00:00.000Z",
            openCandidates: 0,
            reimportable: true,
            versions: [
              {
                importId: IMPORT,
                versionNo: 1,
                importedAt: "2026-09-01T00:00:00.000Z",
                status: "failed",
                wordCount: 42,
                changedRegionShare: null,
                chunksTotal: 4,
                chunksDone: 1,
                extractorVersion: "test",
                facts: { accepted: 0, rejected: 0, open: 0 },
                error: { code: "extraction_failed", message: "Extraction stopped at chunk 2." },
              },
            ],
          },
        ],
      },
      "GET /api/projects": { items: [] },
      "GET /api/employers": { items: [] },
      [RETRY]: queued,
    });
    expect(within(await nextStep()).getByRole("heading").textContent).toBe("You are up to date");

    await user.click(screen.getByRole("link", { name: "Documents" }));
    await user.click(await screen.findByRole("button", { name: "Retry" }));
    await waitFor(() => expect(api.writes()).toEqual([RETRY]));
    await user.click(screen.getByRole("link", { name: "Home" }));
    await waitFor(() => expect(pathname()).toBe("/"));

    // The overview Home had says nothing is waiting, and the read after the write is still out.
    expect((await screen.findByRole("status")).textContent).toBe("Checking what is waiting for you now…");
    expect(screen.queryByText("You are up to date")).toBeNull();
    expect(screen.queryByRole("region", { name: "Next step" })).toBeNull();

    answer({ ...READING, activeImport: { ...queued, filename } });

    expect(within(await nextStep()).getByRole("heading").textContent).toBe("Wait for the first facts");
    expect(await screen.findByText(/Still working, please wait\./)).toBeTruthy();
    expect(api.writes()).toEqual([RETRY]);
  });

  it("holds nothing back for a poll while an import runs", async () => {
    let reads = 0;
    mount("/", {
      "GET /api/overview": () => (++reads === 1 ? READING : new Promise(() => {})),
      "GET /api/imports/summary": { openCandidates: 0, running: true },
    });
    await screen.findByText(/Still working, please wait\./);

    // The second read is the poll, and it never answers.
    await waitFor(() => expect(reads).toBe(2), { timeout: 4_000 });
    expect(screen.getByText(/Still working, please wait\./)).toBeTruthy();
    expect(within(await nextStep()).getByRole("heading").textContent).toBe("Wait for the first facts");
  });
});

describe("the frame, before any read has answered", () => {
  const NEVER = () => new Promise(() => {});
  afterEach(() => vi.useRealTimers());

  it("draws every section's heading over blank blocks while the overview is read", async () => {
    open([], { "GET /api/overview": NEVER });

    expect((await screen.findByRole("status")).textContent).toBe("Loading your record…");
    expect(screen.getByRole("heading", { name: "Home" })).toBeTruthy();
    for (const name of ["Next step", ...SECTIONS]) {
      expect(screen.getByRole("heading", { name })).toBeTruthy();
    }
  });

  it("is drawn while the session is still being read, with the overview asked for beside it", async () => {
    const { api } = open([], { "GET /api/auth/session": NEVER });

    await screen.findByRole("heading", { name: "Your career documents" });
    expect(screen.getByRole("navigation")).toBeTruthy();
    await waitFor(() => expect(api.calls.map((call) => call.path)).toContain("/api/overview"));
    // Nothing of the record shows until the session has answered.
    expect(screen.queryByText("English résumé")).toBeNull();
  });

  it("shows nothing of the record to a visit with no profile, which goes to the profile form", async () => {
    const { pathname } = open([row()], {
      "GET /api/profile": new Refusal(404, "not_found", "No profile yet."),
    });

    await waitFor(() => expect(pathname()).toBe("/profile"));
    expect(screen.queryByText("English résumé")).toBeNull();
  });

  it("gives way to sign-in for a visit with no session", async () => {
    open([row()], { "GET /api/auth/session": new Refusal(401, "unauthenticated", "Sign in to continue.") });

    await screen.findByRole("button", { name: "Continue with Google" });
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByText("English résumé")).toBeNull();
  });

  it("says the read is slow after four seconds", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    open([], { "GET /api/overview": NEVER });
    await screen.findByText("Loading your record…");

    await vi.advanceTimersByTimeAsync(4_000);

    expect((await screen.findByRole("status")).textContent).toBe(
      "Still loading. This is taking longer than usual.",
    );
  });
});

describe("an empty record", () => {
  const empty = (): Overview => ({ ...overview([]), isEmpty: true });

  it("is a different screen: import is the only action, with none of the sections", async () => {
    open([], { "GET /api/overview": empty() });

    await screen.findByRole("heading", { name: "Your record is empty" });
    expect(screen.getByRole("button", { name: "Choose a file" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Import a document" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Quick capture" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Next step" })).toBeNull();
    for (const name of SECTIONS) expect(screen.queryByRole("heading", { name })).toBeNull();
    expect(screen.queryByRole("link", { name: "Export my record" })).toBeNull();
  });

  it("says the loop as three steps to follow", async () => {
    open([], { "GET /api/overview": empty() });
    await screen.findByRole("heading", { name: "Your record is empty" });

    const steps = within(screen.getByRole("main")).getAllByRole("listitem");
    expect(steps.map((step) => step.querySelector("strong")!.textContent)).toEqual([
      "Import",
      "Check",
      "Generate",
    ]);
  });

  it("names only the types that import", async () => {
    open([], { "GET /api/overview": empty() });

    expect(await screen.findByText("Choose a Markdown or plain text file.")).toBeTruthy();
  });

  it("says so beneath the picker when the upload never reaches the server", async () => {
    const { user } = open([], {
      "GET /api/overview": empty(),
      "GET /api/projects": { items: [] },
      "GET /api/employers": { items: [] },
      "POST /api/imports": UNREACHABLE,
    });
    await screen.findByRole("heading", { name: "Your record is empty" });

    await user.upload(document.querySelector<HTMLInputElement>('input[type="file"]')!, file());

    expect((await screen.findByRole("alert")).textContent).toBe(NOT_REACHED);
    expect(toneOf(screen.getByRole("alert"))).toBe("text-secondary");
  });
});

describe("importing a document from the header", () => {
  it("says so when the upload never reaches the server", async () => {
    const { api, user } = open([row()], {
      "GET /api/projects": { items: [] },
      "GET /api/employers": { items: [] },
      "POST /api/imports": UNREACHABLE,
    });
    await documentRow();

    const header = screen.getByRole("button", { name: "Import a document" }).closest("header")!;
    await user.upload(header.querySelector<HTMLInputElement>('input[type="file"]')!, file());

    expect((await screen.findByRole("alert")).textContent).toBe(NOT_REACHED);
    expect(toneOf(screen.getByRole("alert"))).toBe("text-secondary");
    expect(api.writes()).toEqual(["POST /api/imports"]);
  });
});

describe("filing a new document at import", () => {
  const QORVANE: Employer = {
    id: "emp-test-qorvane",
    nameJa: "株式会社コルヴェイン",
    nameLatin: "Qorvane Labs K.K.",
    businessDescription: null,
    industryJa: null,
    capitalYen: null,
    headcount: null,
    employmentType: "full_time",
    startedOn: "2021-04-01",
    endedOn: null,
    leavingReasonJa: null,
    sortOrder: 0,
  };
  const CREATED = { importId: "imp-test-9", sourceDocumentId: "src-test-9", versionNo: 1 };

  async function choose(routes: Routes) {
    const mounted = open([row()], { "POST /api/imports": CREATED, ...routes });
    await documentRow();
    const header = screen.getByRole("button", { name: "Import a document" }).closest("header")!;
    await mounted.user.upload(header.querySelector<HTMLInputElement>('input[type="file"]')!, file());
    return mounted;
  }

  it("offers the employer alone when the record holds employers and no projects, and sends the one chosen", async () => {
    const { api, user } = await choose({
      "GET /api/projects": { items: [] },
      "GET /api/employers": { items: [QORVANE] },
    });

    const employer = await screen.findByRole("combobox", { name: "Employer" });
    expect(screen.queryByRole("combobox", { name: "File it under" })).toBeNull();
    expect(within(employer).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "No employer",
      "Qorvane Labs K.K.",
    ]);
    // Choosing a file writes nothing on its own.
    expect(api.writes()).toEqual([]);

    await user.selectOptions(employer, QORVANE.id);
    await user.click(screen.getByRole("button", { name: "Import" }));

    await waitFor(() => expect(api.writes()).toEqual(["POST /api/imports"]));
    const form = api.bodyOf("POST", "/api/imports") as Record<string, unknown>;
    expect(form.employerId).toBe(QORVANE.id);
    expect(form.projectId).toBeUndefined();
  });

  it("sends no employer when the select is left at No employer", async () => {
    const { api, user } = await choose({
      "GET /api/projects": { items: [] },
      "GET /api/employers": { items: [QORVANE] },
    });

    await screen.findByRole("combobox", { name: "Employer" });
    await user.click(screen.getByRole("button", { name: "Import" }));

    await waitFor(() => expect(api.writes()).toEqual(["POST /api/imports"]));
    expect((api.bodyOf("POST", "/api/imports") as Record<string, unknown>).employerId).toBeUndefined();
  });

  it("imports nothing when the employers cannot be read", async () => {
    const { api } = await choose({
      "GET /api/projects": { items: [] },
      "GET /api/employers": new Refusal(500, "internal", "Something went wrong."),
    });

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Your projects and employers could not be read, so this document was not imported. Try again.",
    );
    expect(api.writes()).toEqual([]);
  });
});

describe("an import in progress", () => {
  const importing = (chunksDone: number, chunksTotal: number): Overview => ({
    ...overview([row()]),
    activeImport: {
      importId: "imp-test-vorbit",
      sourceDocumentId: "doc-test-vorbit",
      versionNo: 1,
      status: "extracting",
      chunksTotal,
      chunksDone,
      candidatesExtracted: 0,
      candidatesDiscarded: 0,
      candidatesSuppressed: 0,
      wordCount: 1200,
      changedRegionShare: null,
      error: null,
      failedAtChunk: null,
      filename: "vorbit-rollout.md",
    },
  });
  const panel = () => screen.findByRole("region", { name: "Import in progress" });

  it("names the document, says it is still working, and shows how far it has got", async () => {
    open([], { "GET /api/overview": importing(2, 5) });

    const region = await panel();
    // A long name is cut short on screen, so the whole of it is kept for hover.
    expect(within(region).getByText("vorbit-rollout.md").title).toBe("vorbit-rollout.md");
    expect(within(region).getByText("40%")).toBeTruthy();
    expect(within(region).getByRole("progressbar").getAttribute("aria-valuenow")).toBe("40");
    expect(within(region).getByText("Still working, please wait. 2 of 5 parts read.")).toBeTruthy();
    // Above the next step, which carries the way into the review.
    const step = await nextStep();
    expect(region.compareDocumentPosition(step) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("opens fact review for that import from the next step, and writes nothing", async () => {
    const { api, user, pathname } = open([], { "GET /api/overview": importing(2, 5) });
    const step = await nextStep();
    expect(within(step).getByRole("heading", { name: "Wait for the first facts" })).toBeTruthy();
    await user.click(within(step).getByRole("link", { name: "Open review" }));

    await waitFor(() => expect(pathname()).toBe("/imports/imp-test-vorbit"));
    expect(api.writes()).toEqual([]);
  });

  it("says the document is being got ready before it has been split", async () => {
    open([], { "GET /api/overview": importing(0, 0) });

    const region = await panel();
    expect(within(region).getByText("0%")).toBeTruthy();
    expect(within(region).getByText("Still working, please wait. Getting the document ready.")).toBeTruthy();
  });

  it("reads again while the import runs, so the bar moves", async () => {
    let read = 0;
    open([], { "GET /api/overview": () => importing(++read, 5) });

    await waitFor(() => expect(screen.getByText("40%")).toBeTruthy(), { timeout: 4_000 });
  });

  it("is absent when nothing is importing", async () => {
    open([row()]);

    await documentRow();
    expect(screen.queryByRole("region", { name: "Import in progress" })).toBeNull();
    expect(screen.queryByText(/Still working/)).toBeNull();
  });
});

describe("the backup", () => {
  it("is one link to the export", async () => {
    open([row()]);

    const link = await screen.findByRole("link", { name: "Export my record" });
    expect(link.getAttribute("href")).toBe("/api/export");
  });
});
