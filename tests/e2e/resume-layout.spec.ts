/** The employer-facing English résumé through the running Worker and built SPA. All data is invented. */
import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import PizZip from "pizzip";
import { SOURCE_FILENAME, SOURCE_TEXT } from "./fixture";
import { RESUME_STORAGE_STATE } from "./env";

const evidence = process.env.TEST_EVIDENCE_DIR;
const sectionNames = ["Summary", "Skills", "Experience", "Projects", "Education", "Certifications", "Languages"];
const PROFILE_FIXTURE = { familyNameKanji: "青木", givenNameKanji: "陽介", familyNameKana: "あおき", givenNameKana: "ようすけ", nameLatin: "Yosuke Aoki", dateOfBirth: "1994-11-01", phone: "080-0000-0000", email: "yosuke@example.invalid", postalCode: "150-0001", address: "東京都渋谷区神宮前0-0-0", addressKana: "とうきょうと しぶやく じんぐうまえ", contactSameAsAddress: true };
const EMPLOYER_FIXTURE = { nameJa: "株式会社アオゾラ物流", nameLatin: "Aozora Logistics K.K.", industryJa: "運輸業", businessDescription: "架空の物流事業者。", employmentType: "full_time", startedOn: "2022-04-01", endedOn: "2024-09-01" };
const ROLE_FIXTURE = { titleLatin: "Backend Engineer", titleJa: "バックエンドエンジニア", shokushuJa: "システムエンジニア", startedOn: "2022-04-01", endedOn: "2023-09-01" };
const EDUCATION_FIXTURE = { institution: "Midorikawa Institute of Technology", institutionJa: "緑川工科大学", faculty: "情報工学部", degree: "B.Eng.", fieldOfStudy: "Information Engineering", startedOn: "2013-04-01", endedOn: "2017-03-01", outcome: "graduated", level: "tertiary" };
const CERTIFICATION_FIXTURE = { name: "Applied Information Technology Engineer", nameJa: "応用情報技術者試験", issuingOrganization: "Information-technology Promotion Agency", issuedOn: "2019-06-01", kind: "technical", technologies: ["SQL"] };

