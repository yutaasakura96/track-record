import { expect, test } from "@playwright/test";
import { PROFILE, SOURCE_FILENAME, SOURCE_TEXT } from "./document-view-fixture";
import { JAPANESE_CHECK_STORAGE_STATE } from "./env";

test("Japanese proposals refuse hard defects and show register advisories", async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  const context = await browser.newContext({ baseURL, storageState: JAPANESE_CHECK_STORAGE_STATE });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  for (const [label, value] of Object.entries(PROFILE)) await page.getByLabel(label).fill(value);
  await page.getByRole("button", { name: "Save and continue" }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: SOURCE_FILENAME,
    mimeType: "text/markdown",
    buffer: Buffer.from(SOURCE_TEXT),
  });
  await expect(page.locator("article[data-fact-card]")).toBeVisible();
  await page.getByRole("button", { name: "Done", exact: true }).first().click();

  const profile = await page.request.get("/api/profile").then((response) => response.json()) as Record<string, unknown>;
  const generate = async (note: string, status: "ready" | "failed", kind = "rirekisho") => {
    const updated = await page.request.put("/api/profile", { data: { ...profile, desiredRoleNote: note } });
    expect(updated.ok()).toBe(true);
    const response = await page.request.post(`/api/renders/${kind}/generate`);
    expect(response.status(), await response.text()).toBe(202);
    const { proposalId } = await response.json() as { proposalId: string };
    const proposal = async () => page.request.get(`/api/proposals/${proposalId}`).then((result) => result.json());
    await expect.poll(async () => (await proposal()).generationStatus, { timeout: 30_000 }).toBe(status);
    await page.goto(`/proposals/${proposalId}`);
    return { proposalId, data: await proposal() as { error: { message: string } | null; warnings: string[] } };
  };

  const onsha = await generate("jp-check-onsha", "failed");
  expect(onsha.data.error?.message).toContain("御社");
  await expect(page.getByText(/御社/)).toBeVisible();
  if (process.env.NO_MISTAKES_EVIDENCE_DIR) await page.screenshot({ path: `${process.env.NO_MISTAKES_EVIDENCE_DIR}/japanese-onsha-refused.png`, fullPage: true });

  const english = await generate("jp-check-english", "failed");
  expect(english.data.error?.message).toContain("English");
  expect((await page.request.get(`/api/proposals/${english.proposalId}/diff`)).status()).toBe(409);
  if (process.env.NO_MISTAKES_EVIDENCE_DIR) await page.screenshot({ path: `${process.env.NO_MISTAKES_EVIDENCE_DIR}/japanese-english-refused.png`, fullPage: true });

  const advisory = await generate("jp-check-advisory", "ready");
  expect(advisory.data.warnings).toEqual(expect.arrayContaining([
    expect.stringMatching(/^貴社 appears/),
    expect.stringMatching(/^Full-width digits/),
  ]));
  await expect(page.getByText(/貴社 appears/)).toBeVisible();
  await expect(page.getByText(/Full-width digits/)).toBeVisible();
  await expect(page.getByText("Loading the document...")).toHaveCount(0);
  await expect(page.getByRole("article")).toBeVisible();
  if (process.env.NO_MISTAKES_EVIDENCE_DIR) await page.screenshot({ path: `${process.env.NO_MISTAKES_EVIDENCE_DIR}/japanese-advisories.png`, fullPage: true });
  expect((await page.request.post(`/api/proposals/${advisory.proposalId}/dismiss`)).ok()).toBe(true);

  const clean = await generate("jp-check-clean", "ready");
  expect(clean.data.warnings).toEqual(expect.not.arrayContaining([
    expect.stringMatching(/^貴社 appears/),
    expect.stringMatching(/^Full-width digits/),
  ]));
  await expect(page.getByText("SaaS (Software as a Service) の導入支援とPostgreSQLの設計を担当しました。")).toBeVisible();
  if (process.env.NO_MISTAKES_EVIDENCE_DIR) await page.screenshot({ path: `${process.env.NO_MISTAKES_EVIDENCE_DIR}/japanese-latin-phrases-accepted.png`, fullPage: true });
  expect((await page.request.post(`/api/proposals/${clean.proposalId}/dismiss`)).ok()).toBe(true);

  const e1 = await generate("jp-check-shokumu-e1", "failed", "shokumu_keirekisho");
  expect(e1.data.error?.message).toContain("English");
  const e2 = await generate("jp-check-shokumu-e2", "failed", "shokumu_keirekisho");
  expect(e2.data.error?.message).toContain("English");
  const bullet = await generate("jp-check-shokumu-advisory", "ready", "shokumu_keirekisho");
  expect(bullet.data.warnings).toEqual(expect.arrayContaining([
    expect.stringMatching(/over 120 characters/),
    expect.stringMatching(/ends in です・ます/),
  ]));
  await expect(page.getByText(/over 120 characters/)).toBeVisible();
  await expect(page.getByText(/ends in です・ます/)).toBeVisible();
  await expect(page.getByText("Loading the document...")).toHaveCount(0);
  await expect(page.getByRole("article")).toBeVisible();
  if (process.env.NO_MISTAKES_EVIDENCE_DIR) await page.screenshot({ path: `${process.env.NO_MISTAKES_EVIDENCE_DIR}/japanese-bullet-advisories.png`, fullPage: true });
  expect((await page.request.post(`/api/proposals/${bullet.proposalId}/dismiss`)).ok()).toBe(true);

  // Recorded technology names joined only by connectors pass; a connector beside prose does not.
  const shot = async (name: string) => {
    if (process.env.NO_MISTAKES_EVIDENCE_DIR) await page.screenshot({ path: `${process.env.NO_MISTAKES_EVIDENCE_DIR}/${name}.png`, fullPage: true });
  };
  const cert = await page.request.post("/api/certifications", { data: {
    name: "Kumo Certified Architect", nameJa: "クモ認定アーキテクト", issuingOrganization: "クモ協会",
    issuedOn: "2019-06-01", kind: "technical", technologies: ["React", "TypeScript"],
  } });
  expect(cert.ok(), await cert.text()).toBe(true);
  const connector = await generate("jp-check-shokumu-connector", "ready", "shokumu_keirekisho");
  expect(connector.data.error).toBeNull();
  await expect(page.getByText("React, TypeScript, and PostgreSQL")).toBeVisible();
  await shot("shokumu-connector-accepted");
  expect((await page.request.post(`/api/proposals/${connector.proposalId}/dismiss`)).ok()).toBe(true);
  const prose = await generate("jp-check-shokumu-connector-prose", "failed", "shokumu_keirekisho");
  expect(prose.data.error?.message).toContain("English");
  await shot("shokumu-connector-prose-refused");

  // A 保有資格 section the model wrote is replaced by the record's rows, so its 御社 does not refuse.
  const modelCerts = await generate("jp-check-shokumu-model-certifications", "ready", "shokumu_keirekisho");
  expect(modelCerts.data.error).toBeNull();
  await expect(page.getByText("御社で役立つ資格を取得しました。")).toHaveCount(0);
  await expect(page.getByText(/クモ認定アーキテクト/).first()).toBeVisible();
  await shot("shokumu-model-certifications-replaced");
  expect((await page.request.post(`/api/proposals/${modelCerts.proposalId}/dismiss`)).ok()).toBe(true);

  // A stored row saying 御社 is refused before generation and named as the record's to fix.
  const stored = await page.request.post("/api/certifications", { data: {
    name: "Onsha Certified", nameJa: "御社認定資格", issuingOrganization: "架空協会",
    issuedOn: "2021-04-01", kind: "technical", technologies: [],
  } });
  expect(stored.ok(), await stored.text()).toBe(true);
  const refused = await generate("jp-check-shokumu-advisory", "failed", "shokumu_keirekisho");
  expect(refused.data.error?.message).toMatch(/^Row 1 of 保有資格 comes from your record and contains 御社/);
  expect(refused.data.error?.message).toMatch(/under Certifications on your record/);
  expect(refused.data.error?.message).not.toMatch(/model wrote|generate again/);
  await expect(page.getByText(/Row 1 of 保有資格 comes from your record/)).toBeVisible();
  await shot("shokumu-stored-onsha-row-refused");
  console.log(`record-row refusal: ${refused.data.error?.message}`);
  expect(errors).toEqual([]);
  await context.close();
});
