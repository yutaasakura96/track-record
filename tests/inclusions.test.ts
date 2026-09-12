/**
 * Per-render inclusion (S13, `docs/02` §4).
 *
 * The three acceptance lines, observed where they matter: what generation is
 * given, what the record still holds, and what the 履歴書 says about the gap an
 * exclusion opens. Every entry here is INVENTED.
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { harness, settle, stubModel, type Client, type StubModel } from "./helpers/harness";
import {
  EDUCATION_FIXTURE,
  EMPLOYER_FIXTURE,
  PROFILE_FIXTURE,
  seedAllowedUser,
  uploadForm,
} from "./helpers/seed";
import { createDb } from "~/server/db/client";
import { collectRirekishoRecord } from "~/server/services/rirekisho";
import type { Bindings } from "~/server/env";
import type { RenderContent, RenderKind } from "~/shared/render-content";

/** Fills the stretch between the education fixture and the employer fixture, so no gap exists until it is left out. */
const EARLIER_EMPLOYER = {
  ...EMPLOYER_FIXTURE,
  nameJa: "株式会社カワセミ精機",
  nameLatin: "Kawasemi Seiki K.K.",
  startedOn: "2017-04-01",
  endedOn: "2022-03-01",
};

const LATER_QUOTE = "Nightly batch runtime fell from 6 hours to 90 minutes.";
const EARLIER_QUOTE = "The depot scanner app shipped to all eleven sites.";
const PROJECT_QUOTE = "The weekend route planner cut a planning session to ten minutes.";

let model: StubModel;
let client: Client;
let userId: string;

beforeEach(async () => {
  model = stubModel();
  const user = await seedAllowedUser();
  userId = user.id;
  client = harness(model).as(user);
  await client.put("/api/profile", PROFILE_FIXTURE);
});

async function created(path: string, body: unknown) {
  return (await (await client.post(path, body)).json()) as { id: string };
}

/** Imports one document and accepts every fact it yields as Measured and Public. */
async function acceptedFacts(
  text: string,
  candidates: { claim: string; quote: string }[],
  projectId?: string,
) {
  model.extractions = [candidates.map((c) => ({ ...c, technologies: [] }))];
  const form = uploadForm(text, `${candidates[0]!.claim.slice(0, 8)}.md`);
  if (projectId) form.set("projectId", projectId);
  const imported = (await (
    await client.request("/api/imports", { method: "POST", body: form })
  ).json()) as { importId: string };
  await settle();

  const { items } = await client.json<{ items: { id: string; claim: string }[] }>(
    `/api/facts?importId=${imported.importId}`,
  );
  for (const fact of items) {
    await client.patch(`/api/facts/${fact.id}`, { provenance: "measured", disclosure: "public" });
    await client.post(`/api/facts/${fact.id}/accept`);
  }
  return (fragment: string) => items.find((f) => f.claim.includes(fragment))!;
}

async function seedRecord() {
  const later = await created("/api/employers", EMPLOYER_FIXTURE);
  const earlier = await created("/api/employers", EARLIER_EMPLOYER);
  const education = await created("/api/educations", EDUCATION_FIXTURE);

  const fact = await acceptedFacts([LATER_QUOTE, EARLIER_QUOTE].join("\n\n"), [
    { claim: "Cut nightly batch runtime to 90 minutes", quote: LATER_QUOTE },
    { claim: "Shipped the depot scanner app to eleven sites", quote: EARLIER_QUOTE },
  ]);
  const laterFact = fact("nightly batch");
  const earlierFact = fact("depot scanner");
  await client.patch(`/api/facts/${laterFact.id}`, { employerId: later.id });
  await client.patch(`/api/facts/${earlierFact.id}`, { employerId: earlier.id });

  return { later, earlier, education, laterFact, earlierFact };
}

const setInclusion = (entityType: string, entityId: string, kind: RenderKind, included: boolean) =>
  client.put("/api/render-inclusions", { entityType, entityId, kind, included });

const EMPTY_RESUME: RenderContent = {
  sections: [
    { key: "experience", heading: "Experience", blocks: [{ id: "blk_1", kind: "bullet", text: "A bullet", factIds: [] }] },
  ],
};

async function generate(kind: RenderKind, content: RenderContent = EMPTY_RESUME) {
  model.generations = [content];
  const response = await client.post(`/api/renders/${kind}/generate`);
  await settle();
  const body = (await response.json()) as { proposalId: string; warnings: string[] };
  // Dismissed at once, so a second generation in the same test is not a second
  // proposal waiting on the same render.
  await client.post(`/api/proposals/${body.proposalId}/dismiss`);
  return { sent: model.generationInputs.at(-1)!, warnings: body.warnings };
}

