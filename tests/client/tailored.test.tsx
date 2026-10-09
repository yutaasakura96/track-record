/**
 * Screen 11, Tailored résumés (`docs/10-screen-specifications.md`, issue #57).
 *
 * Two writes start here, in order: the résumé is stored with its job
 * description, then its first version is asked for and the proposal opened.
 * What matters is that the second names the résumé the first made, that a
 * refusal of the second leaves the résumé on the list, and that nothing is
 * generated while the record has no usable fact. All fixtures are invented.
 */
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { RenderRow } from "~/client/api";
import { mount, Refusal, type Routes } from "./harness";

const POSTING = "Platform engineer for the quillset marketplace.";

const row = (over: Partial<RenderRow> = {}): RenderRow => ({
  id: "rnd-test-1",
  ref: "rnd-test-1",
  tailored: { label: "Quillset, platform engineer", createdAt: "2026-10-07T03:00:00.000Z" },
  kind: "english_resume",
  language: "en",
  title: "Résumé for Quillset, platform engineer",
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

const CREATE = "POST /api/tailored-resumes";
const GENERATE = "POST /api/renders/rnd-test-1/generate";

const open = (items: RenderRow[], routes: Routes = {}, canGenerate = true) =>
  mount("/tailored", {
    "GET /api/tailored-resumes": { items, canGenerate },
    "GET /api/imports/summary": { openCandidates: 0, openFlags: 0, running: false },
    ...routes,
  });

async function fill(user: ReturnType<typeof mount>["user"], label = "Quillset, platform engineer", posting = POSTING) {
  await user.type(await screen.findByLabelText("Name"), label);
  await user.type(screen.getByLabelText("Job description"), posting);
}

describe("making a tailored résumé", () => {
  it("stores it, asks for its first version, and opens the proposal", async () => {
    const { api, user, pathname } = open([], {
      [CREATE]: row(),
      [GENERATE]: { proposalId: "prop-test-plinth" },
    });
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Generate résumé" }));

    await waitFor(() => expect(pathname()).toBe("/proposals/prop-test-plinth"));
    expect(api.writes()).toEqual([CREATE, GENERATE]);
    expect(api.bodyOf("POST", "/api/tailored-resumes")).toEqual({
      label: "Quillset, platform engineer",
      jobDescription: POSTING,
    });
  });

  it("keeps the résumé and shows the server's words when its first version is refused", async () => {
    const { api, user, pathname } = open([], {
      [CREATE]: row(),
      [GENERATE]: new Refusal(428, "precondition_failed", "A Résumé (English) cannot be generated without nameLatin."),
    });
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Generate résumé" }));

    expect((await screen.findByRole("alert")).textContent).toBe("A Résumé (English) cannot be generated without nameLatin.");
    expect(pathname()).toBe("/tailored");
    expect(api.writes()).toEqual([CREATE, GENERATE]);
    // Stored: the form is cleared rather than left to be submitted twice.
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("");
  });

  it("generates nothing, and keeps what was typed, when it could not be stored", async () => {
    const { api, user } = open([], {
      [CREATE]: new Refusal(422, "validation_failed", "Paste the job description this résumé is for."),
    });
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Generate résumé" }));

    expect((await screen.findByRole("alert")).textContent).toBe("Paste the job description this résumé is for.");
    expect(api.writes()).toEqual([CREATE]);
    expect((screen.getByLabelText("Job description") as HTMLTextAreaElement).value).toBe(POSTING);
  });

  it("only saves while the record has no fact a document may use, and says why", async () => {
    const { api, user, pathname } = open([], { [CREATE]: row() }, false);
    expect(await screen.findByText(/your record holds no fact a document may use yet\. Import a document first\./)).toBeTruthy();
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(api.writes()).toEqual([CREATE]));
    expect(pathname()).toBe("/tailored");
  });

  it("offers no submit until it has a name and a job description", async () => {
    const { api, user } = open([]);
    const submit = await screen.findByRole("button", { name: "Generate résumé" });
    expect(submit.getAttribute("aria-disabled") ?? (submit as HTMLButtonElement).disabled.toString()).toBe("true");

    await user.type(screen.getByLabelText("Name"), "Quillset");
    await user.click(submit);
    expect(api.writes()).toEqual([]);
  });

  it("reads the job description from a text file, and names the résumé after it", async () => {
    const { api } = open([]);
    const input = (await screen.findByLabelText("Job description file")) as HTMLInputElement;
    const chosen = new File([POSTING], "quillset-platform.txt", { type: "text/plain" });
    fireEvent.change(input, { target: { files: [chosen] } });

    await waitFor(() => expect((screen.getByLabelText("Job description") as HTMLTextAreaElement).value).toBe(POSTING));
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("quillset-platform");
    // Read in the browser: the file is not uploaded as a source document.
    expect(api.writes()).toEqual([]);
  });
});

describe("the tailored résumés already made", () => {
  it("lists each by its name with its own state, and generates the one whose button is pressed", async () => {
    const second = row({
      id: "rnd-test-2",
      ref: "rnd-test-2",
      tailored: { label: "Orrery, backend engineer", createdAt: "2026-10-06T03:00:00.000Z" },
      status: "up_to_date",
      currentVersionId: "rv-test-2",
      currentVersionNo: 2,
      generatedAt: "2026-10-06T04:00:00.000Z",
    });
    const { api, user, pathname } = open([row(), second], { [GENERATE]: { proposalId: "prop-test-zentrel" } });

    const first = (await screen.findByText("Quillset, platform engineer")).closest("li")!;
    expect((await screen.findByText("Orrery, backend engineer")).closest("li")).toBeTruthy();
    await user.click(within(first).getByRole("button", { name: "Generate" }));

    await waitFor(() => expect(pathname()).toBe("/proposals/prop-test-zentrel"));
    expect(api.writes()).toEqual([GENERATE]);
  });

  it("says there are none yet, and where the main résumé is", async () => {
    open([]);
    expect(await screen.findByText("None yet. Your main résumé is on Home; a tailored one is a variant of it for one job.")).toBeTruthy();
  });
});
