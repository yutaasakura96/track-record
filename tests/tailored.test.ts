/**
 * Tailored résumés, through the API (`docs/07` §7, issue #57).
 *
 * A tailored résumé is a document of its own, written toward one job
 * description from the same facts the main résumé is written from. What is
 * pinned here: it is given no fact the main résumé is not given, it is a
 * proposal read as a diff like every other document, and it is addressed by its
 * own id so that it and the main résumé never serve each other's versions.
 * Every entry here is INVENTED.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { harness, settle, stubModel, type Client, type Harness, type StubModel } from "./helpers/harness";
import { EMPLOYER_FIXTURE, PROFILE_FIXTURE, SECOND_EMAIL, seedAllowedUser, uploadForm } from "./helpers/seed";
import type { CandidateFact } from "~/model/types";
import type { RenderContent } from "~/shared/render-content";

interface Tailored {
  id: string;
  ref: string;
  kind: string;
  status: string;
  currentVersionNo: number | null;
  tailored: { label: string; createdAt: string } | null;
}

const POSTING = "Platform engineer. You will run the batch platform for a logistics marketplace.";

const USABLE: CandidateFact = {
  claim: "Cut the nightly settlement run from 6 hours to 90 minutes",
  quote: "The nightly settlement run fell from 6 hours to 90 minutes.",
  technologies: ["Airflow"],
  provenance: "measured",
};
const PRIVATE: CandidateFact = {
  claim: "Rebuilt the settlement ledger for the retail client",
  quote: "The retail client's settlement ledger was rebuilt over one quarter.",
  technologies: [],
  provenance: "attested",
  confidential: true,
};
const GENERATED: CandidateFact = {
  claim: "Improved the team's delivery confidence",
  quote: "Releases felt calmer by the end of the year.",
  technologies: [],
  provenance: "generated",
};

let model: StubModel;
let app: Harness;
let client: Client;

beforeEach(async () => {
  model = stubModel();
  app = harness(model);
  client = app.as(await seedAllowedUser());
});

/** A profile, an employer and three facts, of which one may be used. */
async function seedRecord(as: Client = client) {
  await as.put("/api/profile", PROFILE_FIXTURE);
  await as.post("/api/employers", EMPLOYER_FIXTURE);
  model.extractions = [[USABLE, PRIVATE, GENERATED]];
  const text = `# Notes\n\n${[USABLE, PRIVATE, GENERATED].map((c) => c.quote).join("\n\n")}\n`;
  await as.request("/api/imports", { method: "POST", body: uploadForm(text) });
  await settle();
  const { items } = await as.json<{ items: { id: string; claim: string }[] }>("/api/facts");
  return { usable: items.find((f) => f.claim === USABLE.claim)! };
}

const create = async (label = "Kestrel, platform engineer", jobDescription = POSTING, as: Client = client) =>
  as.post("/api/tailored-resumes", { label, jobDescription });
const createdRow = async (label?: string, jobDescription?: string, as: Client = client) =>
  (await (await create(label, jobDescription, as)).json()) as Tailored;
const list = (as: Client = client) => as.json<{ items: Tailored[]; canGenerate: boolean }>("/api/tailored-resumes");

function resumeFrom(text: string, factIds: string[]): RenderContent {
  return {
    sections: [
      { key: "experience", heading: "Experience", blocks: [{ id: "blk_1", kind: "bullet", text, factIds }] },
    ],
  };
}

async function generate(ref: string, content: RenderContent = { sections: [] }, as: Client = client) {
  model.generations = [content];
  const response = await as.post(`/api/renders/${ref}/generate`);
  await settle();
  return response;
}

