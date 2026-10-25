import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { PROFILE } from "./fixture";
import { CAPTURE_STORAGE_STATE } from "./env";
import { CREDITS_EXHAUSTED_MESSAGE } from "~/model/types";

test("credit pauses are specific across capture, import, generation and Explain this", async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  const eventually = expect.configure({ timeout: 30_000 });
  const context = await browser.newContext({ baseURL, storageState: CAPTURE_STORAGE_STATE });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  for (const [label, value] of Object.entries(PROFILE)) await page.getByLabel(label).fill(value);
  await page.getByRole("button", { name: "Save and continue" }).click();
  const employer = await page.request.post("/api/employers", {
    data: { nameJa: "株式会社コルヴァーン", nameLatin: "Qorvane", city: "Tokyo", employmentType: "full_time", startedOn: "2022-04-01" },
  });
  expect(employer.status()).toBe(201);
  const { id: employerId } = await employer.json() as { id: string };
  expect((await page.request.post("/api/roles", { data: { employerId, titleLatin: "Engineer", titleJa: "エンジニア", startedOn: "2022-04-01" } })).status()).toBe(201);
  await page.goto("/capture");
  const text = "At Qorvane I led the credit-pause-fixture delivery review.";
  await page.getByLabel("In your own words").fill(text);
  await page.getByRole("button", { name: "Read it" }).click();
  await expect(page.getByRole("status")).toContainText(CREDITS_EXHAUSTED_MESSAGE);
  await expect(page.getByLabel("Claim", { exact: true })).toHaveValue(text);
  const evidence = process.env.TEST_EVIDENCE_DIR;
  if (evidence) {
    mkdirSync(evidence, { recursive: true });
    await page.screenshot({ path: `${evidence}/credit-pause-capture.png`, fullPage: true });
  }
  await page.getByRole("button", { name: "Back to the text" }).click();
  await page.getByLabel("In your own words").fill("An unreadable weekly review at Qorvane.");
  await page.getByRole("button", { name: "Read it" }).click();
  await expect(page.getByText("What you typed could not be read just now. Fill the claim in yourself; your text is kept.")).toBeVisible();
  await expect(page.getByRole("status")).not.toContainText(CREDITS_EXHAUSTED_MESSAGE);
  expect(errors).toEqual([]);

  const upload = async (name: string, text: string) => {
    const response = await page.request.post("/api/imports", {
      multipart: { file: { name, mimeType: "text/markdown", buffer: Buffer.from(text) } },
    });
    expect(response.status()).toBe(202);
    return (await response.json() as { importId: string }).importId;
  };
  const readImport = async (id: string) => page.request.get(`/api/imports/${id}`).then((r) => r.json());
  const importId = await upload("credit-import.md", "At Qorvane I led the credit-import-fixture review.");
  await eventually.poll(async () => (await readImport(importId)).status).toBe("failed");
  const failedImport = await readImport(importId);
  expect(failedImport.error).toMatchObject({ code: "credits_exhausted", message: CREDITS_EXHAUSTED_MESSAGE });
  const retry = await page.request.post(`/api/imports/${importId}/retry`);
  expect(retry.status()).toBe(200);
  await eventually.poll(async () => (await readImport(importId)).error?.code).toBe("credits_exhausted");

  const generationImport = await upload("credit-generation.md", "At Qorvane I led the credit-generation-fixture review.");
  await eventually.poll(async () => (await readImport(generationImport)).status).toBe("ready");
  const facts = await page.request.get(`/api/facts?importId=${generationImport}`).then((r) => r.json()) as { items: { id: string }[] };
  expect(facts.items).toHaveLength(1);
  expect((await page.request.patch(`/api/facts/${facts.items[0]!.id}`, { data: { disclosure: "public", employerId } })).ok()).toBe(true);
  expect((await page.request.post(`/api/facts/${facts.items[0]!.id}/accept`)).ok()).toBe(true);
  const generate = await page.request.post("/api/renders/english_resume/generate");
  expect(generate.status(), await generate.text()).toBe(202);
  const { proposalId } = await generate.json() as { proposalId: string };
  const readProposal = async () => page.request.get(`/api/proposals/${proposalId}`).then((r) => r.json());
  await eventually.poll(async () => (await readProposal()).generationStatus).toBe("failed");
  const proposal = await readProposal();
  expect(proposal.error).toMatchObject({ code: "credits_exhausted", message: CREDITS_EXHAUSTED_MESSAGE });
  expect((await page.request.post("/api/renders/english_resume/generate")).status()).toBe(202);

  const flagImport = await upload("credit-explain.md", "At Qorvane I led the credit-explain-fixture review.");
  await eventually.poll(async () => (await readImport(flagImport)).status).toBe("ready");
  const flags = await page.request.get("/api/flags").then((r) => r.json()) as { items: { id: string }[] };
  expect(flags.items.length).toBeGreaterThan(0);
  const explained = await page.request.post(`/api/flags/${flags.items[0]!.id}/explain`);
  expect(explained.status()).toBe(503);
  const explainError = await explained.json();
  expect(explainError.error).toMatchObject({ message: CREDITS_EXHAUSTED_MESSAGE, details: { reason: "credits_exhausted" } });
  if (evidence) writeFileSync(`${evidence}/credit-pause-api.json`, JSON.stringify({ failedImport, proposal, explainError }, null, 2));
  await context.close();
});
