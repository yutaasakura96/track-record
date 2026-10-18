import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { CLAIM, PROFILE, SOURCE_FILENAME, SOURCE_TEXT } from "./fixture";
import { RESUME_HEADER_STORAGE_STATE } from "./env";

test("résumé header fields are opt-in and never copy 履歴書 PII", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, storageState: RESUME_HEADER_STORAGE_STATE });
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.goto("/");

  for (const [label, value] of Object.entries(PROFILE)) await page.getByLabel(label).fill(value);
  await expect(page.getByText("On your English résumé")).toBeVisible();
  await page.getByLabel("Headline", { exact: false }).fill("Backend Engineer");
  await page.getByLabel("Phone on the résumé", { exact: false }).fill("+81 90-0000-9999");
  await page.locator('input[name="resumeCity"]').fill("Tokyo");
  await page.locator('input[name="resumeCountry"]').fill("Japan");
  await page.getByLabel("LinkedIn", { exact: false }).fill("https://www.linkedin.com/in/example/");
  await page.getByLabel("GitHub", { exact: false }).fill("github.com/example/");
  await page.getByLabel("Portfolio or website", { exact: false }).fill("http://www.example.invalid/work/");
  if (process.env.TEST_EVIDENCE_DIR) {
    await page.screenshot({ path: `${process.env.TEST_EVIDENCE_DIR}/resume-profile-filled.png`, fullPage: true });
  }
  await page.getByLabel("Portfolio or website", { exact: false }).fill("javascript:alert(1)");
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page.getByText("Check this field.")).toBeVisible();
  expect((await context.request.get("/api/profile")).status()).toBe(404);
  await page.getByLabel("Portfolio or website", { exact: false }).fill("http://www.example.invalid/work/");
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page.getByText("Import your first document")).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({
    name: SOURCE_FILENAME,
    mimeType: "text/markdown",
    buffer: Buffer.from(SOURCE_TEXT),
  });
  await expect(page.locator("article[data-fact-card]").filter({ hasText: CLAIM })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Done", exact: true }).first().click();
  await page.getByRole("region", { name: "Next step" }).getByRole("button", { name: "Generate" }).click();
  await expect(page.getByText(CLAIM).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Accept as v1" })).toBeEnabled();
  if (process.env.TEST_EVIDENCE_DIR) {
    await page.screenshot({ path: `${process.env.TEST_EVIDENCE_DIR}/resume-preview-filled.png`, fullPage: true });
  }
  await page.getByRole("button", { name: "Accept as v1" }).click();
  await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Résumé (English)" })).toContainText("Up to date");

  const download = async () => {
    const response = await context.request.get("/api/renders/english_resume/download?format=md");
    expect(response.ok()).toBeTruthy();
    return (await response.text()).split("\n## ")[0]!;
  };
  const filled = await download();
  if (process.env.TEST_EVIDENCE_DIR) await writeFile(`${process.env.TEST_EVIDENCE_DIR}/resume-header-filled.md`, filled);
  expect(filled).toContain("Backend Engineer");
  expect(filled).toContain("Tokyo, Japan · yosuke@example.invalid · +81 90-0000-9999");
  expect(filled).toContain("www.linkedin.com/in/example/");
  expect(filled).toContain("github.com/example/");
  expect(filled).toContain("www.example.invalid/work/");
  expect(filled).not.toContain(PROFILE["電話番号 · Phone"]);
  expect(filled).not.toContain(PROFILE["住所 · Address"]);
  expect(filled).not.toContain(PROFILE["生年月日 · Date of birth"]);

  await page.goto("/profile");
  await expect(page.getByLabel("Phone on the résumé", { exact: false })).toHaveValue("+81 90-0000-9999");
  for (const label of ["Headline", "Phone on the résumé", "City", "Country", "LinkedIn", "GitHub", "Portfolio or website"]) {
    await page.getByLabel(label, { exact: false }).fill("");
  }
  await page.getByRole("button", { name: "Save and continue" }).click();
  const empty = await download();
  if (process.env.TEST_EVIDENCE_DIR) await writeFile(`${process.env.TEST_EVIDENCE_DIR}/resume-header-empty.md`, empty);
  expect(empty).toContain("yosuke@example.invalid");
  for (const value of ["Backend Engineer", "Tokyo", "Japan", "+81 90-0000-9999", "linkedin.com", "github.com", "example.invalid/work"]) {
    expect(empty).not.toContain(value);
  }
  if (process.env.TEST_EVIDENCE_DIR) {
    await page.goto("/profile");
    await expect(page.getByText("On your English résumé")).toBeVisible();
    await page.screenshot({ path: `${process.env.TEST_EVIDENCE_DIR}/resume-profile-empty.png`, fullPage: true });
  }
  expect(consoleErrors.filter((error) => !/status of (404|422) /.test(error))).toEqual([]);
  await context.close();
});
