import { expect, test, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { createDb } from "~/server/db/client";
import { applicationSentCopies } from "~/server/db/schema";
import { readSheet } from "~/render/sheet";
import { RIREKISHO_PRINT_STORAGE_STATE, E2E_DATABASE_URL } from "./env";
import { CLAIM, PROFILE, SOURCE_FILENAME, SOURCE_TEXT } from "./document-view-fixture";

const evidence = process.env.NO_MISTAKES_EVIDENCE_DIR;
const capture = async (page: Page, name: string) => {
  if (evidence) await page.screenshot({ path: `${evidence}/${name}`, fullPage: true });
};

async function checkForm(page: Page) {
  const article = page.getByRole("article");
  await expect(article.getByRole("heading", { name: "履歴書" })).toBeVisible();
  await expect(article.getByText("さとう", { exact: false })).toBeVisible();
  await expect(article.getByText("佐藤", { exact: false })).toBeVisible();
  const tables = article.getByRole("table");
  await expect(tables).toHaveCount(5);
  await expect(tables.nth(0).getByText("男", { exact: false })).toBeVisible();
  await expect(tables.nth(1).getByRole("columnheader")).toHaveText(["年", "月", "学歴・職歴"]);
  for (const label of ["学歴", "職歴", "以上"]) {
    const row = tables.nth(1).getByRole("row").filter({ hasText: label }).filter({ has: page.locator("td[colspan='3']") });
    await expect(row).toHaveCount(1);
  }
  await expect(tables.nth(2).getByRole("columnheader")).toHaveText(["年", "月", "免許・資格"]);
  return article;
}

test("current and legacy 履歴書 pages match their printed files in both themes", async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  const context = await browser.newContext({ baseURL, storageState: RIREKISHO_PRINT_STORAGE_STATE });
  const page = await context.newPage();
  await page.setViewportSize({ width: 1440, height: 1100 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");
  for (const [label, value] of Object.entries(PROFILE)) await page.getByLabel(label).fill(value);
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
  const profileResponse = await context.request.get("/api/profile");
  expect(profileResponse.ok()).toBe(true);
  const profile = await profileResponse.json() as Record<string, unknown>;
  const updated = await context.request.put("/api/profile", { data: { ...profile, gender: "男" } });
  expect(updated.ok()).toBe(true);

  await page.locator('input[type="file"]').setInputFiles({
    name: SOURCE_FILENAME,
    mimeType: "text/markdown",
    buffer: Buffer.from(SOURCE_TEXT),
  });
  await expect(page.locator("article[data-fact-card]").filter({ hasText: CLAIM })).toBeVisible();
  await page.getByRole("button", { name: "Done", exact: true }).first().click();

  const generation = await context.request.post("/api/renders/rirekisho/generate");
  expect(generation.ok()).toBe(true);
  const { proposalId } = await generation.json() as { proposalId: string };
  await expect.poll(async () => {
    const response = await context.request.get(`/api/proposals/${proposalId}`);
    return (await response.json()).generationStatus;
  }).toBe("ready");
  await page.goto(`/proposals/${proposalId}`);
  await checkForm(page);
  await capture(page, "rirekisho-first-proposal-light.png");
  const accepted = await context.request.post(`/api/proposals/${proposalId}/accept`);
  expect(accepted.ok()).toBe(true);

  await page.goto("/renders/rirekisho/view");
  await checkForm(page);
  await capture(page, "rirekisho-current-light.png");
  const version = await context.request.get("/api/renders/rirekisho/page");
  expect(version.ok()).toBe(true);
  const versionPage = await version.json() as { page: { sheet: unknown } };
  expect(versionPage.page.sheet).toBeTruthy();

  await page.getByRole("radio", { name: "Dark" }).click();
  await checkForm(page);
  await capture(page, "rirekisho-current-dark.png");

  const made = await context.request.post("/api/applications", {
    data: { company: "Kakuu Systems", position: "Engineer", jobDescription: "Invented engineering role." },
  });
  expect(made.ok()).toBe(true);
  const application = await made.json() as { id: string };
  const selected = await context.request.put(`/api/applications/${application.id}/documents`, { data: { documents: ["rirekisho"] } });
  expect(selected.ok()).toBe(true);
  const moved = await context.request.post(`/api/applications/${application.id}/steps`, { data: { status: "applied" } });
  expect(moved.ok()).toBe(true);
  const detail = await moved.json() as { sentCopies: { id: string }[] };
  const copyId = detail.sentCopies[0]!.id;
  const copyUrl = `/api/applications/${application.id}/sent-copies/${copyId}`;
  const before = await context.request.get(copyUrl).then((response) => response.json()) as { page: { sheet: unknown; title: string } };
  const file = await context.request.get(`${copyUrl}/download`);
  expect(file.ok()).toBe(true);
  const printedSheet = readSheet(new Uint8Array(await file.body()));
  expect(before.page.sheet).toEqual(printedSheet);

  const { sheet: _sheet, ...oldPage } = before.page;
  const db = createDb(E2E_DATABASE_URL);
  await db.update(applicationSentCopies).set({ page: { ...oldPage, title: "履歴書" } }).where(eq(applicationSentCopies.id, copyId));
  const changedProfile = await context.request.put("/api/profile", { data: { ...profile, gender: "女", address: "架空県別市9-9-9" } });
  expect(changedProfile.ok()).toBe(true);
  const legacy = await context.request.get(copyUrl).then((response) => response.json()) as { page: { sheet: unknown } };
  expect(legacy.page.sheet).toEqual(printedSheet);

  await page.goto(`/applications/${application.id}/sent/${copyId}`);
  await checkForm(page);
  await expect(page.getByRole("article")).not.toContainText("架空県別市9-9-9");
  await capture(page, "rirekisho-legacy-dark.png");
  await page.getByRole("radio", { name: "Light" }).click();
  await checkForm(page);
  await capture(page, "rirekisho-legacy-light.png");

  await db.update(applicationSentCopies).set({ file: Buffer.from("unreadable") }).where(eq(applicationSentCopies.id, copyId));
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("The original file could not be read");
  await expect(page.getByRole("article")).toContainText("履歴書");
  await expect(page.getByRole("article").getByRole("table")).toHaveCount(0);
  await capture(page, "rirekisho-legacy-unreadable-light.png");
  expect(errors).toEqual([]);
  await context.close();
});
