/**
 * An application's documents and its sent copies, through the API
 * (`docs/07` §9c, issue #71).
 *
 * What is pinned here: an application carries a tailored résumé made from its
 * job description, documents the record already has, or several; moving it out
 * of Not applied freezes each one as sent; and a sent copy is the file of that
 * day, which no later version of the document and no later change to the
 * record or the profile reaches.
 *
 * The last is checked on the stored file itself, read back out of the `.docx`,
 * because "it does not change" is a claim about bytes. Every entry here is
 * INVENTED.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PizZip from "pizzip";
import { harness, settle, stubModel, type Client, type Harness, type SeededUser, type StubModel } from "./helpers/harness";
import {
  EDUCATION_FIXTURE,
  EMPLOYER_FIXTURE,
  PROFILE_FIXTURE,
  SECOND_EMAIL,
  seedAllowedUser,
  seedTailoredResume,
  uploadForm,
} from "./helpers/seed";
import { eq } from "drizzle-orm";
import { applicationSentCopies } from "~/server/db/schema";
import type { CandidateFact } from "~/model/types";
import type { Sheet } from "~/render/sheet";
import type { RenderContent } from "~/shared/render-content";

interface Document {
  ref: string;
  kind: string;
  tailored: boolean;
  title: string;
  currentVersionNo: number | null;
  status: string;
}
interface Copy {
  id: string;
  ref: string;
  title: string;
  versionNo: number;
  sentOn: string;
}
interface Detail {
  id: string;
  step: string;
  dates: Record<string, string>;
  lastActivityAt: string;
  documents: Document[];
  choices: (Document & { onApplication: boolean })[];
  sentCopies: Copy[];
  frozen?: { title: string; versionNo: number }[];
}
interface Page {
  stamp: string | null;
  name: string;
  contact: string[];
  sections: { heading: string; blocks: { kind: string; text: string }[] }[];
  sheet?: Sheet;
}
interface CopyPage {
  id: string;
  company: string;
  title: string;
  kind: string;
  language: string;
  versionNo: number;
  sentOn: string;
  page: Page;
}

const POSTING = "Harrowgate Signals is hiring a backend engineer for its tide-gauge telemetry service.";
const JOB = { company: "Harrowgate Signals", position: "Backend Engineer", jobDescription: POSTING };

const USABLE: CandidateFact = {
  claim: "Cut the nightly settlement run from 6 hours to 90 minutes",
  quote: "The nightly settlement run fell from 6 hours to 90 minutes.",
  technologies: ["Airflow"],
  provenance: "measured",
};

/** Midday in Japan, so a test that moves the clock by whole days never crosses midnight. */
const DAY_ONE = new Date("2026-03-02T03:00:00.000Z");
const dayAfter = (days: number) => new Date(DAY_ONE.getTime() + days * 86_400_000);
const dateAfter = (days: number) => dayAfter(days).toISOString().slice(0, 10);

let model: StubModel;
let app: Harness;
let user: SeededUser;
let client: Client;
let factId: string;
let employerId: string;

/** Every line of a sheet, tables included, in the file's order. */
const sheetText = (sheet: Sheet | undefined) =>
  (sheet?.blocks ?? [])
    .flatMap((block) => (block.kind === "line" ? [block.line] : block.rows.flat().flatMap((cell) => cell.lines)))
    .map((line) => line.text)
    .join("\n");

beforeEach(async () => {
  // Only `Date`: the database is real and its requests keep their real timers.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(DAY_ONE);
  model = stubModel();
  app = harness(model);
  user = await seedAllowedUser();
  client = app.as(user);
  factId = await seedRecord(client);
});

afterEach(() => {
  vi.useRealTimers();
});

/** A profile, an employer, an education and one fact a document may use. */
async function seedRecord(as: Client): Promise<string> {
  await as.put("/api/profile", PROFILE_FIXTURE);
  employerId = ((await (await as.post("/api/employers", EMPLOYER_FIXTURE)).json()) as { id: string }).id;
  await as.post("/api/educations", EDUCATION_FIXTURE);
  model.extractions = [[USABLE]];
  await as.request("/api/imports", { method: "POST", body: uploadForm(`# Notes\n\n${USABLE.quote}\n`) });
  await settle();
  const { items } = await as.json<{ items: { id: string }[] }>("/api/facts");
  return items[0]!.id;
}

const content = (text: string, key = "experience", heading = "Experience", cites = factId): RenderContent => ({
  sections: [{ key, heading, blocks: [{ id: "blk_1", kind: "bullet", text, factIds: [cites] }] }],
});

/** A résumé's bullet, under the job it belongs to (issue #107). */
const resumeContent = (text: string): RenderContent => content(text, `employer:${employerId}`, EMPLOYER_FIXTURE.nameLatin);

/** Generates a document and accepts it, which makes its next version. */
async function accept(ref: string, body: RenderContent, as: Client = client) {
  model.generations = [body];
  const { proposalId } = (await (await as.post(`/api/renders/${ref}/generate`)).json()) as { proposalId: string };
  await settle();
  expect((await as.post(`/api/proposals/${proposalId}/accept`)).status).toBe(200);
}

