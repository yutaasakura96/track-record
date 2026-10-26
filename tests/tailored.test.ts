/**
 * Tailored résumés, through the API (`docs/07` §7, issue #57).
 *
 * A tailored résumé is a document of its own, written toward one job
 * description from the same facts the main résumé is written from. What is
 * pinned here: it is given no fact the main résumé is not given, it is a
 * proposal read as a diff like every other document, and it is addressed by its
 * own id so that it and the main résumé never serve each other's versions.
 *
 * Since issue #70 it lives inside an application, which is where its status is
 * read from here. The ones in these tests are seeded as migrations 0017 and
 * 0019 leave one; making one from an application is pinned in
 * `application-documents.test.ts`. Every entry here is INVENTED.
 */
import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { harness, settle, stubModel, type Client, type Harness, type SeededUser, type StubModel } from "./helpers/harness";
import { EMPLOYER_FIXTURE, PROFILE_FIXTURE, postJob, SECOND_EMAIL, seedAllowedUser, seedTailoredResume, uploadForm } from "./helpers/seed";
import { createDb } from "~/server/db/client";
import { renderVersions } from "~/server/db/schema";
import type { Bindings } from "~/server/env";
import type { CandidateFact } from "~/model/types";
import type { RenderContent } from "~/shared/render-content";
import { employerChapterKey } from "~/render/chapters";

