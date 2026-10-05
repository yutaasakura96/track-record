/**
 * The theme (`docs/05` intro, `docs/10` Shared chrome): light by default, dark
 * as the author's choice, kept for this browser.
 *
 * jsdom loads no stylesheet, so what is checked is the contract the stylesheet
 * hangs on: the attribute on `<html>` and the key in `localStorage`. That the
 * two themes are both complete and both readable is `npm run lint`'s to check.
 */
import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { THEME_KEY } from "~/client/stores/theme";
import { mount } from "./harness";

const open = () =>
  mount("/documents", {
    "GET /api/imports": { openCandidates: 0, documents: [] },
    "GET /api/imports/summary": { openCandidates: 0, running: null },
  });

const theme = () => document.documentElement.dataset.theme;

describe("the theme control", () => {
  it("opens light, with nothing chosen", async () => {
    open();

    expect((await screen.findByRole("radio", { name: "Light" })).getAttribute("aria-checked")).toBe("true");
    expect(theme()).toBeUndefined();
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
  });

  it("switches to dark at once and remembers it for this browser", async () => {
    const { user } = open();
    await user.click(await screen.findByRole("radio", { name: "Dark" }));

    expect(theme()).toBe("dark");
    expect(localStorage.getItem(THEME_KEY)).toBe("dark");
    expect(screen.getByRole("radio", { name: "Dark" }).getAttribute("aria-checked")).toBe("true");
  });

  it("goes back to light by removing the attribute, not by naming a second theme", async () => {
    const { user } = open();
    await user.click(await screen.findByRole("radio", { name: "Dark" }));
    await user.click(screen.getByRole("radio", { name: "Light" }));

    expect(theme()).toBeUndefined();
    expect(localStorage.getItem(THEME_KEY)).toBe("light");
  });

  it("is one tab stop, with arrow keys inside it", async () => {
    const { user } = open();
    const light = await screen.findByRole("radio", { name: "Light" });
    light.focus();
    await user.keyboard("{ArrowRight}");

    expect(theme()).toBe("dark");
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Dark" }));
    expect(light.getAttribute("tabindex")).toBe("-1");
  });
});
