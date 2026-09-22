/**
 * The profile form, screen 1: the first thing a new account sees, and the only
 * screen reachable until a profile exists.
 */
import { describe, expect, it } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { mount, Refusal, toneOf } from "./harness";

describe("saving the profile", () => {
  it("states a refusal above the form, and stays", async () => {
    const { api, pathname } = mount("/profile", {
      "GET /api/profile": new Refusal(404, "not_found", "No profile."),
      "PUT /api/profile": new Refusal(422, "invalid", "The postal code is not seven digits."),
    });
    await screen.findByRole("button", { name: "Save and continue" });

    // Submitted directly: the refusal is the server's, whatever the fields hold.
    fireEvent.submit(document.querySelector("form")!);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("The postal code is not seven digits. Nothing was saved.");
    expect(toneOf(alert)).toBe("text-secondary");
    expect(api.writes()).toEqual(["PUT /api/profile"]);
    expect(pathname()).toBe("/profile");
  });
});