describe("creating a tailored résumé", () => {
  it("stores the name and the job description, and generates nothing", async () => {
    await seedRecord();
    const response = await create();
    expect(response.status).toBe(201);
    const row = (await response.json()) as Tailored;

    expect(row).toMatchObject({
      kind: "english_resume",
      status: "never_generated",
      currentVersionNo: null,
      tailored: { label: "Kestrel, platform engineer" },
    });
    // Addressed by its own id, never by its kind.
    expect(row.ref).toBe(row.id);
    expect(model.generationInputs).toEqual([]);

    const one = await client.json<Tailored & { jobDescription: string }>(`/api/tailored-resumes/${row.id}`);
    expect(one.jobDescription).toBe(POSTING);
  });

  it("allows any number of them, newest first, with the job description out of the listing", async () => {
    await seedRecord();
    const first = await createdRow("Kestrel, platform engineer");
    const second = await createdRow("Plinth, backend engineer", "Backend engineer for a tide-table service.");
    const third = await createdRow("Kestrel, platform engineer");

    const body = await list();
    expect(body.items.map((row) => row.id).sort()).toEqual([first.id, second.id, third.id].sort());
    expect(body.canGenerate).toBe(true);
    expect(JSON.stringify(body)).not.toContain("logistics marketplace");
  });

  it("leaves the five main documents as they were", async () => {
    await seedRecord();
    await createdRow();
    const { items } = await client.json<{ items: { kind: string; status: string; tailored: unknown }[] }>("/api/renders");

    expect(items).toHaveLength(5);
    expect(items.every((row) => row.tailored === null && row.status === "never_generated")).toBe(true);
  });

  it("refuses one with no name or no job description, and says which", async () => {
    const unnamed = await client.post("/api/tailored-resumes", { label: "  ", jobDescription: POSTING });
    expect(unnamed.status).toBe(422);
    expect(JSON.stringify(await unnamed.json())).toContain("Name this résumé");

    const empty = await client.post("/api/tailored-resumes", { label: "Kestrel", jobDescription: "" });
    expect(empty.status).toBe(422);
    expect(JSON.stringify(await empty.json())).toContain("Paste the job description");

    const tooLong = await client.post("/api/tailored-resumes", { label: "Kestrel", jobDescription: "a".repeat(20_001) });
    expect(tooLong.status).toBe(422);
    expect((await list()).items).toEqual([]);
  });

  it("refuses a kind that cannot be tailored", async () => {
    const response = await client.post("/api/tailored-resumes", { label: "Kestrel", jobDescription: POSTING, kind: "rirekisho" });
    expect(response.status).toBe(422);
  });

  it("says there is nothing to generate from while no fact is usable", async () => {
    await client.put("/api/profile", PROFILE_FIXTURE);
    const row = await createdRow();
    expect((await list()).canGenerate).toBe(false);
    expect((await generate(row.id)).status).toBe(428);
  });
});

