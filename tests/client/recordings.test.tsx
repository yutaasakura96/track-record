/**
 * The recordings on an interview card (`docs/10-screen-specifications.md`,
 * Screen 13; issue #74).
 *
 * What it can get wrong without looking wrong: a link that is not `http` or
 * `https` sent to the server, or drawn as something to open; Remove acting
 * without asking, or asking and then removing the wrong one; a removed
 * recording vanishing with no line left. Each test states the one write a
 * click made and what it carried.
 *
 * All fixtures are invented.
 */
import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import type { Application } from "~/client/api";
import { figures, type Standing } from "~/shared/application";
import type { Interview } from "~/shared/interview";
import type { Recording } from "~/shared/recording";
import { mount, Refusal, type Call, type Routes } from "./harness";

const TODAY = "2026-10-10";
const ID = "app-test-fernhill";
const AT = `/api/applications/${ID}`;
const ENTRY = "int-test-second";
const RECORDINGS = `${AT}/interviews/${ENTRY}/recordings`;

const STANDING: Standing = {
  step: "interview_2",
  closedAs: null,
  dates: { not_applied: "2026-09-01", applied: "2026-09-03", interview_1: "2026-09-24", interview_2: "2026-10-02" },
};

const THEIRS: Recording = {
  id: "rec-test-theirs",
  kind: "link",
  url: "https://meet.example.invalid/rec/fernhill-second",
  label: "Their recording of the call",
};
const UNNAMED: Recording = { id: "rec-test-unnamed", kind: "link", url: "http://files.example.invalid/call.m4a", label: "" };

const entry = (recordings: Recording[]): Interview => ({
  id: ENTRY,
  date: "2026-10-02",
  round: "interview_2",
  who: "",
  howItWent: "A design exercise on a whiteboard.",
  questions: [],
  recordings,
});

const application = (recordings: Recording[]): Application => ({
  id: ID,
  company: "Fernhill Robotics",
  position: "Senior Backend Engineer",
  postingUrl: null,
  lastActivityAt: "2026-10-02T03:00:00.000Z",
  ...STANDING,
  ...figures(STANDING, "2026-10-02", TODAY),
  requirements: [],
  jobDescription: "Senior backend engineer for the fernhill warehouse fleet.",
  resume: null,
  canGenerate: true,
  interviews: [entry(recordings)],
  today: TODAY,
});

/** One application with one entry, behind a server that keeps the entry's recordings. */
function open(start: Recording[] = [], routes: Routes = {}) {
  let recordings = start;
  return mount(`/applications/${ID}`, {
    "GET /api/applications": { items: [], today: TODAY },
    "GET /api/imports/summary": { openCandidates: 0, openFlags: 0, running: false },
    [`GET ${AT}`]: () => application(recordings),
    [`POST ${RECORDINGS}`]: ({ body }: Call) => {
      const link = body as { url: string; label: string };
      recordings = [...recordings, { id: `rec-test-${recordings.length + 1}`, kind: "link", ...link }];
      return application(recordings);
    },
    ...Object.fromEntries(
      start.map((recording) => [
        `DELETE ${RECORDINGS}/${recording.id}`,
        () => {
          recordings = recordings.map((each) =>
            each.id === recording.id ? { id: each.id, kind: "removed", removedOn: TODAY } : each,
          );
          return application(recordings);
        },
      ]),
    ),
    ...routes,
  });
}

const card = async () => (await screen.findByRole("heading", { name: "Second interview" })).closest("li")!;
const openForm = async (user: ReturnType<typeof open>["user"]) => {
  await user.click(within(await card()).getByRole("button", { name: "Attach a recording" }));
  return within(await card()).getByLabelText("Link to the recording") as HTMLInputElement;
};

