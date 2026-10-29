import { expect, test, type Page } from "@playwright/test";
import { CLAIM, CLAIM_SENTENCE, PROFILE, SOURCE_FILENAME, SOURCE_TEXT } from "./document-view-fixture";
import { DOCUMENT_VIEW_STORAGE_STATE } from "./env";
import { E2E_DATABASE_URL } from "./env";
import { createDb } from "~/server/db/client";
import { facts as factTable } from "~/server/db/schema";
import { eq } from "drizzle-orm";

const ready = expect.configure({ timeout: 20_000 });
const screenshot = async (page: Page, name: string) => {
  if (process.env.NO_MISTAKES_EVIDENCE_DIR) {
    await page.screenshot({ path: `${process.env.NO_MISTAKES_EVIDENCE_DIR}/${name}`, fullPage: true });
  }
};

test("accepted résumé opens from Home and History, then refuses a Private cited fact", async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  const context = await browser.newContext({ baseURL, storageState: DOCUMENT_VIEW_STORAGE_STATE });
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
  await ready(card).toBeVisible();
  const importId = new URL(page.url()).pathname.split("/").at(-1);
  const facts = await page.request.get(`/api/facts?importId=${importId}`).then((r) => r.json()) as {
    items: { id: string; claim: string }[];
  };
  const fact = facts.items.find((item) => item.claim.includes(CLAIM));
  expect(fact).toBeTruthy();
  await page.getByRole("button", { name: "Done", exact: true }).first().click();
  await page.getByRole("region", { name: "Next step" }).getByRole("button", { name: "Generate" }).click();
  await ready(page.getByText(CLAIM).first()).toBeVisible();
  await page.getByRole("button", { name: "Accept as v1" }).click();
  await ready(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();

  const row = page.getByRole("listitem").filter({ hasText: "Résumé (English)" });
  await ready(row).toContainText("Up to date");
  await ready(row.getByRole("link", { name: "View" })).toBeVisible();
  await row.getByRole("link", { name: "View" }).click();
  await ready(page).toHaveURL(/\/renders\/english_resume\/view$/);
  const article = page.getByRole("article");
  // The file prints no title above the name, so neither does its page.
  await ready(article.getByRole("heading", { name: PROFILE["Name in Latin script"] })).toBeVisible();
  await expect(article.getByRole("heading", { name: "Résumé (English)" })).toHaveCount(0);
  await ready(article.getByText(CLAIM, { exact: false })).toBeVisible();
  const traceToggle = page.getByRole("button", { name: "Show where each line comes from" });
  await traceToggle.click();
  const line = article.getByRole("button", { name: CLAIM, exact: false }).first();
  await line.click();
  await ready(article.getByText(CLAIM_SENTENCE)).toBeVisible();
  await ready(article.getByText("Backed by a number", { exact: true })).toBeVisible();
  await screenshot(page, "reader-evidence-measured.png");
  await article.getByRole("link", { name: "Open in source" }).first().click();
  await ready(page).toHaveURL(new RegExp(`/imports/${importId}\\?fact=${fact!.id}`));
  await page.goBack();
  await ready(page).toHaveURL(/\/renders\/english_resume\/view$/);
  const db = createDb(E2E_DATABASE_URL);
  await db.update(factTable).set({ provenance: "attested" }).where(eq(factTable.id, fact!.id));
  await page.reload();
  await traceToggle.click();
  await line.click();
  await ready(article.getByText("Stated by you, no number behind it", { exact: true })).toBeVisible();
  await screenshot(page, "reader-evidence-attested.png");
  await db.update(factTable).set({ quote: null }).where(eq(factTable.id, fact!.id));
  await page.reload();
  await traceToggle.click();
  await line.click();
  await ready(article.getByText("No quoted passage was saved for this fact.")).toBeVisible();
  await ready(article.getByRole("link", { name: "Open in source" })).toBeVisible();
  await screenshot(page, "reader-evidence-no-quote.png");
  await db.update(factTable).set({ sourceDocumentVersionId: null }).where(eq(factTable.id, fact!.id));
  await page.reload();
  await traceToggle.click();
  await line.click();
  await ready(article.getByText("Added by hand", { exact: true })).toBeVisible();
  await ready(article.getByRole("link", { name: "Open it in Quick capture" })).toBeVisible();
  await screenshot(page, "reader-evidence-captured.png");
  await traceToggle.click();
  await expect(article.getByRole("button", { name: CLAIM, exact: false })).toHaveCount(0);
  await expect(page.getByText("v1", { exact: true })).toBeVisible();
  for (const name of ["Download PDF", "History", "Edit", "Regenerate"]) {
    await expect(page.getByRole(name === "Download PDF" || name === "Regenerate" ? "button" : "link", { name, exact: true })).toBeVisible();
  }
  await screenshot(page, "reader-desktop-light.png");

  await page.getByRole("link", { name: "History" }).click();
  await expect(page).toHaveURL(/\/renders\/english_resume\/history$/);
  await page.getByRole("link", { name: "View" }).click();
  await expect(page).toHaveURL(/\/renders\/english_resume\/view$/);
  await ready(article.getByText(CLAIM, { exact: false })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Download PDF", exact: true }).first()).toBeVisible();
  for (const name of ["History", "Edit", "Regenerate", "Home"]) {
    await expect(page.getByRole(name === "Regenerate" ? "button" : "link", { name, exact: true })).toHaveCount(0);
  }
  await screenshot(page, "reader-phone-light.png");
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("radio", { name: "Dark" }).click();
  await page.keyboard.press("Escape");
  await screenshot(page, "reader-phone-dark.png");

  const changed = await page.request.patch(`/api/facts/${fact!.id}`, { data: { disclosure: "private" } });
  expect(changed.ok()).toBe(true);
  await page.reload();
  await ready(page.getByRole("alert")).toContainText("Private");
  await expect(page.getByRole("article")).toHaveCount(0);
  await screenshot(page, "reader-private-refusal.png");
  await context.close();
});
