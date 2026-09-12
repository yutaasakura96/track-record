/**
 * Isolation — every query filters by `user_id`
 * (`docs/11-testing-plan.md` §2.1).
 *
 * **The single most important test in the project**, and the only one whose
 * absence would be a security defect rather than a bug. It runs against a real
 * Postgres because the guarantee is enforced by SQL, and a fake that does not
 * run the query proves nothing about the query.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { harness, settle, stubModel, type Client, type StubModel } from "./helpers/harness";
import {
  AUTHOR_EMAIL,
  CASE_STUDY,
  EMPLOYER_FIXTURE,
  PROFILE_FIXTURE,
  ROLE_FIXTURE,
  SECOND_EMAIL,
  seedAllowedUser,
  uploadForm,
} from "./helpers/seed";

interface Populated {
  client: Client;
  profileName: string;
  employerId: string;
  projectId: string;
  roleId: string;
  factId: string;
  importId: string;
  sourceDocumentId: string;
  proposalId: string;
  renderVersionId: string;
}

let model: StubModel;
let a: Populated;
let b: Populated;

const QUOTE = "Nightly batch runtime fell from 6 hours to 90 minutes.";

async function populate(client: Client, marker: string): Promise<Populated> {
  await client.put("/api/profile", { ...PROFILE_FIXTURE, nameLatin: `${marker} Author` });
  const employer = (await (
    await client.post("/api/employers", { ...EMPLOYER_FIXTURE, nameJa: `${marker}社` })
  ).json()) as { id: string };
  const project = (await (
    await client.post("/api/projects", { name: `${marker} project`, employerId: employer.id })
  ).json()) as { id: string };
  const role = (await (
    await client.post("/api/roles", { ...ROLE_FIXTURE, employerId: employer.id, titleLatin: `${marker} Engineer` })
  ).json()) as { id: string };

  model.extractions = [[{ claim: `${marker} claim`, quote: QUOTE, technologies: ["Airflow"] }]];
  const form = uploadForm(CASE_STUDY, `${marker}.md`);
  form.set("projectId", project.id);
  const imported = (await (
    await client.request("/api/imports", { method: "POST", body: form })
  ).json()) as { importId: string; sourceDocumentId: string };
  await settle();

  const facts = (await client.json<{ items: { id: string }[] }>(
    `/api/facts?importId=${imported.importId}`,
  )).items;
  await client.patch(`/api/facts/${facts[0]!.id}`, { provenance: "measured", disclosure: "public" });
  await client.post(`/api/facts/${facts[0]!.id}/accept`);

  model.generations = [
    {
      sections: [
        {
          key: "experience",
          heading: "Experience",
          blocks: [{ id: "blk_1", kind: "bullet", text: `${marker} bullet`, factIds: [facts[0]!.id] }],
        },
      ],
    },
  ];
  const proposal = (await (
    await client.post("/api/renders/english_resume/generate")
  ).json()) as { proposalId: string };
  await settle();
  await client.post(`/api/proposals/${proposal.proposalId}/accept`);

  const renders = (await client.json<{ items: { kind: string; currentVersionId: string | null }[] }>(
    "/api/renders",
  )).items;
  const resume = renders.find((r) => r.kind === "english_resume")!;

  return {
    client,
    profileName: `${marker} Author`,
    employerId: employer.id,
    projectId: project.id,
    roleId: role.id,
    factId: facts[0]!.id,
    importId: imported.importId,
    sourceDocumentId: imported.sourceDocumentId,
    proposalId: proposal.proposalId,
    renderVersionId: resume.currentVersionId!,
  };
}

beforeAll(async () => {
  model = stubModel();
  const app = harness(model);
  a = await populate(app.as(await seedAllowedUser(AUTHOR_EMAIL)), "Alpha");
  b = await populate(app.as(await seedAllowedUser(SECOND_EMAIL)), "Bravo");
}, 120_000);

describe("one user's record is unreachable from another's session", () => {
  it("returns nothing belonging to the other user from any collection", async () => {
    const collections = [
      // /api/profile first: it is the only endpoint that returns the author's
      // address, phone and date of birth.
      "/api/profile",
      "/api/employers",
      "/api/roles",
      "/api/projects",
      "/api/educations",
      "/api/certifications",
      "/api/facts",
      "/api/renders",
      "/api/overview",
      "/api/export",
    ];
    for (const path of collections) {
      const body = await (await a.client.get(path)).text();
      expect(body, `${path} leaked the other user's record`).not.toContain("Bravo");
    }
  });

  it("answers a request for the other user's record by ID with 404, never 403 and never 200", async () => {
    const byId: [string, string][] = [
      ["GET", `/api/imports/${b.importId}`],
      ["GET", `/api/source-documents/${b.sourceDocumentId}/versions/1/text`],
      ["GET", `/api/proposals/${b.proposalId}`],
      ["GET", `/api/proposals/${b.proposalId}/diff`],
      ["POST", `/api/proposals/${b.proposalId}/accept`],
      ["POST", `/api/proposals/${b.proposalId}/dismiss`],
      ["POST", `/api/facts/${b.factId}/accept`],
      ["POST", `/api/facts/${b.factId}/reject`],
      ["POST", `/api/facts/${b.factId}/undo`],
      ["POST", `/api/imports/${b.importId}/retry`],
      ["POST", `/api/imports/${b.importId}/finish`],
      ["GET", `/api/renders/english_resume/download?versionId=${b.renderVersionId}`],
    ];

    for (const [method, path] of byId) {
      const response = await a.client.request(path, { method });
      expect(response.status, `${method} ${path}`).toBe(404);
      const body = (await response.json()) as { error: { code: string } };
      expect(body.error.code).toBe("not_found");
    }
  });

  it("refuses to edit the other user's records", async () => {
    for (const [path, body] of [
      [`/api/employers/${b.employerId}`, { nameJa: "取得済み" }],
      [`/api/projects/${b.projectId}`, { name: "taken" }],
      [`/api/roles/${b.roleId}`, { titleLatin: "taken" }],
      [`/api/facts/${b.factId}`, { claim: "taken" }],
    ] as [string, unknown][]) {
      const response = await a.client.patch(path, body);
      expect(response.status, path).toBe(404);
    }

    // And the other user's records are unchanged.
    const employers = await b.client.json<{ items: { id: string; nameJa: string }[] }>(
      "/api/employers",
    );
    expect(employers.items.find((e) => e.id === b.employerId)!.nameJa).toContain("Bravo");
  });

  it("cannot file a fact under another user's employer", async () => {
    // The linkage rule worth protecting: a foreign key alone would let one
    // user's fact hang off another user's employer, and the employer's name and
    // dates are what a render's sections are built from.
    const response = await a.client.patch(`/api/facts/${a.factId}`, {
      employerId: b.employerId,
    });
    expect(response.status).toBe(404);

    // And the fact is unchanged — a refused link leaves no partial write.
    const { items } = await a.client.json<{ items: { id: string; employerId: string | null }[] }>(
      "/api/facts",
    );
    expect(items.find((f) => f.id === a.factId)!.employerId).toBeNull();
  });

  it("cannot attach a role to another user's employer", async () => {
    const created = await a.client.post("/api/roles", {
      ...ROLE_FIXTURE,
      employerId: b.employerId,
    });
    expect(created.status).toBe(404);

    const moved = await a.client.patch(`/api/roles/${a.roleId}`, { employerId: b.employerId });
    expect(moved.status).toBe(404);
  });

  it("cannot delete another user's employer, and reports nothing about it", async () => {
    const response = await a.client.delete(`/api/employers/${b.employerId}`);
    expect(response.status).toBe(404);
    // A 409 here would confirm the employer exists and how much hangs off it.
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("not_found");
  });

  it("cannot set another user's entry in or out of a render", async () => {
    // The table names its entry by id with no foreign key, so ownership is the
    // route's to check. Without it one user could empty another's documents.
    for (const [entityType, entityId] of [
      ["employer", b.employerId],
      ["project", b.projectId],
    ]) {
      const response = await a.client.put("/api/render-inclusions", {
        entityType,
        entityId,
        kind: "english_resume",
        included: false,
      });
      expect(response.status, entityType).toBe(404);
    }
    expect((await b.client.json<{ items: unknown[] }>("/api/render-inclusions")).items).toEqual([]);
  });

  it("cannot attach a project to another user's employer", async () => {
    const response = await a.client.post("/api/projects", {
      name: "borrowed",
      employerId: b.employerId,
    });
    expect(response.status).toBe(404);
  });

  it("cannot file an imported document under another user's project", async () => {
    const form = uploadForm(CASE_STUDY, "borrowed.md");
    form.set("projectId", b.projectId);
    const response = await a.client.request("/api/imports", { method: "POST", body: form });
    expect(response.status).toBe(404);
    await settle();
  });

  it("shows each user only their own profile, PII included", async () => {
    const mine = await a.client.json<{ nameLatin: string; phone: string; address: string }>(
      "/api/profile",
    );
    expect(mine.nameLatin).toBe("Alpha Author");

    const theirs = await b.client.json<{ nameLatin: string }>("/api/profile");
    expect(theirs.nameLatin).toBe("Bravo Author");
    expect(mine.nameLatin).not.toBe(theirs.nameLatin);
  });

  it("still serves each user their own record in full", async () => {
    const overview = await a.client.json<{ tiles: { employers: { count: number } } }>(
      "/api/overview",
    );
    expect(overview.tiles.employers.count).toBe(1);

    const own = await a.client.get(`/api/imports/${a.importId}`);
    expect(own.status).toBe(200);
  });
});