const add = async (as: Client = client) => (await (await as.post("/api/applications", JOB)).json()) as Detail;
const read = (id: string, as: Client = client) => as.json<Detail>(`/api/applications/${id}`);
const choose = (id: string, documents: string[], as: Client = client) => as.put(`/api/applications/${id}/documents`, { documents });
const move = (id: string, status: string, as: Client = client) => as.post(`/api/applications/${id}/steps`, { status });
const record = (id: string, documents: string[], as: Client = client) => as.post(`/api/applications/${id}/sent-copies`, { documents });
const listed = async (id: string, as: Client = client) =>
  (await as.json<{ items: { id: string; resume: { documents: { title: string; versionNo: number | null }[]; sent: boolean } }[] }>("/api/applications")).items.find(
    (item) => item.id === id,
  )!.resume;

/** The text of a `.docx`, with its markup dropped. */
const textOf = (bytes: ArrayBuffer) => new PizZip(bytes).file("word/document.xml")!.asText().replace(/<[^>]+>/g, "");
const fileOf = async (id: string, copyId: string, as: Client = client) => {
  const response = await as.get(`/api/applications/${id}/sent-copies/${copyId}/download`);
  expect(response.status).toBe(200);
  return response.arrayBuffer();
};
const sameBytes = (a: ArrayBuffer, b: ArrayBuffer) =>
  a.byteLength === b.byteLength && new Uint8Array(a).every((byte, index) => byte === new Uint8Array(b)[index]);

describe("choosing the documents for a job", () => {
  it("offers the main résumé, 履歴書 and 職務経歴書, and none can be ticked before it has a version", async () => {
    const made = await add();

    expect(made.documents).toEqual([]);
    expect(made.choices.map((choice) => [choice.ref, choice.title, choice.currentVersionNo, choice.onApplication])).toEqual([
      ["english_resume", "Main résumé", null, false],
      ["rirekisho", "履歴書", null, false],
      ["shokumu_keirekisho", "職務経歴書", null, false],
    ]);

    const refused = await choose(made.id, ["rirekisho"]);
    expect(refused.status).toBe(422);
    expect(((await refused.json()) as { error: { message: string } }).error.message).toBe("履歴書 has no version yet. Generate it first.");
    expect((await read(made.id)).documents).toEqual([]);
  });

  it("holds several at once, and the list says they are not sent yet", async () => {
    await accept("rirekisho", content("海事システムの保守経験を活かしたい。", "motivation", "志望の動機"));
    await accept("shokumu_keirekisho", content("夜間バッチを6時間から90分に短縮。"));
    const made = await add();

    vi.setSystemTime(dayAfter(2));
    const response = await choose(made.id, ["rirekisho", "shokumu_keirekisho"]);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Detail;

    expect(body.documents.map((document) => [document.title, document.currentVersionNo, document.tailored])).toEqual([
      ["履歴書", 1, false],
      ["職務経歴書", 1, false],
    ]);
    expect(body.sentCopies).toEqual([]);
    expect(await listed(made.id)).toEqual({
      documents: [
        { title: "履歴書", versionNo: 1 },
        { title: "職務経歴書", versionNo: 1 },
      ],
      sent: false,
    });
    // Choosing a document is activity.
    expect(body.lastActivityAt).toBe(dayAfter(2).toISOString());
  });

  it("writes nothing when the same ticks are saved again", async () => {
    await accept("english_resume", resumeContent("Cut the nightly run to 90 minutes."));
    const made = await add();
    vi.setSystemTime(dayAfter(1));
    await choose(made.id, ["english_resume"]);

    vi.setSystemTime(dayAfter(5));
    const again = (await (await choose(made.id, ["english_resume"])).json()) as Detail;

    expect(again.lastActivityAt).toBe(dayAfter(1).toISOString());
    expect(again.documents).toHaveLength(1);
  });

  it("takes a document off without touching the document, and unticking does the same", async () => {
    await accept("english_resume", resumeContent("Cut the nightly run to 90 minutes."));
    await accept("shokumu_keirekisho", content("夜間バッチを短縮。"));
    const made = await add();
    await choose(made.id, ["english_resume", "shokumu_keirekisho"]);

    const taken = await client.delete(`/api/applications/${made.id}/documents/english_resume`);
    expect(taken.status).toBe(200);
    expect(((await taken.json()) as Detail).documents.map((document) => document.ref)).toEqual(["shokumu_keirekisho"]);

    const unticked = (await (await choose(made.id, [])).json()) as Detail;
    expect(unticked.documents).toEqual([]);

    // Both documents are where they were, and can be put back.
    const renders = await client.json<{ items: { kind: string; currentVersionNo: number | null }[] }>("/api/renders");
    expect(renders.items.filter((item) => item.currentVersionNo === 1).map((item) => item.kind)).toEqual([
      "english_resume",
      "shokumu_keirekisho",
    ]);
    expect(((await (await choose(made.id, ["english_resume"])).json()) as Detail).documents).toHaveLength(1);
    expect((await client.delete(`/api/applications/${made.id}/documents/rirekisho`)).status).toBe(404);
  });

  it("refuses a document that is not one an application sends", async () => {
    const made = await add();
    expect((await choose(made.id, ["career_story_en"])).status).toBe(422);
    expect((await choose(made.id, ["english_resume", "english_resume"])).status).toBe(422);
    expect((await client.put(`/api/applications/${made.id}/documents`, { documents: [], extra: true })).status).toBe(422);
  });
});

