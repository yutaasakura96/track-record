/**
 * Screen 8, Documents (`docs/10-screen-specifications.md`).
 *
 * Three writes start here: refiling a document under a project, re-importing a
 * new version of it, and retrying a failed import. What matters is that each one
 * names the document or version its row shows, that choosing a file or opening
 * the refile row writes nothing on its own, and that a write refused or never
 * delivered says so beneath the row that made it.
 * All fixtures are invented.
 */
import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import type { DocumentVersion, DocumentsListing, Project, SourceDocumentRow } from "~/client/api";
import { mount, Refusal, type Routes } from "./harness";

const UNREACHABLE = () => {
  throw new TypeError("Failed to fetch");
};
const NOT_REACHED = "The server could not be reached. Try again.";
/** A read has a Retry beside it, so its line does not also say to try again. */
const NOT_READ = "The server could not be reached.";

function version(versionNo: number, overrides: Partial<DocumentVersion> = {}): DocumentVersion {
  return {
    importId: `imp-test-${versionNo}`,
    versionNo,
    importedAt: `2026-09-0${versionNo}T00:00:00.000Z`,
    status: "ready",
    wordCount: 400,
    changedRegionShare: versionNo === 1 ? null : 0.2,
    chunksTotal: 2,
    chunksDone: 2,
    extractorVersion: "test",
    facts: { accepted: 3, rejected: 1, open: 0 },
    error: null,
    ...overrides,
  };
}

const PLINTH: Project = {
  id: "proj-test-plinth",
  name: "Plinth quillset",
  nameJa: null,
  employerId: null,
  summary: null,
  startedOn: null,
  endedOn: null,
  clientIsNamed: false,
};

function document(overrides: Partial<SourceDocumentRow> = {}): SourceDocumentRow {
  return {
    sourceDocumentId: "src-test-1",
    filename: "qorvane-notes.md",
    mimeType: "text/markdown",
    project: null,
    lastImportedAt: "2026-09-02T00:00:00.000Z",
    openCandidates: 0,
    reimportable: true,
    versions: [version(2), version(1)],
    ...overrides,
  };
}

const listing = (...documents: SourceDocumentRow[]): DocumentsListing => ({ openCandidates: 0, documents });

const open = (routes: Routes = {}, documents = [document()]) =>
  mount("/documents", {
    "GET /api/imports": listing(...documents),
    "GET /api/projects": { items: [PLINTH] },
    ...routes,
  });

const block = async (filename = "qorvane-notes.md") => (await screen.findByText(filename)).closest("section")!;

const versionRow = async (versionNo: number) => {
  const tag = (await screen.findAllByText(`v${versionNo}`)).find((node) => node.closest("li"));
  return tag!.closest("li")!;
};

const file = (name = "qorvane-notes.md") => new File(["# zentrel"], name, { type: "text/markdown" });

async function chooseFile(user: ReturnType<typeof open>["user"], chosen = file()) {
  const input = (await block()).querySelector<HTMLInputElement>('input[type="file"]')!;
  await user.upload(input, chosen);
}

/* ------------------------------------------------------------------ refile */

