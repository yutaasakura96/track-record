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

  it("sends the résumé's paper size, A4 until the author picks Letter (issue #107)", async () => {
    const { api } = mount("/profile", {
      "GET /api/profile": new Refusal(404, "not_found", "No profile."),
      "PUT /api/profile": new Refusal(422, "invalid", "Not saved in this test."),
    });
    const paper = (await screen.findByLabelText(/^Paper size/)) as unknown as HTMLSelectElement;
    expect(paper.value).toBe("a4");

    fireEvent.change(paper, { target: { value: "letter" } });
    fireEvent.submit(document.querySelector("form")!);

    await screen.findByRole("alert");
    expect(api.bodyOf("PUT", "/api/profile")).toMatchObject({ paperSize: "letter" });
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

describe("the date of birth", () => {
  it("is a full date input, sends the day, and loads a stored day back", async () => {
    const { api } = mount("/profile", {
      "GET /api/profile": new Refusal(404, "not_found", "No profile."),
      "PUT /api/profile": new Refusal(422, "invalid", "Not saved in this test."),
    });
    const field = (await screen.findByLabelText(/生年月日/)) as HTMLInputElement;
    expect(field.type).toBe("date");

    fireEvent.change(field, { target: { value: "1994-11-17" } });
    fireEvent.submit(document.querySelector("form")!);
    await screen.findByRole("alert");

    expect(api.bodyOf("PUT", "/api/profile")).toMatchObject({ dateOfBirth: "1994-11-17" });
  });

  it("shows the stored day in the field", async () => {
    mount("/profile", {
      "GET /api/profile": { id: "profile-test-1", hasPhoto: false, dateOfBirth: "1994-11-17" },
    });
    const field = (await screen.findByLabelText(/生年月日/)) as HTMLInputElement;
    expect(field.value).toBe("1994-11-17");
  });
});

describe("the contact fields use the right input", () => {
  it("phones get a telephone keyboard and a pattern, postal code a numeric hyphen keyboard, email its type", async () => {
    mount("/profile", {
      "GET /api/profile": new Refusal(404, "not_found", "No profile."),
    });
    const phone = (await screen.findByLabelText(/電話番号/)) as HTMLInputElement;
    expect(phone.type).toBe("tel");
    expect(phone.getAttribute("inputmode")).toBe("tel");
    expect(phone.getAttribute("autocomplete")).toBe("tel");
    const re = new RegExp(`^(?:${phone.getAttribute("pattern")})$`, "v");
    expect(re.test("090-0000-1234")).toBe(true);
    expect(re.test("+81 (90) 0000 1234")).toBe(true);
    expect(re.test("０９０ー００００ー１２３４")).toBe(true);
    expect(re.test("090−0000‐1234")).toBe(true);
    expect(re.test("abc")).toBe(false);

    const resumePhone = screen.getByLabelText(/Phone on the résumé/) as HTMLInputElement;
    expect(resumePhone.type).toBe("tel");
    expect(resumePhone.getAttribute("pattern")).toBe(phone.getAttribute("pattern"));

    const postal = screen.getByLabelText(/郵便番号/) as HTMLInputElement;
    expect(postal.getAttribute("autocomplete")).toBe("postal-code");
    const postalRe = new RegExp(`^(?:${postal.getAttribute("pattern")})$`, "v");
    expect(postalRe.test("150-0001")).toBe(true);
    expect(postalRe.test("1500001")).toBe(true);
    expect(postalRe.test("１５０ー０００１")).toBe(true);
    expect(postalRe.test("15-00001")).toBe(false);

    const email = screen.getByLabelText(/メールアドレス/) as HTMLInputElement;
    expect(email.type).toBe("email");
    expect(email.getAttribute("autocomplete")).toBe("email");
  });
});