describe("a tailored résumé made from the application", () => {
  it("is stored from the job description, put on the application, and generated like any document", async () => {
    const made = await add();

    const response = await client.post(`/api/applications/${made.id}/tailored-resume`);
    expect(response.status).toBe(201);
    const body = (await response.json()) as Detail;
    const [resume] = body.documents;
    expect(resume).toMatchObject({
      kind: "english_resume",
      tailored: true,
      title: "Tailored résumé for Harrowgate Signals",
      status: "never_generated",
      currentVersionNo: null,
    });
    expect(resume!.ref).toMatch(/^rnd_/);

    await accept(resume!.ref, resumeContent("Ran telemetry ingestion for tide gauges."));
    // The posting reaches generation as text to read; the facts are the record's own.
    expect(model.generationInputs.at(-1)!.spec.jobDescription).toBe(POSTING);
    expect(model.generationInputs.at(-1)!.facts.map((fact) => fact.id)).toEqual([factId]);

    const after = await read(made.id);
    expect(after.documents[0]).toMatchObject({ ref: resume!.ref, currentVersionNo: 1, status: "up_to_date" });
    // The review of its proposal returns to the application it belongs to.
    const proposals = await client.json<{ items: { id: string }[] }>(`/api/proposals?kind=${resume!.ref}`);
    expect(await client.json<{ applicationId: string }>(`/api/proposals/${proposals.items[0]!.id}`)).toMatchObject({
      applicationId: made.id,
    });
  });

  it("is the one an application has: asked again it is the same résumé, put back if it was taken off", async () => {
    const made = await add();
    const first = (await (await client.post(`/api/applications/${made.id}/tailored-resume`)).json()) as Detail;
    const ref = first.documents[0]!.ref;

    const again = await client.post(`/api/applications/${made.id}/tailored-resume`);
    expect(again.status).toBe(200);
    expect(((await again.json()) as Detail).documents.map((document) => document.ref)).toEqual([ref]);

    await client.delete(`/api/applications/${made.id}/documents/${ref}`);
    expect((await read(made.id)).documents).toEqual([]);
    const back = (await (await client.post(`/api/applications/${made.id}/tailored-resume`)).json()) as Detail;
    expect(back.documents.map((document) => document.ref)).toEqual([ref]);
  });

  it("stays on the application when generating is refused", async () => {
    const other = app.as(await seedAllowedUser(SECOND_EMAIL));
    // No profile and no fact: nothing to write it from.
    const made = await add(other);
    const stored = (await (await other.post(`/api/applications/${made.id}/tailored-resume`)).json()) as Detail;

    const refused = await other.post(`/api/renders/${stored.documents[0]!.ref}/generate`);
    expect(refused.status).toBe(428);
    expect((await read(made.id, other)).documents).toMatchObject([{ tailored: true, status: "never_generated" }]);
  });

  it("sits beside the documents the record already has", async () => {
    await accept("english_resume", resumeContent("Cut the nightly run to 90 minutes."));
    const carried = await seedTailoredResume(user, "Kestrel Freight");
    await choose(carried.applicationId, ["english_resume"]);

    const application = await read(carried.applicationId);
    expect(application.documents.map((document) => [document.title, document.tailored])).toEqual([
      ["Tailored résumé for Kestrel Freight", true],
      ["Main résumé", false],
    ]);
    // Unticking the three leaves the tailored résumé where it is.
    expect(((await (await choose(carried.applicationId, [])).json()) as Detail).documents.map((document) => document.ref)).toEqual([carried.id]);
  });
});