describe("refiling a document", () => {
  const PATCH = "PATCH /api/source-documents/src-test-1";

  it("files it under the chosen project and closes the row", async () => {
    const { api, user } = open({
      [PATCH]: { sourceDocumentId: "src-test-1", project: { id: PLINTH.id, name: PLINTH.name }, facts: 4 },
    });
    const row = await block();

    await user.click(within(row).getByRole("button", { name: "File qorvane-notes.md under a different project" }));
    expect(api.writes()).toEqual([]);

    await user.selectOptions(await within(row).findByRole("combobox"), PLINTH.id);
    await user.click(within(row).getByRole("button", { name: "Refile" }));

    await waitFor(() => expect(within(row).queryByRole("combobox")).toBeNull());
    expect(api.writes()).toEqual([PATCH]);
    expect(api.bodyOf("PATCH", "/api/source-documents/src-test-1")).toEqual({ projectId: PLINTH.id });
    expect(within(row).queryByRole("alert")).toBeNull();
  });

  it("does not offer Refile until the choice differs from where it is filed", async () => {
    const { user } = open({}, [document({ project: { id: PLINTH.id, name: PLINTH.name } })]);
    const row = await block();

    await user.click(within(row).getByRole("button", { name: "File qorvane-notes.md under a different project" }));

    const refile = await within(row).findByRole("button", { name: "Refile" });
    expect(refile.getAttribute("title")).toBe("This document is already filed there.");
  });

  it("says there is nowhere to file it when the record has no projects", async () => {
    const { api, user } = open({ "GET /api/projects": { items: [] } });
    const row = await block();

    await user.click(within(row).getByRole("button", { name: "File qorvane-notes.md under a different project" }));

    expect((await within(row).findByRole("alert")).textContent).toBe(
      "There are no projects to file this document under.",
    );
    expect(within(row).queryByRole("combobox")).toBeNull();
    expect(api.writes()).toEqual([]);
  });

  it("does not open the row when the projects cannot be read", async () => {
    const { user } = open({ "GET /api/projects": new Refusal(500, "internal", "Something went wrong.") });
    const row = await block();

    await user.click(within(row).getByRole("button", { name: "File qorvane-notes.md under a different project" }));

    expect((await within(row).findByRole("alert")).textContent).toBe("Your projects could not be read. Try again.");
    expect(within(row).queryByRole("combobox")).toBeNull();
  });

  it.each([
    [new Refusal(409, "conflict", "Wait for v2 to finish extracting."), "Wait for v2 to finish extracting."],
    [UNREACHABLE, NOT_REACHED],
  ])("says why beneath the document when a refile fails", async (answer, said) => {
    const { user } = open({ [PATCH]: answer });
    const row = await block();

    await user.click(within(row).getByRole("button", { name: "File qorvane-notes.md under a different project" }));
    await user.selectOptions(await within(row).findByRole("combobox"), PLINTH.id);
    await user.click(within(row).getByRole("button", { name: "Refile" }));

    expect((await within(row).findByRole("alert")).textContent).toBe(said);
  });
});

/* --------------------------------------------------------------- re-import */

describe("re-importing a document", () => {
  const POST = "POST /api/imports";

  it("names the version it will become, and writes nothing until Import", async () => {
    const { api, user } = open();

    await chooseFile(user, file("qorvane-notes-final.md"));

    const row = await block();
    expect(within(row).getByText("This becomes v3 of qorvane-notes.md")).toBeTruthy();
    expect(within(row).getByText("The file is named qorvane-notes-final.md. The document keeps its name.")).toBeTruthy();
    expect(api.writes()).toEqual([]);

    await user.click(within(row).getByRole("button", { name: "Cancel" }));
    expect(within(row).queryByText("This becomes v3 of qorvane-notes.md")).toBeNull();
    expect(api.writes()).toEqual([]);
  });

  it("sends the file as a new version of this document and opens its review", async () => {
    const { api, user, pathname } = open({
      [POST]: { importId: "imp-test-3", sourceDocumentId: "src-test-1", versionNo: 3 },
    });

    await chooseFile(user);
    await user.click(within(await block()).getByRole("button", { name: "Import" }));

    await waitFor(() => expect(pathname()).toBe("/imports/imp-test-3"));
    expect(api.writes()).toEqual([POST]);
    const sent = api.bodyOf("POST", "/api/imports") as Record<string, unknown>;
    expect(sent.sourceDocumentId).toBe("src-test-1");
    expect((sent.file as File).name).toBe("qorvane-notes.md");
    // A re-import keeps the document's project; the client never sends one.
    expect(sent).not.toHaveProperty("projectId");
  });

  it("does not offer Re-import while the newest version is extracting", async () => {
    open({}, [
      document({ reimportable: false, versions: [version(2, { status: "extracting", chunksDone: 1 }), version(1)] }),
    ]);

    const reimport = within(await block()).getByRole("button", { name: "Re-import" });
    expect(reimport.getAttribute("title")).toBe("Wait for v2 to finish extracting.");
  });

  it.each([
    [new Refusal(422, "invalid", "That file is empty."), "That file is empty."],
    [UNREACHABLE, NOT_REACHED],
  ])("says why beneath the document when a re-import fails, and stays", async (answer, said) => {
    const { user, pathname } = open({ [POST]: answer });

    await chooseFile(user);
    const row = await block();
    await user.click(within(row).getByRole("button", { name: "Import" }));

    expect((await within(row).findByRole("alert")).textContent).toBe(said);
    expect(within(row).queryByText("This becomes v3 of qorvane-notes.md")).toBeNull();
    expect(pathname()).toBe("/documents");
  });
});

