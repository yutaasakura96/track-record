/**
 * Connected apps on the profile (decision log 2026-11-21): the clients the
 * author allowed, and Disconnect. Every value is invented.
 */
import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { mount, Refusal } from "./harness";

const PROFILE = { id: "profile-test-1", hasPhoto: false, photoVersion: null };
const CLAUDE = {
  clientId: "client-test-claude",
  name: "Claude",
  host: "claude.ai",
  connectedAt: "2026-11-20T03:00:00.000Z",
  lastUsedAt: null,
};

const panel = async () => within((await screen.findByRole("heading", { name: "Connected apps" })).closest("section")!);

describe("connected apps on the profile", () => {
  it("lists each app with where it sends the author back to and when it was allowed", async () => {
    mount("/profile", { "GET /api/profile": PROFILE, "GET /api/connections": { items: [CLAUDE] } });
    const apps = await panel();
    expect(await apps.findByText("Claude")).toBeTruthy();
    expect(apps.getByText(/Sends you back to claude\.ai · Allowed 2026-11-20/)).toBeTruthy();
    expect(apps.getByRole("button", { name: "Disconnect Claude" })).toBeTruthy();
  });

  it("says so when nothing is connected", async () => {
    mount("/profile", { "GET /api/profile": PROFILE, "GET /api/connections": { items: [] } });
    expect(await (await panel()).findByText("No app is connected.")).toBeTruthy();
  });

  it("disconnects on one press, holding the buttons while the server answers, and reads the list again", async () => {
    let items = [CLAUDE];
    let answer: () => void = () => {};
    const { api, user } = mount("/profile", {
      "GET /api/profile": PROFILE,
      "GET /api/connections": () => ({ items }),
      "DELETE /api/connections/client-test-claude": () =>
        new Promise<undefined>((resolve) => {
          answer = () => {
            items = [];
            resolve(undefined);
          };
        }),
    });
    const apps = await panel();
    await user.click(await apps.findByRole("button", { name: "Disconnect Claude" }));
    // Pending: the button says so and says why it cannot be pressed again.
    const pending = await apps.findByRole("button", { name: "Disconnect Claude" });
    await waitFor(() => expect(pending.textContent).toBe("Disconnecting…"));
    expect(pending.getAttribute("title")).toBe("Waiting for the server to end a connection.");
    answer();
    await waitFor(() => expect(api.writes()).toEqual(["DELETE /api/connections/client-test-claude"]));
    expect(await apps.findByText("No app is connected.")).toBeTruthy();
  });

  it("says the app is still connected when the server refuses", async () => {
    const { user } = mount("/profile", {
      "GET /api/profile": PROFILE,
      "GET /api/connections": { items: [CLAUDE] },
      "DELETE /api/connections/client-test-claude": new Refusal(500, "internal", "Something went wrong."),
    });
    const apps = await panel();
    await user.click(await apps.findByRole("button", { name: "Disconnect Claude" }));
    expect((await apps.findByRole("alert")).textContent).toMatch(/The app is still connected\./);
  });

  it("is not offered before there is a profile", async () => {
    mount("/profile", { "GET /api/profile": new Refusal(404, "not_found", "No profile.") });
    await screen.findByRole("heading", { name: "First, who this record is about" });
    expect(screen.queryByRole("heading", { name: "Connected apps" })).toBeNull();
  });
});