describe("an entry left out of a render", () => {
  it("never reaches that render's payload, and neither does any fact filed under it", async () => {
    const record = await seedRecord();
    expect((await setInclusion("employer", record.earlier.id, "english_resume", false)).status).toBe(200);

    const { sent } = await generate("english_resume");
    expect(sent.spec.employers.map((e) => e.id)).toEqual([record.later.id]);
    expect(sent.facts.map((f) => f.id)).toEqual([record.laterFact.id]);
    expect(JSON.stringify(sent)).not.toContain("depot scanner");
  });

  it("still reaches every other render, and the 履歴書 takes everything by default", async () => {
    const record = await seedRecord();
    await setInclusion("employer", record.earlier.id, "english_resume", false);

    const { sent } = await generate("rirekisho");
    expect(sent.spec.employers.map((e) => e.id)).toContain(record.earlier.id);
    expect(sent.facts.map((f) => f.id)).toContain(record.earlierFact.id);
  });

  it("is neither deleted nor hidden from the record", async () => {
    const record = await seedRecord();
    await setInclusion("employer", record.earlier.id, "english_resume", false);

    const employers = await client.json<{ items: { id: string }[] }>("/api/employers");
    expect(employers.items.map((e) => e.id)).toContain(record.earlier.id);
    const facts = await client.json<{ items: { id: string; status: string }[] }>("/api/facts");
    expect(facts.items.find((f) => f.id === record.earlierFact.id)!.status).toBe("accepted");
  });

  it("comes back when it is included again", async () => {
    const record = await seedRecord();
    await setInclusion("employer", record.earlier.id, "english_resume", false);
    await setInclusion("employer", record.earlier.id, "english_resume", true);

    const { sent } = await generate("english_resume");
    expect(sent.spec.employers.map((e) => e.id)).toContain(record.earlier.id);
    expect(sent.facts.map((f) => f.id)).toContain(record.earlierFact.id);
  });

  it("takes a project's facts with it, and plans no chapter for work outside employment", async () => {
    await seedRecord();
    const project = await created("/api/projects", { name: "Weekend route planner" });
    const fact = await acceptedFacts(
      PROJECT_QUOTE,
      [{ claim: "Built a weekend route planner", quote: PROJECT_QUOTE }],
      project.id,
    );
    await setInclusion("project", project.id, "career_story_en", false);

    const { sent } = await generate("english_resume");
    expect(sent.facts.map((f) => f.id)).toContain(fact("route planner").id);

    model.generations = [];
    await client.post("/api/renders/career_story_en/generate");
    await settle();
    const story = model.generationInputs.at(-1)!;
    expect(story.spec.projects).toEqual([]);
    expect(story.facts.map((f) => f.id)).not.toContain(fact("route planner").id);
    expect(story.spec.workOutsideEmployment).toBe(false);
  });

  it("takes the projects of an excluded employer with it", async () => {
    const record = await seedRecord();
    const project = await created("/api/projects", { name: "Depot rollout", employerId: record.earlier.id });
    await setInclusion("employer", record.earlier.id, "english_resume", false);

    const { sent } = await generate("english_resume");
    expect(sent.spec.projects.map((p) => p.id)).not.toContain(project.id);
  });

  it("leaves an education out", async () => {
    const record = await seedRecord();
    await setInclusion("education", record.education.id, "english_resume", false);

    const { sent } = await generate("english_resume");
    expect(sent.spec.educations).toEqual([]);
  });
});

describe("the 履歴書", () => {
  it("warns about the gap an exclusion opens, and never blocks", async () => {
    const record = await seedRecord();
    const before = await generate("rirekisho", {
      sections: [{ key: "motivation", heading: "志望動機", blocks: [] }],
    });
    expect(before.warnings.some((w) => w.includes("2017-03"))).toBe(false);

    await setInclusion("employer", record.earlier.id, "rirekisho", false);
    const after = await generate("rirekisho", {
      sections: [{ key: "motivation", heading: "志望動機", blocks: [] }],
    });
    expect(after.warnings.some((w) => w.includes("2017-03") && w.includes("2022-04"))).toBe(true);
  });

  it("builds its tables from what it includes", async () => {
    const record = await seedRecord();
    await setInclusion("employer", record.earlier.id, "rirekisho", false);
    await setInclusion("education", record.education.id, "rirekisho", false);
    // Left out of a different render, which must not reach this one.
    await setInclusion("employer", record.later.id, "english_resume", false);

    const tables = await collectRirekishoRecord(createDb((env as unknown as Bindings).DATABASE_URL), userId);
    expect(tables.employers.map((e) => e.nameJa)).toEqual([EMPLOYER_FIXTURE.nameJa]);
    expect(tables.educations).toEqual([]);
  });
});

describe("the setting", () => {
  it("is stored only where it departs from the default", async () => {
    const record = await seedRecord();
    expect((await client.json<{ items: unknown[] }>("/api/render-inclusions")).items).toEqual([]);

    await setInclusion("employer", record.earlier.id, "shokumu_keirekisho", false);
    expect((await client.json<{ items: unknown[] }>("/api/render-inclusions")).items).toEqual([
      { entityType: "employer", entityId: record.earlier.id, kind: "shokumu_keirekisho", included: false },
    ]);
  });

  it("refuses an entry type S13 does not name", async () => {
    const record = await seedRecord();
    const response = await setInclusion("certification", record.earlier.id, "english_resume", false);
    expect(response.status).toBe(422);
  });

  it("refuses an entry that does not exist, naming no other table's row", async () => {
    const record = await seedRecord();
    // An employer's id offered as an education: the type is checked against its own table.
    const response = await setInclusion("education", record.earlier.id, "english_resume", false);
    expect(response.status).toBe(404);
  });
});