/* -------------------------------------------------------------- new import */

describe("importing a new document from the header", () => {
  it("says so when the upload never reaches the server, and stays", async () => {
    const { api, user, pathname } = open({ "GET /api/projects": { items: [] }, "POST /api/imports": UNREACHABLE });
    await block();

    // The header's picker is the only file input outside a document's block.
    const header = screen.getByRole("banner");
    await user.upload(header.querySelector<HTMLInputElement>('input[type="file"]')!, file("plinth-log.md"));

    expect((await screen.findByRole("alert")).textContent).toBe(NOT_REACHED);
    expect(api.writes()).toEqual(["POST /api/imports"]);
    expect(pathname()).toBe("/documents");
  });
});

/* ------------------------------------------------------------------- retry */

describe("retrying a failed import", () => {
  const FAILED = version(2, {
    status: "failed",
    chunksDone: 1,
    error: { code: "extraction_failed", message: "Extraction stopped at chunk 2." },
  });
  const RETRY = "POST /api/imports/imp-test-2/retry";

  it("shows the stored reason and retries that version only", async () => {
    const { api, user } = open(
      {
        [RETRY]: {
          importId: "imp-test-2",
          sourceDocumentId: "src-test-1",
          versionNo: 2,
          status: "queued",
          chunksTotal: 2,
          chunksDone: 0,
          candidatesExtracted: 0,
          candidatesDiscarded: 0,
          candidatesSuppressed: 0,
          wordCount: 400,
          changedRegionShare: 0.2,
          error: null,
          failedAtChunk: null,
        },
      },
      [document({ versions: [FAILED, version(1)] })],
    );
    const row = await versionRow(2);

    expect(within(row).getByText("Extraction stopped at chunk 2.")).toBeTruthy();
    expect(within(await versionRow(1)).queryByRole("button", { name: "Retry" })).toBeNull();

    await user.click(within(row).getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(api.writes()).toEqual([RETRY]));
    expect(within(row).queryByRole("alert")).toBeNull();
  });

  it.each([
    [new Refusal(409, "conflict", "That import is not failed."), "That import is not failed."],
    [UNREACHABLE, NOT_REACHED],
  ])("says why beneath the version when a retry fails", async (answer, said) => {
    const { user } = open({ [RETRY]: answer }, [document({ versions: [FAILED, version(1)] })]);
    const row = await versionRow(2);

    await user.click(within(row).getByRole("button", { name: "Retry" }));

    expect((await within(row).findByRole("alert")).textContent).toBe(said);
    expect(within(await versionRow(1)).queryByRole("alert")).toBeNull();
  });
});

describe("a listing that could not be read", () => {
  it.each([
    [new Refusal(500, "internal", "Something went wrong on our side."), "Something went wrong on our side."],
    [UNREACHABLE, NOT_READ],
  ])("says why in place of the list", async (answer, said) => {
    open({ "GET /api/imports": answer });

    expect((await screen.findByRole("alert")).textContent).toBe(said);
    expect(screen.queryByText("qorvane-notes.md")).toBeNull();
  });

  it("reads it again on Retry and shows the list once it arrives", async () => {
    let attempt = 0;
    const { api, user } = open({
      "GET /api/imports": () => (++attempt === 1 ? UNREACHABLE() : listing(document())),
    });
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "Retry" }));

    await block();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(api.writes()).toEqual([]);
  });

  it("shows the loading state again while Retry reads", async () => {
    let attempt = 0;
    const { user } = open({
      "GET /api/imports": () => (++attempt === 1 ? UNREACHABLE() : new Promise(() => {})),
    });
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "Retry" }));

    await screen.findByLabelText("Loading your documents");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });
});
