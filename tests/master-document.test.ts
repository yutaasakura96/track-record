/**
 * The master document, through the API (`docs/07` §9, issue #57).
 *
 * It is a view of the record, built on the read by no model and stored
 * nowhere. What is pinned here is what it is for: it holds everything accepted,
 * including the facts no résumé may use, and it holds no source text. Every
 * entry here is INVENTED.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { harness, settle, stubModel, type Client, type Harness, type StubModel } from "./helpers/harness";
import {
  asCandidates,
  CERTIFICATION_FIXTURE,
  EDUCATION_FIXTURE,
  EMPLOYER_FIXTURE,
  PROFILE_FIXTURE,
  ROLE_FIXTURE,
  SECOND_EMAIL,
  seedAllowedUser,
  uploadForm,
} from "./helpers/seed";
import type { CandidateFact } from "~/model/types";
import type { MasterDocument, MasterFact } from "~/shared/master-document";

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
  note: "It names a client's system",
};
const GENERATED: CandidateFact = {
  claim: "Improved the team's delivery confidence",
  quote: "Releases felt calmer by the end of the year.",
  technologies: [],
  provenance: "generated",
};
const REJECTED: CandidateFact = {
  claim: "Attended the weekly planning meeting",
  quote: "A planning meeting was held every week.",
  technologies: [],
  provenance: "attested",
};
const SIDE: CandidateFact = {
  claim: "Published a small command-line tool for tide tables",
  quote: "A small command-line tool for tide tables was published.",
  technologies: [],
  provenance: "attested",
};

let model: StubModel;
let app: Harness;
let client: Client;

beforeEach(async () => {
  model = stubModel();
  app = harness(model);
  client = app.as(await seedAllowedUser());
});

const created = async (path: string, body: unknown, as: Client = client) =>
  ((await (await as.post(path, body)).json()) as { id: string }).id;

async function imported(candidates: CandidateFact[], filename: string, filed: Record<string, string> = {}, as: Client = client) {
  model.extractions = [candidates];
  const form = uploadForm(`# Notes\n\n${candidates.map((c) => c.quote).join("\n\n")}\n`, filename);
  for (const [key, value] of Object.entries(filed)) form.set(key, value);
  const { importId } = (await (await as.request("/api/imports", { method: "POST", body: form })).json()) as {
    importId: string;
  };
  await settle();
  return importId;
}

/**
 * One employer with a role and a project, an education and a certification;
 * four facts under the project, one of them then rejected; and one fact that
 * belongs to no employer.
 */
async function seedRecord() {
  await client.put("/api/profile", PROFILE_FIXTURE);
  const employerId = await created("/api/employers", EMPLOYER_FIXTURE);
  await created("/api/roles", { ...ROLE_FIXTURE, employerId });
  const projectId = await created("/api/projects", { name: "Settlement batch", employerId, summary: "The nightly run." });
  await created("/api/educations", EDUCATION_FIXTURE);
  await created("/api/certifications", CERTIFICATION_FIXTURE);

  const importId = await imported([USABLE, PRIVATE, GENERATED, REJECTED], "kestrel-notes.md", { projectId });
  const { items } = await client.json<{ items: { id: string; claim: string }[] }>(`/api/facts?importId=${importId}`);
  await client.post(`/api/facts/${items.find((f) => f.claim === REJECTED.claim)!.id}/reject`);
  await imported([SIDE], "side-notes.md");
  return { employerId, projectId, importId };
}

const master = (as: Client = client) => as.json<MasterDocument>("/api/master-document");
const everyFact = (doc: MasterDocument): MasterFact[] => [
  ...doc.employers.flatMap((e) => [...e.facts, ...e.projects.flatMap((p) => p.facts)]),
  ...doc.independent.facts,
  ...doc.independent.projects.flatMap((p) => p.facts),
];

