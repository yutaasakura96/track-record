/**
 * Applications: the résumé for a job and a sent copy
 * (`docs/10-screen-specifications.md` Screens 14 and 15, issue #71).
 *
 * What a screen here can get wrong without looking wrong: a tick sent for the
 * wrong document, a copy recorded when a document was only meant to be chosen,
 * a freeze the owner was not told about, and a sent copy that offers to change.
 * Each test states the writes a click made and what they carried.
 *
 * All fixtures are invented.
 */
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { Application, ApplicationDocument, DocumentChoice, Proposal, SentCopy, SentCopyPage } from "~/client/api";
import { figures, moveTo, type Standing } from "~/shared/application";
import { mount, Refusal, type Call, type Routes } from "./harness";
import { RIREKISHO_SHEET } from "./rirekisho-sheet";

const TODAY = "2026-10-10";
const ID = "app-test-osprey";
const AT = `/api/applications/${ID}`;
const TAILORED = "rnd-test-osprey";

const NOT_APPLIED: Standing = { step: "not_applied", closedAs: null, dates: { not_applied: "2026-10-01" } };
const APPLIED: Standing = { step: "applied", closedAs: null, dates: { not_applied: "2026-10-01", applied: "2026-10-06" } };

const document = (over: Partial<ApplicationDocument> = {}): ApplicationDocument => ({
  ref: "english_resume",
  kind: "english_resume",
  tailored: false,
  title: "Main résumé",
  language: "en",
  currentVersionId: "rvr-test-main-7",
  currentVersionNo: 7,
  status: "up_to_date",
  newFactsSince: 0,
  withdrawnFactsSince: 0,
  pendingProposalId: null,
  ...over,
});
const MAIN = document();
const RIREKISHO = document({ ref: "rirekisho", kind: "rirekisho", title: "履歴書", language: "ja", currentVersionId: "rvr-test-rireki-4", currentVersionNo: 4 });
const SHOKUMU = document({ ref: "shokumu_keirekisho", kind: "shokumu_keirekisho", title: "職務経歴書", language: "ja", currentVersionId: "rvr-test-shokumu-6", currentVersionNo: 6 });
const OWN = document({ ref: TAILORED, tailored: true, title: "Tailored résumé for Osprey Grid", currentVersionId: "rvr-test-own-1", currentVersionNo: 1 });

const choicesOf = (on: ApplicationDocument[], offered: ApplicationDocument[] = [MAIN, RIREKISHO, SHOKUMU]): DocumentChoice[] =>
  [...on.filter((item) => item.tailored), ...offered.filter((item) => !item.tailored)].map((item) => ({
    ...item,
    onApplication: on.some((other) => other.ref === item.ref),
  }));

const copy = (of: ApplicationDocument, sentOn: string, over: Partial<SentCopy> = {}): SentCopy => ({
  id: `asc-test-${of.kind}-${sentOn}`,
  ref: of.ref,
  kind: of.kind,
  title: of.title,
  versionNo: of.currentVersionNo!,
  sentOn,
  recordedAt: `${sentOn}T03:00:00.000Z`,
  ...over,
});

const application = (standing: Standing, over: Partial<Application> = {}): Application => ({
  id: ID,
  company: "Osprey Grid",
  position: "Backend Engineer",
  postingUrl: null,
  lastActivityAt: "2026-10-06T03:00:00.000Z",
  ...standing,
  ...figures(standing, "2026-10-06", TODAY),
  requirements: [],
  jobDescription: "Backend engineer for the osprey grid telemetry service.",
  documents: [],
  choices: choicesOf([]),
  sentCopies: [],
  canGenerate: true,
  interviews: [],
  today: TODAY,
  ...over,
});

const SUMMARY = { "GET /api/imports/summary": { openCandidates: 0, openFlags: 0, running: false } };

const open = (start: Application, routes: Routes = {}) =>
  mount(`/applications/${ID}`, {
    "GET /api/applications": { items: [], today: TODAY },
    [`GET ${AT}`]: start,
    ...SUMMARY,
    ...routes,
  });

const panel = async () => within((await screen.findByRole("heading", { name: "Résumé for this job" })).closest("section")!);

