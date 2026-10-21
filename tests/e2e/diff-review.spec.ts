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

  const factsResponse = await context.request.get("/api/facts");
  expect(factsResponse.ok()).toBeTruthy();
  const { items } = await factsResponse.json() as { items: { id: string; claim: string }[] };
  const fact = items.find((item) => item.claim.includes(CLAIM));
  expect(fact).toBeDefined();
  const revised = `${CLAIM} (revised)`;
  const editResponse = await context.request.patch(`/api/facts/${fact!.id}`, { data: { claim: revised } });
  expect(editResponse.ok()).toBeTruthy();
  const generation = await context.request.post("/api/renders/english_resume/generate");
  expect(generation.ok()).toBeTruthy();
  const { proposalId } = await generation.json() as { proposalId: string };
  await expect.poll(async () => {
    const response = await context.request.get(`/api/proposals/${proposalId}`);
    return (await response.json()).generationStatus;
  }).toBe("ready");
  await page.goto(`/proposals/${proposalId}`);
  await expect(page.getByText("Experience", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Selected", { exact: true }).first()).toBeVisible();
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
  const form = page.getByRole("article");
  await expect(form.getByRole("heading", { name: "履歴書" })).toBeVisible();
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
  await context.close();
});
