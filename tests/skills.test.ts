/**
 * Skills curation (S9, `docs/02` §4).
 *
 * The three acceptance lines, observed over HTTP and at the generation payload:
 * candidates come from accepted facts and certifications and from nowhere else,
 * the author's groups and order are what a render is given, and a skill the
 * record stops naming is flagged rather than removed. Every entry here is
 * INVENTED.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { harness, settle, stubModel, type Client, type StubModel } from "./helpers/harness";
import {
  CERTIFICATION_FIXTURE,
  EMPLOYER_FIXTURE,
  PROFILE_FIXTURE,
  asCandidates,
  seedAllowedUser,
  uploadForm,
} from "./helpers/seed";
import type { RenderKind } from "~/shared/render-content";

const PIPELINE_QUOTE = "The ingest pipeline moved to a job runner and stopped paging overnight.";
const WAREHOUSE_QUOTE = "Reporting queries fell from 40 seconds to 3 after the warehouse rebuild.";
const PRIVATE_QUOTE = "The client's session cache was rebuilt over one weekend.";
const GENERATED_QUOTE = "Infrastructure was described entirely as code.";
const PENDING_QUOTE = "An event bus carried order updates between four services.";

type LastUsed = number | "now" | null;
interface Candidate {
  name: string;
  factCount: number;
  certificationCount: number;
  lastUsed: LastUsed;
  curated: boolean;
  suggestedGroup: string | null;
}
interface Curation {
  groups: {
    name: string;
    skills: { name: string; factCount: number; certificationCount: number; lastUsed: LastUsed; stale: boolean }[];
  }[];
  candidates: Candidate[];
  printable: string[];
}

let model: StubModel;
let client: Client;

beforeEach(async () => {
  model = stubModel();
  client = harness(model).as(await seedAllowedUser());
  await client.put("/api/profile", PROFILE_FIXTURE);
});

async function created(path: string, body: unknown) {
  return (await (await client.post(path, body)).json()) as { id: string };
}

/**
 * Imports one document and returns its facts, resolving none of them: as
 * candidates, the way an import left them before automatic acceptance.
 */
async function imported(candidates: { claim: string; quote: string; technologies: string[] }[]) {
  model.extractions = [candidates];
  const form = uploadForm(candidates.map((c) => c.quote).join("\n\n"), `${candidates[0]!.claim.slice(0, 8)}.md`);
  const started = (await (
    await client.request("/api/imports", { method: "POST", body: form })
  ).json()) as { importId: string };
  await settle();
  await asCandidates(started.importId);
  const { items } = await client.json<{ items: { id: string; claim: string }[] }>(
    `/api/facts?importId=${started.importId}`,
  );
  return (fragment: string) => items.find((f) => f.claim.includes(fragment))!;
}

async function accept(id: string, provenance = "measured", disclosure = "public") {
  await client.patch(`/api/facts/${id}`, { provenance, disclosure });
  await client.post(`/api/facts/${id}/accept`);
}

/**
 * Two usable facts, three that must never become candidates, and one
 * certification. CockroachDB is named twice, so a count is observable.
 */
async function seedRecord() {
  const fact = await imported([
    { claim: "Moved ingest to a job runner", quote: PIPELINE_QUOTE, technologies: ["Airflow", "CockroachDB"] },
    { claim: "Rebuilt the reporting warehouse", quote: WAREHOUSE_QUOTE, technologies: ["CockroachDB"] },
    { claim: "Rebuilt a session cache", quote: PRIVATE_QUOTE, technologies: ["Memcached"] },
    { claim: "Described infrastructure as code", quote: GENERATED_QUOTE, technologies: ["Pulumi"] },
    { claim: "Carried order updates on a bus", quote: PENDING_QUOTE, technologies: ["NATS"] },
  ]);
  const pipeline = fact("ingest");
  const warehouse = fact("warehouse");
  await accept(pipeline.id);
  await accept(warehouse.id);
  await accept(fact("session cache").id, "measured", "private");
  await accept(fact("infrastructure").id, "generated", "public");
  const certification = await created("/api/certifications", CERTIFICATION_FIXTURE);
  return { pipeline, warehouse, certification };
}

