import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { createDb } from "~/server/db/client";
import { employers, renders, renderVersions, users } from "~/server/db/schema";
import type { RenderContent } from "~/shared/render-content";
import { JAPANESE_DIFF_IDENTITY, JAPANESE_DIFF_STORAGE_STATE, E2E_DATABASE_URL } from "./env";
import { PROFILE } from "./fixture";

const before: RenderContent = { sections: [{ key: "experience", heading: "職務経歴", blocks: [
  { id: "a-open-1", kind: "paragraph", text: "架空商事株式会社 ・ 2021年4月〜現在 ・ 正社員／開発担当", factIds: [] },
  { id: "a-bullet-1", kind: "bullet", text: "受注処理を8時間から3時間へ短縮", factIds: [] },
  { id: "b-open-1", kind: "paragraph", text: "空想工業株式会社（2018年4月〜2021年3月）正社員／開発担当", factIds: [] },
  { id: "b-row-1", kind: "row", text: "資本金：1億円 従業員数：300名", factIds: [] },
] }] };
const after: RenderContent = { sections: [{ key: "experience", heading: "職務経歴", blocks: [
  { id: "a-open-2", kind: "paragraph", text: "架空商事株式会社 ・ 2021年4月〜2026年9月 ・ 正社員／リード", factIds: [] },
  { id: "a-bullet-2", kind: "bullet", text: "受注処理の所要時間を8時間から3時間に短縮", factIds: [] },
  { id: "c-open-2", kind: "paragraph", text: "未来製作所株式会社（2022年4月〜現在）正社員／開発担当", factIds: [] },
  { id: "c-row-2", kind: "row", text: "資本金：5000万円 従業員数：120名", factIds: [] },
] }] };