describe("the master document", () => {
  it("holds every accepted fact, the Private and the Generated with the rest, each with its labels", async () => {
    await seedRecord();
    const doc = await master();
    const byClaim = new Map(everyFact(doc).map((fact) => [fact.claim, fact]));

    expect([...byClaim.keys()].sort()).toEqual([USABLE.claim, PRIVATE.claim, GENERATED.claim, SIDE.claim].sort());
    expect(byClaim.get(USABLE.claim)).toMatchObject({ provenance: "measured", disclosure: "restricted", technologies: ["Airflow"], flags: ["number"] });
    expect(byClaim.get(PRIVATE.claim)).toMatchObject({ provenance: "attested", disclosure: "private", flags: ["confidential"] });
    expect(byClaim.get(GENERATED.claim)).toMatchObject({ provenance: "generated", disclosure: "restricted", flags: ["unsure"] });
    expect(doc.counts).toEqual({ facts: 4, usable: 2, private: 1, generated: 1, flagged: 3, waiting: 0 });
    expect(doc.subjectName).toBe(PROFILE_FIXTURE.nameLatin);
  });

  it("leaves out a rejected fact, and a fact still waiting to be sorted, and counts the second", async () => {
    const { importId } = await seedRecord();
    expect(everyFact(await master()).map((fact) => fact.claim)).not.toContain(REJECTED.claim);

    await asCandidates(importId);
    const doc = await master();
    expect(everyFact(doc).map((fact) => fact.claim)).toEqual([SIDE.claim]);
    expect(doc.counts.waiting).toBe(4);
  });

  it("files each fact under the employer it resolves to and then its project, with the roles held there", async () => {
    const { employerId, projectId, importId } = await seedRecord();
    const doc = await master();

    expect(doc.employers).toHaveLength(1);
    const [employer] = doc.employers;
    expect(employer).toMatchObject({
      id: employerId,
      name: EMPLOYER_FIXTURE.nameLatin,
      nameJa: EMPLOYER_FIXTURE.nameJa,
      startedOn: EMPLOYER_FIXTURE.startedOn,
      roles: [{ title: ROLE_FIXTURE.titleLatin, startedOn: ROLE_FIXTURE.startedOn, endedOn: ROLE_FIXTURE.endedOn }],
    });
    expect(employer!.projects).toHaveLength(1);
    expect(employer!.projects[0]).toMatchObject({ id: projectId, name: "Settlement batch", summary: "The nightly run." });
    expect(employer!.projects[0]!.facts).toHaveLength(3);
    expect(employer!.projects[0]!.facts[0]!.source).toMatchObject({ importId, filename: "kestrel-notes.md" });
    // Filed under no employer and no project.
    expect(doc.independent.facts.map((fact) => fact.claim)).toEqual([SIDE.claim]);
    expect(doc.educations).toMatchObject([{ institution: EDUCATION_FIXTURE.institution, outcome: "graduated" }]);
    expect(doc.certifications).toMatchObject([{ name: CERTIFICATION_FIXTURE.name }]);
  });

  it("lists a project with no facts rather than hiding it", async () => {
    const employerId = await created("/api/employers", EMPLOYER_FIXTURE);
    await created("/api/projects", { name: "Harbour lantern", employerId });
    await created("/api/projects", { name: "Tide tables" });

    const doc = await master();
    expect(doc.employers[0]!.projects).toMatchObject([{ name: "Harbour lantern", facts: [] }]);
    expect(doc.independent.projects).toMatchObject([{ name: "Tide tables", facts: [] }]);
  });

  it("drops a flag the author has marked checked, and keeps the fact", async () => {
    await seedRecord();
    const flags = await client.json<{ items: { id: string; fact: { claim: string } }[] }>("/api/flags");
    await client.post(`/api/flags/${flags.items.find((item) => item.fact.claim === USABLE.claim)!.id}/check`);

    const doc = await master();
    expect(everyFact(doc).find((fact) => fact.claim === USABLE.claim)!.flags).toEqual([]);
    expect(doc.counts.flagged).toBe(2);
  });

  it("carries no passage from any source document, and is built without a model call", async () => {
    await seedRecord();
    const calls = { extract: model.extractCalls.length, generate: model.generationInputs.length };
    const body = JSON.stringify(await master());
    const file = await (await client.get("/api/master-document/download")).text();

    for (const candidate of [USABLE, PRIVATE, GENERATED, REJECTED, SIDE]) {
      expect(body).not.toContain(candidate.quote);
      expect(file).not.toContain(candidate.quote);
    }
    expect(model.extractCalls).toHaveLength(calls.extract);
    expect(model.generationInputs).toHaveLength(calls.generate);
    expect(model.gradeCalls).toEqual([]);
    expect(model.explainCalls).toEqual([]);
  });

  it("is empty for a user with nothing, and never holds another user's record", async () => {
    await seedRecord();
    const other = app.as(await seedAllowedUser(SECOND_EMAIL));

    const theirs = await master(other);
    expect(theirs.counts).toEqual({ facts: 0, usable: 0, private: 0, generated: 0, flagged: 0, waiting: 0 });
    expect(theirs).toMatchObject({ subjectName: null, employers: [], educations: [], certifications: [] });
    expect(theirs.independent).toEqual({ projects: [], facts: [] });

    const file = await (await other.get("/api/master-document/download")).text();
    expect(file).not.toContain(USABLE.claim);
    expect(file).not.toContain(EMPLOYER_FIXTURE.nameLatin);
  });
});

describe("the master document as a file", () => {
  it("downloads as Markdown, in full, Private facts included, and says so in its first lines", async () => {
    await seedRecord();
    const response = await client.get("/api/master-document/download");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="master-document-\d{4}-\d{2}-\d{2}\.md"$/);
    expect(response.headers.get("cache-control")).toBe("no-store");

    const file = await response.text();
    const [title, , notice, , counts] = file.split("\n");
    expect(title).toBe(`# Master document: ${PROFILE_FIXTURE.nameLatin}`);
    expect(notice).toContain("including Private facts");
    expect(notice).toContain("Do not send it to an employer or a recruiter.");
    expect(counts).toBe("4 facts: 2 a document may use, 1 Private, 1 Generated.");

    expect(file).toContain(`## ${EMPLOYER_FIXTURE.nameLatin} (${EMPLOYER_FIXTURE.nameJa})`);
    expect(file).toContain("### Settlement batch");
    expect(file).toContain(`- ${PRIVATE.claim} [Attested · Private · flagged] kestrel-notes.md L`);
    expect(file).toContain(`- ${GENERATED.claim} [Generated · Restricted · flagged]`);
    expect(file).toContain("## Work outside employment");
    expect(file).toContain(`- ${SIDE.claim} [Attested · Restricted] side-notes.md L`);
    expect(file).toContain("## Education");
    expect(file).toContain("## Certifications");
    expect(file).not.toContain(REJECTED.claim);
  });

  it("says how many facts are waiting and not listed", async () => {
    const { importId } = await seedRecord();
    await asCandidates(importId);
    const file = await (await client.get("/api/master-document/download")).text();
    expect(file).toContain("1 fact: 1 a document may use, 0 Private, 0 Generated. 4 more are waiting to be sorted and are not listed.");
  });
});
