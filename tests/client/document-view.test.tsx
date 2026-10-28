/**
 * Screen 17, reading a document (`docs/10-screen-specifications.md`, issue
 * #106).
 *
 * What matters is that the page reads the version it says it reads, that the
 * header offers a control only where its route would accept it, and that a
 * download the server would refuse is said in place of a page it would not
 * produce. All fixtures are invented.
 */
import { afterEach, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import type { RenderPage, RenderRow } from "~/client/api";
import type { FactEvidence } from "~/shared/evidence";
import { mount, Refusal, type Routes } from "./harness";
import { RIREKISHO_SHEET } from "./rirekisho-sheet";
import { TAILORED_MOTIVATION_NOTICE } from "~/shared/rirekisho-notice";

const KIND = "english_resume";
const PAGE = `GET /api/renders/${KIND}/page`;

const DOCUMENT: RenderRow = {
  id: "rnd-test-1",
  ref: KIND,
  tailored: null,
  kind: KIND,
  language: "en",
  title: "Résumé (English)",
  buildable: true,
  currentVersionId: "ver-test-3",
  currentVersionNo: 3,
  generatedAt: "2026-09-03T00:00:00.000Z",
  status: "up_to_date",
  newFactsSince: 0,
  withdrawnFactsSince: 0,
  pendingProposalId: null,
};

const view = (over: Partial<RenderPage> = {}): RenderPage => ({
  renderKind: KIND,
  renderRef: KIND,
  title: "Résumé (English)",
  language: "en",
  tailored: false,
  applicationId: null,
  motivationNote: null,
  document: DOCUMENT,
  canGenerate: true,
  version: { id: "ver-test-3", versionNo: 3, origin: "accepted", acceptedAt: "2026-09-03T00:00:00.000Z", isCurrent: true },
  page: {
    title: "Résumé (English)",
    stamp: null,
    name: "Ryo Tanabe",
    contact: ["ryo@example.invalid"],
    sections: [
      {
        heading: "Experience",
        blocks: [
          { kind: "bullet", text: "Moved the Qorvane quillset to zentrel" },
          { kind: "bullet", text: "Cut the plinth build from nine minutes to two" },
        ],
      },
    ],
  },
  evidence: [],
  ...over,
});

const open = (path = `/renders/${KIND}/view`, routes: Routes = {}) =>
  mount(path, { [PAGE]: view(), ...routes });

const notice = async () => within((await screen.findByText("v3")).parentElement!);

it("does not repeat the drafted-motivation notice on a version the author accepted", async () => {
  const tailored = view({
    renderKind: "rirekisho", renderRef: "rnd-test-ja", language: "ja", tailored: true,
    applicationId: "app-test", motivationNote: null,
    page: { ...view().page, sheet: RIREKISHO_SHEET },
  });
  mount("/renders/rnd-test-ja/view", { "GET /api/renders/rnd-test-ja/page": tailored });
  await screen.findByText("v3");
  expect(screen.queryByText(TAILORED_MOTIVATION_NOTICE)).toBeNull();
});

describe("the page", () => {
  it("shows the document as its download holds it, under its version and date", async () => {
    open();

    const page = await screen.findByRole("article");
    const title = within(page).getByRole("heading", { name: "Résumé (English)" });
    const name = within(page).getByText("Ryo Tanabe");
    const section = within(page).getByRole("heading", { name: "Experience" });
    expect(title.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(name.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(page).getByText("ryo@example.invalid")).toBeTruthy();
    expect(within(page).getByRole("heading", { name: "Experience" })).toBeTruthy();
    expect(within(page).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Moved the Qorvane quillset to zentrel",
      "Cut the plinth build from nine minutes to two",
    ]);
    const bar = await notice();
    expect(bar.getByText("Current")).toBeTruthy();
    expect(bar.getByText(/This is the document as its download holds it today/)).toBeTruthy();
  });

  it("leads an English résumé with its name, headline and contact line, under no title", async () => {
    mount(`/renders/${KIND}/view`, {
      [PAGE]: view({
        page: {
          title: null,
          stamp: null,
          name: "Ryo Tanabe",
          headline: "Platform Engineer",
          contact: ["Sapporo, Japan · ryo@example.invalid · github.com/ryo-example"],
          sections: [{ heading: "Summary", blocks: [{ kind: "paragraph", text: "Engineer who ships." }] }],
        },
      }),
    });

    const page = await screen.findByRole("article");
    const headings = within(page).getAllByRole("heading").map((heading) => heading.textContent);
    expect(headings).toEqual(["Ryo Tanabe", "Summary"]);
    const headline = within(page).getByText("Platform Engineer");
    const contact = within(page).getByText("Sapporo, Japan · ryo@example.invalid · github.com/ryo-example");
    expect(within(page).getByRole("heading", { name: "Ryo Tanabe" }).compareDocumentPosition(headline) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(headline.compareDocumentPosition(contact) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(headline).not.toBe(contact);
  });

  it("offers Download, History, Edit and Regenerate on the current version", async () => {
    open();
    const bar = await notice();

    expect(bar.getByRole("button", { name: "Download PDF" })).toBeTruthy();
    expect(bar.getByRole("link", { name: "History" }).getAttribute("href")).toBe(`/renders/${KIND}/history`);
    expect(bar.getByRole("link", { name: "Edit" }).getAttribute("href")).toBe(`/renders/${KIND}/edit`);
    expect(bar.getByRole("button", { name: "Regenerate" })).toBeTruthy();
  });

  it("regenerates, and opens the proposal it started", async () => {
    const { api, user, pathname } = open(undefined, {
      [`POST /api/renders/${KIND}/generate`]: { proposalId: "prop-test-new" },
    });
    await user.click((await notice()).getByRole("button", { name: "Regenerate" }));

    await waitFor(() => expect(pathname()).toBe("/proposals/prop-test-new"));
    expect(api.writes()).toEqual([`POST /api/renders/${KIND}/generate`]);
  });

  it("leads to the waiting proposal instead of writing a second", async () => {
    open(undefined, {
      [PAGE]: view({ document: { ...DOCUMENT, status: "proposal_pending", pendingProposalId: "prop-test-wait" } }),
    });
    const bar = await notice();

    expect(bar.getByRole("link", { name: "Review changes" }).getAttribute("href")).toBe("/proposals/prop-test-wait");
    expect(bar.queryByRole("button", { name: "Regenerate" })).toBeNull();
    expect(screen.getByText(/A new version is waiting for you/)).toBeTruthy();
  });

  it("reads an earlier version by id, without Edit or a new version, and leads to the current one", async () => {
    const { api } = open(`/renders/${KIND}/view?version=ver-test-1`, {
      [`${PAGE}?versionId=ver-test-1`]: view({
        version: { id: "ver-test-1", versionNo: 1, origin: "edited", acceptedAt: "2026-09-01T00:00:00.000Z", isCurrent: false },
      }),
    });
    const bar = within((await screen.findByText("v1")).parentElement!);

    expect(bar.queryByText("Current")).toBeNull();
    expect(bar.getByText(/Edited by hand/)).toBeTruthy();
    expect(bar.queryByRole("link", { name: "Edit" })).toBeNull();
    expect(bar.queryByRole("button", { name: "Regenerate" })).toBeNull();
    expect(bar.getByRole("link", { name: "Read the current version" }).getAttribute("href")).toBe(
      `/renders/${KIND}/view`,
    );
    expect(api.calls.map((call) => call.path)).toContain(`/api/renders/${KIND}/page?versionId=ver-test-1`);
  });

  it("says the download's refusal in place of a page, with the way out", async () => {
    open(undefined, {
      [PAGE]: new Refusal(409, "conflict", "fct-test-a is Private and never reaches a document.", {
        facts: [{ factId: "fct-test-a", problem: "private" }],
      }),
    });

    expect((await screen.findByRole("alert")).textContent).toBe("fct-test-a is Private and never reaches a document.");
    expect(screen.queryByRole("article")).toBeNull();
    expect(screen.getByRole("link", { name: "Edit" }).getAttribute("href")).toBe(`/renders/${KIND}/edit`);
  });

  it("links each gap in a refused job header to its field, as a refused generation does", async () => {
    const message = "Every job on the English résumé is headed by its city and title. Gull Freight Ltd. needs a city.";
    open(undefined, {
      [PAGE]: new Refusal(409, "conflict", message, {
        fields: ["employers"],
        jobHeaders: [{ employerId: "emp-test-gull", name: "Gull Freight Ltd.", missing: ["city"] }],
      }),
    });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent!.startsWith(message)).toBe(true);
    expect(within(alert).getByRole("link", { name: "Add the city for Gull Freight Ltd." }).getAttribute("href")).toBe(
      "/record?employer=emp-test-gull&fix=city",
    );
    // No fact or edit closes the gap, so the advice about them is not given.
    expect(screen.queryByText(/A document obeys your record/)).toBeNull();
  });

  it("replaces a cached page when a later read is refused", async () => {
    let withheld = false;
    const { queryClient } = open(undefined, {
      [PAGE]: () => withheld
        ? new Refusal(409, "conflict", "A cited fact is Private.")
        : view(),
    });
    expect(await screen.findByRole("article")).toBeTruthy();

    withheld = true;
    await queryClient.invalidateQueries({ queryKey: ["renders", KIND] });

    expect((await screen.findByRole("alert")).textContent).toBe("A cited fact is Private.");
    expect(screen.queryByRole("article")).toBeNull();
  });

  it("is not found for a document with no version", async () => {
    open(undefined, { [PAGE]: new Refusal(404, "not_found", "A version of that document was not found.") });
    expect(await screen.findByText("That document or version was not found.")).toBeTruthy();
  });

  it("leads a tailored résumé back to its application", async () => {
    const ref = "rnd-test-tailored";
    open(`/renders/${ref}/view`, {
      [`GET /api/renders/${ref}/page`]: view({
        renderRef: ref,
        title: "Tailored résumé for Quillset Ltd",
        tailored: true,
        applicationId: "app-test-1",
        document: { ...DOCUMENT, ref, tailored: { label: "Quillset Ltd", createdAt: "2026-09-01T00:00:00.000Z" } },
      }),
    });
    const bar = await notice();

    expect(bar.getByRole("link", { name: "Back to the application" }).getAttribute("href")).toBe(
      "/applications/app-test-1",
    );
    expect(bar.getByRole("link", { name: "History" }).getAttribute("href")).toBe(`/renders/${ref}/history`);
  });
});

/**
 * "Show where each line comes from" (issue #110, S6): a line opens the facts
 * it was written from, each with its worth, its employer and its passage.
 */
describe("where each line comes from", () => {
  const MEASURED: FactEvidence = {
    id: "fct-test-measured",
    claim: "Cut the plinth build from nine minutes to two",
    provenance: "measured",
    employer: "Quillset Ltd",
    quote: "The plinth build went from nine minutes to two.",
    source: { importId: "sdv-test-1", filename: "quillset-notes.md", lineNumber: 12 },
  };
  const ATTESTED: FactEvidence = {
    id: "fct-test-attested",
    claim: "Moved the Qorvane quillset to zentrel",
    provenance: "attested",
    employer: "Quillset Ltd",
    quote: "We moved the quillset onto zentrel.",
    source: { importId: "sdv-test-1", filename: "quillset-notes.md", lineNumber: 4 },
  };
  const CAPTURED: FactEvidence = {
    id: "fct-test-captured",
    claim: "Mentored two new plinth engineers",
    provenance: "attested",
    employer: null,
    quote: null,
    source: null,
  };
  const SOURCED_UNQUOTED: FactEvidence = {
    id: "fct-test-unquoted",
    claim: "Maintained the quillset release process",
    provenance: "attested",
    employer: "Quillset Ltd",
    quote: null,
    source: { importId: "sdv-test-2", filename: "release-notes.md", lineNumber: null },
  };

  const traced = () =>
    view({
      page: {
        title: null,
        stamp: null,
        name: "Ryo Tanabe",
        contact: [],
        sections: [
          {
            heading: "Experience",
            blocks: [
              { kind: "row", text: "Quillset Ltd · Apr 2022 – Present", factIds: [] },
              { kind: "bullet", text: "Moved the Qorvane quillset to zentrel", factIds: [ATTESTED.id, SOURCED_UNQUOTED.id] },
              { kind: "bullet", text: "Cut the plinth build from nine minutes to two", factIds: [MEASURED.id, CAPTURED.id] },
            ],
          },
        ],
      },
      evidence: [ATTESTED, SOURCED_UNQUOTED, MEASURED, CAPTURED],
    });

  const tracing = async () => {
    const mounted = mount(`/renders/${KIND}/view`, { [PAGE]: traced() });
    const toggle = await screen.findByRole("button", { name: "Show where each line comes from" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    await mounted.user.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    return { ...mounted, toggle, page: within(screen.getByRole("article")) };
  };

  it("makes no line a control until it is asked to, then every line one", async () => {
    const { user } = open(undefined, { [PAGE]: traced() });
    const page = within(await screen.findByRole("article"));
    expect(page.queryAllByRole("button")).toEqual([]);

    await user.click(screen.getByRole("button", { name: "Show where each line comes from" }));
    expect(page.getAllByRole("button").map((line) => line.textContent)).toEqual([
      "Quillset Ltd · Apr 2022 – Present",
      "Moved the Qorvane quillset to zentrel",
      "Cut the plinth build from nine minutes to two",
    ]);
  });

  it("shows a measured fact's worth, employer and passage, and opens it in Fact Review", async () => {
    const { user, page, pathname } = await tracing();
    const line = page.getByRole("button", { name: "Cut the plinth build from nine minutes to two" });
    await user.click(line);

    expect(line.getAttribute("aria-expanded")).toBe("true");
    const behind = within(page.getByRole("region", { name: "Behind this line" }));
    expect(line.getAttribute("aria-controls")).toBe(behind.getByText("2 facts from your record.").closest("div[id]")!.id);
    const card = within(behind.getByText(MEASURED.claim).closest("li")!);
    expect(card.getByText("Backed by a number")).toBeTruthy();
    expect(card.getByText("Quillset Ltd")).toBeTruthy();
    expect(card.getByText(MEASURED.quote!)).toBeTruthy();
    expect(card.getByText("quillset-notes.md, line 12")).toBeTruthy();
    expect(card.queryByText("Added by hand")).toBeNull();
    const source = card.getByRole("link", { name: "Open in source" });
    expect(source.getAttribute("href")).toBe("/imports/sdv-test-1?fact=fct-test-measured");

    await user.click(source);
    await waitFor(() => expect(pathname()).toBe("/imports/sdv-test-1"));
  });

  it("says an attested fact has no number behind it", async () => {
    const { user, page } = await tracing();
    await user.click(page.getByRole("button", { name: ATTESTED.claim }));

    const behind = within(page.getByRole("region", { name: "Behind this line" }));
    expect(behind.getByText("2 facts from your record.")).toBeTruthy();
    const card = within(behind.getByText(ATTESTED.claim, { selector: "p" }).closest("li")!);
    expect(card.getByText("Stated by you, no number behind it")).toBeTruthy();
    expect(card.queryByText("Backed by a number")).toBeNull();
    expect(card.getByText(ATTESTED.quote!)).toBeTruthy();
    expect(card.getByRole("link", { name: "Open in source" }).getAttribute("href")).toBe(
      "/imports/sdv-test-1?fact=fct-test-attested",
    );
  });

  it("keeps a sourced fact without a saved quote in Fact Review", async () => {
    const { user, page } = await tracing();
    await user.click(page.getByRole("button", { name: ATTESTED.claim }));
    const card = within(page.getByText(SOURCED_UNQUOTED.claim).closest("li")!);
    expect(card.getByText("Stated by you, no number behind it")).toBeTruthy();
    expect(card.getByText("Quillset Ltd")).toBeTruthy();
    expect(card.getByText("No quoted passage was saved for this fact.")).toBeTruthy();
    expect(card.queryByText("Added by hand")).toBeNull();
    expect(card.queryByRole("link", { name: "Open it in Quick capture" })).toBeNull();
    expect(card.getByRole("link", { name: "Open in source" }).getAttribute("href")).toBe(
      "/imports/sdv-test-2?fact=fct-test-unquoted",
    );
  });

  it("keeps a 履歴書 sheet visible and selects its prose cell in place", async () => {
    const sheet = structuredClone(RIREKISHO_SHEET);
    const motivation = sheet.blocks.filter((block) => block.kind === "table")[3]!;
    motivation.rows[1]![0]!.factIds = [ATTESTED.id];
    const { user } = mount("/renders/rirekisho/view", {
      "GET /api/renders/rirekisho/page": view({
        renderKind: "rirekisho", renderRef: "rirekisho", language: "ja",
        page: { title: "履 歴 書", stamp: null, name: "架空　花子", contact: [], sections: [], sheet },
        evidence: [ATTESTED],
      }),
    });
    const page = within(await screen.findByRole("article"));
    expect(page.getAllByRole("table")).toHaveLength(5);
    await user.click(screen.getByRole("button", { name: "Show where each line comes from" }));
    expect(page.getAllByRole("table")).toHaveLength(5);
    const cell = page.getByRole("button", { name: "架空の志望動機です。" });
    expect(cell.closest("td")).toBeTruthy();
    cell.focus();
    await user.keyboard("{Enter}");
    expect(cell.getAttribute("aria-expanded")).toBe("true");
    expect(page.getByText(ATTESTED.claim)).toBeTruthy();
    await user.click(page.getByRole("button", { name: "架空大学　架空学部　卒業" }));
    expect(page.getByText(/No fact behind this line/)).toBeTruthy();
  });

  const rirekishoPage = (sheet: typeof RIREKISHO_SHEET) =>
    view({
      renderKind: "rirekisho", renderRef: "rirekisho", language: "ja",
      page: { title: "履 歴 書", stamp: null, name: "架空　花子", contact: [], sections: [], sheet },
    });

  it("says when a 履歴書's 写真 cell is empty, in the owner's words, with the way to add one (issue #117)", async () => {
    mount("/renders/rirekisho/view", { "GET /api/renders/rirekisho/page": rirekishoPage(RIREKISHO_SHEET) });
    const note = await screen.findByText(/写真欄は空欄です。必要な場合はWordで貼付してください/);
    expect(within(note).getByRole("link", { name: "Add a photo" }).getAttribute("href")).toBe("/profile");
    expect(within(screen.getByRole("article")).queryByRole("img")).toBeNull();
  });

  it("says the 履歴書's current gaps once it is accepted, and takes an explanation for each (issue #117, G1)", async () => {
    const gap = { after: "2096-01", before: "2096-07", from: "2096-02", to: "2096-06", months: 5 };
    const { api, user } = mount("/renders/rirekisho/view", {
      "GET /api/renders/rirekisho/page": rirekishoPage(RIREKISHO_SHEET),
      "GET /api/career-timeline": { employers: [], projects: [], gaps: [gap], explained: [], staleNotes: [] },
      "POST /api/gap-notes": { id: "gap-test-1" },
    });

    const gaps = await screen.findByRole("list", { name: "Gaps in 学歴・職歴" });
    expect(within(gaps).getByText("2096年2月〜6月（5か月）は、学歴・職歴のどの行にも含まれていません。")).toBeTruthy();
    expect(within(gaps).getByText("February–June 2096 (5 months) is covered by no 学歴・職歴 entry.")).toBeTruthy();

    await user.click(within(gaps).getByRole("button", { name: "Add an explanation" }));
    await user.type(within(gaps).getByRole("textbox"), "資格取得のため学習");
    await user.click(within(gaps).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.writes()).toEqual(["POST /api/gap-notes"]));
    expect(api.bodyOf("POST", "/api/gap-notes")).toEqual({ fromOn: "2096-02-01", toOn: "2096-06-01", text: "資格取得のため学習" });
  });

  it("says nothing of gaps on a 履歴書 whose record has none", async () => {
    mount("/renders/rirekisho/view", {
      "GET /api/renders/rirekisho/page": rirekishoPage(RIREKISHO_SHEET),
      "GET /api/career-timeline": { employers: [], projects: [], gaps: [], explained: [], staleNotes: [] },
    });
    await screen.findByRole("article");
    expect(screen.queryByRole("list", { name: "Gaps in 学歴・職歴" })).toBeNull();
  });

  it("draws the photo in the 写真 cell when the file holds one, and says nothing of an empty cell (issue #117)", async () => {
    const sheet = structuredClone(RIREKISHO_SHEET);
    const identity = sheet.blocks.find((block) => block.kind === "table")!;
    identity.rows[0]![2]!.photo = true;
    mount("/renders/rirekisho/view", {
      "GET /api/profile": { id: "profile-test-1", hasPhoto: true, photoVersion: "a1b2c3d4e5f6" },
      "GET /api/renders/rirekisho/page": rirekishoPage(sheet),
    });
    const photo = await within(await screen.findByRole("article")).findByRole("img", { name: "写真" });
    expect(photo.getAttribute("src")).toBe("/api/profile/photo?v=a1b2c3d4e5f6");
    expect(photo.closest("td")?.getAttribute("rowspan")).toBe("3");
    expect(screen.queryByText(/写真欄は空欄です/)).toBeNull();
  });

  it("says a captured fact was added by hand, with no passage, and opens its card", async () => {
    const { user, page } = await tracing();
    await user.click(page.getByRole("button", { name: MEASURED.claim }));

    const card = within(screen.getByText(CAPTURED.claim).closest("li")!);
    expect(card.getByText("Added by hand")).toBeTruthy();
    expect(card.getByText("Stated by you, no number behind it")).toBeTruthy();
    expect(card.getByText("No employer")).toBeTruthy();
    expect(card.getByText(/no passage to quote/)).toBeTruthy();
    expect(card.queryByRole("link", { name: "Open in source" })).toBeNull();
    expect(card.getByRole("link", { name: "Open it in Quick capture" }).getAttribute("href")).toBe(
      "/capture?fact=fct-test-captured",
    );
  });

  it("says a line copied from the record has no fact behind it", async () => {
    const { user, page } = await tracing();
    await user.click(page.getByRole("button", { name: "Quillset Ltd · Apr 2022 – Present" }));

    expect(page.getByText(/No fact behind this line/)).toBeTruthy();
  });

  it("shows one line at a time, closes it on a second press, and puts every line back when turned off", async () => {
    const { user, page, toggle } = await tracing();
    const first = page.getByRole("button", { name: ATTESTED.claim });
    const second = page.getByRole("button", { name: MEASURED.claim });

    await user.click(first);
    await user.click(second);
    expect(first.getAttribute("aria-expanded")).toBe("false");
    expect(page.getAllByRole("region", { name: "Behind this line" })).toHaveLength(1);

    await user.click(second);
    expect(page.queryByRole("region", { name: "Behind this line" })).toBeNull();

    await user.click(second);
    await user.click(toggle);
    expect(page.queryAllByRole("button")).toEqual([]);
    expect(page.queryByRole("region", { name: "Behind this line" })).toBeNull();
  });

  it("works from the keyboard: a line opens on Enter, and its evidence is the next stop", async () => {
    const { user, page } = await tracing();
    const line = page.getByRole("button", { name: ATTESTED.claim });
    line.focus();

    await user.keyboard("{Enter}");
    expect(line.getAttribute("aria-expanded")).toBe("true");
    await user.tab();
    expect(document.activeElement?.textContent).toBe("Open in source");
  });
});

describe("at phone width", () => {
  const WIDER = /needs a window at least 1024/;
  const width = window.innerWidth;
  const setWidth = (next: number) =>
    Object.defineProperty(window, "innerWidth", { value: next, configurable: true, writable: true });
  afterEach(() => setWidth(width));

  it("keeps Download at 390px and holds back the actions that open a screen behind the message", async () => {
    setWidth(390);
    open();
    const bar = await notice();

    expect(screen.queryByText(WIDER)).toBeNull();
    expect(screen.getByRole("article")).toBeTruthy();
    expect(bar.getByRole("button", { name: "Download PDF" })).toBeTruthy();
    expect(bar.queryByRole("link", { name: "History" })).toBeNull();
    expect(bar.queryByRole("link", { name: "Edit" })).toBeNull();
    expect(bar.queryByRole("button", { name: "Regenerate" })).toBeNull();
  });

  it("leads back to Applications at 390px, not to Home behind the message", async () => {
    setWidth(390);
    open();
    await notice();

    // The sidebar is in the page and hidden by CSS under 720px; the header's breadcrumb is what a phone reads.
    const crumb = within(screen.getByRole("heading", { level: 1 }));
    expect(crumb.queryByRole("link", { name: "Home" })).toBeNull();
    expect(crumb.getByRole("link", { name: "Applications" }).getAttribute("href")).toBe("/applications");
  });

  it("keeps History, Edit and Regenerate, and Home as the way back, in a wide window", async () => {
    setWidth(1280);
    open();
    const bar = await notice();

    expect(bar.getByRole("link", { name: "History" })).toBeTruthy();
    expect(bar.getByRole("link", { name: "Edit" })).toBeTruthy();
    expect(bar.getByRole("button", { name: "Regenerate" })).toBeTruthy();
    expect(within(screen.getByRole("heading", { level: 1 })).getByRole("link", { name: "Home" }).getAttribute("href")).toBe("/");
  });

  it("still shows the message on the document's other screens", async () => {
    setWidth(390);
    mount(`/renders/${KIND}/history`, {});
    expect(await screen.findByText(WIDER)).toBeTruthy();
  });
});