describe("choosing a résumé, before Applied", () => {
  it("offers a tailored résumé and the documents the record has, side by side, and says what to do next", async () => {
    open(application(NOT_APPLIED, { choices: choicesOf([], [MAIN, document({ ...RIREKISHO, currentVersionId: null, currentVersionNo: null }), SHOKUMU]) }));
    const resume = await panel();

    expect(screen.getByText(/choose the résumé for this job: make a tailored one, or use a document you already have\./)).toBeTruthy();
    expect(resume.getByRole("heading", { name: "Make a tailored résumé" })).toBeTruthy();
    expect(resume.getByText(/English only for now\./)).toBeTruthy();
    expect(resume.getByRole("heading", { name: "Use a document you already have" })).toBeTruthy();
    expect(resume.getByText("English · version 7, the one current today")).toBeTruthy();
    expect(resume.getByText("日本語 · version 6, the one current today")).toBeTruthy();

    // A document with no version is listed and cannot be ticked.
    const unwritten = resume.getByRole("checkbox", { name: /履歴書/ }) as HTMLInputElement;
    expect(unwritten.disabled).toBe(true);
    expect(resume.getByText("No version yet. Generate it from Home first.")).toBeTruthy();
    // Nothing is sent, so nothing is said about copies.
    expect(resume.queryByText("What you sent")).toBeNull();
    expect(resume.queryByText(/No sent copy is recorded/)).toBeNull();
  });

  it("uses the ticked documents, several at once, and then says what moving to Applied will freeze", async () => {
    const chosen = application(NOT_APPLIED, { documents: [RIREKISHO, SHOKUMU], choices: choicesOf([RIREKISHO, SHOKUMU]) });
    const { api, user } = open(application(NOT_APPLIED), { [`PUT ${AT}/documents`]: chosen });
    const resume = await panel();

    await user.click(resume.getByRole("checkbox", { name: /職務経歴書/ }));
    await user.click(resume.getByRole("checkbox", { name: /履歴書/ }));
    await user.click(resume.getByRole("button", { name: "Use the ticked documents" }));

    expect(await screen.findByText("Version 4 · the same document as on Home")).toBeTruthy();
    // In the card's order, whatever order they were ticked in.
    expect(api.bodyOf("PUT", `${AT}/documents`)).toEqual({ documents: ["rirekisho", "shokumu_keirekisho"] });
    expect(api.writes()).toEqual([`PUT ${AT}/documents`]);
    expect(screen.getByText(/when you have sent it, move this to Applied\. The résumé is frozen as sent at that moment\./)).toBeTruthy();
    expect(screen.getByText(/It also freezes 履歴書 v4 and 職務経歴書 v6 as sent\./)).toBeTruthy();
  });

  it("adds to and takes from the documents on it with the card, which starts from what is on it", async () => {
    const start = application(NOT_APPLIED, { documents: [MAIN], choices: choicesOf([MAIN]) });
    const next = application(NOT_APPLIED, { documents: [SHOKUMU], choices: choicesOf([SHOKUMU]) });
    const { api, user } = open(start, { [`PUT ${AT}/documents`]: next });
    const resume = await panel();

    await user.click(resume.getByRole("button", { name: "Add a document you already have" }));
    expect((resume.getByRole("checkbox", { name: /Main résumé/ }) as HTMLInputElement).checked).toBe(true);
    await user.click(resume.getByRole("checkbox", { name: /Main résumé/ }));
    await user.click(resume.getByRole("checkbox", { name: /職務経歴書/ }));
    await user.click(resume.getByRole("button", { name: "Use the ticked documents" }));

    await waitFor(() => expect(resume.queryByRole("button", { name: "Use the ticked documents" })).toBeNull());
    expect(api.bodyOf("PUT", `${AT}/documents`)).toEqual({ documents: ["shokumu_keirekisho"] });
    expect(resume.getByText("職務経歴書")).toBeTruthy();
  });

  it("takes a document off the application, and only that one", async () => {
    const start = application(NOT_APPLIED, { documents: [OWN, MAIN], choices: choicesOf([OWN, MAIN]) });
    const { api, user } = open(start, {
      [`DELETE ${AT}/documents/english_resume`]: application(NOT_APPLIED, { documents: [OWN], choices: choicesOf([OWN]) }),
    });
    const resume = await panel();
    expect(resume.getByText("Version 1 · written for this job")).toBeTruthy();

    await user.click(resume.getByRole("button", { name: "Take off Main résumé" }));

    await waitFor(() => expect(resume.queryByText("Main résumé")).toBeNull());
    expect(api.writes()).toEqual([`DELETE ${AT}/documents/english_resume`]);
    expect(resume.getByText("Tailored résumé for Osprey Grid")).toBeTruthy();
  });

  it("makes a tailored résumé: stores it on the application, generates, and opens its review", async () => {
    const unwritten = document({ ...OWN, currentVersionId: null, currentVersionNo: null, status: "never_generated" });
    const { api, user, pathname } = open(application(NOT_APPLIED), {
      [`POST ${AT}/tailored-resume`]: application(NOT_APPLIED, { documents: [unwritten], choices: choicesOf([unwritten]) }),
      [`POST /api/renders/${TAILORED}/generate`]: { proposalId: "prop-test-own" },
    });

    await user.click((await panel()).getByRole("button", { name: "Make a tailored résumé" }));

    await waitFor(() => expect(pathname()).toBe("/proposals/prop-test-own"));
    expect(api.writes()).toEqual([`POST ${AT}/tailored-resume`, `POST /api/renders/${TAILORED}/generate`]);
  });

  it("keeps the tailored résumé on the application when generating is refused, with the reason", async () => {
    const unwritten = document({ ...OWN, currentVersionId: null, currentVersionNo: null, status: "never_generated" });
    const { user, pathname } = open(application(NOT_APPLIED), {
      [`POST ${AT}/tailored-resume`]: application(NOT_APPLIED, { documents: [unwritten], choices: choicesOf([unwritten]) }),
      [`POST /api/renders/${TAILORED}/generate`]: new Refusal(428, "precondition_required", "There are no accepted facts to generate from yet."),
    });
    const resume = await panel();

    await user.click(resume.getByRole("button", { name: "Make a tailored résumé" }));

    expect((await resume.findByRole("alert")).textContent).toBe("There are no accepted facts to generate from yet.");
    expect(pathname()).toBe(`/applications/${ID}`);
    expect(resume.getByText("No version yet · written for this job")).toBeTruthy();
    // It is there to generate later, and a second one is not offered.
    expect(resume.getByRole("button", { name: "Generate" })).toBeTruthy();
    expect(resume.queryByRole("button", { name: "Make a tailored résumé" })).toBeNull();
  });

  it("puts back a tailored résumé that has a version without generating, and stays on the application", async () => {
    const { api, user, pathname } = open(application(NOT_APPLIED), {
      [`POST ${AT}/tailored-resume`]: application(NOT_APPLIED, { documents: [OWN], choices: choicesOf([OWN]) }),
    });
    const resume = await panel();
    await user.click(resume.getByRole("button", { name: "Make a tailored résumé" }));

    expect(await resume.findByRole("button", { name: "Regenerate" })).toBeTruthy();
    expect(api.writes()).toEqual([`POST ${AT}/tailored-resume`]);
    expect(pathname()).toBe(`/applications/${ID}`);
  });

  it("puts back a tailored résumé whose first proposal is waiting without generating, and refuses nothing", async () => {
    const waiting = document({ ...OWN, currentVersionId: null, currentVersionNo: null, pendingProposalId: "prop-test-own" });
    const { api, user, pathname } = open(application(NOT_APPLIED), {
      [`POST ${AT}/tailored-resume`]: application(NOT_APPLIED, { documents: [waiting], choices: choicesOf([waiting]) }),
    });
    const resume = await panel();
    await user.click(resume.getByRole("button", { name: "Make a tailored résumé" }));

    await waitFor(() => expect(resume.queryByRole("button", { name: "Make a tailored résumé" })).toBeNull());
    expect(resume.getAllByRole("link").map((link) => link.getAttribute("href"))).toContain("/proposals/prop-test-own");
    expect(api.writes()).toEqual([`POST ${AT}/tailored-resume`]);
    expect(resume.queryByRole("alert")).toBeNull();
    expect(pathname()).toBe(`/applications/${ID}`);
  });

  it("regenerates a tailored résumé from its row, and links to its history", async () => {
    const start = application(NOT_APPLIED, { documents: [OWN], choices: choicesOf([OWN]) });
    const { api, user, pathname } = open(start, { [`POST /api/renders/${TAILORED}/generate`]: { proposalId: "prop-test-own-2" } });
    const resume = await panel();

    expect(resume.getByRole("link", { name: "History" }).getAttribute("href")).toBe(`/renders/${TAILORED}/history`);
    expect(resume.getByRole("link", { name: "View" }).getAttribute("href")).toBe(`/renders/${TAILORED}/view`);
    await user.click(resume.getByRole("button", { name: "Regenerate" }));

    await waitFor(() => expect(pathname()).toBe("/proposals/prop-test-own-2"));
    expect(api.writes()).toEqual([`POST /api/renders/${TAILORED}/generate`]);
  });
});

