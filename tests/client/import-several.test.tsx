/**
 * Importing several documents at once (`docs/10` Screen 3, "Importing several
 * documents"; `docs/09` Flow 8; issue #93).
 *
 * What it can get wrong without looking wrong: one employer applied to every
 * file; a file of a type that does not import sent anyway, or stopping the
 * rest; the files sent out of the order they are listed, which is the order
 * they are read; one file the server refuses taking the others with it.
 * All fixtures are invented.
 */
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { DocumentsListing, Employer, ImportStatus, Project } from "~/client/api";
import { MAX_UPLOAD_BYTES } from "~/shared/import-file";
import { mount, Refusal, type Call, type Routes } from "./harness";

const PLINTH: Project = {
  id: "proj-test-plinth",
  name: "Plinth quillset",
  nameJa: null,
  employerId: null,
  summary: null,
  summaryJa: null,
  startedOn: null,
  endedOn: null,
  clientIsNamed: false,
};

const employer = (id: string, nameLatin: string): Employer => ({
  id,
  nameJa: "株式会社テスト",
  nameLatin,
  businessDescription: null,
  industryJa: null, city: null,
  capitalYen: null,
  headcount: null,
  employmentType: "full_time",
  startedOn: "2021-04-01",
  endedOn: null,
  leavingReasonJa: null,
  sortOrder: 0,
});
const QORVANE = employer("emp-test-qorvane", "Qorvane Labs K.K.");
const TALLOW = employer("emp-test-tallow", "Tallow Works Ltd.");

const EMPTY: DocumentsListing = { openCandidates: 0, documents: [] };

const file = (name: string, size?: number) => {
  const chosen = new File(["# zentrel notes"], name, { type: "text/markdown" });
  if (size !== undefined) Object.defineProperty(chosen, "size", { value: size });
  return chosen;
};

const status = (importId: string, over: Partial<ImportStatus> = {}): ImportStatus => ({
  importId,
  sourceDocumentId: `src-${importId}`,
  versionNo: 1,
  status: "queued",
  chunksTotal: 0,
  chunksDone: 0,
  candidatesExtracted: 0,
  candidatesDiscarded: 0,
  candidatesSuppressed: 0,
  wordCount: 40,
  changedRegionShare: null,
  error: null,
  failedAtChunk: null,
  ...over,
});

const batch = (...ids: (string | Refusal)[]) => ({
  results: ids.map((id) => id instanceof Refusal ? { reason: id.message } : { importId: id }),
});
const single = (id: string) => ({ importId: id, sourceDocumentId: `src-${id}`, versionNo: 1 });

function open(routes: Routes = {}, listing: DocumentsListing = EMPTY) {
  return mount("/documents", {
    "GET /api/imports": listing,
    "GET /api/projects": { items: [PLINTH] },
    "GET /api/employers": { items: [QORVANE, TALLOW] },
    ...routes,
  });
}

/** The header's picker: the browser's own list may hold any file, whatever `accept` hints. */
async function choose(files: File[]) {
  await screen.findByText("Import your first document");
  const input = screen.getByRole("banner").querySelector<HTMLInputElement>('input[type="file"]')!;
  expect(input.multiple).toBe(true);
  fireEvent.change(input, { target: { files } });
}

const list = () => screen.findByRole("region", { name: "Import documents" });
const row = (name: string) => within(screen.getByRole("region", { name: "Import documents" })).getByRole("listitem", { name });
const posts = (calls: Call[]) => calls.filter((c) => c.method === "POST" && c.path === "/api/imports/batch");