test("main and tailored résumé download, with invalid edit refused", async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  if (evidence) mkdirSync(evidence, { recursive: true });
  const context = await browser.newContext({ baseURL, storageState: RESUME_STORAGE_STATE, acceptDownloads: true });
  const page = await context.newPage();
  const api = page.request;
  const put = async (url: string, data: unknown) => {
    const response = await api.put(url, { data });
    expect(response.status(), `${url}: ${await response.text()}`).toBe(200);
  };
  const post = async (url: string, data: unknown) => {
    const response = await api.post(url, { data });
    expect(response.status(), `${url}: ${await response.text()}`).toBe(201);
    return response.json();
  };

  await put("/api/profile", PROFILE_FIXTURE);
  const employer = await post("/api/employers", { ...EMPLOYER_FIXTURE, city: "Yokohama" }) as { id: string };
  await post("/api/roles", { ...ROLE_FIXTURE, employerId: employer.id });
  await post("/api/roles", { ...ROLE_FIXTURE, employerId: employer.id, titleLatin: "Senior Backend Engineer", startedOn: "2023-10-01", endedOn: "2024-09-01" });
  const independent = await post("/api/projects", { name: "Route Planner", summary: "Built a route planner for invented delivery routes." }) as { id: string };
  await post("/api/educations", EDUCATION_FIXTURE);
  await post("/api/certifications", CERTIFICATION_FIXTURE);
  await post("/api/certifications", { ...CERTIFICATION_FIXTURE, name: "Expired Cloud Associate", expiresOn: "2021-03-01" });
  await post("/api/certifications", { ...CERTIFICATION_FIXTURE, name: "TOEIC Listening & Reading 880", issuingOrganization: "IIBC", kind: "language", technologies: [] });
  const imported = await api.post("/api/imports", { multipart: { file: { name: SOURCE_FILENAME, mimeType: "text/markdown", buffer: Buffer.from(SOURCE_TEXT) } } });
  expect(imported.status(), await imported.text()).toBe(202);
  await expect.poll(async () => {
    const body = await api.get("/api/facts").then((r) => r.json()) as { items: { id: string }[] };
    return body.items.length;
  }).toBe(1);
  const facts = await api.get("/api/facts").then((r) => r.json()) as { items: { id: string }[] };
  expect((await api.patch(`/api/facts/${facts.items[0]!.id}`, { data: { employerId: employer.id } })).status()).toBe(200);

  const accept = async (ref: string) => {
    const started = await api.post(`/api/renders/${ref}/generate`);
    expect(started.status(), await started.text()).toBe(202);
    const { proposalId } = await started.json() as { proposalId: string };
    await expect.poll(async () => (await api.get(`/api/proposals/${proposalId}`).then((r) => r.json()) as { generationStatus: string }).generationStatus).toBe("ready");
    expect((await api.post(`/api/proposals/${proposalId}/accept`)).status()).toBe(200);
  };

  await accept("english_resume");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Résumé (English)" })).toContainText("Up to date");
  if (evidence) await page.screenshot({ path: `${evidence}/resume-home.png`, fullPage: true });

  const checkDownload = async (ref: string, label: string) => {
    const md = await api.get(`/api/renders/${ref}/download?format=md`);
    expect(md.status()).toBe(200);
    const markdown = await md.text();
    const headings = [...markdown.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
    expect(headings).toEqual(sectionNames);
    expect(markdown).toContain("**Aozora Logistics K.K.** · Yokohama — Apr 2022 – Sep 2024");
    expect(markdown).toContain("*Senior Backend Engineer (Oct 2023 – Sep 2024) · Backend Engineer (Apr 2022 – Sep 2023)*");
    expect(markdown).toContain("TOEIC Listening & Reading 880");
    expect(markdown).toContain("Route Planner");
    expect(markdown).not.toMatch(/Expired Cloud Associate|情報工学部|緑川/);
    if (evidence) writeFileSync(`${evidence}/${label}.md`, markdown);

    const file = await api.get(`/api/renders/${ref}/download?format=docx`);
    expect(file.status()).toBe(200);
    expect(file.headers()["content-disposition"]).toMatch(/filename="Yosuke-Aoki-Resume-\d{4}-\d{2}\.docx"/);
    const bytes = Buffer.from(await file.body());
    if (evidence) writeFileSync(`${evidence}/${label}.docx`, bytes);
    const zip = new PizZip(bytes);
    const document = zip.file("word/document.xml")!.asText();
    expect(document).toContain("<w:numPr>");
    expect(document).not.toContain("<w:tbl>");
    expect(document).toContain("Aozora Logistics K.K.");
    expect(zip.file("word/header1.xml")).toBeNull();
    expect(zip.file("word/footer1.xml")).toBeNull();
    return markdown;
  };

  const original = await checkDownload("english_resume", "resume-main");
  await page.goto("/renders/english_resume/view");
  await expect(page.getByRole("article").getByText("Aozora Logistics K.K.")).toBeVisible();
  if (evidence) await page.screenshot({ path: `${evidence}/resume-reader.png`, fullPage: true });

  // A version accepted with a complete job must stop printing when today's
  // record loses its city, in the reader and in every downloadable format.
  expect((await api.patch(`/api/employers/${employer.id}`, { data: { city: null } })).status()).toBe(200);
  for (const path of [
    "/api/renders/english_resume/page",
    "/api/renders/english_resume/download?format=md",
    "/api/renders/english_resume/download?format=docx",
    "/api/renders/english_resume/download?format=pdf",
  ]) {
    const response = await api.get(path);
    expect(response.status(), path).toBe(409);
    const body = await response.json();
    expect(body.error.details.jobHeaders).toEqual([
      { employerId: employer.id, name: "Aozora Logistics K.K.", missing: ["city"] },
    ]);
    if (evidence) writeFileSync(`${evidence}/resume-city-refusal.json`, JSON.stringify(body, null, 2));
  }
  await page.reload();
  const cityLink = page.getByRole("link", { name: "Add the city for Aozora Logistics K.K." });
  await expect(cityLink).toBeVisible();
  if (evidence) await page.screenshot({ path: `${evidence}/resume-city-refusal.png`, fullPage: true });
  await cityLink.click();
  await expect(page).toHaveURL(new RegExp(`/record\\?employer=${employer.id}&fix=city$`));
  await expect(page.getByRole("form", { name: "Editing employer" }).getByLabel(/^City/)).toBeFocused();
  expect((await api.patch(`/api/employers/${employer.id}`, { data: { city: "Yokohama" } })).status()).toBe(200);
  expect((await api.get("/api/renders/english_resume/download?format=md")).status()).toBe(200);

  // The form cannot silently classify a new language score as technical.
  const unclassified = await api.post("/api/certifications", {
    data: { name: "TOEIC Listening & Reading 890", issuingOrganization: "IIBC" },
  });
  expect(unclassified.status()).toBe(422);
  expect((await unclassified.json()).error.details.fields).toContain("kind");
  await post("/api/certifications", {
    name: "Ordinary driving licence", issuingOrganization: "Fictional licensing office", kind: "other",
  });
  const classified = await api.get("/api/renders/english_resume/download?format=md");
  expect(classified.status()).toBe(200);
  expect(await classified.text()).not.toContain("Ordinary driving licence");

  const refused = async (entry: string, expected: string) => {
    const response = await api.post("/api/renders/english_resume/generate");
    expect(response.status(), `${entry}: ${await response.text()}`).toBe(428);
    expect(await response.text()).toContain(expected);
    if (evidence) writeFileSync(`${evidence}/resume-${entry}-refusal.txt`, `${response.status()} ${await response.text()}\n`);
  };
  expect((await api.patch(`/api/employers/${employer.id}`, { data: { nameJa: "Компания", nameLatin: null } })).status()).toBe(200);
  await refused("employer", "Latin-script name for employer");
  for (const format of ["md", "docx"]) {
    const response = await api.get(`/api/renders/english_resume/download?format=${format}`);
    expect(response.status()).toBe(409);
    expect(await response.text()).toContain("Latin-script name");
  }
  expect((await api.patch(`/api/employers/${employer.id}`, { data: { nameJa: EMPLOYER_FIXTURE.nameJa, nameLatin: EMPLOYER_FIXTURE.nameLatin } })).status()).toBe(200);
  const attached = await post("/api/projects", { name: "Проект", employerId: employer.id }) as { id: string };
  await refused("attached-project", "Latin-script name for project");
  expect((await api.patch(`/api/projects/${attached.id}`, { data: { name: "Dispatch Console" } })).status()).toBe(200);
  const school = await post("/api/educations", { ...EDUCATION_FIXTURE, institution: "Школа", level: "secondary_upper" }) as { id: string };
  await refused("secondary-school", "Latin-script name for education");
  expect((await api.patch(`/api/educations/${school.id}`, { data: { institution: "Midorikawa High School" } })).status()).toBe(200);
  const { items } = await api.get("/api/renders").then((r) => r.json()) as { items: { kind: string; currentVersionId: string }[] };
  const versionId = items.find((item) => item.kind === "english_resume")!.currentVersionId;
  const version = await api.get(`/api/renders/english_resume/versions/${versionId}`).then((r) => r.json()) as { content: { sections: { key: string; blocks: { kind: string }[] }[] } };
  const invalid = { sections: version.content.sections.map((section) => section.key === `employer:${employer.id}`
    ? { ...section, blocks: section.blocks.map((block) => ({ ...block, kind: "paragraph" })) }
    : section) };
  const edit = await api.post("/api/renders/english_resume/versions", { data: { basedOnVersionId: versionId, content: invalid } });
  expect(edit.status()).toBe(422);
  const longSummary = { sections: version.content.sections.map((section) => section.key === "summary"
    ? { ...section, blocks: section.blocks.map((block) => ({ ...block, text: Array.from({ length: 51 }, () => "settlement").join(" ") })) }
    : section) };
  const overBound = await api.post("/api/renders/english_resume/versions", { data: { basedOnVersionId: versionId, content: longSummary } });
  expect(overBound.status()).toBe(422);
  if (evidence) writeFileSync(`${evidence}/resume-refused-edits.txt`, `wrong block kind: ${edit.status()} ${await edit.text()}\n51-word summary: ${overBound.status()} ${await overBound.text()}\n`);
  const after = await api.get("/api/renders/english_resume/download?format=md");
  expect(await after.text()).toBe(original);

  const application = await post("/api/applications", { company: "Kestrel", position: "Platform Engineer", jobDescription: "Kestrel seeks an engineer for an invented settlement platform." }) as { id: string };
  const tailored = await api.post(`/api/applications/${application.id}/tailored/english_resume`);
  expect(tailored.status(), await tailored.text()).toBe(201);
  const detail = await api.get(`/api/applications/${application.id}`).then((r) => r.json()) as { documents: { ref: string; tailored: boolean }[] };
  const ref = detail.documents.find((document) => document.tailored)!.ref;
  await accept(ref);
  await checkDownload(ref, "resume-tailored");

  // A tailored 履歴書, made from its own application through the screen
  // (`docs/06`, 2026-10-26): its drafts are confirmed or edited before it is
  // accepted, and it is then the application's 履歴書.
  const japanese = await post("/api/applications", { company: "Osprey", position: "バックエンドエンジニア", jobDescription: "Osprey は架空の決済基盤のエンジニアを募集しています。" }) as { id: string };
  await page.goto(`/applications/${japanese.id}`);
  await page.getByLabel(/Why you are applying/).fill("決済の信頼性に関わり続けたいからです。");
  await page.getByRole("button", { name: "Make a tailored 履歴書" }).click();
  await expect(page).toHaveURL(/\/proposals\/[^/]+$/, { timeout: 30_000 });
  const drafts = page.getByRole("region", { name: "Drafted for you" });
  await expect(drafts.getByText("Drafted for you: 2 parts to confirm")).toBeVisible();
  await expect(page.getByRole("button", { name: "Accept as v1" })).toBeDisabled();
  await drafts.getByRole("button", { name: "Confirm as written" }).first().click();
  await expect(drafts.getByText("Drafted for you: 1 part to confirm")).toBeVisible();
  const kibou = drafts.getByRole("textbox", { name: /本人希望欄/ });
  await kibou.fill("バックエンドエンジニア職を希望いたします。");
  await drafts.getByRole("button", { name: "Save my wording" }).click();
  await expect(drafts).toBeHidden();
  if (evidence) await page.screenshot({ path: `${evidence}/rirekisho-tailored-review.png`, fullPage: true });
  await page.getByRole("button", { name: "Accept as v1" }).click();
  await expect(page).toHaveURL(new RegExp(`/applications/${japanese.id}$`));
  await expect(page.getByText("Tailored 履歴書 for Osprey", { exact: true })).toBeVisible();
  const japaneseDetail = await api.get(`/api/applications/${japanese.id}`).then((r) => r.json()) as { documents: { ref: string; kind: string; tailored: boolean; currentVersionNo: number | null }[] };
  const ownRirekisho = japaneseDetail.documents.find((document) => document.tailored && document.kind === "rirekisho")!;
  expect(ownRirekisho.currentVersionNo).toBe(1);
  const rirekishoFile = await api.get(`/api/renders/${ownRirekisho.ref}/download?format=docx`);
  expect(rirekishoFile.status()).toBe(200);
  expect(decodeURIComponent(rirekishoFile.headers()["content-disposition"] ?? "")).toMatch(/履歴書_/);
  expect(new PizZip(await rirekishoFile.body()).file("word/document.xml")!.asText()).toContain("バックエンドエンジニア職を希望いたします。");
  expect((await api.patch(`/api/projects/${independent.id}`, { data: { employerId: employer.id } })).status()).toBe(200);
  const reworded = { sections: version.content.sections.map((section) => section.key === "summary"
    ? { ...section, blocks: section.blocks.map((block) => ({ ...block, text: "Backend engineer improving dependable settlement services." })) }
    : section) };
  const movedRecordEdit = await api.post("/api/renders/english_resume/versions", { data: { basedOnVersionId: versionId, content: reworded } });
  expect(movedRecordEdit.status(), await movedRecordEdit.text()).toBe(201);
  if (evidence) writeFileSync(`${evidence}/resume-edit-after-project-move.txt`, `${movedRecordEdit.status()} ${await movedRecordEdit.text()}\n`);

  // An accepted version must also refuse a title lost after acceptance.
  const savedRoles = await api.get("/api/roles").then((response) => response.json()) as { items: { id: string; employerId: string }[] };
  for (const role of savedRoles.items.filter((item) => item.employerId === employer.id)) {
    expect((await api.delete(`/api/roles/${role.id}`)).status()).toBe(204);
  }
  for (const path of ["/api/renders/english_resume/page", "/api/renders/english_resume/download?format=md"]) {
    const response = await api.get(path);
    expect(response.status(), path).toBe(409);
    const body = await response.json();
    expect(body.error.details.jobHeaders).toEqual([
      { employerId: employer.id, name: "Aozora Logistics K.K.", missing: ["role"] },
    ]);
    if (evidence) writeFileSync(`${evidence}/resume-role-refusal.json`, JSON.stringify(body, null, 2));
  }
  const noRoleGeneration = await api.post("/api/renders/english_resume/generate");
  expect(noRoleGeneration.status()).toBe(428);
  await page.goto("/renders/english_resume/view");
  const roleLink = page.getByRole("link", { name: "Add the role for Aozora Logistics K.K." });
  await expect(roleLink).toBeVisible();
  if (evidence) await page.screenshot({ path: `${evidence}/resume-role-refusal.png`, fullPage: true });
  await roleLink.click();
  await expect(page).toHaveURL(new RegExp(`/record\\?employer=${employer.id}&fix=role$`));
  await expect(page.getByRole("form", { name: "New role" }).getByLabel(/^Title/)).toBeFocused();

  // Both ways an application freezes a document must show the same repair link.
  await page.goto(`/applications/${application.id}`);
  await page.getByRole("button", { name: "Move to Applied" }).click();
  await expect(page.getByRole("link", { name: "Add the role for Aozora Logistics K.K." })).toBeVisible();
  if (evidence) await page.screenshot({ path: `${evidence}/resume-application-step-refusal.png`, fullPage: true });
  await post("/api/roles", { ...ROLE_FIXTURE, employerId: employer.id });
  await page.getByRole("button", { name: "Move to Applied" }).click();
  await expect(page.getByRole("button", { name: "Move to Résumé passed" })).toBeVisible();
  expect((await api.patch(`/api/employers/${employer.id}`, { data: { city: null } })).status()).toBe(200);
  await page.getByRole("button", { name: "Record another sent copy" }).click();
  await page.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: "Record the ticked documents" }).click();
  await expect(page.getByRole("link", { name: "Add the city for Aozora Logistics K.K." })).toBeVisible({ timeout: 15_000 });
  if (evidence) await page.screenshot({ path: `${evidence}/resume-application-record-refusal.png`, fullPage: true });
  await context.close();
});
