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

describe("the résumé header fields (issue #108)", () => {
  it("are their own optional panel, and the résumé phone is not the 履歴書 phone", async () => {
    const { api } = mount("/profile", {
      "GET /api/profile": new Refusal(404, "not_found", "No profile."),
      "PUT /api/profile": new Refusal(422, "invalid", "Portfolio is not a web address.", { fields: ["resumePortfolioUrl"] }),
    });
    await screen.findByRole("button", { name: "Save and continue" });

    expect(screen.getByText("On your English résumé")).toBeTruthy();
    expect(screen.getByText(/never appear on the résumé/).textContent).toContain("履歴書 address");
    const phone = screen.getByLabelText(/Phone on the résumé/) as HTMLInputElement;
    expect(phone).not.toBe(screen.getByLabelText(/電話番号/));
    fireEvent.change(phone, { target: { value: "+81 90-0000-9999" } });
    fireEvent.change(screen.getByLabelText(/^Headline/), { target: { value: "Backend Engineer" } });
    fireEvent.change(screen.getByLabelText(/^Portfolio/), { target: { value: "not a link" } });

    fireEvent.submit(document.querySelector("form")!);
    await screen.findByRole("alert");

    const body = api.bodyOf("PUT", "/api/profile") as Record<string, unknown>;
    expect(body.resumePhone).toBe("+81 90-0000-9999");
    expect(body.resumeHeadline).toBe("Backend Engineer");
    expect(body.resumePortfolioUrl).toBe("not a link");
    // Left blank, sent as null: nothing is printed for it.
    expect(body.resumeCity).toBeNull();
    expect(body.resumeLinkedinUrl).toBeNull();
    // A refused optional field is not called required.
    expect(screen.getByText("Check this field.")).toBeTruthy();
  });
});