const curation = () => client.json<Curation>("/api/skills/curation");
const curate = (groups: { name: string; skills: string[] }[]) =>
  client.put("/api/skills/curation", { groups });

async function generated(kind: RenderKind) {
  model.generations = [{ sections: [] }];
  const response = await client.post(`/api/renders/${kind}/generate`);
  await settle();
  const { proposalId } = (await response.json()) as { proposalId: string };
  await client.post(`/api/proposals/${proposalId}/dismiss`);
  return model.generationInputs.at(-1)!.spec;
}

describe("candidates", () => {
  it("are the technologies on accepted, render-eligible facts and on certifications, counted", async () => {
    await seedRecord();
    const { candidates, groups } = await curation();

    expect(groups).toEqual([]);
    expect(candidates).toEqual([
      { name: "CockroachDB", factCount: 2, certificationCount: 0, lastUsed: null, curated: false, suggestedGroup: null },
      { name: "Airflow", factCount: 1, certificationCount: 0, lastUsed: null, curated: false, suggestedGroup: null },
      { name: "SQL", factCount: 0, certificationCount: 1, lastUsed: 2019, curated: false, suggestedGroup: null },
    ]);
  });
});

describe("when a skill was last used", () => {
  it("is the end of the employer's tenure its fact resolves to, or the month it was captured with", async () => {
    const record = await seedRecord();
    const employer = await created("/api/employers", EMPLOYER_FIXTURE);
    await client.patch(`/api/facts/${record.pipeline.id}`, { employerId: employer.id });

    const byName = async () => new Map((await curation()).candidates.map((c) => [c.name, c.lastUsed]));
    expect(await byName()).toEqual(new Map<string, LastUsed>([["CockroachDB", 2024], ["Airflow", 2024], ["SQL", 2019]]));

    // The later of two facts: one at the 2024 employer, one captured in 2025.
    await client.patch(`/api/facts/${record.warehouse.id}`, { month: "2025-03" });
    expect((await byName()).get("CockroachDB")).toBe(2025);
  });

  it("is now while the employer is current, on a curated skill as on a candidate", async () => {
    const record = await seedRecord();
    const current = await created("/api/employers", { ...EMPLOYER_FIXTURE, endedOn: null, leavingReasonJa: null });
    await client.patch(`/api/facts/${record.pipeline.id}`, { employerId: current.id });
    await curate([{ name: "Data platforms", skills: ["Airflow"] }]);

    const { groups, candidates } = await curation();
    expect(groups[0]!.skills[0]!.lastUsed).toBe("now");
    expect(candidates.find((c) => c.name === "CockroachDB")!.lastUsed).toBe("now");
  });
});