describe("moving to Applied", () => {
  it("freezes every document on the application as sent, with that day's date, and says which", async () => {
    await accept("rirekisho", content("海事システムの保守経験を活かしたい。", "motivation", "志望の動機"));
    await accept("shokumu_keirekisho", content("夜間バッチを6時間から90分に短縮。"));
    const made = await add();
    await choose(made.id, ["rirekisho", "shokumu_keirekisho"]);

    vi.setSystemTime(dayAfter(3));
    const response = await move(made.id, "applied");
    expect(response.status).toBe(200);
    const body = (await response.json()) as Detail;

    expect(body.step).toBe("applied");
    expect(body.frozen).toEqual([
      { title: "履歴書", versionNo: 1 },
      { title: "職務経歴書", versionNo: 1 },
    ]);
    expect(body.sentCopies.map((copy) => [copy.title, copy.versionNo, copy.sentOn, copy.ref])).toEqual([
      ["履歴書", 1, dateAfter(3), "rirekisho"],
      ["職務経歴書", 1, dateAfter(3), "shokumu_keirekisho"],
    ]);
    expect(await listed(made.id)).toEqual({
      documents: [
        { title: "履歴書", versionNo: 1 },
        { title: "職務経歴書", versionNo: 1 },
      ],
      sent: true,
    });
  });

  it("freezes on a move that skips Applied, and freezes nothing when no document is on it", async () => {
    await accept("english_resume", resumeContent("Cut the nightly run to 90 minutes."));
    const withOne = await add();
    await choose(withOne.id, ["english_resume"]);
    // Straight to an interview, as saving an interview on one not yet applied does.
    const skipped = (await (await move(withOne.id, "interview_1")).json()) as Detail;
    expect(skipped.step).toBe("interview_1");
    expect(skipped.frozen).toEqual([{ title: "Main résumé", versionNo: 1 }]);
    expect(skipped.sentCopies).toHaveLength(1);
    expect((await record(withOne.id, ["english_resume"])).status).toBe(201);

    const withNone = await add();
    const moved = (await (await move(withNone.id, "applied")).json()) as Detail;
    expect(moved.step).toBe("applied");
    expect(moved.frozen).toEqual([]);
    expect(moved.sentCopies).toEqual([]);
  });

  it("freezes when an interview entry is what takes it out of Not applied, and Undo takes that back", async () => {
    await accept("english_resume", resumeContent("Cut the nightly run to 90 minutes."));
    const made = await add();
    await choose(made.id, ["english_resume"]);

    vi.setSystemTime(dayAfter(5));
    const response = await client.post(`/api/applications/${made.id}/interviews`, {
      date: dateAfter(4),
      round: "interview_1",
      howItWent: "A first conversation about the telemetry service.",
    });
    expect(response.status).toBe(201);
    const noted = (await response.json()) as Detail;
    expect(noted.step).toBe("interview_1");
    expect(noted.frozen).toEqual([{ title: "Main résumé", versionNo: 1 }]);
    expect(noted.sentCopies.map((copy) => [copy.title, copy.versionNo, copy.sentOn])).toEqual([
      ["Main résumé", 1, dateAfter(4)],
    ]);

    const undone = await client.put(`/api/applications/${made.id}/standing`, {
      step: made.step,
      closedAs: null,
      dates: made.dates,
    });
    expect(undone.status).toBe(200);
    const back = await read(made.id);
    expect(back.step).toBe("not_applied");
    expect(back.sentCopies).toEqual([]);
  });

  it("leaves a tailored résumé that has no version yet out of the freeze", async () => {
    const made = await add();
    await client.post(`/api/applications/${made.id}/tailored-resume`);

    const moved = (await (await move(made.id, "applied")).json()) as Detail;
    expect(moved.frozen).toEqual([]);
    expect(moved.documents).toHaveLength(1);
  });

  it("is not made when a document cannot be frozen, and says why", async () => {
    await accept("english_resume", resumeContent("Cut the nightly run to 90 minutes."));
    const made = await add();
    await choose(made.id, ["english_resume"]);
    // The version cites a fact that may no longer reach a document.
    await client.patch(`/api/facts/${factId}`, { disclosure: "private" });

    const refused = await move(made.id, "applied");
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: { message: string } }).error.message).toContain(factId);
    const after = await read(made.id);
    expect(after.step).toBe("not_applied");
    expect(after.sentCopies).toEqual([]);
  });
});

