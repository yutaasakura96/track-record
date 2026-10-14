/**
 * Uploading, playing and removing an audio recording on an interview card
 * (`docs/10-screen-specifications.md`, Screen 13; issue #76).
 *
 * What it can get wrong without looking wrong: a file too large or not audio
 * sent anyway, only for the server to refuse it after minutes of uploading; a
 * name sent unencoded; an upload cut off that leaves nothing to press; a
 * recording drawn as uploaded before the server said so. The upload goes
 * through `XMLHttpRequest`, for its progress, so that is what is faked here and
 * every request it made is recorded.
 *
 * All fixtures are invented.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import type { Application } from "~/client/api";
import { figures, type Standing } from "~/shared/application";
import type { Interview } from "~/shared/interview";
import { RECORDING_MAX_BYTES, type Recording } from "~/shared/recording";
import { mount, type Routes } from "./harness";

const TODAY = "2026-10-10";
const ID = "app-test-fernhill";
const AT = `/api/applications/${ID}`;
const ENTRY = "int-test-first";
const RECORDINGS = `${AT}/interviews/${ENTRY}/recordings`;

const STANDING: Standing = {
  step: "interview_1",
  closedAs: null,
  dates: { not_applied: "2026-09-01", applied: "2026-09-03", interview_1: "2026-09-24" },
};

const FILED: Recording = {
  id: "rec-test-file",
  kind: "upload",
  fileName: "fernhill-first-interview.m4a",
  byteSize: 46 * 1024 * 1024,
  durationSeconds: 52 * 60,
  uploadedOn: "2026-09-24",
};

const entry = (recordings: Recording[]): Interview => ({
  id: ENTRY,
  date: "2026-09-24",
  round: "interview_1",
  who: "",
  howItWent: "Friendly and fast.",
  questions: [],
  recordings,
});

const application = (recordings: Recording[]): Application => ({
  id: ID,
  company: "Fernhill Robotics",
  position: "Senior Backend Engineer",
  postingUrl: null,
  lastActivityAt: "2026-09-24T03:00:00.000Z",
  ...STANDING,
  ...figures(STANDING, "2026-09-24", TODAY),
  requirements: [],
  jobDescription: "Senior backend engineer for the fernhill warehouse fleet.",
  documents: [],
  choices: [],
  sentCopies: [],
  canGenerate: true,
  interviews: [entry(recordings)],
  today: TODAY,
});

/** An `XMLHttpRequest` that records what was sent and answers when the test says. */
class FakeRequest {
  static sent: FakeRequest[] = [];
  method = "";
  url = "";
  headers: Record<string, string> = {};
  body: unknown;
  status = 0;
  response: unknown = null;
  responseType = "";
  upload: { onprogress: ((event: { loaded: number; total: number; lengthComputable: boolean }) => void) | null } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name.toLowerCase()] = value;
  }
  send(body: unknown) {
    this.body = body;
    FakeRequest.sent.push(this);
  }
  progress(loaded: number, total: number) {
    this.upload.onprogress?.({ loaded, total, lengthComputable: true });
  }
  answer(status: number, response: unknown) {
    this.status = status;
    this.response = response;
    this.onload?.();
  }
}

