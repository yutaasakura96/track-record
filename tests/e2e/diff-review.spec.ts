import { expect, test, type Page } from "@playwright/test";
import { CLAIM, PROFILE, SOURCE_FILENAME, SOURCE_TEXT } from "./fixture";
import { DIFF_REVIEW_STORAGE_STATE } from "./env";

const evidence = process.env.TEST_EVIDENCE_DIR;
async function screenshot(page: Page, name: string) {
  if (evidence) await page.screenshot({ path: `${evidence}/${name}`, fullPage: true });
}

test("first proposal previews the document; regeneration shows a heading change", async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
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
  const card = page.locator("article[data-fact-card]").filter({ hasText: CLAIM });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card).not.toContainText("Check where the number came from");
  const factId = await card.getAttribute("data-fact-card");
  expect(factId).toBeTruthy();
  const changed = await context.request.patch(`/api/facts/${factId}`, {
    data: { claim: "Cut the overnight settlement job from eight hours to forty minutes" },
  });
  expect(changed.ok()).toBeTruthy();
  await page.reload();
  const changedCard = page.locator(`article[data-fact-card="${factId}"]`);
  await expect(changedCard).toContainText("Check where the number came from");
  await screenshot(page, "unsourced-number-flag.png");
  await changedCard.getByText("Check where the number came from").scrollIntoViewIfNeeded();
  if (evidence) await changedCard.screenshot({ path: `${evidence}/unsourced-number-card.png` });
  const year = await context.request.patch(`/api/facts/${factId}`, { data: { claim: "Gave a talk in 2023" } });
  expect(year.ok()).toBeTruthy();
  await page.reload();
  await expect(page.locator(`article[data-fact-card="${factId}"]`)).not.toContainText("Check where the number came from");
  const count = await context.request.patch(`/api/facts/${factId}`, { data: { claim: "Processed 2023 tickets" } });
  expect(count.ok()).toBeTruthy();
  await page.reload();
  await expect(page.locator(`article[data-fact-card="${factId}"]`)).toContainText("Check where the number came from");
  const restored = await context.request.patch(`/api/facts/${factId}`, { data: { claim: CLAIM } });
  expect(restored.ok()).toBeTruthy();
  await page.reload();
  await expect(page.locator(`article[data-fact-card="${factId}"]`)).not.toContainText("Check where the number came from");
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

  await expect(page.getByRole("heading", { name: "Yosuke Aoki" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Résumé (English)" })).toHaveCount(0);
  await expect(page.getByText("yosuke@example.invalid")).toBeVisible();
  await expect(page.getByText(CLAIM).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Accept as v1" })).toBeEnabled();
  await expect(page.getByRole("link", { name: "Home", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("button", { name: "Accept as v1" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Discard draft" })).toBeVisible();
  await expect(page.getByText("Current", { exact: true })).toHaveCount(0);
  await screenshot(page, "first-resume-preview.png");

  await page.getByRole("button", { name: "Accept as v1" }).click();
  await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "日本語" }).click();
  await expect(page.getByRole("tab", { name: "日本語" })).toHaveAttribute("aria-selected", "true");

  const reworded = "Shortened the overnight settlement job from eight hours to fifty minutes";
  const reword = await context.request.patch(`/api/facts/${factId}`, { data: { claim: reworded } });
  expect(reword.ok()).toBeTruthy();

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
  await page.getByText("Optimizer", { exact: true }).first().click();
  await expect(page.getByText(/Heading rewritten/)).toBeVisible();
  await screenshot(page, "heading-change-review.png");
  await page.getByText(reworded).last().click();
  await expect(page.getByText("Restricted, so check the wording names no client or system")).toBeVisible();
  await screenshot(page, "restricted-rationale-review.png");

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
  const form = page.getByRole("article");
  await expect(form.getByRole("heading", { name: "履歴書" })).toBeVisible({ timeout: 20_000 });
  const identity = form.getByRole("table").first();
  const cells = identity.getByRole("cell");
  await expect(cells.filter({ hasText: "名前" }).first()).toContainText("ふりがな");
  await expect(cells.filter({ hasText: "あおき" })).toContainText("青木");
  await expect(cells.filter({ hasText: "生（満" })).toContainText("男");
  const residence = identity.getByRole("row").filter({ hasText: "現住所" });
  await expect(residence.getByRole("cell").first()).toContainText("ふりがな");
  const address = residence.getByRole("cell").nth(1).getByText(/東京都渋谷区神宮前0-0-0/);
  await expect(address).toContainText("架空ビル404号室");
  expect(await address.evaluate((element) => getComputedStyle(element).whiteSpace)).toBe("pre-wrap");
  const contact = identity.getByRole("row").filter({ hasText: "連絡先" });
  await expect(contact.getByRole("cell").nth(1)).toContainText("同上");
  await screenshot(page, "first-rirekisho-preview.png");
  await page.goto(`/proposals/${proposalId}`);
  await expect(page.getByRole("button", { name: "Accept proposed version" })).toBeEnabled();
  await page.getByRole("button", { name: "Accept proposed version" }).click();
  await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "English" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("status")).toContainText("Saved as v2 of your Résumé (English).");
  await screenshot(page, "accepted-english-home.png");
  await context.close();
});