describe("a sent copy", () => {
  it("is the file as it was that day: a later version, a renamed author and a changed record do not reach it", async () => {
    await accept("english_resume", resumeContent("Cut the nightly run to 90 minutes."));
    await accept("rirekisho", content("海事システムの保守経験を活かしたい。", "motivation", "志望の動機"));
    const made = await add();
    await choose(made.id, ["english_resume", "rirekisho"]);
    const applied = (await (await move(made.id, "applied")).json()) as Detail;
    const [resume, rirekisho] = applied.sentCopies;

    const sentResume = await fileOf(made.id, resume!.id);
    const sentRirekisho = await fileOf(made.id, rirekisho!.id);
    expect(textOf(sentResume)).toContain("Cut the nightly run to 90 minutes.");
    expect(textOf(sentResume)).toContain("Yosuke Aoki");
    expect(textOf(sentRirekisho)).toContain("緑川工科大学");

    // Weeks later: a new version of each, a new name and address, and a record that has moved on.
    vi.setSystemTime(dayAfter(40));
    await accept("english_resume", resumeContent("Rebuilt the settlement run on a streaming platform."));
    await accept("rirekisho", content("新しい志望動機。", "motivation", "志望の動機"));
    await client.put("/api/profile", { ...PROFILE_FIXTURE, nameLatin: "Yosuke Hayashi", familyNameKanji: "林", address: "大阪府大阪市北区0-0-0" });
    await client.post("/api/educations", { ...EDUCATION_FIXTURE, institutionJa: "白波大学院大学", level: "postgraduate", startedOn: "2017-04-01", endedOn: "2019-03-01" });

    // The document itself has moved on.
    const fresh = textOf(await (await client.get("/api/renders/english_resume/download?format=docx")).arrayBuffer());
    expect(fresh).toContain("Rebuilt the settlement run on a streaming platform.");
    expect(fresh).toContain("Yosuke Hayashi");
    expect((await read(made.id)).documents.map((document) => document.currentVersionNo)).toEqual([2, 2]);

    // The copies have not: the same bytes, and the same words on the page.
    expect(sameBytes(await fileOf(made.id, resume!.id), sentResume)).toBe(true);
    expect(sameBytes(await fileOf(made.id, rirekisho!.id), sentRirekisho)).toBe(true);
    expect(textOf(await fileOf(made.id, rirekisho!.id))).not.toContain("白波大学院大学");

    const page = await client.json<CopyPage>(`/api/applications/${made.id}/sent-copies/${resume!.id}`);
    expect(page).toMatchObject({ company: "Harrowgate Signals", title: "Main résumé", versionNo: 1, sentOn: dateAfter(0), language: "en" });
    expect(page.page.name).toBe("Yosuke Aoki");
    expect(page.page.contact).toEqual([PROFILE_FIXTURE.email]);
    // The résumé's page is the file's text: its job header and education are
    // the record of that day, and the later education is not on it (issue #107).
    const experience = page.page.sections.find((section) => section.heading === "Experience")!;
    expect(experience.blocks).toContainEqual({ kind: "row", text: "Aozora Logistics K.K. · Apr 2022 – Sep 2024" });
    expect(experience.blocks).toContainEqual({ kind: "bullet", text: "Cut the nightly run to 90 minutes." });
    expect(page.page.sections.flatMap((section) => section.blocks).every((block) => !("factIds" in block))).toBe(true);
    expect(JSON.stringify(page.page)).not.toContain("Rebuilt the settlement run");
    expect(page.page.sections.find((section) => section.heading === "Education")!.blocks).toHaveLength(1);

    const form = await client.json<CopyPage>(`/api/applications/${made.id}/sent-copies/${rirekisho!.id}`);
    expect(form).toMatchObject({ title: "履歴書", language: "ja" });
    expect(form.page.name).toBe("青木　陽介");
    expect(form.page.contact.join("\n")).toContain("東京都渋谷区神宮前0-0-0");
    expect(form.page.sections.map((section) => section.heading)).toEqual(["学歴", "職歴", "志望の動機"]);
    expect(form.page.sections.flatMap((section) => section.blocks).every((block) => !("factIds" in block))).toBe(true);
    expect(form.page.sheet!.blocks.filter((block) => block.kind === "table").flatMap((table) => table.rows.flat()).every((cell) => !("factIds" in cell))).toBe(true);
    expect(JSON.stringify(form.page)).not.toContain("白波大学院大学");
    expect(JSON.stringify(form.page)).toContain("海事システムの保守経験を活かしたい。");
    // The form as the file lays it out, read out of the file that was sent.
    expect(sheetText(form.page.sheet)).toContain("履 歴 書");
    expect(sheetText(form.page.sheet)).toContain("東京都渋谷区神宮前0-0-0");
    expect(sheetText(form.page.sheet)).not.toContain("白波大学院大学");

    // And the application still names what was sent, not what is current.
    expect((await read(made.id)).sentCopies.map((copy) => copy.versionNo)).toEqual([1, 1]);
    expect((await listed(made.id)).documents.map((document) => document.versionNo)).toEqual([1, 1]);
  });

  it("reads a 履歴書 stored before its page carried the form out of the file that was sent", async () => {
    const made = await add();
    await accept("rirekisho", content("海事システムの保守経験を活かしたい。", "motivation", "志望の動機"));
    await choose(made.id, ["rirekisho"]);
    const [copy] = ((await (await move(made.id, "applied")).json()) as Detail).sentCopies;
    const url = `/api/applications/${made.id}/sent-copies/${copy!.id}`;
    const current = await client.json<CopyPage>(url);

    // What a copy stored before the form existed holds: the text alone, under the old title.
    const { sheet: _sheet, ...text } = current.page;
    await app.db.update(applicationSentCopies).set({ page: { ...text, title: "履歴書" } }).where(eq(applicationSentCopies.id, copy!.id));
    // And the record moves on, which the stored file has not.
    await client.put("/api/profile", { ...PROFILE_FIXTURE, address: "大阪府大阪市北区0-0-0" });

    const legacy = await client.json<CopyPage>(url);
    expect(legacy.page.sheet).toEqual(current.page.sheet);
    expect(sheetText(legacy.page.sheet)).toContain("履 歴 書");
    expect(sheetText(legacy.page.sheet)).toContain("東京都渋谷区神宮前0-0-0");
    expect(sheetText(legacy.page.sheet)).not.toContain("大阪府");
  });

  it("warns and logs only ids and error kind when a legacy copy's file cannot be read", async () => {
    const made = await add();
    await accept("rirekisho", content("海事システムの保守経験を活かしたい。", "motivation", "志望の動機"));
    await choose(made.id, ["rirekisho"]);
    const [copy] = ((await (await move(made.id, "applied")).json()) as Detail).sentCopies;
    const url = `/api/applications/${made.id}/sent-copies/${copy!.id}`;
    const current = await client.json<CopyPage>(url);
    const { sheet: _sheet, ...text } = current.page;
    await app.db.update(applicationSentCopies).set({ page: text, file: Buffer.from("unreadable") }).where(eq(applicationSentCopies.id, copy!.id));

    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await client.get(url);
      expect(response.status).toBe(200);
      const legacy = (await response.json()) as CopyPage;
      expect(legacy.page).toMatchObject({ readFailure: "original_file_unreadable", sections: text.sections });
      expect(legacy.page.sheet).toBeUndefined();
      expect(log).toHaveBeenCalledOnce();
      expect(JSON.parse(log.mock.calls[0]![0] as string)).toEqual({
        event: "sent_copy_sheet_unreadable", userId: user.id, copyId: copy!.id, errorKind: "Error",
      });
    } finally {
      log.mockRestore();
    }
  });

  it("keeps the name it was sent under when the company is corrected later", async () => {
    const made = await add();
    const stored = (await (await client.post(`/api/applications/${made.id}/tailored-resume`)).json()) as Detail;
    await accept(stored.documents[0]!.ref, resumeContent("Ran telemetry ingestion for tide gauges."));
    await move(made.id, "applied");

    await client.patch(`/api/applications/${made.id}`, { company: "Harrowgate Signals Ltd" });
    const after = await read(made.id);
    expect(after.documents[0]!.title).toBe("Tailored résumé for Harrowgate Signals Ltd");
    expect(after.sentCopies[0]!.title).toBe("Tailored résumé for Harrowgate Signals");
  });

  it("is served as a .docx under the name it had, and has no route that changes it", async () => {
    await accept("english_resume", resumeContent("Cut the nightly run to 90 minutes."));
    const made = await add();
    await choose(made.id, ["english_resume"]);
    const [copy] = ((await (await move(made.id, "applied")).json()) as Detail).sentCopies;
    const path = `/api/applications/${made.id}/sent-copies/${copy!.id}`;

    const response = await client.get(`${path}/download`);
    expect(response.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(response.headers.get("content-disposition")).toMatch(/attachment; filename="Yosuke-Aoki-Resume-\d{4}-\d{2}\.docx"/);

    for (const method of ["PUT", "PATCH", "DELETE", "POST"]) {
      expect((await client.request(path, { method, body: "{}", headers: { "content-type": "application/json" } })).status).toBe(404);
    }
    expect((await read(made.id)).sentCopies).toHaveLength(1);
  });

  it("follows a correction of the Applied date when that move froze it", async () => {
    await accept("english_resume", resumeContent("Cut the nightly run to 90 minutes."));
    const made = await add();
    await choose(made.id, ["english_resume"]);
    vi.setSystemTime(dayAfter(6));
    await move(made.id, "applied");

    // Applied was noted late: it really happened three days earlier.
    const corrected = (await (await client.patch(`/api/applications/${made.id}/steps/applied`, { date: dateAfter(3) })).json()) as Detail;
    expect(corrected.sentCopies.map((copy) => copy.sentOn)).toEqual([dateAfter(3)]);
    // And again: the copy still follows the date that move saved.
    const twice = (await (await client.patch(`/api/applications/${made.id}/steps/applied`, { date: dateAfter(4) })).json()) as Detail;
    expect(twice.sentCopies.map((copy) => copy.sentOn)).toEqual([dateAfter(4)]);
  });
});

