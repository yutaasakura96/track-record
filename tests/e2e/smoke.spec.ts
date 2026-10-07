/**
 * The critical path in a real browser (`docs/11-testing-plan.md` §2.9, issue #33).
 *
 * `tests/smoke.test.ts` walks this path through the Hono app. What only a
 * browser can break is covered here: the built assets not being served, the SPA
 * failing to mount, and the button that starts sign-in.
 *
 * ONE TEST, ONE HAPPY PATH. Do not add a second; §2.9 says why.
 */
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { CLAIM, PROFILE, SOURCE_FILENAME, SOURCE_TEXT } from "./fixture";
import { STORAGE_STATE } from "./env";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

test("sign-in button to a downloaded .docx", async ({ browser, page, baseURL }) => {
  // 1 · Signed out, the built SPA mounts and offers the one way in. The click
  //     asks our Worker for the authorization URL and the browser is sent to
  //     Google. Google is never reached: the navigation is answered here, and
  //     what matters is where it was headed.
  const google = /^https:\/\/accounts\.google\.com\//;
  await page.route(google, (route) => route.fulfill({ status: 200, body: "stopped at Google" }));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Track Record" })).toBeVisible();
  const redirect = page.waitForRequest(google);
  await page.getByRole("button", { name: "Continue with Google" }).click();
  const authorization = new URL((await redirect).url());

  // EXACTLY THREE SCOPES, AND NEVER MORE (`src/server/auth.ts`).
  expect([...new Set(authorization.searchParams.get("scope")?.split(" "))].sort()).toEqual([
    "email",
    "openid",
    "profile",
  ]);
  expect(authorization.searchParams.get("redirect_uri")).toBe(`${baseURL}/api/auth/callback/google`);

  // 2 · From here the browser is signed in, with the session the setup made.
  const context = await browser.newContext({ baseURL, storageState: STORAGE_STATE });
  const app = await context.newPage();
  await app.goto("/");

  // A new record has no profile, and nothing else is reachable until it does.
  await expect(app.getByRole("heading", { name: "First, who this record is about" })).toBeVisible();
  for (const [label, value] of Object.entries(PROFILE)) await app.getByLabel(label).fill(value);
  await app.getByRole("button", { name: "Save and continue" }).click();

  // 3 · Import one document. The stubbed model answers; the review opens at once.
  await expect(app.getByText("Import your first document")).toBeVisible();
  await app.locator('input[type="file"]').setInputFiles({
    name: SOURCE_FILENAME,
    mimeType: "text/markdown",
    buffer: Buffer.from(SOURCE_TEXT),
  });
  await expect(app).toHaveURL(/\/imports\/[^/]+$/);

  // 4 · Extraction finishes and the fact is on the page, already in the
  //     record with the importer's grade. There is nothing to accept
  //     (issue #57), so the author reads it and goes on.
  const card = app.getByRole("article").filter({ hasText: CLAIM });
  await expect(card).toBeVisible();
  await expect(card).toContainText("accepted · measured · restricted");
  await app.getByRole("button", { name: "Done", exact: true }).first().click();

  // 5 · Generate the English résumé from Home's next step, and read the proposal.
  const home = app.getByRole("heading", { name: "Home", exact: true });
  await expect(home).toBeVisible();
  const step = app.getByRole("region", { name: "Next step" });
  await expect(step.getByRole("heading", { name: "Generate your Résumé (English)" })).toBeVisible();
  await step.getByRole("button", { name: "Generate" }).click();
  await expect(app).toHaveURL(/\/proposals\/[^/]+$/);
  await expect(app.getByText(CLAIM).first()).toBeVisible();

  // 6 · Accept it.
  await app.getByRole("button", { name: "Accept proposed version" }).click();
  await expect(home).toBeVisible();
  const row = app.getByRole("listitem").filter({ hasText: "Résumé (English)" });
  await expect(row).toContainText("Up to date");

  // 7 · Download the .docx: the response is the Word MIME type, and what the
  //     browser saved is a zip of a non-trivial length.
  const response = app.waitForResponse((r) => r.url().includes("/api/renders/english_resume/download"));
  const download = app.waitForEvent("download");
  await row.getByRole("button", { name: "Download", exact: true }).click();
  expect((await response).headers()["content-type"]).toBe(DOCX);
  const saved = await download;
  expect(saved.suggestedFilename()).toMatch(/\.docx$/);
  const bytes = await readFile(await saved.path());
  expect(bytes.length).toBeGreaterThan(1000);
  expect([...bytes.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);

  await context.close();
});
