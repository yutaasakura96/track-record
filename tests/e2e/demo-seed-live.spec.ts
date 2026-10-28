import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import PizZip from "pizzip";
import { DEMO_SEED_STORAGE_STATE } from "./env";

test("the finished demo record's sent 履歴書 bears its sent date", async ({ browser, baseURL }) => {
  test.setTimeout(900_000);
  execFileSync("npx", ["tsx", "--import", "./scripts/demo-seed/binary-modules.mjs", "tests/e2e/seed-demo.ts"], {
    cwd: process.cwd(), env: process.env, timeout: 900_000, maxBuffer: 10_000_000,
  });

  const context = await browser.newContext({ baseURL, storageState: DEMO_SEED_STORAGE_STATE });
  const page = await context.newPage();
  await page.goto("/applications");
  const row = page.getByRole("link", { name: /Northwind Clinics Cloud/ }).first();
  await expect(row).toBeVisible();
  await row.click();
  const applicationId = new URL(page.url()).pathname.split("/").at(-1)!;
  const response = await context.request.get(`/api/applications/${applicationId}`);
  expect(response.ok()).toBe(true);
  const detail = await response.json() as { sentCopies: { id: string; kind: string; sentOn: string }[] };
  const sent = detail.sentCopies.find((copy) => copy.kind === "rirekisho");
  expect(sent).toBeTruthy();
  const download = await context.request.get(`/api/applications/${applicationId}/sent-copies/${sent!.id}/download`);
  expect(download.ok()).toBe(true);
  const text = new PizZip(await download.body()).file("word/document.xml")!.asText().replace(/<[^>]+>/g, "").replace(/\s+/g, "");
  const [year, month, day] = sent!.sentOn.split("-").map(Number);
  expect(sent!.sentOn).toBe("2026-05-26");
  expect(text).toContain(`${year}年${month}月${day}日現在`);
  expect(text).toContain("生（満35歳）");
  const overview = await context.request.get("/api/overview").then((result) => result.json()) as { review: unknown; unconfirmed: unknown; activeImport: unknown };
  expect(overview).toMatchObject({ review: null, unconfirmed: null, activeImport: null });
  if (process.env.NO_MISTAKES_EVIDENCE_DIR) {
    await page.screenshot({ path: `${process.env.NO_MISTAKES_EVIDENCE_DIR}/demo-sent-rirekisho.png`, fullPage: true });
  }
  await context.close();
});
