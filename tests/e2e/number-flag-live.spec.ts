import { expect, test } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { createDb } from "~/server/db/client";
import { facts, users } from "~/server/db/schema";
import { CLAIM, PROFILE, SOURCE_FILENAME, SOURCE_TEXT } from "./fixture";
import { E2E_DATABASE_URL, JAPANESE_CHECK_IDENTITY, JAPANESE_CHECK_STORAGE_STATE } from "./env";

test("the record distinguishes equivalent figures from unsupported ones", async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  const context = await browser.newContext({ baseURL, storageState: JAPANESE_CHECK_STORAGE_STATE });
  const page = await context.newPage();
  await page.goto("/");
  for (const [label, value] of Object.entries(PROFILE)) await page.getByLabel(label).fill(value);
  await page.getByRole("button", { name: "Save and continue" }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: SOURCE_FILENAME, mimeType: "text/markdown", buffer: Buffer.from(SOURCE_TEXT),
  });
  const card = page.locator("article[data-fact-card]").filter({ hasText: CLAIM });
  await expect(card).toBeVisible({ timeout: 30_000 });
  const factId = await card.getAttribute("data-fact-card");
  expect(factId).toBeTruthy();
  const db = createDb(E2E_DATABASE_URL);
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, JAPANESE_CHECK_IDENTITY.email));
  expect(user).toBeTruthy();

  const cases: [string, string, boolean][] = [
    ["Cut load time from 6.8 s to 2.9 s", "Load time fell from 6.8 seconds to 2.9 seconds.", false],
    ["並列実行できるジョブが約3割ある", "並列実行できるジョブが全体の約 3 割あることが分かった。", false],
    ["Ran a three-phase migration", "The migration ran in three phases.", false],
    ["Reduced breaks from 37 a quarter to 2 a quarter", "Breaks fell from 37 in the quarter before to 2 in the quarter after.", false],
    ["Cut the rollback rate to one in five", "The rollback rate fell to about one in five releases.", false],
    ["Replaced three component libraries", "Replaced three diverging component libraries.", false],
    ["Has 1,400 GitHub stars", "It has 1,400 stars on GitHub.", false],
    ["Wrote 5 reports", "Wrote 5 engineering reports.", true],
    ["Reduced breaks to 5 in the month", "Breaks fell to 5 in the quarter.", true],
    ["Reduced breaks to 5 in the month", "Breaks fell to 5.", true],
    ["Cut costs by 30%", "Costs fell by 20%.", true],
    ["Built screens 40% faster", "Built screens faster.", true],
  ];
  for (const [index, [claim, quote, flagged]] of cases.entries()) {
    await db.update(facts).set({ quote }).where(and(eq(facts.id, factId!), eq(facts.userId, user!.id)));
    const response = await context.request.patch(`/api/facts/${factId}`, { data: { claim } });
    expect(response.ok(), claim).toBe(true);
    await page.reload();
    const edited = page.locator(`article[data-fact-card="${factId}"]`);
    await expect(edited).toContainText(claim);
    const warning = edited.getByText("Check where the number came from");
    if (flagged) await expect(warning, claim).toBeVisible();
    else await expect(warning, claim).toHaveCount(0);
    if (index === 0 && process.env.NO_MISTAKES_EVIDENCE_DIR) {
      await page.screenshot({ path: `${process.env.NO_MISTAKES_EVIDENCE_DIR}/number-flag-equivalent.png`, fullPage: true });
    }
  }
  if (process.env.NO_MISTAKES_EVIDENCE_DIR) {
    await page.screenshot({ path: `${process.env.NO_MISTAKES_EVIDENCE_DIR}/number-flag-unsupported.png`, fullPage: true });
  }
  await context.close();
});
