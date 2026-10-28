/**
 * Quick capture in a browser (issue #95), at desktop width and at 390px.
 *
 * Two typed sentences become two facts in the record; a reading that fails
 * opens the plain form with the text kept; a reload keeps the draft; nothing
 * scrolls sideways on a phone, in either theme, with Japanese text. The model
 * is the stub in `model.ts`. Every value is invented.
 */
import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { PROFILE } from "./fixture";
import { CAPTURE_STORAGE_STATE } from "./env";

const evidence = process.env.TEST_EVIDENCE_DIR;

interface Captured {
  claim: string;
  status: string;
  provenance: string;
  disclosure: string;
  gradedBy: string | null;
  evidence: unknown;
  month: string | null;
  employerId: string | null;
}

const sideways = (page: Page) =>
  page.evaluate(
    () => [...document.querySelectorAll("body *")].filter((element) => element.getBoundingClientRect().right > window.innerWidth + 0.5).length,
  );

const captured = async (page: Page) =>
  ((await page.request.get("/api/facts?captured=true").then((r) => r.json())) as { items: Captured[] }).items;

test("capture two sentences into the record at desktop and phone width, and fall back to the plain form", async ({ browser, baseURL }) => {
  if (evidence) mkdirSync(evidence, { recursive: true });
  const context = await browser.newContext({ baseURL, storageState: CAPTURE_STORAGE_STATE, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");
  for (const [label, value] of Object.entries(PROFILE)) await page.getByLabel(label).fill(value);
  await page.getByRole("button", { name: "Save and continue" }).click();
  // An empty record has nothing to capture against, and no way in.
  await expect(page.getByRole("heading", { name: "Your record is empty" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Quick capture" })).toHaveCount(0);

  const employer = await page.request.post("/api/employers", {
    data: {
      nameJa: "株式会社コルヴァーン",
      nameLatin: "Qorvane",
      employmentType: "full_time",
      startedOn: "2022-04-01",
    },
  });
  expect(employer.status()).toBe(201);
  const { id: employerId } = (await employer.json()) as { id: string };

  // Desktop: from Home's header, two sentences, two facts, inside a minute.
  const started = Date.now();
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Quick capture" })).toBeVisible();
  if (evidence) await page.screenshot({ path: `${evidence}/home-header-desktop.png` });
  await page.getByRole("link", { name: "Quick capture" }).click();
  await page.getByLabel("In your own words").fill(
    "Last month at Qorvane I moved the nightly export onto a queue. The morning report now arrives by 7:00.",
  );
  await page.getByRole("button", { name: "Read it" }).click();
  await expect(page.getByRole("heading", { name: "Check the 2 claims" })).toBeVisible();
  const second = page.getByRole("group", { name: "Claim 2" });
  // The second sentence names no employer and no month, so both are asked.
  await expect(second.getByText("Which employer, or which project?")).toBeVisible();
  await expect(second.getByText("When was this?")).toBeVisible();
  await second.getByLabel("Claim 2: employer or project").selectOption(`employer:${employerId}`);
  await second.getByLabel("Claim 2: month").fill("2026-09");
  if (evidence) await page.screenshot({ path: `${evidence}/capture-check-desktop.png`, fullPage: true });
  await page.getByRole("button", { name: "Save 2 facts" }).click();
  await expect(page.getByText("Saved 2 facts into your record.")).toBeVisible();
  expect(Date.now() - started).toBeLessThan(60_000);

  const desktop = await captured(page);
  expect(desktop).toHaveLength(2);
  for (const fact of desktop) {
    expect(fact).toMatchObject({ status: "accepted", provenance: "attested", disclosure: "restricted", gradedBy: "author", evidence: null, employerId });
  }
  // `Last month` is read against the browser's own month.
  const lastMonth = await page.evaluate(() => {
    const now = new Date();
    const back = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return `${back.getFullYear()}-${String(back.getMonth() + 1).padStart(2, "0")}`;
  });
  expect(desktop.map((fact) => fact.month).sort()).toEqual([lastMonth, "2026-09"].sort());
  await expect(page.getByRole("heading", { name: "Captured facts" })).toBeVisible();
  if (evidence) await page.screenshot({ path: `${evidence}/capture-saved-desktop.png`, fullPage: true });

  // A reading that fails opens the plain form, with the text kept, and a fact still saves.
  await page.getByLabel("In your own words").fill("Ran an unreadable but useful weekly review with four teams.");
  await page.getByRole("button", { name: "Read it" }).click();
  await expect(page.getByText("What you typed could not be read just now. Fill the claim in yourself; your text is kept.")).toBeVisible();
  await expect(page.getByLabel("Claim", { exact: true })).toHaveValue("Ran an unreadable but useful weekly review with four teams.");
  // The draft survives a reload, and nothing was saved yet.
  await page.reload();
  await expect(page.getByLabel("Claim", { exact: true })).toHaveValue("Ran an unreadable but useful weekly review with four teams.");
  expect(await captured(page)).toHaveLength(2);
  await page.getByLabel("Claim", { exact: true }).fill("Ran a weekly review with four teams.");
  await page.getByRole("button", { name: "Save the fact" }).click();
  await expect(page.getByText("Saved 1 fact into your record.")).toBeVisible();
  expect(await captured(page)).toHaveLength(3);

  await page.evaluate(() => localStorage.setItem("track-record:theme", "dark"));
  await page.reload();
  await expect(page.getByRole("heading", { name: "Captured facts" })).toBeVisible();
  expect(await sideways(page)).toBe(0);
  if (evidence) await page.screenshot({ path: `${evidence}/capture-saved-desktop-dark.png`, fullPage: true });
  await page.evaluate(() => localStorage.setItem("track-record:theme", "light"));

  // Phone: from the menu, two Japanese sentences, both themes, nothing sideways.
  await page.setViewportSize({ width: 390, height: 1100 });
  await page.goto("/");
  await expect(page.getByText(/needs a window at least 1024/)).toBeVisible();
  await page.goto("/applications");
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "Quick capture" }).click();
  await expect(page.getByText(/needs a window at least 1024/)).toHaveCount(0);
  const phoneStarted = Date.now();
  await page.getByLabel("In your own words").fill(
    "先月、株式会社コルヴァーンで夜間の受注集計をキュー処理に切り替えた。朝の帳票が7時までに届くようになった。",
  );
  await page.getByRole("button", { name: "Read it" }).click();
  await expect(page.getByRole("heading", { name: "Check the 2 claims" })).toBeVisible();
  expect(await sideways(page)).toBe(0);
  if (evidence) await page.screenshot({ path: `${evidence}/capture-check-phone-light.png`, fullPage: true });
  await page.evaluate(() => localStorage.setItem("track-record:theme", "dark"));
  await page.reload();
  await expect(page.getByRole("heading", { name: "Check the 2 claims" })).toBeVisible();
  expect(await sideways(page)).toBe(0);
  if (evidence) await page.screenshot({ path: `${evidence}/capture-check-phone-dark.png`, fullPage: true });
  await page.getByRole("group", { name: "Claim 2" }).getByLabel("Claim 2: employer or project").selectOption(`employer:${employerId}`);
  await page.getByRole("button", { name: "Save 2 facts" }).click();
  await expect(page.getByText("Saved 2 facts into your record.")).toBeVisible();
  expect(Date.now() - phoneStarted).toBeLessThan(60_000);
  expect(await sideways(page)).toBe(0);
  if (evidence) await page.screenshot({ path: `${evidence}/capture-saved-phone-dark.png`, fullPage: true });

  // A captured fact's card opens to change it, at phone width too.
  await page.getByRole("button", { name: "Change" }).first().click();
  await expect(page.getByRole("region", { name: "Change this fact" })).toBeVisible();
  expect(await sideways(page)).toBe(0);
  if (evidence) await page.screenshot({ path: `${evidence}/capture-card-phone-dark.png`, fullPage: true });

  const all = await captured(page);
  expect(all).toHaveLength(5);
  expect(all.filter((fact) => fact.claim.includes("キュー処理"))).toHaveLength(1);
  expect(errors).toEqual([]);
  await context.close();
});
