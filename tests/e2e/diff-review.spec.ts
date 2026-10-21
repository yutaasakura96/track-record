import { expect, test, type Page } from "@playwright/test";
import { CLAIM, PROFILE, SOURCE_FILENAME, SOURCE_TEXT } from "./fixture";
import { DIFF_REVIEW_STORAGE_STATE } from "./env";

const evidence = process.env.TEST_EVIDENCE_DIR;
async function screenshot(page: Page, name: string) {
  if (evidence) await page.screenshot({ path: `${evidence}/${name}`, fullPage: true });
}

test("first proposal previews the document; regeneration shows a heading change", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, storageState: DIFF_REVIEW_STORAGE_STATE });
  const page = await context.newPage();
  await page.goto("/");
  for (const [label, value] of Object.entries(PROFILE)) await page.getByLabel(label).fill(value);
  await page.getByRole("button", { name: "Save and continue" }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: SOURCE_FILENAME,
    mimeType: "text/markdown",
    buffer: Buffer.from(SOURCE_TEXT),
  });
  await expect(page.locator("article[data-fact-card]").filter({ hasText: CLAIM })).toBeVisible();
  await page.getByRole("button", { name: "Done", exact: true }).first().click();
  // An independent project's section is headed by its record name, the one
  // résumé heading a record edit can rewrite.
  const projectResponse = await context.request.post("/api/projects", { data: { name: "Route Planner" } });
  expect(projectResponse.status()).toBe(201);
  const project = await projectResponse.json() as { id: string };
  await page.route("**/api/proposals/*/diff", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "unavailable", message: "Document unavailable for review." } }),
    });
  });
  await page.getByRole("region", { name: "Next step" }).getByRole("button", { name: "Generate" }).click();

  await expect(page.getByRole("alert")).toContainText("Document unavailable for review.", { timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Accept as v1" })).toBeDisabled();
  await screenshot(page, "preview-read-failure.png");
  await page.unroute("**/api/proposals/*/diff");
  await page.getByRole("button", { name: "Retry" }).click();

  await expect(page.getByRole("heading", { name: "Résumé (English)" })).toBeVisible();
  await expect(page.getByText("Yosuke Aoki")).toBeVisible();
  await expect(page.getByText("yosuke@example.invalid")).toBeVisible();
  await expect(page.getByText(CLAIM).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Accept as v1" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Discard draft" })).toBeVisible();
  await expect(page.getByText("Current", { exact: true })).toHaveCount(0);
  await screenshot(page, "first-resume-preview.png");

  await page.getByRole("button", { name: "Accept as v1" }).click();
  await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();

  const renameResponse = await context.request.patch(`/api/projects/${project.id}`, { data: { name: "Route Optimizer" } });
  expect(renameResponse.ok()).toBeTruthy();
  const generation = await context.request.post("/api/renders/english_resume/generate");
  expect(generation.ok()).toBeTruthy();
  const { proposalId } = await generation.json() as { proposalId: string };
  await expect.poll(async () => {
    const response = await context.request.get(`/api/proposals/${proposalId}`);
    return (await response.json()).generationStatus;
  }).toBe("ready");
  await page.goto(`/proposals/${proposalId}`);
  await expect(page.getByText("Planner", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Optimizer", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Heading rewritten/)).toBeVisible();
  await screenshot(page, "heading-change-review.png");

  const profileResponse = await context.request.get("/api/profile");
  expect(profileResponse.ok()).toBeTruthy();
  const profile = await profileResponse.json() as Record<string, unknown>;
  const updatedProfile = await context.request.put("/api/profile", {
    data: { ...profile, gender: "男", address: "東京都渋谷区神宮前0-0-0\n架空ビル404号室" },
  });
  expect(updatedProfile.ok()).toBeTruthy();
  const rirekishoGeneration = await context.request.post("/api/renders/rirekisho/generate");
  expect(rirekishoGeneration.ok()).toBeTruthy();
  const { proposalId: rirekishoId } = await rirekishoGeneration.json() as { proposalId: string };
  await expect.poll(async () => {
    const response = await context.request.get(`/api/proposals/${rirekishoId}`);
    return (await response.json()).generationStatus;
  }).toBe("ready");
  await page.goto(`/proposals/${rirekishoId}`);
  await expect(page.getByRole("heading", { name: "履歴書" })).toBeVisible();
  await expect(page.getByText(/ふりがな あおき/)).toBeVisible();
  await expect(page.getByText("性別 男")).toBeVisible();
  await expect(page.getByText(/現住所ふりがな/)).toBeVisible();
  await expect(page.getByText(/連絡先 同上/)).toBeVisible();
  const address = page.getByText(/東京都渋谷区神宮前0-0-0/);
  await expect(address).toContainText("架空ビル404号室");
  expect(await address.evaluate((element) => getComputedStyle(element).whiteSpace)).toBe("pre-line");
  await screenshot(page, "first-rirekisho-preview.png");
  await context.close();
});