describe("moving to Applied", () => {
  it("says which documents were frozen as sent, and lists them under What you sent", async () => {
    const start = application(NOT_APPLIED, { documents: [RIREKISHO, SHOKUMU], choices: choicesOf([RIREKISHO, SHOKUMU]) });
    const { api, user } = open(start, {
      [`POST ${AT}/steps`]: ({ body }: Call) => {
        const moved = moveTo(NOT_APPLIED, (body as { status: Standing["step"] }).status, TODAY);
        return application(moved, {
          documents: [RIREKISHO, SHOKUMU],
          choices: choicesOf([RIREKISHO, SHOKUMU]),
          sentCopies: [copy(RIREKISHO, TODAY), copy(SHOKUMU, TODAY)],
          frozen: [
            { title: "履歴書", versionNo: 4 },
            { title: "職務経歴書", versionNo: 6 },
          ],
        });
      },
    });

    await user.click(await screen.findByRole("button", { name: "Move to Applied" }));

    expect(
      await screen.findByText(`Moved to Applied. Date saved as ${TODAY}. 履歴書 v4 and 職務経歴書 v6 were frozen as sent.`),
    ).toBeTruthy();
    expect(api.bodyOf("POST", `${AT}/steps`)).toEqual({ status: "applied" });
    const resume = await panel();
    expect(resume.getByRole("heading", { name: "What you sent" })).toBeTruthy();
    expect(resume.getByText("v4 · frozen")).toBeTruthy();
    expect(resume.getByText("v6 · frozen")).toBeTruthy();
    // Chosen before, recorded from here on: nothing is taken off any more.
    expect(resume.queryByRole("button", { name: /^Take off/ })).toBeNull();
    expect(resume.getByRole("button", { name: "Record another sent copy" })).toBeTruthy();
  });

  it("says one document was frozen, in the singular, and that the move was refused when it could not be", async () => {
    const start = application(NOT_APPLIED, { documents: [MAIN], choices: choicesOf([MAIN]) });
    const one = open(start, {
      [`POST ${AT}/steps`]: application(APPLIED, {
        documents: [MAIN],
        choices: choicesOf([MAIN]),
        sentCopies: [copy(MAIN, "2026-10-06")],
        frozen: [{ title: "Main résumé", versionNo: 7 }],
      }),
    });
    await one.user.click(await screen.findByRole("button", { name: "Move to Applied" }));
    expect(await screen.findByText(/Main résumé v7 was frozen as sent\.$/)).toBeTruthy();
  });

  it("is not made when freezing fails, and the reason is said in the panel", async () => {
    const start = application(NOT_APPLIED, { documents: [MAIN], choices: choicesOf([MAIN]) });
    const { user } = open(start, {
      [`POST ${AT}/steps`]: new Refusal(409, "conflict", "fct-test-1 is Private and never reaches a document."),
    });

    await user.click(await screen.findByRole("button", { name: "Move to Applied" }));

    expect((await screen.findByRole("alert")).textContent).toBe("fct-test-1 is Private and never reaches a document.");
    expect(screen.getByRole("button", { name: "Move to Applied" })).toBeTruthy();
    expect(screen.queryByText(/Moved to Applied/)).toBeNull();
  });

  it("links to the missing job header field when moving to Applied cannot freeze the résumé", async () => {
    const start = application(NOT_APPLIED, { documents: [MAIN], choices: choicesOf([MAIN]) });
    const { user } = open(start, {
      [`POST ${AT}/steps`]: new Refusal(409, "conflict", "Complete the job header first.", {
        jobHeaders: [{ employerId: "emp-test-osprey", name: "Osprey Grid", missing: ["city"] }],
      }),
    });

    await user.click(await screen.findByRole("button", { name: "Move to Applied" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Complete the job header first.");
    expect(within(alert).getByRole("link", { name: "Add the city for Osprey Grid" }).getAttribute("href"))
      .toBe("/record?employer=emp-test-osprey&fix=city");
    expect(screen.getByRole("button", { name: "Move to Applied" })).toBeTruthy();
  });
});

describe("from Applied onward", () => {
  const sent = application(APPLIED, {
    documents: [OWN, MAIN],
    choices: choicesOf([OWN, MAIN]),
    sentCopies: [copy(OWN, "2026-10-06")],
  });

  it("lists every copy with its date, and reads or downloads each one", async () => {
    const earlier = copy(MAIN, "2026-10-06", { versionNo: 6 });
    const later = copy(MAIN, "2026-10-09");
    const { user, pathname } = open(application(APPLIED, { documents: [MAIN], choices: choicesOf([MAIN]), sentCopies: [later, earlier] }));
    const resume = await panel();

    const rows = within(resume.getByRole("heading", { name: "What you sent" }).parentElement!).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Main résumé v7 · frozenSent 2026-10-09"),
      expect.stringContaining("Main résumé v6 · frozenSent 2026-10-06"),
    ]);
    expect(resume.getByText(/A frozen copy is the file exactly as it was on the day\./)).toBeTruthy();
    expect(resume.getByRole("button", { name: "Download Main résumé v6, sent 2026-10-06" })).toBeTruthy();

    await user.click(resume.getByRole("link", { name: "Read Main résumé v6, sent 2026-10-06" }));
    await waitFor(() => expect(pathname()).toBe(`/applications/${ID}/sent/${earlier.id}`));
  });

  it("records another sent copy of whatever is ticked, the tailored résumé and one not on the application included", async () => {
    const recorded = application(APPLIED, {
      documents: [OWN, MAIN, SHOKUMU],
      choices: choicesOf([OWN, MAIN, SHOKUMU]),
      sentCopies: [copy(OWN, TODAY, { id: "asc-test-own-again" }), copy(SHOKUMU, TODAY), copy(OWN, "2026-10-06")],
      frozen: [
        { title: "Tailored résumé for Osprey Grid", versionNo: 1 },
        { title: "職務経歴書", versionNo: 6 },
      ],
    });
    const { api, user } = open(sent, { [`POST ${AT}/sent-copies`]: recorded });
    const resume = await panel();

    await user.click(resume.getByRole("button", { name: "Record another sent copy" }));
    // Every document that could have been sent, and none ticked: a tick always freezes.
    const ticks = resume.getAllByRole("checkbox") as HTMLInputElement[];
    expect(ticks.map((tick) => tick.checked)).toEqual([false, false, false, false]);
    const record = resume.getByRole("button", { name: "Record the ticked documents" }) as HTMLButtonElement;
    expect(record.disabled).toBe(true);
    expect(record.title).toBe("Tick at least one document.");

    await user.click(resume.getByRole("checkbox", { name: /Tailored résumé for Osprey Grid/ }));
    await user.click(resume.getByRole("checkbox", { name: /職務経歴書/ }));
    await user.click(resume.getByRole("button", { name: "Record the ticked documents" }));

    expect(await screen.findByText("Tailored résumé for Osprey Grid v1 and 職務経歴書 v6 frozen as sent today.")).toBeTruthy();
    expect(api.bodyOf("POST", `${AT}/sent-copies`)).toEqual({ documents: ["shokumu_keirekisho", TAILORED] });
    expect(api.writes()).toEqual([`POST ${AT}/sent-copies`]);
    await waitFor(() => expect(resume.queryByRole("button", { name: "Record the ticked documents" })).toBeNull());
  });

  it("links to the missing job header field when recording another sent copy is refused", async () => {
    const { user } = open(sent, {
      [`POST ${AT}/sent-copies`]: new Refusal(409, "conflict", "Complete the job header first.", {
        jobHeaders: [{ employerId: "emp-test-osprey", name: "Osprey Grid", missing: ["role"] }],
      }),
    });
    const resume = await panel();

    await user.click(resume.getByRole("button", { name: "Record another sent copy" }));
    await user.click(resume.getByRole("checkbox", { name: /Main résumé/ }));
    await user.click(resume.getByRole("button", { name: "Record the ticked documents" }));

    const alert = await resume.findByRole("alert");
    expect(alert.textContent).toContain("Complete the job header first.");
    expect(within(alert).getByRole("link", { name: "Add the role for Osprey Grid" }).getAttribute("href"))
      .toBe("/record?employer=emp-test-osprey&fix=role");
    expect(resume.getByRole("button", { name: "Record the ticked documents" })).toBeTruthy();
  });

  it("closes the card on Cancel and sends nothing", async () => {
    const { api, user } = open(sent);
    const resume = await panel();

    await user.click(resume.getByRole("button", { name: "Record another sent copy" }));
    await user.click(resume.getByRole("checkbox", { name: /Main résumé/ }));
    await user.click(resume.getByRole("button", { name: "Cancel" }));

    expect(resume.queryByRole("checkbox")).toBeNull();
    expect(api.writes()).toEqual([]);
  });

  it("says when nothing was frozen, and when there is no résumé at all", async () => {
    open(application(APPLIED));
    const resume = await panel();

    expect(resume.getByText("No résumé is recorded for this application.")).toBeTruthy();
    expect(resume.getByText("No sent copy is recorded. Use “Record another sent copy” to add one.")).toBeTruthy();
    expect(resume.getByRole("button", { name: "Make a tailored résumé" })).toBeTruthy();
    expect(resume.getByRole("button", { name: "Record another sent copy" })).toBeTruthy();
  });

  it("drops the Undo of an earlier move once a copy is recorded, which is the last change now", async () => {
    const start = application(NOT_APPLIED, { documents: [MAIN], choices: choicesOf([MAIN]) });
    const moved = application(APPLIED, { documents: [MAIN], choices: choicesOf([MAIN]), sentCopies: [copy(MAIN, "2026-10-06")], frozen: [{ title: "Main résumé", versionNo: 7 }] });
    const { user } = open(start, {
      [`POST ${AT}/steps`]: moved,
      [`POST ${AT}/sent-copies`]: { ...moved, sentCopies: [copy(MAIN, TODAY), ...moved.sentCopies] },
    });

    await user.click(await screen.findByRole("button", { name: "Move to Applied" }));
    expect(await screen.findByRole("button", { name: "Undo" })).toBeTruthy();

    const resume = await panel();
    await user.click(resume.getByRole("button", { name: "Record another sent copy" }));
    await user.click(resume.getByRole("checkbox", { name: /Main résumé/ }));
    await user.click(resume.getByRole("button", { name: "Record the ticked documents" }));

    await waitFor(() => expect(screen.queryByRole("button", { name: "Undo" })).toBeNull());
  });
});

describe("a sent copy", () => {
  const SENT: SentCopyPage = {
    id: "asc-test-rireki",
    applicationId: ID,
    company: "Osprey Grid",
    kind: "rirekisho",
    language: "ja",
    title: "履歴書",
    versionNo: 4,
    sentOn: "2026-10-06",
    recordedAt: "2026-10-06T03:00:00.000Z",
    filename: "rirekisho-2026-10-01.docx",
    page: {
      title: "履 歴 書",
      stamp: "2026年10月6日現在",
      name: "架空　花子",
      contact: ["ふりがな かくう　はなこ", "〒000-0000 架空県架空市0-0-0"],
      sections: [{ heading: "志望の動機", blocks: [{ kind: "paragraph", text: "架空の志望動機です。" }] }],
      sheet: RIREKISHO_SHEET,
    },
  };
  const openCopy = (routes: Routes = {}) =>
    mount(`/applications/${ID}/sent/${SENT.id}`, {
      [`GET ${AT}/sent-copies/${SENT.id}`]: SENT,
      ...SUMMARY,
      ...routes,
    });

  it("shows the document as it was sent, read-only, under the application it was sent for", async () => {
    const { api, pathname, user } = openCopy();

    expect(await screen.findByRole("heading", { level: 1, name: "Applications / Osprey Grid / 履歴書 as sent" })).toBeTruthy();
    expect(screen.getByText("v4 · frozen")).toBeTruthy();
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === "SPAN" &&
          element.textContent ===
            "Sent to Osprey Grid on 2026-10-06. This is the file as it was that day. It cannot be edited, and later changes to the résumé or to your record do not reach it.",
      ),
    ).toBeTruthy();

    // The form as its file lays it out: cells, spans and the 年 / 月 tables, not prose.
    const page = screen.getByRole("article");
    expect(page.getAttribute("lang")).toBe("ja");
    expect(within(page).getByRole("heading", { level: 2, name: "履歴書" })).toBeTruthy();
    expect(within(page).getByText("2026年 10月 6日")).toBeTruthy();
    const tables = within(page).getAllByRole("table");
    expect(tables).toHaveLength(5);
    const printedBlocks = [...page.firstElementChild!.children];
    expect(printedBlocks.map((block) => block.tagName === "P" && block.getAttribute("aria-hidden") === "true" ? "gap" : block.querySelector("table") ? "table" : "line")).toEqual([
      "line", "line", "table", "gap", "table", "gap", "table", "gap", "table", "gap", "table", "gap",
    ]);
    expect(printedBlocks[3]!.classList.contains("mb-14")).toBe(true);
    expect(printedBlocks[9]!.classList.contains("mb-8")).toBe(true);
    expect(printedBlocks[11]!.classList.contains("mb-0")).toBe(true);
    expect(within(tables[0]!).getAllByRole("cell")[1]!.querySelectorAll("p")[0]!.classList.contains("mb-2")).toBe(true);
    expect(within(tables[0]!).getAllByRole("cell")[1]!.querySelectorAll("p")[0]!.classList.contains("mt-4")).toBe(true);
    expect(within(tables[0]!).getAllByRole("cell")[2]!.querySelector("p")!.textContent).toBe("\u00a0");
    expect(within(tables[0]!).getAllByRole("cell")[2]!.querySelector("p")!.classList.contains("mt-26")).toBe(true);
    expect(within(tables[0]!).getAllByRole("cell")[2]!.classList.contains("bg-shade")).toBe(true);
    expect(within(tables[0]!).getAllByRole("cell")[1]!.classList.contains("bg-shade")).toBe(false);
    expect(within(tables[3]!).getAllByRole("cell")[1]!.querySelector("p")!.classList.contains("mt-8")).toBe(true);
    expect(printedBlocks[0]!.classList.contains("mt-0")).toBe(true);
    const cells = (row: HTMLElement) => [...row.querySelectorAll("td, th")];

    const identity = within(tables[0]!).getAllByRole("row");
    expect(cells(identity[0]!).map((cell) => cell.textContent)).toEqual(["ふりがな名前", "かくう　はなこ架空　花子", "\u00a0"]);
    expect(cells(identity[0]!)[2]!.getAttribute("rowspan")).toBe("3");
    expect(cells(identity[1]!).map((cell) => cell.textContent)).toEqual(["1995年 2月 3日生（満 31 歳） 女"]);
    expect(cells(identity[1]!)[0]!.getAttribute("colspan")).toBe("2");

    expect(within(tables[1]!).getAllByRole("columnheader").map((header) => header.textContent)).toEqual(["年", "月", "学歴・職歴"]);
    const history = within(tables[1]!).getAllByRole("row");
    expect(history.map((row) => cells(row).map((cell) => cell.textContent))).toEqual([
      ["年", "月", "学歴・職歴"],
      ["学歴"],
      ["2017", "3", "架空大学　架空学部　卒業"],
      ["職歴"],
      ["2020", "4", "架空商事　入社"],
      ["以上"],
    ]);
    for (const at of [1, 3, 5]) expect(cells(history[at]!)[0]!.getAttribute("colspan")).toBe("3");
    expect(within(tables[2]!).getAllByRole("columnheader").map((header) => header.textContent)).toEqual(["年", "月", "免許・資格"]);
    expect(within(page).getByText("架空の志望動機です。")).toBeTruthy();

    // No edit, no history, no regenerate: one download and the way back.
    expect(screen.getAllByRole("button").map((button) => button.textContent).filter((text) => /edit|history|regenerate|restore/i.test(text ?? ""))).toEqual([]);
    expect(screen.getByRole("button", { name: "Download" })).toBeTruthy();
    expect(api.writes()).toEqual([]);

    await user.click(screen.getByRole("link", { name: "Back to the application" }));
    await waitFor(() => expect(pathname()).toBe(`/applications/${ID}`));
  });

  it("uses the printed kind title for an older sent page without a title", async () => {
    const { title: _title, sheet: _sheet, ...legacyPage } = SENT.page;
    openCopy({ [`GET ${AT}/sent-copies/${SENT.id}`]: {
      ...SENT, kind: "english_resume", title: "Main résumé", language: "en", page: legacyPage,
    } });
    const page = await screen.findByRole("article");
    expect(within(page).getByRole("heading", { name: "Résumé (English)" })).toBeTruthy();
    expect(within(page).queryByRole("heading", { name: "Main résumé" })).toBeNull();
  });

  it("warns above the text when an older copy's original file is unreadable", async () => {
    const { sheet: _sheet, ...legacyPage } = SENT.page;
    openCopy({ [`GET ${AT}/sent-copies/${SENT.id}`]: {
      ...SENT, page: { ...legacyPage, readFailure: "original_file_unreadable" },
    } });
    const page = await screen.findByRole("article");
    const notice = within(page).getByRole("alert");
    expect(notice.textContent).toBe("The original file could not be read — showing its text only.");
    expect(notice.compareDocumentPosition(within(page).getByRole("heading", { level: 2 })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(page).getByText("架空の志望動機です。")).toBeTruthy();
  });

  it("shows the corrected date when the copy is opened again after the Applied date was corrected", async () => {
    const sentOn = (date: string) =>
      screen.findByText((_, element) => element?.tagName === "SPAN" && (element.textContent ?? "").startsWith(`Sent to Osprey Grid on ${date}.`));
    let standing = APPLIED;
    const now = () =>
      application(standing, {
        documents: [RIREKISHO],
        choices: choicesOf([RIREKISHO]),
        sentCopies: [copy(RIREKISHO, standing.dates.applied!, { id: SENT.id })],
      });
    const { user } = openCopy({
      "GET /api/applications": { items: [], today: TODAY },
      [`GET ${AT}`]: now,
      [`GET ${AT}/sent-copies/${SENT.id}`]: () => ({ ...SENT, sentOn: standing.dates.applied! }),
      [`PATCH ${AT}/steps/applied`]: ({ body }: Call) => {
        standing = { ...standing, dates: { ...standing.dates, applied: (body as { date: string }).date } };
        return now();
      },
    });
    expect(await sentOn("2026-10-06")).toBeTruthy();

    await user.click(screen.getByRole("link", { name: "Back to the application" }));
    await user.click(await screen.findByRole("button", { name: "Applied, 2026-10-06. Correct this date" }));
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-10-04" } });
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("button", { name: "Applied, 2026-10-04. Correct this date" });

    await user.click(screen.getByRole("link", { name: "Read 履歴書 v4, sent 2026-10-04" }));
    expect(await sentOn("2026-10-04")).toBeTruthy();
  });

  it("says so when the copy is not there, and offers nothing to do to it", async () => {
    mount(`/applications/${ID}/sent/asc-test-missing`, SUMMARY);
    expect(await screen.findByText("That sent copy was not found.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Download" })).toBeNull();
  });

  it("says when the stored file cannot be downloaded", async () => {
    const { user } = openCopy({
      [`GET ${AT}/sent-copies/${SENT.id}/download`]: new Refusal(404, "not_found", "That sent copy was not found."),
    });
    await user.click(await screen.findByRole("button", { name: "Download" }));
    expect((await screen.findByRole("alert")).textContent).toBe("That sent copy was not found.");
  });
});