beforeEach(() => {
  FakeRequest.sent = [];
  vi.stubGlobal("XMLHttpRequest", FakeRequest);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A file whose first bytes are an M4A's, `size` long as the browser reports it. */
function m4a(name = "fernhill-final.m4a", size?: number) {
  const head = new Uint8Array([0, 0, 0, 0x20, ...new TextEncoder().encode("ftypM4A "), 0, 0, 0, 0]);
  const file = new File([head, new Uint8Array(2048)], name, { type: "audio/x-m4a" });
  if (size !== undefined) Object.defineProperty(file, "size", { value: size });
  return file;
}

function open(start: Recording[] = [], routes: Routes = {}) {
  let recordings = start;
  return mount(`/applications/${ID}`, {
    "GET /api/applications": { items: [], today: TODAY },
    "GET /api/imports/summary": { openCandidates: 0, openFlags: 0, running: false },
    [`GET ${AT}`]: () => application(recordings),
    [`DELETE ${RECORDINGS}/${FILED.id}`]: () => {
      recordings = recordings.map((each) => (each.id === FILED.id ? { id: each.id, kind: "removed", removedOn: TODAY } : each));
      return application(recordings);
    },
    ...routes,
  });
}

const card = async () => (await screen.findByRole("heading", { name: "First interview" })).closest("li")!;

/** `Attach a recording`, then a file chosen through `Upload audio`. */
async function choose(user: ReturnType<typeof open>["user"], file: File) {
  await user.click(within(await card()).getByRole("button", { name: "Attach a recording" }));
  const chooser = within(await card()).getByLabelText("Choose an audio file") as HTMLInputElement;
  await user.upload(chooser, file);
}

describe("an uploaded recording on its card", () => {
  it("reads its name, size, length, day and that only you can play it, with Play, Download and Remove", async () => {
    open([FILED]);
    const row = within(await card());

    expect(row.getByText("Audio")).toBeTruthy();
    expect(row.getByText("fernhill-first-interview.m4a")).toBeTruthy();
    expect(row.getByText("46 MB · 52 min · uploaded 2026-09-24 · only you can play it")).toBeTruthy();
    const download = row.getByRole("link", { name: "Download fernhill-first-interview.m4a" }) as HTMLAnchorElement;
    expect(download.getAttribute("href")).toBe(`${RECORDINGS}/${FILED.id}/audio?download`);
    expect(row.getByRole("button", { name: "Remove fernhill-first-interview.m4a" })).toBeTruthy();
  });

  it("leaves the length out when it is not known", async () => {
    open([{ ...FILED, durationSeconds: null, byteSize: 3_400_000 }]);
    expect(within(await card()).getByText("3.2 MB · uploaded 2026-09-24 · only you can play it")).toBeTruthy();
  });

  it("plays in the page from the Worker, which is where seeking is answered", async () => {
    const { user } = open([FILED]);
    await user.click(within(await card()).getByRole("button", { name: "Play fernhill-first-interview.m4a" }));

    const player = (await card()).querySelector("audio")!;
    expect(player.getAttribute("src")).toBe(`${RECORDINGS}/${FILED.id}/audio`);
    expect(player.controls).toBe(true);
    expect(within(await card()).queryByRole("button", { name: "Play fernhill-first-interview.m4a" })).toBeNull();
  });

  it("asks once before removing, saying the file is deleted, and removes that one", async () => {
    const { user, api } = open([FILED]);
    await user.click(within(await card()).getByRole("button", { name: "Remove fernhill-first-interview.m4a" }));

    const dialog = within(await card()).getByRole("alertdialog", { name: "Remove this recording" });
    expect(dialog.textContent).toContain(
      "Remove fernhill-first-interview.m4a for good? The file is deleted from storage and cannot be brought back. The interview keeps a line saying one was removed.",
    );
    await user.click(within(dialog).getByRole("button", { name: "Remove it" }));

    expect(await within(await card()).findByText("A recording was removed on 2026-10-10.")).toBeTruthy();
    expect(api.writes()).toEqual([`DELETE ${RECORDINGS}/${FILED.id}`]);
  });
});

describe("uploading one", () => {
  it("offers Upload audio first and states the kinds, the limit and who can play it", async () => {
    const { user } = open();
    await user.click(within(await card()).getByRole("button", { name: "Attach a recording" }));
    const box = within(await card());

    expect(box.getByRole("button", { name: "Upload audio" })).toBeTruthy();
    expect(box.getByRole("button", { name: "Add a link instead" })).toBeTruthy();
    expect(
      box.getByText(
        "Audio (MP3, M4A, AAC, WAV, FLAC or Ogg), up to 90 MB a file. It is stored privately and only you, signed in, can play it. Other people's voices are on it, so nothing here shares it or sends it anywhere.",
      ),
    ).toBeTruthy();
  });

  it("refuses a file over the limit before sending it, with its name, its size and the limit", async () => {
    const { user } = open();
    await choose(user, m4a("long-call.m4a", RECORDING_MAX_BYTES + 5 * 1024 * 1024));

    expect((await within(await card()).findByRole("alert")).textContent).toBe(
      "long-call.m4a is 95.0 MB. A recording can be at most 90 MB.",
    );
    expect(FakeRequest.sent).toEqual([]);
  });

  it("refuses a file that is not audio before sending it, with its name, its type and what it takes", async () => {
    const { user } = open();
    // Named and typed as audio, but its first bytes are a PDF's.
    await choose(user, new File(["%PDF-1.7 not a recording"], "posting.mp3", { type: "audio/mpeg" }));

    expect((await within(await card()).findByRole("alert")).textContent).toBe(
      "posting.mp3, audio/mpeg, is not audio this app keeps. It takes MP3, M4A, AAC, WAV, FLAC or Ogg, up to 90 MB.",
    );
    expect(FakeRequest.sent).toEqual([]);
  });

  it("sends the file as the body with its name encoded, shows its progress, and lists it once the server has it", async () => {
    const { user } = open();
    const file = m4a("面接 final.m4a");
    await choose(user, file);

    await waitFor(() => expect(FakeRequest.sent).toHaveLength(1));
    const [sent] = FakeRequest.sent;
    expect(sent!.method).toBe("POST");
    expect(sent!.url).toBe(`${RECORDINGS}/audio`);
    expect(sent!.body).toBe(file);
    expect(sent!.headers["x-file-name"]).toBe(encodeURIComponent("面接 final.m4a"));

    sent!.progress(1024 * 1024, 2 * 1024 * 1024);
    const status = await within(await card()).findByRole("status");
    expect(status.textContent).toContain("Uploading 面接 final.m4a");
    expect(status.textContent).toContain("1 of 2 MB. Keep this page open.");
    expect(within(status).getByRole("progressbar").getAttribute("aria-valuenow")).toBe("50");
    // Not listed while it is still going.
    expect(within(await card()).queryByText("Audio")).toBeNull();

    sent!.answer(201, application([{ ...FILED, id: "rec-test-new", fileName: "面接 final.m4a" }]));
    expect(await screen.findByText("Recording uploaded.")).toBeTruthy();
    expect(within(await card()).getByText("面接 final.m4a")).toBeTruthy();
    expect(within(await card()).queryByRole("status")).toBeNull();
  });

  it("says an upload cut off stopped and kept nothing, and Try again sends it again", async () => {
    const { user } = open();
    const file = m4a();
    await choose(user, file);
    await waitFor(() => expect(FakeRequest.sent).toHaveLength(1));
    FakeRequest.sent[0]!.onerror?.();

    const alert = await within(await card()).findByRole("alert");
    expect(alert.textContent).toContain("The upload of fernhill-final.m4a stopped before it finished, so nothing was kept.");
    expect(within(await card()).queryByText("Audio")).toBeNull();

    await user.click(within(alert).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(FakeRequest.sent).toHaveLength(2));
    expect(FakeRequest.sent[1]!.body).toBe(file);
  });

  it("lists it as uploaded when the connection dropped after the server had stored it", async () => {
    let stored: Recording[] = [];
    const { user } = open([], { [`GET ${AT}`]: () => application(stored) });
    await choose(user, m4a());
    await waitFor(() => expect(FakeRequest.sent).toHaveLength(1));

    // The server has it; its answer never arrived.
    stored = [{ ...FILED, id: "rec-test-landed", fileName: "fernhill-final.m4a", byteSize: m4a().size }];
    FakeRequest.sent[0]!.onerror?.();

    expect(await screen.findByText("Recording uploaded.")).toBeTruthy();
    expect(within(await card()).getByText("fernhill-final.m4a")).toBeTruthy();
    expect(within(await card()).queryByText(/stopped before it finished/)).toBeNull();
    expect(FakeRequest.sent).toHaveLength(1);
  });

  it("says why when the server refuses one, and keeps the card open", async () => {
    const { user } = open();
    await choose(user, m4a());
    await waitFor(() => expect(FakeRequest.sent).toHaveLength(1));
    FakeRequest.sent[0]!.answer(422, { error: { code: "validation_failed", message: "Give the file a name." } });

    expect((await within(await card()).findByRole("alert")).textContent).toBe("Give the file a name.");
    expect(within(await card()).getByRole("button", { name: "Upload audio" })).toBeTruthy();
  });
});
