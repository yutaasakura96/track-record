import { expect, test } from "@playwright/test";
import { PROFILE, SOURCE_FILENAME, SOURCE_TEXT } from "./fixture";
import { PHONE_WALL_STORAGE_STATE } from "./env";

test("a phone visitor can leave the width wall for usable screens", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, storageState: PHONE_WALL_STORAGE_STATE, viewport: { width: 1280, height: 844 } });
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/");
  for (const [label, value] of Object.entries(PROFILE)) await page.getByLabel(label).fill(value);
  await page.getByRole("button", { name: "Save and continue" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByText(/needs a window at least 1024/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Applications" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Skills" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Quick capture" })).toHaveCount(0);
  if (process.env.NO_MISTAKES_EVIDENCE_DIR) {
    await page.screenshot({ path: `${process.env.NO_MISTAKES_EVIDENCE_DIR}/phone-width-wall.png`, fullPage: true });
  }
  await page.getByRole("link", { name: "Applications" }).click();
  await expect(page).toHaveURL(/\/applications$/);
  await expect(page.getByRole("heading", { name: "No applications yet" })).toBeVisible();
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "Skills" }).click();
  await expect(page).toHaveURL(/\/skills$/);
  await expect(page.getByRole("heading", { name: "Skills" })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 844 });
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({
    name: SOURCE_FILENAME, mimeType: "text/markdown", buffer: Buffer.from(SOURCE_TEXT),
  });
  await expect(page.locator("article[data-fact-card]")).toBeVisible({ timeout: 30_000 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Quick capture" })).toBeVisible();
  if (process.env.NO_MISTAKES_EVIDENCE_DIR) {
    await page.screenshot({ path: `${process.env.NO_MISTAKES_EVIDENCE_DIR}/phone-width-wall-filled.png`, fullPage: true });
  }
  await page.getByRole("link", { name: "Quick capture" }).click();
  await expect(page).toHaveURL(/\/capture$/);
  expect(pageErrors).toEqual([]);
  await context.close();
});
