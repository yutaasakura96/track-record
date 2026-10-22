import { expect, test } from "@playwright/test";
import { STORAGE_STATE } from "./env";
import { PROFILE } from "./fixture";

test("education chips match document exclusions and update when the level changes", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, storageState: STORAGE_STATE, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  for (const [label, value] of Object.entries(PROFILE)) await page.getByLabel(label).fill(value);
  await page.getByRole("button", { name: "Save and continue" }).click();

  const rows = [
    { institution: "Westbridge Middle School", level: "secondary_lower", startedOn: "2005-04-01", endedOn: "2008-03-01", outcome: "graduated" },
    { institution: "Westbridge High School", level: "secondary_upper", startedOn: "2008-04-01", endedOn: "2011-03-01", outcome: "graduated" },
    { institution: "Westbridge Design Academy", level: "vocational", startedOn: "2011-04-01", endedOn: "2012-03-01", outcome: "completed" },
  ];
  for (const row of rows) expect((await context.request.post("/api/educations", { data: row })).status()).toBe(201);
  await page.goto("/record");
  const education = page.getByRole("heading", { name: "Education", level: 2 }).locator("xpath=ancestor::section[1]");
  const school = (name: string) => education.locator("li").filter({ hasText: name });
  await expect(school("Westbridge Middle School")).toContainText("Left out of: Résumé (English), 職務経歴書");
  await expect(school("Westbridge High School")).toContainText("Left out of: Résumé (English)");
  await expect(school("Westbridge High School")).not.toContainText("職務経歴書");
  await expect(school("Westbridge Design Academy")).not.toContainText("Left out of:");
  if (process.env.TEST_EVIDENCE_DIR) await page.screenshot({ path: `${process.env.TEST_EVIDENCE_DIR}/education-chips.png`, fullPage: true });

  await school("Westbridge Design Academy").getByRole("button", { name: "Edit Westbridge Design Academy" }).click();
  await page.getByLabel("Level").selectOption("secondary_upper");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(school("Westbridge Design Academy")).toContainText("Left out of: Résumé (English)");
  if (process.env.TEST_EVIDENCE_DIR) await page.screenshot({ path: `${process.env.TEST_EVIDENCE_DIR}/education-chip-after-edit.png`, fullPage: true });
  expect(errors).toEqual([]);
  await context.close();
});
