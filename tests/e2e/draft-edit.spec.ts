/**
 * A waiting draft edited by hand before it is accepted (`docs/06`, 2026-11-04),
 * in a real browser against the built SPA and the Worker. Invented record only.
 */
import { expect, test, type Page } from "@playwright/test";
import { CLAIM, PROFILE, SOURCE_FILENAME, SOURCE_TEXT } from "./fixture";
import { DIFF_REVIEW_STORAGE_STATE } from "./env";

const evidence = process.env.TEST_EVIDENCE_DIR;
async function screenshot(page: Page, name: string) {
  if (evidence) await page.screenshot({ path: `${evidence}/${name}`, fullPage: true });
}

interface Block { id: string; kind: string; text: string; factIds: string[] }
interface Content { sections: { key: string; heading: string; blocks: Block[] }[] }

test("a draft is edited by hand and lands as two versions, with no regeneration", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const context = await browser.newContext({ baseURL, storageState: DIFF_REVIEW_STORAGE_STATE });
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
  const card = page.locator("article[data-fact-card]").filter({ hasText: CLAIM });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Done", exact: true }).first().click();
  await page.getByRole("region", { name: "Next step" }).getByRole("button", { name: "Generate" }).click();

  // 1 · The review of a first draft offers Edit draft, and says what needs no regeneration.
  await expect(page.getByRole("button", { name: "Accept as v1" })).toBeEnabled({ timeout: 30_000 });
  await expect(page.getByText(/come from your/).first()).toBeVisible();
  await expect(page.getByText(/needs no regenerating/).first()).toBeVisible();
  const proposalId = new URL(page.url()).pathname.split("/").pop()!;
  await screenshot(page, "01-review-with-edit-draft.png");

  // 2 · Edit draft opens the editor on the draft.
  await page.getByRole("button", { name: "Edit draft" }).click();
  await expect(page).toHaveURL(new RegExp(`/proposals/${proposalId}/edit$`));
  await expect(page.getByText("editing the v1 draft")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Saving accepts the draft as v1 and saves your edit as v2.")).toBeVisible();
  const save = page.getByRole("button", { name: "Accept with my edits as v2" });
  await expect(save).toBeDisabled();

  // 3 · Cancel after a change discards it and leaves the draft waiting.
  const bullet = page.getByLabel(/Bullet text|Paragraph text/).filter({ hasText: /settlement/ }).first();
  const original = (await bullet.textContent())!.trim();
  await bullet.fill(`${original} (cancelled)`);
  await bullet.press("Tab");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("The draft is unchanged and still waiting for you.")).toBeVisible();
  await screenshot(page, "02-cancel-confirm.png");
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(page).toHaveURL(new RegExp(`/proposals/${proposalId}$`));
  expect((await (await context.request.get(`/api/proposals/${proposalId}`)).json()).status).toBe("pending");

  // 4 · Adversarial, at the route the editor saves through: nothing here may accept the draft.
  const read = await context.request.get(`/api/proposals/${proposalId}/content`);
  expect(read.ok()).toBeTruthy();
  const generated = (await read.json()).content as Content;
  const firstBlock = generated.sections.flatMap((s) => s.blocks).find((b) => b.factIds.length > 0)!;
  const clone = () => structuredClone(generated);

  const unchanged = await context.request.post(`/api/proposals/${proposalId}/edit`, { data: { content: clone() } });
  expect(unchanged.status()).toBe(409);

  const cited = clone();
  for (const s of cited.sections) for (const b of s.blocks) if (b.id === firstBlock.id) b.factIds.push("fct_doesnotexist0000");
  const addCitation = await context.request.post(`/api/proposals/${proposalId}/edit`, { data: { content: cited } });
  expect(addCitation.status()).toBeGreaterThanOrEqual(400);
  expect(addCitation.status()).toBeLessThan(500);

  if (generated.sections.length > 1) {
    const movedContent = clone();
    const from = movedContent.sections.find((s) => s.blocks.some((b) => b.id === firstBlock.id))!;
    const to = movedContent.sections.find((s) => s !== from)!;
    from.blocks = from.blocks.filter((b) => b.id !== firstBlock.id);
    to.blocks.push(firstBlock);
    const move = await context.request.post(`/api/proposals/${proposalId}/edit`, { data: { content: movedContent } });
    expect(move.status()).toBeGreaterThanOrEqual(400);
    expect(move.status()).toBeLessThan(500);
  }
  const emptied = clone();
  for (const s of emptied.sections) s.blocks = [];
  const empty = await context.request.post(`/api/proposals/${proposalId}/edit`, { data: { content: emptied } });
  expect(empty.status()).toBeGreaterThanOrEqual(400);
  expect((await (await context.request.get(`/api/proposals/${proposalId}`)).json()).status).toBe("pending");
  expect((await (await context.request.get("/api/renders/english_resume/versions")).json()).items).toHaveLength(0);

  // 5 · A real edit through the browser accepts the draft as v1 and the edit as v2.
  await page.getByRole("button", { name: "Edit draft" }).click();
  await expect(page.getByText("editing the v1 draft")).toBeVisible({ timeout: 20_000 });
  const edited = `${original.replace(/fifty minutes/, "forty-five minutes")}`;
  expect(edited).not.toBe(original);
  const target = page.getByLabel(/Bullet text|Paragraph text/).filter({ hasText: /settlement/ }).first();
  await target.fill(edited);
  await target.press("Tab");
  await expect(save).toBeEnabled();
  await screenshot(page, "03-draft-editor-changed.png");
  await save.click();
  await expect(page).toHaveURL(/\/renders\/english_resume\/history$/, { timeout: 20_000 });
  await expect(page.getByText("EDITED BY HAND").first()).toBeVisible();
  await expect(page.getByText(/Edited from/).first()).toBeVisible();
  await screenshot(page, "04-history-two-versions.png");

  const history = await (await context.request.get("/api/renders/english_resume/versions")).json();
  const items = history.items as { versionNo: number; origin: string; content?: unknown }[];
  expect(history.currentVersionNo).toBe(2);
  expect(items.map((i) => [i.versionNo, i.origin]).sort()).toEqual([[1, "accepted"], [2, "edited"]].sort());
  expect((await (await context.request.get(`/api/proposals/${proposalId}`)).json()).status).toBe("accepted");
  const again = await context.request.post(`/api/proposals/${proposalId}/edit`, { data: { content: cited } });
  expect(again.status()).toBe(409);

  // 6 · v1 is what the model wrote; v2 carries the edit.
  const versions = history.items as { id: string; versionNo: number }[];
  const textOf = async (versionNo: number) => {
    const id = versions.find((v) => v.versionNo === versionNo)!.id;
    const v = await (await context.request.get(`/api/renders/english_resume/versions/${id}`)).json();
    return JSON.stringify(v.content);
  };
  expect(await textOf(1)).toContain(original.slice(0, 40));
  expect(await textOf(1)).not.toContain("forty-five minutes");
  expect(await textOf(2)).toContain("forty-five minutes");

  // 7 · Home shows Edit on an accepted document, and the line beside regenerate.
  await page.goto("/");
  const resumeCard = page.locator("li").filter({ hasText: "Résumé (English)" }).first();
  await expect(resumeCard.getByRole("link", { name: "Edit", exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/needs no regenerating/).first()).toBeVisible();
  await screenshot(page, "05-home-edit-link.png");

  // 8 · With a regenerated draft waiting, Home's Edit becomes Edit draft and opens it.
  const factId = await (async () => {
    const facts = await (await context.request.get("/api/facts")).json();
    const list = (Array.isArray(facts) ? facts : facts.items ?? facts.facts) as { id: string; claim: string }[];
    return list.find((f) => f.claim === CLAIM)!.id;
  })();
  expect((await context.request.patch(`/api/facts/${factId}`, { data: { claim: "Shortened the overnight settlement job to fifty minutes" } })).ok()).toBeTruthy();
  const generation = await context.request.post("/api/renders/english_resume/generate");
  expect(generation.ok()).toBeTruthy();
  const { proposalId: secondId } = (await generation.json()) as { proposalId: string };
  await expect.poll(async () => (await (await context.request.get(`/api/proposals/${secondId}`)).json()).generationStatus, { timeout: 60_000 }).toBe("ready");
  await page.reload();
  const draftLink = page.getByRole("link", { name: "Edit draft" }).first();
  await expect(draftLink).toBeVisible({ timeout: 20_000 });
  await screenshot(page, "06-home-edit-draft-link.png");
  await draftLink.click();
  await expect(page).toHaveURL(new RegExp(`/proposals/${secondId}/edit$`));
  await expect(page.getByText("editing the v3 draft")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Accept with my edits as v4" })).toBeDisabled();
  await screenshot(page, "07-second-draft-editor.png");

  // 9 · The document reader's Edit also opens the waiting draft, never the current version.
  await page.goto("/renders/english_resume/view");
  const readerEdit = page.getByRole("link", { name: "Edit draft" }).first();
  await expect(readerEdit).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/needs no regenerating/).first()).toBeVisible();
  await screenshot(page, "08-reader-edit-draft.png");

  expect(errors).toEqual([]);
  await context.close();
});