interface Tailored {
  ref: string;
  kind: string;
  title: string;
  status: string;
  currentVersionNo: number | null;
  tailored: boolean;
}
/** A seeded résumé: its own id, which every render route takes, and its application's. */
interface Seeded {
  id: string;
  applicationId: string;
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
let user: SeededUser;
let client: Client;

beforeEach(async () => {
  model = stubModel();
  app = harness(model);
  user = await seedAllowedUser();
  client = app.as(user);
});

/** A profile, an employer and three facts, of which one may be used. */
async function seedRecord(as: Client = client) {
  await as.put("/api/profile", PROFILE_FIXTURE);
  const employerId = await postJob(as);
  model.extractions = [[USABLE, PRIVATE, GENERATED]];
  const text = `# Notes\n\n${[USABLE, PRIVATE, GENERATED].map((c) => c.quote).join("\n\n")}\n`;
  await as.request("/api/imports", { method: "POST", body: uploadForm(text) });
  await settle();
  const { items } = await as.json<{ items: { id: string; claim: string }[] }>("/api/facts");
  return { usable: items.find((f) => f.claim === USABLE.claim)!, employerId };
}

const createdRow = (label = "Kestrel, platform engineer", jobDescription = POSTING, as: SeededUser = user): Promise<Seeded> =>
  seedTailoredResume(as, label, jobDescription);
/** The résumé as its application shows it, and whether anything can be generated. */
const shown = async (row: Seeded, as: Client = client) => {
  const application = await as.json<{ documents: Tailored[]; canGenerate: boolean }>(`/api/applications/${row.applicationId}`);
  return { ...application.documents.find((document) => document.tailored)!, canGenerate: application.canGenerate };
};

function resumeFrom(text: string, factIds: string[], employerId: string): RenderContent {
  return {
    sections: [
      {
        key: "summary",
        heading: "Summary",
        blocks: [{ id: "blk_summary", kind: "paragraph", text: "Platform engineer with batch systems experience.", factIds: [] }],
      },
      {
        key: employerChapterKey(employerId),
        heading: EMPLOYER_FIXTURE.nameLatin,
        blocks: [{ id: "blk_1", kind: "bullet", text, factIds }],
      },
    ],
  };
}

async function generate(ref: string, content: RenderContent = { sections: [] }, as: Client = client) {
  model.generations = [content];
  const response = await as.post(`/api/renders/${ref}/generate`);
  await settle();
  return response;
}

describe("a tailored résumé inside its application", () => {
  it("is a document of its own, addressed by its id, with nothing generated yet", async () => {
    await seedRecord();
    const row = await createdRow();

    expect(await shown(row)).toMatchObject({
      // Addressed by its own id, never by its kind.
      ref: row.id,
      kind: "english_resume",
      status: "never_generated",
      currentVersionNo: null,
      tailored: true,
      title: "Tailored résumé for Kestrel, platform engineer",
      canGenerate: true,
    });
    expect(model.generationInputs).toEqual([]);
  });

  it("leaves the five main documents as they were", async () => {
    await seedRecord();
    await createdRow();
    const { items } = await client.json<{ items: { kind: string; status: string; tailored: unknown }[] }>("/api/renders");

    expect(items).toHaveLength(5);
    expect(items.every((row) => row.tailored === null && row.status === "never_generated")).toBe(true);
  });

  it("says there is nothing to generate from while no fact is usable", async () => {
    await client.put("/api/profile", PROFILE_FIXTURE);
    const row = await createdRow();
    expect((await shown(row)).canGenerate).toBe(false);
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
    const { usable, employerId } = await seedRecord();
    const row = await createdRow();
    const { proposalId } = (await (
      await generate(row.id, resumeFrom("Cut the nightly settlement run to 90 minutes.", [usable.id], employerId))
    ).json()) as { proposalId: string };

    expect(await shown(row)).toMatchObject({ status: "proposal_pending", currentVersionNo: null });
    const proposal = await client.json<{ title: string; renderRef: string }>(`/api/proposals/${proposalId}`);
    expect(proposal).toMatchObject({ title: "Résumé for Kestrel, platform engineer", renderRef: row.id });
    expect((await client.get(`/api/proposals/${proposalId}/diff`)).status).toBe(200);

    expect((await client.post(`/api/proposals/${proposalId}/accept`)).status).toBe(200);
    expect(await shown(row)).toMatchObject({ status: "up_to_date", currentVersionNo: 1 });
  });

  it("is not refused for a generic Experience heading, which names no employer", async () => {
    const { usable } = await seedRecord();
    const row = await createdRow();
    const { proposalId } = (await (
      await generate(row.id, {
        sections: [{
          key: "experience",
          heading: "Experience",
          blocks: [{ id: "blk_1", kind: "bullet", text: "Cut the nightly settlement run to 90 minutes.", factIds: [usable.id] }],
        }],
      })
    ).json()) as { proposalId: string };

    // One call: the English check found nothing to retry.
    expect(model.generationInputs).toHaveLength(1);
    const proposal = await client.json<{ generationStatus: string }>(`/api/proposals/${proposalId}`);
    expect(proposal.generationStatus).toBe("ready");
  });

  it("refuses a second proposal while one waits, and holds only its own document", async () => {
    const { employerId } = await seedRecord();
    const row = await createdRow();
    const other = await createdRow("Plinth, backend engineer");
    await generate(row.id, resumeFrom("One.", [], employerId));

    expect((await generate(row.id)).status).toBe(409);
    // A waiting proposal on one résumé does not hold another, nor the main one.
    expect((await generate(other.id)).status).toBe(202);
    expect((await generate("english_resume")).status).toBe(202);
  });

  it("keeps its versions apart from the main résumé's, on every route that reads one", async () => {
    const { usable, employerId } = await seedRecord();
    const row = await createdRow();
    const accept = async (ref: string, text: string) => {
      const { proposalId } = (await (await generate(ref, resumeFrom(text, [usable.id], employerId))).json()) as { proposalId: string };
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
    // The file an employer receives carries the author's name, not the
    // author's label for the job or the app's id for it (issue #107).
    expect(tailoredFile.headers.get("content-disposition")).toMatch(/filename="Yosuke-Aoki-Resume-\d{4}-\d{2}\.md"/);
    const mainFile = await client.get("/api/renders/english_resume/download?format=md");
    expect(await mainFile.text()).toContain("Main bullet about the settlement run.");
    expect(mainFile.headers.get("content-disposition")).toMatch(/filename="Yosuke-Aoki-Resume-\d{4}-\d{2}\.md"/);

    // Neither document serves the other's version.
    expect((await client.get(`/api/renders/${row.id}/versions/${mainVersion!.id}`)).status).toBe(404);
    expect((await client.get(`/api/renders/english_resume/versions/${tailoredVersion!.id}`)).status).toBe(404);
    expect((await client.get(`/api/renders/${row.id}/download?format=md&versionId=${mainVersion!.id}`)).status).toBe(404);
    expect(
      (await client.get(`/api/renders/english_resume/download?format=md&versionId=${tailoredVersion!.id}`)).status,
    ).toBe(404);
  });

  it("records the facts its version could use, and is out of date once one of them is withdrawn", async () => {
    const { usable, employerId } = await seedRecord();
    const row = await createdRow();
    const { proposalId } = (await (
      await generate(row.id, resumeFrom("Cut the nightly settlement run to 90 minutes.", [usable.id], employerId))
    ).json()) as { proposalId: string };
    await client.post(`/api/proposals/${proposalId}/accept`);

    // The set the main résumé's version records (issue #62), not the count alone.
    const [version] = await createDb((env as unknown as Bindings).DATABASE_URL)
      .select({ usableFactIds: renderVersions.usableFactIds })
      .from(renderVersions)
      .where(eq(renderVersions.renderId, row.id));
    expect(version!.usableFactIds).toEqual([usable.id]);
    expect(await shown(row)).toMatchObject({ status: "up_to_date", newFactsSince: 0, withdrawnFactsSince: 0 });

    await client.patch(`/api/facts/${usable.id}`, { disclosure: "private" });
    expect(await shown(row)).toMatchObject({ status: "stale", newFactsSince: 0, withdrawnFactsSince: 1 });
  });

  it("withholds the file once a fact it cites is made Private, as the main résumé's is", async () => {
    const { usable, employerId } = await seedRecord();
    const row = await createdRow();
    const { proposalId } = (await (
      await generate(row.id, resumeFrom("Cut the nightly settlement run to 90 minutes.", [usable.id], employerId))
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

    expect((await other.json<{ items: unknown[] }>("/api/applications")).items).toEqual([]);
    expect((await other.get(`/api/applications/${mine.applicationId}`)).status).toBe(404);
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
    expect(await shown(mine)).toMatchObject({ ref: mine.id, status: "never_generated" });
  });
});