describe("choosing several files at once", () => {
  it("gives each file its own row, and files each under the employer chosen for it", async () => {
    const { api, user } = open({ "POST /api/imports/batch": batch("imp-a", "imp-b", "imp-c") });
    await choose([file("alder.md"), file("birch.md"), file("cedar.txt")]);
    await list();

    for (const name of ["alder.md", "birch.md", "cedar.txt"]) {
      expect(within(row(name)).getByRole("combobox", { name: "File it under" })).toBeTruthy();
      expect(within(row(name)).getByRole("combobox", { name: "Employer" })).toBeTruthy();
    }
    // Choosing writes nothing on its own.
    expect(api.writes()).toEqual([]);

    await user.selectOptions(within(row("alder.md")).getByRole("combobox", { name: "Employer" }), QORVANE.id);
    await user.selectOptions(within(row("birch.md")).getByRole("combobox", { name: "Employer" }), TALLOW.id);
    await user.selectOptions(within(row("birch.md")).getByRole("combobox", { name: "File it under" }), PLINTH.id);
    await user.selectOptions(within(row("cedar.txt")).getByRole("combobox", { name: "Employer" }), QORVANE.id);
    await user.click(screen.getByRole("button", { name: "Import" }));

    await waitFor(() => expect(posts(api.calls)).toHaveLength(1));
    const sent = posts(api.calls)[0]!.body as { file: File[]; filing: string[] };
    expect(sent.file.map((file) => file.name)).toEqual(["alder.md", "birch.md", "cedar.txt"]);
    expect(sent.filing.map((value) => JSON.parse(value).employerId)).toEqual([QORVANE.id, TALLOW.id, QORVANE.id]);
    expect(sent.filing.map((value) => JSON.parse(value).projectId)).toEqual([undefined, PLINTH.id, undefined]);
  });

  it("leaves out a select with nothing to offer, on every row", async () => {
    open({ "GET /api/projects": { items: [] } });
    await choose([file("alder.md"), file("birch.md")]);
    await list();

    for (const name of ["alder.md", "birch.md"]) {
      expect(within(row(name)).queryByRole("combobox", { name: "File it under" })).toBeNull();
      expect(within(row(name)).getByRole("combobox", { name: "Employer" })).toBeTruthy();
    }
  });

  it("lists several files even when the record has nothing to file them under", async () => {
    const { api, user } = open({
      "GET /api/projects": { items: [] },
      "GET /api/employers": { items: [] },
      "POST /api/imports/batch": batch("imp-a", "imp-b"),
    });
    await choose([file("alder.md"), file("birch.md")]);
    await list();

    expect(screen.queryByRole("combobox")).toBeNull();
    expect(api.writes()).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(posts(api.calls)).toHaveLength(1));
  });

  it("takes a row out with its own Remove", async () => {
    const { api, user } = open({ "POST /api/imports": single("imp-a") });
    await choose([file("alder.md"), file("birch.md")]);
    await list();

    await user.click(screen.getByRole("button", { name: "Remove birch.md" }));
    expect(screen.queryByRole("listitem", { name: "birch.md" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Import" }));

    await waitFor(() => expect(api.calls.filter((call) => call.method === "POST" && call.path === "/api/imports")).toHaveLength(1));
  });
});

describe("a file that cannot be imported", () => {
  it("is refused on its own row with the reason before anything is sent, and the rest go ahead", async () => {
    const { api, user } = open({ "POST /api/imports/batch": batch("imp-a", "imp-b") });
    await choose([file("alder.md"), file("brief.rtf"), file("huge.md", MAX_UPLOAD_BYTES + 1), file("cedar.md")]);
    await list();

    expect(
      within(row("brief.rtf")).getByText("That file type cannot be imported. Markdown, plain text, Word and PDF files are supported."),
    ).toBeTruthy();
    expect(within(row("huge.md")).getByText("That file is larger than the 2 MB limit for Markdown files.")).toBeTruthy();
    expect(within(row("brief.rtf")).queryByRole("combobox")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(posts(api.calls)).toHaveLength(1));
    expect(((posts(api.calls)[0]!.body as { file: File[] }).file).map((file) => file.name)).toEqual([
      "alder.md",
      "cedar.md",
    ]);
  });

  it("offers no Import when none of the files can be", async () => {
    open();
    await choose([file("brief.rtf"), file("deck.pptx")]);
    await list();

    const button = screen.getByRole("button", { name: "Import" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toBe("None of these files can be imported.");
  });

  it("says the server's reason on its row while the others start", async () => {
    const { api, user } = open({
      "POST /api/imports/batch": batch("imp-a", new Refusal(422, "validation_failed", "That file is empty."), "imp-c"),
      "GET /api/imports/imp-a": status("imp-a"),
      "GET /api/imports/imp-c": status("imp-c"),
    });
    await choose([file("alder.md"), file("blank.md"), file("cedar.md")]);
    await list();
    await user.click(screen.getByRole("button", { name: "Import" }));

    await waitFor(() => expect(posts(api.calls)).toHaveLength(1));
    expect(await within(row("blank.md")).findByText("That file is empty.")).toBeTruthy();
  });
});

describe("once imported", () => {
  it("says where each one stands: waiting, reading, done or failed, and stays on the page", async () => {
    const { user, pathname } = open({
      "POST /api/imports/batch": batch("imp-a", "imp-b", "imp-c", "imp-d"),
      "GET /api/imports/imp-a": status("imp-a", { status: "ready", candidatesExtracted: 7 }),
      "GET /api/imports/imp-b": status("imp-b", {
        status: "failed",
        error: { code: "extraction_failed", message: "Anthropic is unavailable." },
      }),
      "GET /api/imports/imp-c": status("imp-c", { status: "extracting", chunksTotal: 4, chunksDone: 1 }),
      "GET /api/imports/imp-d": status("imp-d"),
    });
    await choose([file("alder.md"), file("birch.md"), file("cedar.md"), file("dogwood.md")]);
    await list();
    await user.click(screen.getByRole("button", { name: "Import" }));

    await waitFor(() => expect(within(row("alder.md")).getByText(/Done · 7 facts/)).toBeTruthy());
    expect(within(row("alder.md")).getByRole("link", { name: "Review" }).getAttribute("href")).toBe("/imports/imp-a");
    expect(within(row("birch.md")).getByText(/Failed · Anthropic is unavailable\./)).toBeTruthy();
    expect(within(row("cedar.md")).getByText(/Reading · 25%/)).toBeTruthy();
    expect(within(row("dogwood.md")).getByText(/Waiting/)).toBeTruthy();
    expect(pathname()).toBe("/documents");
    // The set is sent: no row can be removed and nothing is imported twice.
    expect(screen.queryByRole("button", { name: /^Remove/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Import" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("region", { name: "Import documents" })).toBeNull();
  });

  it("opens Fact Review on a single file, as it always has", async () => {
    const { user, pathname } = open({
      "POST /api/imports": single("imp-a"),
      "GET /api/imports/imp-a": status("imp-a"),
    });
    await choose([file("alder.md")]);
    await screen.findByRole("region", { name: "Import a document" });
    await user.click(screen.getByRole("button", { name: "Import" }));

    await waitFor(() => expect(pathname()).toBe("/imports/imp-a"));
  });
});

describe("the drop target", () => {
  it("takes several files dropped on it at once", async () => {
    open();
    const target = (await screen.findByText("Import your first document")).parentElement!;

    fireEvent.drop(target, { dataTransfer: { files: [file("alder.md"), file("birch.md")] } });

    await list();
    expect(row("alder.md")).toBeTruthy();
    expect(row("birch.md")).toBeTruthy();
  });
});