describe("the recordings on an interview card", () => {
  it("draws a link as its label and its address, with Open in a new tab", async () => {
    open([THEIRS, UNNAMED]);
    const within_ = within(await card());

    expect(within_.getByText("Their recording of the call")).toBeTruthy();
    expect(within_.getByText("https://meet.example.invalid/rec/fernhill-second")).toBeTruthy();
    const link = within_.getByRole("link", { name: "Open Their recording of the call" }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("https://meet.example.invalid/rec/fernhill-second");
    expect(link.target).toBe("_blank");
    expect(link.rel).toBe("noopener noreferrer");
    expect(link.textContent).toBe("Open");

    // One with no label says what it is anyway.
    expect(within_.getByText("Recording kept elsewhere")).toBeTruthy();
    expect(within_.getByRole("link", { name: "Open Recording kept elsewhere" }).getAttribute("href")).toBe(
      "http://files.example.invalid/call.m4a",
    );
    expect(within_.getAllByText("Link")).toHaveLength(2);
  });

  it("never draws an address that is not http or https as something to open", async () => {
    open([{ id: "rec-test-bad", kind: "link", url: "javascript:alert(1)", label: "Not a link at all" }]);
    const within_ = within(await card());

    expect(within_.getByText("Not a link at all")).toBeTruthy();
    expect(within_.queryByRole("link")).toBeNull();
    expect(within_.getByRole("button", { name: "Remove Not a link at all" })).toBeTruthy();
  });

  it("says a recording was removed and when, with nothing to open or remove", async () => {
    open([{ id: "rec-test-gone", kind: "removed", removedOn: "2026-10-05" }]);
    const within_ = within(await card());

    expect(within_.getByText("A recording was removed on 2026-10-05.")).toBeTruthy();
    expect(within_.queryByRole("link")).toBeNull();
    expect(within_.queryByRole("button", { name: /^Remove/ })).toBeNull();
    expect(within_.getByRole("button", { name: "Attach a recording" })).toBeTruthy();
  });

  it("says on the new interview form that a recording is attached afterwards", async () => {
    const { user } = open();
    await user.click(await screen.findByRole("button", { name: "Add an interview" }));
    expect(screen.getByText("A recording is attached after you save, from the interview's own card.")).toBeTruthy();
  });
});

describe("attaching a link", () => {
  it("opens the link form in place, and says only the link is kept", async () => {
    const { api, user } = open();
    const field = await openForm(user);
    const within_ = within(await card());

    expect(field.placeholder).toBe("https://");
    expect(document.activeElement).toBe(field);
    expect((within_.getByLabelText("What it is, in a few words") as HTMLInputElement).placeholder).toBe(
      "Their recording of the call",
    );
    expect(
      within_.getByText("Only the link is kept. If the recording is taken down where it lives, it is gone here too."),
    ).toBeTruthy();
    // While it is open there is nothing to open.
    expect(within_.queryByRole("button", { name: "Attach a recording" })).toBeNull();

    await user.click(within_.getByRole("button", { name: "Cancel" }));
    expect(within(await card()).getByRole("button", { name: "Attach a recording" })).toBeTruthy();
    expect(api.writes()).toEqual([]);
  });

  it("sends the link and what it is, trimmed, then shows the row and says so", async () => {
    const { api, user } = open();
    await user.type(await openForm(user), "  https://meet.example.invalid/rec/fernhill-second ");
    await user.type(within(await card()).getByLabelText("What it is, in a few words"), " Their recording of the call ");
    await user.click(within(await card()).getByRole("button", { name: "Add the link" }));

    expect(await screen.findByText("Link added.")).toBeTruthy();
    expect(api.writes()).toEqual([`POST ${RECORDINGS}`]);
    expect(api.bodyOf("POST", RECORDINGS)).toEqual({
      url: "https://meet.example.invalid/rec/fernhill-second",
      label: "Their recording of the call",
    });
    const within_ = within(await card());
    expect(within_.getByRole("link", { name: "Open Their recording of the call" })).toBeTruthy();
    expect(within_.queryByLabelText("Link to the recording")).toBeNull();
    expect(within_.getByRole("button", { name: "Attach a recording" })).toBeTruthy();
  });

  it("adds the link on Enter", async () => {
    const { api, user } = open();
    await user.type(await openForm(user), "https://meet.example.invalid/rec/fernhill-second{Enter}");

    expect(await screen.findByText("Link added.")).toBeTruthy();
    expect(api.bodyOf("POST", RECORDINGS)).toEqual({ url: "https://meet.example.invalid/rec/fernhill-second", label: "" });
  });

  it.each(["meet.example.invalid/rec", "javascript:alert(1)", "ftp://files.example.invalid/call.m4a", "file:///call.m4a", "https://"])(
    "refuses %s without sending it, and keeps what was typed",
    async (text) => {
      const { api, user } = open();
      const field = await openForm(user);
      await user.type(field, text);
      await user.click(within(await card()).getByRole("button", { name: "Add the link" }));

      expect(within(await card()).getByRole("alert").textContent).toBe(
        "That does not look like a link. It should start with https://",
      );
      expect(api.writes()).toEqual([]);
      expect(field.value).toBe(text);
    },
  );

  it("refuses an empty field the same way", async () => {
    const { api, user } = open();
    await openForm(user);
    await user.click(within(await card()).getByRole("button", { name: "Add the link" }));

    expect(within(await card()).getByRole("alert").textContent).toBe(
      "That does not look like a link. It should start with https://",
    );
    expect(api.writes()).toEqual([]);
  });

  it("keeps the form and what was typed when the server refuses, and says why", async () => {
    const { user } = open([], {
      [`POST ${RECORDINGS}`]: new Refusal(409, "conflict", "This application was changed somewhere else. Reload it and try again."),
    });
    const field = await openForm(user);
    await user.type(field, "https://meet.example.invalid/rec/fernhill-second");
    await user.click(within(await card()).getByRole("button", { name: "Add the link" }));

    await waitFor(() =>
      expect(within(document.body).getByRole("alert").textContent).toBe(
        "This application was changed somewhere else. Reload it and try again.",
      ),
    );
    expect(field.value).toBe("https://meet.example.invalid/rec/fernhill-second");
    expect(screen.queryByText("Link added.")).toBeNull();
  });
});

describe("removing a recording", () => {
  it("asks once in place of the row, and Keep it changes nothing", async () => {
    const { api, user } = open([THEIRS]);
    await user.click(within(await card()).getByRole("button", { name: "Remove Their recording of the call" }));

    const dialog = within(await card()).getByRole("alertdialog", { name: "Remove this recording" });
    expect(dialog.textContent).toContain(
      "Remove Their recording of the call for good? Only the link is removed; the recording stays where it lives. The interview keeps a line saying one was removed.",
    );
    // The row it stands in for is not drawn beside it.
    expect(within(await card()).queryByRole("link")).toBeNull();

    await user.click(within(dialog).getByRole("button", { name: "Keep it" }));
    expect(within(await card()).queryByRole("alertdialog")).toBeNull();
    expect(within(await card()).getByRole("link", { name: "Open Their recording of the call" })).toBeTruthy();
    expect(api.writes()).toEqual([]);
  });

  it("removes the one asked about, leaves a line in its place and says so", async () => {
    const { api, user } = open([THEIRS, UNNAMED]);
    await user.click(within(await card()).getByRole("button", { name: "Remove Recording kept elsewhere" }));

    const dialog = within(await card()).getByRole("alertdialog");
    expect(dialog.textContent).toContain("Remove this link for good?");
    await user.click(within(dialog).getByRole("button", { name: "Remove it" }));

    expect(await screen.findByText("Recording removed.")).toBeTruthy();
    expect(api.writes()).toEqual([`DELETE ${RECORDINGS}/${UNNAMED.id}`]);
    const within_ = within(await card());
    expect(within_.getByText(`A recording was removed on ${TODAY}.`)).toBeTruthy();
    expect(within_.queryByText("http://files.example.invalid/call.m4a")).toBeNull();
    expect(within_.getByRole("link", { name: "Open Their recording of the call" })).toBeTruthy();
    expect(within_.queryByRole("alertdialog")).toBeNull();
  });

  it("keeps asking, and says why, when the server refuses", async () => {
    const { user } = open([THEIRS], {
      [`DELETE ${RECORDINGS}/${THEIRS.id}`]: new Refusal(409, "conflict", "This application was changed somewhere else. Reload it and try again."),
    });
    await user.click(within(await card()).getByRole("button", { name: "Remove Their recording of the call" }));
    await user.click(within(await card()).getByRole("button", { name: "Remove it" }));

    const dialog = await within(await card()).findByRole("alertdialog");
    await waitFor(() =>
      expect(within(dialog).getByRole("alert").textContent).toBe(
        "This application was changed somewhere else. Reload it and try again.",
      ),
    );
    expect(screen.queryByText("Recording removed.")).toBeNull();
  });
});