describe("a suggested group", () => {
  it("is the group whose skills a candidate is named beside", async () => {
    await seedRecord();
    await curate([
      { name: "Qualifications", skills: ["SQL"] },
      { name: "Data platforms", skills: ["CockroachDB"] },
    ]);

    const { candidates } = await curation();
    expect(candidates.map((c) => [c.name, c.suggestedGroup])).toEqual([
      ["CockroachDB", null],
      ["Airflow", "Data platforms"],
      ["SQL", null],
    ]);
  });

  it("is the group sharing its employers, else the largest group, when it is named beside none", async () => {
    const fact = await imported([
      { claim: "Streamed orders through Kafka", quote: "Orders streamed through a Kafka topic per region.", technologies: ["Kafka"] },
      { claim: "Cached prices in Redis", quote: "Price lookups were served from Redis.", technologies: ["Redis"] },
      { claim: "Planned networks in Terraform", quote: "Every network was planned in Terraform.", technologies: ["Terraform"] },
      { claim: "Packaged services with Helm", quote: "Each service shipped as a Helm chart.", technologies: ["Helm"] },
      { claim: "Scripted releases in Bash", quote: "Releases ran from one Bash script.", technologies: ["Bash"] },
    ]);
    const first = await created("/api/employers", EMPLOYER_FIXTURE);
    const second = await created("/api/employers", { ...EMPLOYER_FIXTURE, nameLatin: "Kumo Freight K.K." });
    for (const [fragment, employerId] of [["Kafka", first.id], ["Redis", first.id], ["Terraform", second.id], ["Helm", second.id]]) {
      const id = fact(fragment!).id;
      await client.patch(`/api/facts/${id}`, { employerId });
      await accept(id);
    }
    await accept(fact("Bash").id);
    await curate([
      { name: "Infrastructure", skills: ["Terraform", "Helm"] },
      { name: "Data", skills: ["Redis"] },
    ]);

    const suggested = new Map((await curation()).candidates.map((c) => [c.name, c.suggestedGroup]));
    expect(suggested.get("Kafka")).toBe("Data");
    expect(suggested.get("Bash")).toBe("Infrastructure");
  });

  it("is the earlier of equally large groups, and none while no group exists", async () => {
    await seedRecord();
    expect((await curation()).candidates.every((c) => c.suggestedGroup === null)).toBe(true);

    await curate([
      { name: "Pipelines", skills: ["Airflow"] },
      { name: "Stores", skills: ["CockroachDB"] },
    ]);
    expect((await curation()).candidates.find((c) => c.name === "SQL")!.suggestedGroup).toBe("Pipelines");
  });
});

describe("what the résumé may print", () => {
  it("is every technology its facts and certifications name, best evidenced first", async () => {
    await seedRecord();
    expect((await curation()).printable).toEqual(["CockroachDB", "Airflow", "SQL"]);
  });

  it("leaves out a skill whose only facts the résumé leaves out, which the preview then leaves out too", async () => {
    const record = await seedRecord();
    const employer = await created("/api/employers", EMPLOYER_FIXTURE);
    await client.patch(`/api/facts/${record.pipeline.id}`, { employerId: employer.id });
    await client.put("/api/render-inclusions", {
      entityType: "employer",
      entityId: employer.id,
      kind: "english_resume",
      included: false,
    });

    expect((await curation()).printable).toEqual(["CockroachDB", "SQL"]);
  });
});

describe("a curation", () => {
  it("keeps the author's groups and order", async () => {
    await seedRecord();
    expect(
      (await curate([
        { name: "Qualifications", skills: ["SQL"] },
        { name: "Data platforms", skills: ["Airflow", "CockroachDB"] },
      ])).status,
    ).toBe(200);

    const { groups, candidates } = await curation();
    expect(groups.map((g) => [g.name, g.skills.map((s) => s.name)])).toEqual([
      ["Qualifications", ["SQL"]],
      ["Data platforms", ["Airflow", "CockroachDB"]],
    ]);
    expect(groups.flatMap((g) => g.skills).every((s) => !s.stale)).toBe(true);
    expect(candidates.every((c) => c.curated)).toBe(true);
  });

  it("refuses a skill no candidate names, so nothing is hand-authored", async () => {
    await seedRecord();
    for (const name of ["NATS", "Memcached", "Pulumi", "Zig"]) {
      const response = await curate([{ name: "Sundries", skills: [name] }]);
      expect(response.status, name).toBe(422);
    }
    expect((await curation()).groups).toEqual([]);
  });

  it("refuses a skill listed twice, and a group with no skills", async () => {
    await seedRecord();
    expect((await curate([
      { name: "Data platforms", skills: ["Airflow"] },
      { name: "Qualifications", skills: ["Airflow"] },
    ])).status).toBe(422);
    expect((await curate([{ name: "Sundries", skills: [] }])).status).toBe(422);
  });

  it("is cleared by an empty list, which hands the section back to the model", async () => {
    await seedRecord();
    await curate([{ name: "Data platforms", skills: ["Airflow"] }]);
    expect((await curate([])).status).toBe(200);
    expect((await curation()).groups).toEqual([]);
  });
});