describe("the review of a tailored résumé", () => {
  const proposal: Proposal = {
    id: "prop-test-own",
    renderKind: "english_resume",
    renderRef: TAILORED,
    title: "Résumé for Osprey Grid",
    applicationId: ID,
    status: "pending",
    generationStatus: "ready",
    error: null,
    basedOnVersionNo: null,
    proposedVersionNo: 1,
    generatedAt: "2026-10-10T00:00:00.000Z",
    reason: null,
    warnings: [],
    unchanged: false,
    withheld: { privateFactCount: 0, generatedFactCount: 0 },
  };
  const review = (decision: "accept" | "dismiss") =>
    mount(`/proposals/${proposal.id}`, {
      [`GET /api/proposals/${proposal.id}`]: proposal,
      [`GET /api/proposals/${proposal.id}/diff`]: { additions: 0, removals: 0, changes: [], preview: { title: "Résumé (English)", page: { stamp: null, name: "Mika Tanaka", contact: ["mika@example.invalid"], sections: [] } } },
      [`POST /api/proposals/${proposal.id}/${decision}`]: decision === "accept" ? { newVersionNo: 1 } : { status: "dismissed" },
      [`GET ${AT}`]: application(NOT_APPLIED, { documents: [OWN], choices: choicesOf([OWN]) }),
      ...SUMMARY,
    });

  it.each([
    ["Accept as v1", "accept"],
    ["Discard draft", "dismiss"],
  ] as const)("returns to its application after %s", async (name, decision) => {
    const { user, pathname } = review(decision);
    await screen.findByText("Mika Tanaka");
    await user.click(await screen.findByRole("button", { name }));
    await waitFor(() => expect(pathname()).toBe(`/applications/${ID}`));
  });
});
