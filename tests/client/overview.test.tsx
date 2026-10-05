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
  kind: "english_resume",
  language: "en",
  title: "English résumé",
  buildable: true,
  currentVersionId: null,
  currentVersionNo: null,
  generatedAt: null,
  status: "never_generated",
  newFactsSince: null,
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
  review: null,
  unconfirmed: null,
  documents,
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
});

describe("the next step", () => {
  const POST = "POST /api/renders/english_resume/generate";
  const waiting = (over: Partial<Overview>, documents: RenderRow[] = [row()]): Routes => ({
    "GET /api/overview": { ...overview(documents), ...over },
  });
  const REVIEW = { openCandidates: 1085, documents: 1, importId: "imp-test-vorbit", filename: "vorbit-rollout.md" };

  it("leads with the candidates waiting, and opens the review that holds them", async () => {
    const { api, user, pathname } = open([], waiting({ review: REVIEW }));
    const step = await nextStep();

    expect(within(step).getByRole("heading", { name: "Review 1,085 facts" })).toBeTruthy();
    expect(
      within(step).getByText(
        "Found in vorbit-rollout.md. A fact is used in your documents only after you accept it.",
      ),
    ).toBeTruthy();
    await user.click(within(step).getByRole("link", { name: "Review facts" }));

    await waitFor(() => expect(pathname()).toBe("/imports/imp-test-vorbit"));
    expect(api.writes()).toEqual([]);
  });

  it("says how many documents the candidates sit in when it is more than one", async () => {
    open([], waiting({ review: { ...REVIEW, openCandidates: 1, documents: 3 } }));
    const step = await nextStep();

    expect(within(step).getByRole("heading", { name: "Review 1 fact" })).toBeTruthy();
    expect(
      within(step).getByText(
        "Found in 3 documents, newest first. A fact is used in your documents only after you accept it.",
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
          unconfirmed: { importId: "imp-test-quillset", count: 3 },
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
        factsByProvenance: { measured: 0, attested: 96, generated: 16 },
        unconfirmed: { importId: "imp-test-quillset", count: 3 },
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
        { unconfirmed: { importId: "imp-test-quillset", count: 3 } },
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
      await screen.findByText("No accepted facts yet. They arrive when you review a document you imported."),
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
  const line = async () => (await documentRow()).closest("section")!.querySelector("p + p, header + div > p")!;

  it("says how many are out of date and that the rest can wait", async () => {
    open([
      row({ status: "stale", currentVersionId: "ver-test-1", newFactsSince: 12 }),
      row({ ...JA, status: "stale", currentVersionId: "ver-test-2", newFactsSince: 12 }),
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

  it("names the one document that is out of date", async () => {
    open([row({ status: "stale", currentVersionId: "ver-test-1", newFactsSince: 3 }), row(JA)]);

    expect((await line()).textContent).toBe("English résumé is out of date. Update it when you next need it.");
  });

  it("points at the document with a version waiting", async () => {
    open([
      row({ status: "stale", currentVersionId: "ver-test-1", newFactsSince: 12 }),
      row({ ...JA, status: "proposal_pending", pendingProposalId: "prop-test-zentrel" }),
    ]);

    expect((await line()).textContent).toBe("Qorvane 履歴書 has a new version waiting for you. Check it first.");
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

describe("the sidebar", () => {
  it("says what its count counts", async () => {
    open([row()], { "GET /api/imports/summary": { openCandidates: 1085, running: false } });

    // jsdom joins the two lines of the row without the space a browser reads between them.
    const link = await screen.findByRole("link", { name: /^Documents\s*1,085 facts to review$/ });
    expect(link.getAttribute("href")).toBe("/documents");
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

    await screen.findByText("Qorvane 履歴書");
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
      "Review",
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