describe("a curated skill the record stops naming", () => {
  it("is flagged, kept in place, and survives the list being saved again", async () => {
    const record = await seedRecord();
    await curate([{ name: "Data platforms", skills: ["Airflow", "CockroachDB", "SQL"] }]);

    await client.post(`/api/facts/${record.pipeline.id}/undo`);
    await client.patch(`/api/certifications/${record.certification.id}`, {
      ...CERTIFICATION_FIXTURE,
      technologies: [],
    });

    const stale = await curation();
    expect(stale.groups[0]!.skills.map((s) => [s.name, s.stale])).toEqual([
      ["Airflow", true],
      ["CockroachDB", false],
      ["SQL", true],
    ]);

    // Reordered and saved: a stale skill is no longer a candidate, and the save
    // must not be refused for carrying it.
    expect((await curate([{ name: "Data platforms", skills: ["CockroachDB", "SQL", "Airflow"] }])).status).toBe(200);
    expect((await curation()).groups[0]!.skills.map((s) => s.name)).toEqual(["CockroachDB", "SQL", "Airflow"]);
  });
});

describe("a render with a skills section", () => {
  it("is given no list while nothing is curated", async () => {
    await seedRecord();
    expect((await generated("shokumu_keirekisho")).curatedSkills).toBeNull();
  });

  it("is given the curated groups, and a render without the section is not", async () => {
    await seedRecord();
    await curate([
      { name: "Data platforms", skills: ["CockroachDB", "Airflow"] },
      { name: "Qualifications", skills: ["SQL"] },
    ]);

    const expected = [
      { name: "Data platforms", skills: ["CockroachDB", "Airflow"] },
      { name: "Qualifications", skills: ["SQL"] },
    ];
    expect((await generated("shokumu_keirekisho")).curatedSkills).toEqual(expected);
    expect((await generated("career_story_en")).curatedSkills).toBeNull();
    // The English résumé's skills line is filled from the record when the file
    // is built (issue #107), so its prompt carries no list to write one from.
    expect((await generated("english_resume")).curatedSkills).toBeNull();
  });

  it("is never given a stale skill, and drops a group left empty", async () => {
    const record = await seedRecord();
    await curate([
      { name: "Data platforms", skills: ["CockroachDB", "Airflow"] },
      { name: "Qualifications", skills: ["SQL"] },
    ]);
    await client.post(`/api/facts/${record.pipeline.id}/undo`);
    await client.patch(`/api/certifications/${record.certification.id}`, {
      ...CERTIFICATION_FIXTURE,
      technologies: [],
    });

    expect((await generated("shokumu_keirekisho")).curatedSkills).toEqual([
      { name: "Data platforms", skills: ["CockroachDB"] },
    ]);
  });

  it("is not given a skill whose only facts that render leaves out", async () => {
    const record = await seedRecord();
    const employer = await created("/api/employers", EMPLOYER_FIXTURE);
    await client.patch(`/api/facts/${record.pipeline.id}`, { employerId: employer.id });
    await curate([{ name: "Data platforms", skills: ["Airflow", "CockroachDB"] }]);
    await client.put("/api/render-inclusions", {
      entityType: "employer",
      entityId: employer.id,
      kind: "shokumu_keirekisho",
      included: false,
    });

    expect((await generated("shokumu_keirekisho")).curatedSkills).toEqual([
      { name: "Data platforms", skills: ["CockroachDB"] },
    ]);
    // Still stale nowhere: the record names it, one render simply leaves it out.
    expect((await curation()).groups[0]!.skills.every((s) => !s.stale)).toBe(true);
  });
});
