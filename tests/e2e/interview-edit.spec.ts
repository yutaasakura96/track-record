import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { PROFILE } from "./fixture";
import { INTERVIEW_STORAGE_STATE } from "./env";

const evidence = process.env.TEST_EVIDENCE_DIR;

test("edit and delete an interview in the application at desktop and phone width", async ({ browser, baseURL }) => {
  if (evidence) mkdirSync(evidence, { recursive: true });
  const context = await browser.newContext({ baseURL, storageState: INTERVIEW_STORAGE_STATE, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  for (const [label, value] of Object.entries(PROFILE)) await page.getByLabel(label).fill(value);
  await page.getByRole("button", { name: "Save and continue" }).click();

  const created = await page.request.post("/api/applications", {
    data: { company: "Cedar Labs", position: "Platform Engineer", jobDescription: "Cedar Labs needs a platform engineer to maintain its invented test systems." },
  });
  expect(created.status()).toBe(201);
  const application = await created.json() as { id: string };
  await page.goto(`/applications/${application.id}`);
  await expect(page.getByRole("heading", { name: "Interviews" })).toBeVisible();
  await page.getByRole("button", { name: "Add an interview" }).click();
  const form = page.getByRole("heading", { name: "New interview" }).locator("xpath=..");
  await form.locator('input[name="date"]').fill("2026-01-10");
  await form.locator('select[name="round"]').selectOption("interview_1");
  await form.locator('textarea[name="howItWent"]').fill("A useful first conversation.");
  await form.getByRole("textbox", { name: "A question they asked" }).fill("What would you improve?");
  await form.getByRole("textbox", { name: "A question they asked" }).press("Enter");
  await form.getByRole("textbox", { name: "A question they asked" }).fill("Why this role?");
  await form.getByRole("button", { name: "Save interview" }).click();
  await expect(page.getByRole("button", { name: "Edit the First interview entry of 2026-01-10" })).toBeVisible();
  const before = await page.request.get(`/api/applications/${application.id}`).then((r) => r.json()) as { daysSinceFirstInterview: number };

  await page.getByRole("button", { name: "Edit the First interview entry of 2026-01-10" }).click();
  const edit = page.getByRole("heading", { name: "Edit interview" }).locator("xpath=..");
  await edit.locator('input[name="date"]').fill("2026-01-09");
  await edit.getByRole("textbox", { name: "Question 1" }).fill("What should we measure first?");
  await edit.getByRole("button", { name: "Remove question 2" }).click();
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("button", { name: "Edit the First interview entry of 2026-01-09" })).toBeVisible();
  await expect(page.getByText("What should we measure first?")).toBeVisible();
  const after = await page.request.get(`/api/applications/${application.id}`).then((r) => r.json()) as {
    step: string; dates: Record<string, string>; daysSinceFirstInterview: number;
    interviews: { id: string; questions: { id: string }[] }[];
  };
  expect(after.step).toBe("interview_1");
  expect(after.dates.interview_1).toBe("2026-01-09");
  expect(after.daysSinceFirstInterview).toBe(before.daysSinceFirstInterview + 1);
  expect(after.interviews[0]?.questions).toHaveLength(1);
  const exportAfterEdit = await page.request.get("/api/export").then((r) => r.json()) as {
    interviewQuestions: { interviewId: string; removedAt: string | null }[];
  };
  const storedQuestions = exportAfterEdit.interviewQuestions.filter((question) => question.interviewId === after.interviews[0]?.id);
  expect(storedQuestions).toHaveLength(2);
  expect(storedQuestions.filter((question) => question.removedAt === null)).toHaveLength(1);
  if (evidence) await page.screenshot({ path: `${evidence}/interview-edited-desktop.png`, fullPage: true });
  await page.reload();
  await expect(page.getByText("What should we measure first?")).toBeVisible();

  await page.setViewportSize({ width: 390, height: 1300 });
  await expect(page.getByRole("button", { name: "Edit the First interview entry of 2026-01-09" })).toBeVisible();
  await page.getByRole("button", { name: "Edit the First interview entry of 2026-01-09" }).click();
  await expect(page.getByRole("heading", { name: "Edit interview" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save changes" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole("heading", { name: "Edit interview" }).locator("xpath=..").scrollIntoViewIfNeeded();
  if (evidence) await page.screenshot({ path: `${evidence}/interview-edit-phone.png`, fullPage: true });
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Delete the First interview entry of 2026-01-09" }).click();
  await expect(page.getByRole("alertdialog", { name: "Delete this interview" })).toBeVisible();
  if (evidence) await page.screenshot({ path: `${evidence}/interview-delete-confirm-phone.png`, fullPage: true });
  await page.getByRole("button", { name: "Keep it" }).click();
  await expect(page.getByRole("button", { name: "Edit the First interview entry of 2026-01-09" })).toBeVisible();
  await page.getByRole("button", { name: "Delete the First interview entry of 2026-01-09" }).click();
  await page.getByRole("button", { name: "Delete it" }).click();
  await expect(page.getByRole("button", { name: "Edit the First interview entry of 2026-01-09" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("None yet. After each one")).toBeVisible();
  const deleted = await page.request.get(`/api/applications/${application.id}`).then((r) => r.json()) as typeof after;
  expect(deleted.interviews).toHaveLength(0);
  expect(deleted.step).toBe("interview_1");
  expect(deleted.dates.interview_1).toBe("2026-01-09");
  const exported = await page.request.get("/api/export").then((r) => r.json()) as {
    interviews: { id: string; removedAt: string | null }[];
    interviewQuestions: { id: string; removedAt: string | null }[];
  };
  expect(exported.interviews.find((entry) => entry.id === after.interviews[0]?.id)?.removedAt).toBeTruthy();
  expect(exported.interviewQuestions.find((question) => question.id === after.interviews[0]?.questions[0]?.id)?.removedAt).toBeNull();
  if (evidence) await page.screenshot({ path: `${evidence}/interview-deleted-phone.png`, fullPage: true });
  expect(errors).toEqual([]);
  await context.close();
});