describe("moving back, and undoing", () => {
  const applied = async () => {
    await accept("english_resume", resumeContent("Cut the nightly run to 90 minutes."));
    const made = await add();
    await choose(made.id, ["english_resume"]);
    const before = await read(made.id);
    const after = (await (await move(made.id, "applied")).json()) as Detail;
    return { made, before, after };
  };

  it("keeps the sent copies when the status is moved back, and does not freeze the same document again", async () => {
    const { made, after } = await applied();

    vi.setSystemTime(dayAfter(2));
    const back = (await (await move(made.id, "not_applied")).json()) as Detail;
    expect(back.step).toBe("not_applied");
    expect(back.sentCopies.map((copy) => copy.id)).toEqual(after.sentCopies.map((copy) => copy.id));

    vi.setSystemTime(dayAfter(4));
    const again = (await (await move(made.id, "applied")).json()) as Detail;
    expect(again.frozen).toEqual([]);
    expect(again.sentCopies).toHaveLength(1);
    // The copy was frozen by the earlier move, so the new Applied date is not its date.
    const corrected = (await (await client.patch(`/api/applications/${made.id}/steps/applied`, { date: dateAfter(3) })).json()) as Detail;
    expect(corrected.sentCopies.map((copy) => copy.sentOn)).toEqual([dateAfter(0)]);
  });

  it("freezes a newly attached document when Undo restores Applied", async () => {
    const { made, after } = await applied();
    await move(made.id, "not_applied");
    await accept("shokumu_keirekisho", content("夜間バッチを短縮。"));
    await choose(made.id, ["english_resume", "shokumu_keirekisho"]);

    vi.setSystemTime(dayAfter(2));
    const response = await client.put(`/api/applications/${made.id}/standing`, {
      step: after.step,
      closedAs: null,
      dates: after.dates,
    });
    expect(response.status).toBe(200);
    const restored = (await response.json()) as Detail;
    expect(restored.step).toBe("applied");
    expect(restored.frozen).toEqual([{ title: "職務経歴書", versionNo: 1 }]);
    expect(restored.sentCopies.map((copy) => [copy.title, copy.sentOn])).toEqual([
      ["職務経歴書", after.dates.applied],
      ["Main résumé", after.dates.applied],
    ]);
    expect(restored.sentCopies.find((copy) => copy.title === "Main résumé")?.id).toBe(after.sentCopies[0]!.id);
  });

  it("freezes a newly attached document when Undo restores a step later than Applied", async () => {
    const { made } = await applied();
    const passed = (await (await move(made.id, "resume_passed")).json()) as Detail;
    await move(made.id, "not_applied");
    await accept("shokumu_keirekisho", content("夜間バッチを短縮。"));
    await choose(made.id, ["english_resume", "shokumu_keirekisho"]);

    vi.setSystemTime(dayAfter(2));
    const response = await client.put(`/api/applications/${made.id}/standing`, {
      step: passed.step,
      closedAs: null,
      dates: passed.dates,
    });
    expect(response.status).toBe(200);
    const restored = (await response.json()) as Detail;
    expect(restored.step).toBe("resume_passed");
    expect(restored.frozen).toEqual([{ title: "職務経歴書", versionNo: 1 }]);
    expect(restored.sentCopies.map((copy) => [copy.title, copy.sentOn])).toEqual([
      ["職務経歴書", passed.dates.resume_passed],
      ["Main résumé", passed.dates.applied],
    ]);
    expect(restored.sentCopies.find((copy) => copy.title === "Main résumé")?.id).toBe(passed.sentCopies[0]!.id);
  });

  it("freezes nothing when a move or an Undo arrives at Applied from a later step", async () => {
    const { made, after } = await applied();
    const stored = (await (await client.post(`/api/applications/${made.id}/tailored-resume`)).json()) as Detail;
    await accept(stored.documents.find((document) => document.title.startsWith("Tailored"))!.ref, resumeContent("Ran telemetry ingestion for tide gauges."));

    const passed = (await (await move(made.id, "resume_passed")).json()) as Detail;
    expect(passed.frozen).toEqual([]);
    const undone = (await (await client.put(`/api/applications/${made.id}/standing`, { step: after.step, closedAs: null, dates: after.dates })).json()) as Detail;
    expect(undone.step).toBe("applied");
    expect(undone.frozen).toEqual([]);

    await move(made.id, "resume_passed");
    const back = (await (await move(made.id, "applied")).json()) as Detail;
    expect(back.frozen).toEqual([]);
    expect(back.sentCopies.map((copy) => copy.id)).toEqual(after.sentCopies.map((copy) => copy.id));
    expect(back.documents).toHaveLength(2);
  });

  it("takes back the copies a move froze when that move is undone, and freezes them again on the next move", async () => {
    const { made, before, after } = await applied();
    expect(after.sentCopies).toHaveLength(1);

    const undone = await client.put(`/api/applications/${made.id}/standing`, { step: before.step, closedAs: null, dates: before.dates });
    expect(undone.status).toBe(200);
    const body = (await undone.json()) as Detail;
    expect(body.step).toBe("not_applied");
    expect(body.sentCopies).toEqual([]);
    expect(body.documents).toHaveLength(1);
    expect(await listed(made.id)).toEqual({ documents: [{ title: "Main résumé", versionNo: 1 }], sent: false });
    // The copy is gone from every read, its own included.
    expect((await client.get(`/api/applications/${made.id}/sent-copies/${after.sentCopies[0]!.id}`)).status).toBe(404);
    expect((await client.get(`/api/applications/${made.id}/sent-copies/${after.sentCopies[0]!.id}/download`)).status).toBe(404);

    const again = (await (await move(made.id, "applied")).json()) as Detail;
    expect(again.frozen).toEqual([{ title: "Main résumé", versionNo: 1 }]);
    expect(again.sentCopies).toHaveLength(1);

    // A backup holds what the database holds: the undone copy too, and no bytes.
    const backup = await client.json<{
      applicationDocuments: { applicationId: string }[];
      applicationSentCopies: Record<string, unknown>[];
    }>("/api/export");
    expect(backup.applicationDocuments.filter((row) => row.applicationId === made.id)).toHaveLength(1);
    const copies = backup.applicationSentCopies.filter((row) => row.applicationId === made.id);
    expect(copies.map((row) => row.undoneAt === null)).toEqual(expect.arrayContaining([true, false]));
    expect(copies).toHaveLength(2);
    for (const copy of copies) {
      expect(copy).not.toHaveProperty("file");
      expect(copy).not.toHaveProperty("userId");
      expect(copy.page).toBeTruthy();
    }
  });

  it("undoes the move after its date was corrected, and leaves a copy recorded by hand", async () => {
    await accept("shokumu_keirekisho", content("夜間バッチを短縮。"));
    const { made, before } = await applied();
    await client.patch(`/api/applications/${made.id}/steps/applied`, { date: dateAfter(-2) });
    await record(made.id, ["shokumu_keirekisho"]);

    const undone = (await (await client.put(`/api/applications/${made.id}/standing`, { step: before.step, closedAs: null, dates: before.dates })).json()) as Detail;
    expect(undone.sentCopies.map((copy) => copy.title)).toEqual(["職務経歴書"]);
  });
});