describe("generating a tailored résumé", () => {
  it("gives the model the job description and exactly the facts the main résumé is given", async () => {
    await seedRecord();
    const row = await createdRow();

    const response = await generate(row.id);
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ renderKind: "english_resume", renderRef: row.id, status: "generating" });
    const tailored = model.generationInputs.at(-1)!;
    expect(tailored.spec.jobDescription).toBe(POSTING);
    // Never a Private fact and never a Generated one, whatever the job asks for.
    expect(tailored.facts.map((fact) => fact.claim)).toEqual([USABLE.claim]);

    await generate("english_resume");
    const main = model.generationInputs.at(-1)!;
    expect(main.spec.jobDescription).toBeNull();
    expect(main.facts).toEqual(tailored.facts);
    expect({ ...main.spec, jobDescription: POSTING }).toEqual(tailored.spec);
  });

  it("is a proposal, read as a diff and accepted, like every other document", async () => {
    const { usable } = await seedRecord();
    const row = await createdRow();
    const { proposalId } = (await (
      await generate(row.id, resumeFrom("Cut the nightly settlement run to 90 minutes.", [usable.id]))
    ).json()) as { proposalId: string };

    expect((await list()).items[0]).toMatchObject({ status: "proposal_pending", currentVersionNo: null });
    const proposal = await client.json<{ title: string; renderRef: string }>(`/api/proposals/${proposalId}`);
    expect(proposal).toMatchObject({ title: "Résumé for Kestrel, platform engineer", renderRef: row.id });
    expect((await client.get(`/api/proposals/${proposalId}/diff`)).status).toBe(200);

    expect((await client.post(`/api/proposals/${proposalId}/accept`)).status).toBe(200);
    expect((await list()).items[0]).toMatchObject({ status: "up_to_date", currentVersionNo: 1 });
  });

  it("refuses a second proposal while one waits, and holds only its own document", async () => {
    await seedRecord();
    const row = await createdRow();
    const other = await createdRow("Plinth, backend engineer");
    await generate(row.id, resumeFrom("One.", []));

    expect((await generate(row.id)).status).toBe(409);
    // A waiting proposal on one résumé does not hold another, nor the main one.
    expect((await generate(other.id)).status).toBe(202);
    expect((await generate("english_resume")).status).toBe(202);
  });

  it("keeps its versions apart from the main résumé's, on every route that reads one", async () => {
    const { usable } = await seedRecord();
    const row = await createdRow();
    const accept = async (ref: string, text: string) => {
      const { proposalId } = (await (await generate(ref, resumeFrom(text, [usable.id]))).json()) as { proposalId: string };
      await client.post(`/api/proposals/${proposalId}/accept`);
    };
    await accept(row.id, "Tailored bullet about the batch platform.");
    await accept("english_resume", "Main bullet about the settlement run.");

    const versionsOf = async (ref: string) =>
      (await client.json<{ items: { id: string; versionNo: number }[] }>(`/api/renders/${ref}/versions`)).items;
    const [tailoredVersion] = await versionsOf(row.id);
    const [mainVersion] = await versionsOf("english_resume");
    expect(tailoredVersion!.versionNo).toBe(1);
    expect(mainVersion!.versionNo).toBe(1);
    expect(tailoredVersion!.id).not.toBe(mainVersion!.id);

    const tailoredFile = await client.get(`/api/renders/${row.id}/download?format=md`);
    expect(await tailoredFile.text()).toContain("Tailored bullet about the batch platform.");
    expect(tailoredFile.headers.get("content-disposition")).toMatch(
      /filename="resume-kestrel-platform-engineer-\d{4}-\d{2}-\d{2}\.md"/,
    );
    const mainFile = await client.get("/api/renders/english_resume/download?format=md");
    expect(await mainFile.text()).toContain("Main bullet about the settlement run.");
    expect(mainFile.headers.get("content-disposition")).toMatch(/filename="resume-\d{4}-\d{2}-\d{2}\.md"/);

    // Neither document serves the other's version.
    expect((await client.get(`/api/renders/${row.id}/versions/${mainVersion!.id}`)).status).toBe(404);
    expect((await client.get(`/api/renders/english_resume/versions/${tailoredVersion!.id}`)).status).toBe(404);
    expect((await client.get(`/api/renders/${row.id}/download?format=md&versionId=${mainVersion!.id}`)).status).toBe(404);
    expect(
      (await client.get(`/api/renders/english_resume/download?format=md&versionId=${tailoredVersion!.id}`)).status,
    ).toBe(404);
  });

  it("withholds the file once a fact it cites is made Private, as the main résumé's is", async () => {
    const { usable } = await seedRecord();
    const row = await createdRow();
    const { proposalId } = (await (
      await generate(row.id, resumeFrom("Cut the nightly settlement run to 90 minutes.", [usable.id]))
    ).json()) as { proposalId: string };
    await client.post(`/api/proposals/${proposalId}/accept`);
    expect((await client.get(`/api/renders/${row.id}/download?format=md`)).status).toBe(200);

    await client.patch(`/api/facts/${usable.id}`, { disclosure: "private" });
    expect((await client.get(`/api/renders/${row.id}/download?format=md`)).status).toBe(409);
  });
});

describe("another user's tailored résumé", () => {
  it("is not listed, and is a 404 on every route addressed by its id", async () => {
    await seedRecord();
    const mine = await createdRow();
    const other = app.as(await seedAllowedUser(SECOND_EMAIL));
    await seedRecord(other);

    expect((await list(other)).items).toEqual([]);
    expect((await other.get(`/api/tailored-resumes/${mine.id}`)).status).toBe(404);
    for (const [method, path] of [
      ["POST", `/api/renders/${mine.id}/generate`],
      ["GET", `/api/renders/${mine.id}/versions`],
      ["GET", `/api/renders/${mine.id}/diff`],
      ["GET", `/api/renders/${mine.id}/download`],
      ["POST", `/api/renders/${mine.id}/versions`],
    ] as const) {
      const response = await other.request(path, {
        method,
        ...(method === "POST" ? { body: "{}", headers: { "content-type": "application/json" } } : {}),
      });
      expect(response.status, `${method} ${path}`).toBe(404);
    }
    // Nothing was generated for the stranger, and nothing of mine was touched.
    expect(model.generationInputs).toEqual([]);
    expect((await list()).items[0]).toMatchObject({ id: mine.id, status: "never_generated" });
  });
});
