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
const masterJa = (as: Client = client) => as.json<MasterDocument>("/api/master-document?language=ja");
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
      alternateName: EMPLOYER_FIXTURE.nameJa,
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

/**
 * Issue #59: each language has its own. It is the same view, with the record
 * named as a document of that language names it, and nothing translated.
 */
describe("the master document of each language", () => {
  it("is English unless 日本語 is asked for, and says which it is", async () => {
    await seedRecord();

    expect((await master()).language).toBe("en");
    expect((await masterJa()).language).toBe("ja");
    // An unknown language is ignored, as an unknown filter is.
    expect((await client.json<MasterDocument>("/api/master-document?language=fr")).language).toBe("en");
  });

  it("names the record as a Japanese document names it", async () => {
    const { employerId } = await seedRecord();
    await created("/api/projects", { name: "Harbour lantern", nameJa: "港の灯台", employerId });
    const doc = await masterJa();

    expect(doc.subjectName).toBe(`${PROFILE_FIXTURE.familyNameKanji}　${PROFILE_FIXTURE.givenNameKanji}`);
    expect(doc.employers[0]).toMatchObject({
      name: EMPLOYER_FIXTURE.nameJa,
      alternateName: EMPLOYER_FIXTURE.nameLatin,
      roles: [{ title: ROLE_FIXTURE.titleJa }],
    });
    // A project with a Japanese name is called by it; one without keeps the name it has.
    expect(doc.employers[0]!.projects.map((project) => project.name).sort()).toEqual(["Settlement batch", "港の灯台"].sort());
    expect(doc.educations).toMatchObject([{ institution: EDUCATION_FIXTURE.institutionJa }]);
    expect(doc.certifications).toMatchObject([{ name: CERTIFICATION_FIXTURE.nameJa }]);
  });

  it("holds the same facts in both, each claim as it was written", async () => {
    await seedRecord();
    const [english, japanese] = [await master(), await masterJa()];
    const claims = (doc: MasterDocument) => everyFact(doc).map((fact) => [fact.id, fact.claim, fact.provenance, fact.disclosure]);

    expect(claims(japanese)).toEqual(claims(english));
    expect(japanese.counts).toEqual(english.counts);
  });

  it("falls back to the only name the record holds, and then lists no second name", async () => {
    await created("/api/employers", { ...EMPLOYER_FIXTURE, nameLatin: null });

    for (const doc of [await master(), await masterJa()]) {
      expect(doc.employers[0]).toMatchObject({ name: EMPLOYER_FIXTURE.nameJa, alternateName: null });
    }
  });

  it("is built without a model call in Japanese too", async () => {
    await seedRecord();
    const calls = { extract: model.extractCalls.length, generate: model.generationInputs.length };
    await masterJa();
    await client.get("/api/master-document/download?language=ja");

    expect(model.extractCalls).toHaveLength(calls.extract);
    expect(model.generationInputs).toHaveLength(calls.generate);
    expect(model.gradeCalls).toEqual([]);
    expect(model.explainCalls).toEqual([]);
  });

  it("never holds another user's record in Japanese either", async () => {
    await seedRecord();
    const other = app.as(await seedAllowedUser(SECOND_EMAIL));

    expect(await masterJa(other)).toMatchObject({ language: "ja", subjectName: null, employers: [], educations: [], certifications: [] });
    const file = await (await other.get("/api/master-document/download?language=ja")).text();
    expect(file).not.toContain(USABLE.claim);
    expect(file).not.toContain(EMPLOYER_FIXTURE.nameJa);
  });
});

describe("the master document as a file", () => {
  it("downloads as Markdown, in full, Private facts included, and says so in its first lines", async () => {
    await seedRecord();
    const response = await client.get("/api/master-document/download");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="master-document-en-\d{4}-\d{2}-\d{2}\.md"$/);
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

  it("downloads the Japanese one as a file of its own, headed and dated in Japanese", async () => {
    await seedRecord();
    const response = await client.get("/api/master-document/download?language=ja");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="master-document-ja-\d{4}-\d{2}-\d{2}\.md"$/);
    expect(response.headers.get("cache-control")).toBe("no-store");

    const file = await response.text();
    const [title, , notice, , counts] = file.split("\n");
    expect(title).toBe(`# マスタードキュメント：${PROFILE_FIXTURE.familyNameKanji}　${PROFILE_FIXTURE.givenNameKanji}`);
    // The same two warnings the English file opens with, and that nothing was translated.
    expect(notice).toContain("Private（非公開）の事実");
    expect(notice).toContain("企業や採用担当者には送らないでください。");
    expect(notice).toContain("翻訳していません。");
    expect(counts).toBe("事実 4 件：書類に使用可 2 件、Private 1 件、Generated 1 件。");

    expect(file).toContain(`## ${EMPLOYER_FIXTURE.nameJa} (${EMPLOYER_FIXTURE.nameLatin})`);
    expect(file).toContain("2022年4月〜2024年9月 · 運輸業");
    expect(file).toContain(`- ${ROLE_FIXTURE.titleJa} (2022年4月〜2023年9月)`);
    expect(file).toContain("## 雇用外の活動");
    expect(file).toContain("## 学歴");
    expect(file).toContain(`- ${EDUCATION_FIXTURE.institutionJa}、`);
    expect(file).toContain("2013年4月〜2017年3月、卒業)");
    expect(file).toContain("## 資格");
    expect(file).toContain(`- ${CERTIFICATION_FIXTURE.nameJa}、${CERTIFICATION_FIXTURE.issuingOrganization} (2019年6月取得)`);
    // The claims are the ones that were read, under the product's own labels.
    expect(file).toContain(`- ${PRIVATE.claim} [Attested · Private · flagged] kestrel-notes.md L`);
    expect(file).not.toContain("## Education");
    expect(file).not.toContain(REJECTED.claim);
    for (const candidate of [USABLE, PRIVATE, GENERATED, REJECTED, SIDE]) expect(file).not.toContain(candidate.quote);
  });

  it("says in Japanese how many facts are waiting and not listed", async () => {
    const { importId } = await seedRecord();
    await asCandidates(importId);
    const file = await (await client.get("/api/master-document/download?language=ja")).text();
    expect(file).toContain("事実 1 件：書類に使用可 1 件、Private 0 件、Generated 0 件。ほかに 4 件が仕分け待ちで、掲載されていません。");
  });

  it("says how many facts are waiting and not listed", async () => {
    const { importId } = await seedRecord();
    await asCandidates(importId);
    const file = await (await client.get("/api/master-document/download")).text();
    expect(file).toContain("1 fact: 1 a document may use, 0 Private, 0 Generated. 4 more are waiting to be sorted and are not listed.");
  });
});