describe("recording another sent copy", () => {
  it("is refused before Applied, where the move does the freezing", async () => {
    await accept("english_resume", resumeContent("Cut the nightly run to 90 minutes."));
    const made = await add();
    const refused = await record(made.id, ["english_resume"]);
    expect(refused.status).toBe(409);
    expect((await read(made.id)).sentCopies).toEqual([]);
  });

  it("freezes each ticked document again, always, and the latest is the one most recently recorded", async () => {
    await accept("english_resume", resumeContent("Cut the nightly run to 90 minutes."));
    const made = await add();
    await choose(made.id, ["english_resume"]);
    await move(made.id, "applied");

    // The same document, unchanged, sent again a week later: a second copy, with the same version.
    vi.setSystemTime(dayAfter(7));
    const second = await record(made.id, ["english_resume"]);
    expect(second.status).toBe(201);
    const body = (await second.json()) as Detail;
    expect(body.frozen).toEqual([{ title: "Main résumé", versionNo: 1 }]);
    expect(body.sentCopies.map((copy) => [copy.versionNo, copy.sentOn])).toEqual([
      [1, dateAfter(7)],
      [1, dateAfter(0)],
    ]);
    expect(body.lastActivityAt).toBe(dayAfter(7).toISOString());

    // A newer version, sent later still. The list names it; the page keeps all three.
    vi.setSystemTime(dayAfter(9));
    await accept("english_resume", resumeContent("Rebuilt the settlement run on a streaming platform."));
    const third = (await (await record(made.id, ["english_resume"])).json()) as Detail;
    expect(third.sentCopies.map((copy) => copy.versionNo)).toEqual([2, 1, 1]);
    expect(await listed(made.id)).toEqual({ documents: [{ title: "Main résumé", versionNo: 2 }], sent: true });
    expect(textOf(await fileOf(made.id, third.sentCopies[2]!.id))).toContain("Cut the nightly run to 90 minutes.");
    expect(textOf(await fileOf(made.id, third.sentCopies[0]!.id))).toContain("Rebuilt the settlement run on a streaming platform.");
  });

  it("takes a document that was not on the application, and a tailored résumé made after Applied", async () => {
    await accept("shokumu_keirekisho", content("夜間バッチを短縮。"));
    const made = await add();
    await move(made.id, "applied");
    expect((await read(made.id)).documents).toEqual([]);

    const stored = (await (await client.post(`/api/applications/${made.id}/tailored-resume`)).json()) as Detail;
    const tailored = stored.documents[0]!.ref;
    await accept(tailored, resumeContent("Ran telemetry ingestion for tide gauges."));

    const recorded = (await (await record(made.id, [tailored, "shokumu_keirekisho"])).json()) as Detail;
    expect(recorded.frozen).toEqual([
      { title: "Tailored résumé for Harrowgate Signals", versionNo: 1 },
      { title: "職務経歴書", versionNo: 1 },
    ]);
    expect(recorded.documents.map((document) => document.title)).toEqual(["Tailored résumé for Harrowgate Signals", "職務経歴書"]);
    expect(recorded.sentCopies).toHaveLength(2);

    // The list names what was sent in document order, whichever was recorded last.
    vi.setSystemTime(dayAfter(1));
    await record(made.id, [tailored]);
    await accept("english_resume", resumeContent("Cut the nightly run to 90 minutes."));
    vi.setSystemTime(dayAfter(2));
    await record(made.id, ["english_resume"]);
    expect((await listed(made.id)).documents.map((document) => document.title)).toEqual([
      "Tailored résumé for Harrowgate Signals",
      "Main résumé",
      "職務経歴書",
    ]);
    // From Applied onward a document is recorded, not chosen or taken off.
    expect((await choose(made.id, [])).status).toBe(409);
    expect((await client.delete(`/api/applications/${made.id}/documents/shokumu_keirekisho`)).status).toBe(409);
  });

  it("refuses a document with no version, an unknown one, and another application's résumé", async () => {
    await accept("english_resume", resumeContent("Cut the nightly run to 90 minutes."));
    const made = await add();
    await move(made.id, "applied");
    const elsewhere = await seedTailoredResume(user, "Kestrel Freight");

    expect((await record(made.id, ["rirekisho"])).status).toBe(422);
    expect((await record(made.id, [])).status).toBe(422);
    expect((await record(made.id, ["career_story_en"])).status).toBe(422);
    expect((await record(made.id, [elsewhere.id])).status).toBe(422);
    expect((await read(made.id)).sentCopies).toEqual([]);
  });
});