test("Japanese version comparison pairs one employer and separates another", async ({ browser, baseURL }) => {
  const db = createDb(E2E_DATABASE_URL);
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, JAPANESE_DIFF_IDENTITY.email));
  expect(user).toBeTruthy();
  const userId = user!.id;
  await db.insert(employers).values([
    { id: "emp-a", userId, nameJa: "架空商事株式会社", nameLatin: "Kasou Trading K.K.", employmentType: "full_time", startedOn: "2021-04-01" },
    { id: "emp-b", userId, nameJa: "空想工業株式会社", employmentType: "full_time", startedOn: "2018-04-01" },
    { id: "emp-c", userId, nameJa: "未来製作所株式会社", employmentType: "full_time", startedOn: "2022-04-01" },
  ]);
  await db.insert(renders).values({ id: "render-ja", userId, kind: "shokumu_keirekisho", currentVersionId: "version-2" });
  await db.insert(renderVersions).values([
    { id: "version-1", userId, renderId: "render-ja", versionNo: 1, content: before, factCountAt: 0 },
    { id: "version-2", userId, renderId: "render-ja", versionNo: 2, content: after, factCountAt: 0 },
  ]);

  const context = await browser.newContext({ baseURL, storageState: JAPANESE_DIFF_STORAGE_STATE });
  const onboarding = await context.newPage();
  await onboarding.goto("/");
  for (const [label, value] of Object.entries(PROFILE)) await onboarding.getByLabel(label).fill(value);
  await onboarding.getByRole("button", { name: "Save and continue" }).click();
  await onboarding.close();
  const response = await context.request.get("/api/renders/shokumu_keirekisho/diff?from=version-2&to=version-1");
  expect(response.status()).toBe(200);
  const body = await response.json() as { changes: Array<{ currentBlockId: string | null; proposedBlockId: string | null; location: { employer: string | null }; tokens: Array<{ op: string; text: string }> }> };
  const bullet = body.changes.find((change) => change.currentBlockId === "a-bullet-2");
  expect(bullet?.proposedBlockId).toBe("a-bullet-1");
  expect(bullet?.location.employer).toContain("架空商事");
  expect(bullet?.tokens.some((token) => token.op === "equal")).toBe(true);
  expect(body.changes.find((change) => change.currentBlockId === "c-row-2")?.proposedBlockId).toBeNull();
  expect(body.changes.find((change) => change.proposedBlockId === "b-row-1")?.currentBlockId).toBeNull();

  const page = await context.newPage();
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
  await page.goto("/renders/shokumu_keirekisho/history");
  await page.getByRole("button", { name: "Compare" }).click();
  await expect(page.getByText(/職務経歴 · 架空商事株式会社/).first()).toBeVisible();
  await expect(page.getByText(/職務経歴 · 空想工業株式会社/).first()).toBeVisible();
  await expect(page.getByText(/職務経歴 · 未来製作所株式会社/).first()).toBeVisible();
  if (process.env.TEST_EVIDENCE_DIR) await page.screenshot({ path: `${process.env.TEST_EVIDENCE_DIR}/japanese-diff-live.png`, fullPage: true });
  expect(browserErrors).toEqual([]);

  const oneGroup = (opening: string, bulletText: string): RenderContent => ({ sections: [{ key: "experience", heading: "職務経歴", blocks: [
    { id: "opening", kind: "paragraph", text: opening, factIds: [] },
    { id: "bullet", kind: "bullet", text: bulletText, factIds: [] },
  ] }] });
  await db.insert(renderVersions).values([
    { id: "version-3", userId, renderId: "render-ja", versionNo: 3, content: oneGroup("架空商事株式会社（2021年4月〜現在）正社員", "受注処理を8時間から3時間へ短縮"), factCountAt: 0 },
    { id: "version-4", userId, renderId: "render-ja", versionNo: 4, content: oneGroup("Kasou Trading K.K. ・ 2021年4月〜2026年9月 ・ Lead", "受注処理の所要時間を8時間から3時間に短縮"), factCountAt: 0 },
    { id: "version-5", userId, renderId: "render-ja", versionNo: 5, content: oneGroup("㈱未登録商事 ・ 2021年4月〜現在 ・ 正社員", "受注処理を8時間から3時間へ短縮"), factCountAt: 0 },
    { id: "version-6", userId, renderId: "render-ja", versionNo: 6, content: oneGroup("㈱未登録商事 ・ 2021年4月〜2026年9月 ・ リード", "受注処理の所要時間を8時間から3時間に短縮"), factCountAt: 0 },
    { id: "version-7", userId, renderId: "render-ja", versionNo: 7, content: oneGroup("架空商事株式会社（2021年4月〜現在）正社員", "受注処理を8時間から3時間へ短縮"), factCountAt: 0 },
    { id: "version-8", userId, renderId: "render-ja", versionNo: 8, content: oneGroup("架空商事株式会社（2021年4月〜現在）正社員", "社外向けの勉強会を企画・運営（参加者40名）"), factCountAt: 0 },
    { id: "version-9", userId, renderId: "render-ja", versionNo: 9, content: oneGroup("架空商事株式会社（2021年4月〜現在）正社員", "夜間バッチの分散処理への移行で、サーバー費用を35%削減"), factCountAt: 0 },
    { id: "version-10", userId, renderId: "render-ja", versionNo: 10, content: oneGroup("架空商事株式会社（2021年4月〜現在）正社員", "夜間バッチの分散処理移行により、サーバーコストを35%削減"), factCountAt: 0 },
    { id: "version-11", userId, renderId: "render-ja", versionNo: 11, content: oneGroup("架空商事株式会社（2021年4月〜現在）正社員", "検索画面の応答目標200msをCIで監視し、他の3チームにも展開"), factCountAt: 0 },
    { id: "version-12", userId, renderId: "render-ja", versionNo: 12, content: oneGroup("架空商事株式会社（2021年4月〜現在）正社員", "検索画面の応答時間上限200msをCIで監視する仕組みを導入し、他の3チームでも採用"), factCountAt: 0 },
  ]);
  const compare = async (from: string, to: string) => {
    const result = await context.request.get(`/api/renders/shokumu_keirekisho/diff?from=${from}&to=${to}`);
    expect(result.status()).toBe(200);
    return result.json() as Promise<typeof body>;
  };
  const recordMatch = await compare("version-3", "version-4");
  const fallbackMatch = await compare("version-5", "version-6");
  const unrelated = await compare("version-7", "version-8");
  const rewordedTwo = await compare("version-9", "version-10");
  const rewordedThree = await compare("version-11", "version-12");
  for (const result of [recordMatch, fallbackMatch, rewordedTwo, rewordedThree]) {
    expect(result.changes.find((change) => change.currentBlockId === "bullet")?.proposedBlockId).toBe("bullet");
  }
  expect(unrelated.changes.map((change) => [change.currentBlockId, change.proposedBlockId])).toEqual([[null, "bullet"], ["bullet", null]]);
  if (process.env.TEST_EVIDENCE_DIR) await writeFile(`${process.env.TEST_EVIDENCE_DIR}/japanese-diff-api.json`, JSON.stringify({
    sameEmployer: body.changes.map((change) => ({ current: change.currentBlockId, proposed: change.proposedBlockId, location: change.location })),
    recordMatch: recordMatch.changes.map((change) => ({ current: change.currentBlockId, proposed: change.proposedBlockId, location: change.location })),
    fallbackMatch: fallbackMatch.changes.map((change) => ({ current: change.currentBlockId, proposed: change.proposedBlockId, location: change.location })),
    unrelated: unrelated.changes.map((change) => ({ current: change.currentBlockId, proposed: change.proposedBlockId, location: change.location })),
    rewordedTwo: rewordedTwo.changes.map((change) => ({ current: change.currentBlockId, proposed: change.proposedBlockId, location: change.location })),
    rewordedThree: rewordedThree.changes.map((change) => ({ current: change.currentBlockId, proposed: change.proposedBlockId, location: change.location })),
  }, null, 2));
  await context.close();
});
