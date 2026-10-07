/**
 * Screen 10, Master document (`docs/10-screen-specifications.md`, issue #57).
 *
 * A read-only view of the whole record. What matters is that the facts no
 * résumé may use are on it and marked, that nothing on it can be edited, and
 * that the download says it includes Private facts before it is pressed. All
 * fixtures are invented.
 */
import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import type { MasterDocument, MasterFact } from "~/shared/master-document";
import { mount, Refusal, type Routes } from "./harness";

const fact = (over: Partial<MasterFact> = {}): MasterFact => ({
  id: "fct-test-1",
  claim: "Cut the plinth build from 40 minutes to 6",
  provenance: "measured",
  disclosure: "restricted",
  technologies: [],
  flags: [],
  source: { importId: "sdv-test-1", filename: "quillset-notes.md", lineNumber: 12 },
  ...over,
});

const USABLE = fact();
const PRIVATE = fact({ id: "fct-test-2", claim: "Rebuilt the zentrel ledger", provenance: "attested", disclosure: "private", flags: ["confidential"] });
const GENERATED = fact({ id: "fct-test-3", claim: "Improved delivery confidence", provenance: "generated", flags: ["unsure"], source: null });
const SIDE = fact({ id: "fct-test-4", claim: "Published a tide-table tool", provenance: "attested" });

const master = (over: Partial<MasterDocument> = {}): MasterDocument => ({
  builtAt: "2026-10-08T03:00:00.000Z",
  subjectName: "Test Author",
  counts: { facts: 4, usable: 2, private: 1, generated: 1, flagged: 2, waiting: 0 },
  employers: [
    {
      id: "emp-test-1",
      name: "Orrery Works",
      nameJa: "株式会社オーラリー",
      industry: "ソフトウェア",
      startedOn: "2022-04-01",
      endedOn: null,
      roles: [{ title: "Backend Engineer", startedOn: "2022-04-01", endedOn: null }],
      projects: [{ id: "prj-test-1", name: "Plinth build", summary: "The build pipeline.", facts: [USABLE, PRIVATE] }],
      facts: [GENERATED],
    },
  ],
  independent: { projects: [], facts: [SIDE] },
  educations: [
    { id: "edu-test-1", institution: "Midorikawa Institute of Technology", detail: "B.Eng.", startedOn: "2013-04-01", endedOn: "2017-03-01", outcome: "graduated" },
  ],
  certifications: [
    { id: "crt-test-1", name: "Applied Information Technology Engineer", issuingOrganization: "IPA", issuedOn: "2019-06-01", expiresOn: null },
  ],
  ...over,
});

const open = (doc: MasterDocument, routes: Routes = {}) =>
  mount("/master", {
    "GET /api/master-document": doc,
    "GET /api/imports/summary": { openCandidates: 0, openFlags: 0, running: false },
    ...routes,
  });

const rowOf = async (claim: string) => (await screen.findByText(claim)).closest("li")!;

describe("the master document", () => {
  it("lists every fact under its employer and project, the Private and the Generated with the rest", async () => {
    open(master());

    expect(within(await rowOf(USABLE.claim)).getByText("Measured")).toBeTruthy();
    expect(within(await rowOf(PRIVATE.claim)).getByText("Private")).toBeTruthy();
    expect(within(await rowOf(PRIVATE.claim)).getByText("Flagged")).toBeTruthy();
    expect(within(await rowOf(GENERATED.claim)).getByText("Generated")).toBeTruthy();
    expect(within(await rowOf(SIDE.claim)).queryByText("Flagged")).toBeNull();

    expect(screen.getByRole("heading", { name: "Orrery Works (株式会社オーラリー)" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Plinth build" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Work outside employment" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Education" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Certifications" })).toBeTruthy();
    expect(screen.getByText("Backend Engineer")).toBeTruthy();
    expect(screen.getByText(/4 facts: 2 a document may use, 1 Private,\s+1 Generated\./)).toBeTruthy();
    expect(screen.getByRole("link", { name: "2 flagged to check" }).getAttribute("href")).toBe("/flagged");
  });

  it("is read-only: one read, no write, and nothing to type into", async () => {
    const { api } = open(master());
    await screen.findByText(USABLE.claim);

    expect(api.writes()).toEqual([]);
    expect(screen.queryAllByRole("textbox")).toEqual([]);
    expect(screen.getAllByRole("button").map((b) => b.textContent)).not.toContain("Save");
  });

  it("links each fact to its card in the document it was read from", async () => {
    open(master());
    const link = within(await rowOf(USABLE.claim)).getByRole("link");
    expect(link.getAttribute("href")).toBe("/imports/sdv-test-1?fact=fct-test-1");
    // A fact with no source document has nowhere to open.
    expect(within(await rowOf(GENERATED.claim)).queryByRole("link")).toBeNull();
  });

  it("says how many facts are still waiting to be sorted, and where to sort them", async () => {
    open(master({ counts: { facts: 4, usable: 2, private: 1, generated: 1, flagged: 0, waiting: 3 } }));
    expect(await screen.findByText(/3 more are waiting to be sorted and are not listed yet\. Sort them from Home\./)).toBeTruthy();
  });

  it("offers no download and says what to do while the record holds no fact", async () => {
    open(
      master({
        counts: { facts: 0, usable: 0, private: 0, generated: 0, flagged: 0, waiting: 0 },
        employers: [],
        independent: { projects: [], facts: [] },
        educations: [],
        certifications: [],
      }),
    );
    expect(await screen.findByText(/import a document\. Its facts appear here\./)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Download .md" })).toBeNull();
  });
});

describe("downloading the master document", () => {
  const DOWNLOAD = "GET /api/master-document/download";

  it("says before the press that the file includes Private facts", async () => {
    open(master());
    await screen.findByText(USABLE.claim);
    expect(screen.getByText("The file includes Private facts. It is your copy.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download .md" })).toBeTruthy();
  });

  it("asks for the file once, writes nothing, and says why when it is refused", async () => {
    const { api, user } = open(master(), {
      [DOWNLOAD]: new Refusal(500, "internal", "The master document could not be built."),
    });
    await user.click(await screen.findByRole("button", { name: "Download .md" }));

    expect((await screen.findByRole("alert")).textContent).toBe("The master document could not be built.");
    expect(api.calls.filter((c) => `${c.method} ${c.path}` === DOWNLOAD)).toHaveLength(1);
    expect(api.writes()).toEqual([]);
    // Usable again rather than stuck on "Preparing…".
    expect(screen.getByRole("button", { name: "Download .md" })).toBeTruthy();
  });
});