describe("another user's application", () => {
  it("is a 404 on every route here, and its sent copy is never served", async () => {
    await accept("english_resume", resumeContent("Cut the nightly run to 90 minutes."));
    const made = await add();
    await choose(made.id, ["english_resume"]);
    const [copy] = ((await (await move(made.id, "applied")).json()) as Detail).sentCopies;
    const mine = await add();

    const other = app.as(await seedAllowedUser(SECOND_EMAIL));
    const theirs = await add(other);

    for (const response of [
      await choose(made.id, [], other),
      await other.delete(`/api/applications/${made.id}/documents/english_resume`),
      await other.post(`/api/applications/${made.id}/tailored-resume`),
      await record(made.id, ["english_resume"], other),
      await other.get(`/api/applications/${made.id}/sent-copies/${copy!.id}`),
      await other.get(`/api/applications/${made.id}/sent-copies/${copy!.id}/download`),
      // Their own application does not open somebody else's copy either.
      await other.get(`/api/applications/${theirs.id}/sent-copies/${copy!.id}`),
      await other.get(`/api/applications/${theirs.id}/sent-copies/${copy!.id}/download`),
      // Nor does another of the owner's applications.
      await client.get(`/api/applications/${mine.id}/sent-copies/${copy!.id}`),
      await client.get(`/api/applications/${mine.id}/sent-copies/${copy!.id}/download`),
    ]) {
      expect(response.status).toBe(404);
    }
    expect((await read(made.id)).sentCopies).toHaveLength(1);
    expect((await listed(theirs.id, other)).documents).toEqual([]);
  });
});
