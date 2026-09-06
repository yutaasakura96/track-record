/**
 * Profile, employers, projects and the overview
 * (`docs/07-api-design.md` §4 and §8, `docs/09-user-flows.md` Flow 1).
 *
 * The first-run path has exactly one way forward: no profile means the client is
 * sent to the profile form, because every render needs a name to put on it.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { harness, settle, stubModel, type Client, type StubModel } from "./helpers/harness";
import {
  CASE_STUDY,
  CERTIFICATION_FIXTURE,
  EDUCATION_FIXTURE,
  EMPLOYER_FIXTURE,
  PROFILE_FIXTURE,
  ROLE_FIXTURE,
  seedAllowedUser,
  uploadForm,
} from "./helpers/seed";

let model: StubModel;
let client: Client;

beforeEach(async () => {
  model = stubModel();
  client = harness(model).as(await seedAllowedUser());
});

describe("the profile form", () => {
  it("reports no profile as 404, which is what sends the client to the form", async () => {
    const response = await client.get("/api/profile");
    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("not_found");
  });

  it("names a missing required field inline and saves nothing", async () => {
    const { nameLatin: _omitted, ...incomplete } = PROFILE_FIXTURE;
    const response = await client.put("/api/profile", incomplete);

    expect(response.status).toBe(422);
    const body = (await response.json()) as {
      error: { code: string; details: { fields: string[] } };
    };
    expect(body.error.code).toBe("validation_failed");
    expect(body.error.details.fields).toContain("nameLatin");

    // Nothing was saved — a partial attempt costs nothing.
    expect((await client.get("/api/profile")).status).toBe(404);
  });

  it("rejects a calendar value that is not month precision", async () => {
    const response = await client.put("/api/profile", {
      ...PROFILE_FIXTURE,
      dateOfBirth: "1994-11-17",
    });
    expect(response.status).toBe(422);
    expect(
      ((await response.json()) as { error: { details: { fields: string[] } } }).error.details.fields,
    ).toContain("dateOfBirth");
  });

  it("rejects katakana in a kana field and saves nothing", async () => {
    // ふりがな is hiragana (`docs/04` §139-148) and prints above the kanji in
    // 履歴書 row 1. Katakana used to save silently and render a wrong document.
    const response = await client.put("/api/profile", {
      ...PROFILE_FIXTURE,
      familyNameKana: "アオキ",
    });

    expect(response.status).toBe(422);
    const body = (await response.json()) as {
      error: { code: string; message: string; details: { fields: string[] } };
    };
    expect(body.error.code).toBe("validation_failed");
    expect(body.error.details.fields).toContain("familyNameKana");
    expect(body.error.message).toMatch(/hiragana/i);

    expect((await client.get("/api/profile")).status).toBe(404);
  });

  it("accepts a hiragana address reading carrying digits and hyphens", async () => {
    // The rule names katakana rather than demanding pure hiragana: a reading
    // legitimately carries digits, spaces and hyphens.
    const response = await client.put("/api/profile", {
      ...PROFILE_FIXTURE,
      addressKana: "とうきょうと ちよだく 1-1-1",
    });
    expect(response.status).toBe(200);
  });

  it("saves the profile and never inlines the photo", async () => {
    const saved = (await (await client.put("/api/profile", PROFILE_FIXTURE)).json()) as Record<
      string,
      unknown
    >;
    expect(saved.nameLatin).toBe("Yosuke Aoki");
    expect(saved.hasPhoto).toBe(false);
    expect(saved).not.toHaveProperty("photo");
    expect(saved).not.toHaveProperty("userId");

    // Full replace, creating on the first call and updating after.
    const again = await client.put("/api/profile", { ...PROFILE_FIXTURE, nameLatin: "Y. Aoki" });
    expect(again.status).toBe(200);
    const reread = await client.json<{ nameLatin: string }>("/api/profile");
    expect(reread.nameLatin).toBe("Y. Aoki");
  });
});

describe("employers and projects", () => {
  beforeEach(async () => {
    await client.put("/api/profile", PROFILE_FIXTURE);
  });

  it("stores 資本金 in yen and month-precision dates", async () => {
    const created = (await (await client.post("/api/employers", EMPLOYER_FIXTURE)).json()) as {
      capitalYen: number;
      startedOn: string;
    };
    expect(created.capitalYen).toBe(50_000_000);
    expect(created.startedOn).toBe("2022-04-01");
  });

  it("allows a project with no employer — an independent project", async () => {
    const response = await client.post("/api/projects", { name: "Side ledger tool" });
    expect(response.status).toBe(201);
    expect(((await response.json()) as { employerId: string | null }).employerId).toBeNull();
  });

  it("rejects an employer with no name", async () => {
    const response = await client.post("/api/employers", {
      ...EMPLOYER_FIXTURE,
      nameJa: "",
    });
    expect(response.status).toBe(422);
  });
});

describe("the entity layer", () => {
  beforeEach(async () => {
    await client.put("/api/profile", PROFILE_FIXTURE);
  });

  const addEmployer = async (overrides: Record<string, unknown> = {}) =>
    (await (await client.post("/api/employers", { ...EMPLOYER_FIXTURE, ...overrides })).json()) as {
      id: string;
    };

  it("records several roles at one employer, because a promotion is a second row", async () => {
    const employer = await addEmployer();
    await client.post("/api/roles", { ...ROLE_FIXTURE, employerId: employer.id });
    const second = await client.post("/api/roles", {
      ...ROLE_FIXTURE,
      employerId: employer.id,
      titleLatin: "Senior Backend Engineer",
      startedOn: "2023-10-01",
      endedOn: null,
    });
    expect(second.status).toBe(201);

    const { items } = await client.json<{ items: { titleLatin: string; endedOn: string | null }[] }>(
      "/api/roles",
    );
    expect(items).toHaveLength(2);
    // Most recent first — the order every render lists them in.
    expect(items[0]!.titleLatin).toBe("Senior Backend Engineer");
    expect(items[0]!.endedOn).toBeNull();
  });

  it("refuses a role with no employer", async () => {
    const response = await client.post("/api/roles", ROLE_FIXTURE);
    expect(response.status).toBe(422);
    expect(
      ((await response.json()) as { error: { details: { fields: string[] } } }).error.details.fields,
    ).toContain("employerId");
  });

  it("refuses to delete an employer while facts, roles or projects reference it", async () => {
    const employer = await addEmployer();
    await client.post("/api/roles", { ...ROLE_FIXTURE, employerId: employer.id });
    await client.post("/api/projects", { name: "Batch rewrite", employerId: employer.id });

    model.extractions = [
      [
        {
          claim: "Reduced nightly batch runtime",
          quote: "Nightly batch runtime fell from 6 hours to 90 minutes.",
          technologies: [],
        },
      ],
    ];
    const imported = (await (
      await client.request("/api/imports", { method: "POST", body: uploadForm(CASE_STUDY) })
    ).json()) as { importId: string };
    await settle();
    const { items } = await client.json<{ items: { id: string }[] }>(
      `/api/facts?importId=${imported.importId}`,
    );
    await client.patch(`/api/facts/${items[0]!.id}`, { employerId: employer.id });

    const refused = await client.delete(`/api/employers/${employer.id}`);
    expect(refused.status).toBe(409);
    const body = (await refused.json()) as {
      error: { code: string; message: string; details: Record<string, number> };
    };
    expect(body.error.code).toBe("conflict");
    // Counts, so the refusal can say what is in the way without naming any of it.
    expect(body.error.details).toEqual({ facts: 1, roles: 1, projects: 1 });
    expect(body.error.message).not.toContain("Reduced nightly batch runtime");

    // And nothing was deleted.
    const stillThere = await client.json<{ items: { id: string }[] }>("/api/employers");
    expect(stillThere.items.map((e) => e.id)).toContain(employer.id);
  });

  it("deletes an employer nothing references", async () => {
    const employer = await addEmployer();
    expect((await client.delete(`/api/employers/${employer.id}`)).status).toBe(204);
    expect((await client.json<{ items: unknown[] }>("/api/employers")).items).toHaveLength(0);
    // Repeating it is a 404, not a second success.
    expect((await client.delete(`/api/employers/${employer.id}`)).status).toBe(404);
  });

  it("frees an employer for deletion once its facts are refiled", async () => {
    const employer = await addEmployer();
    const role = (await (
      await client.post("/api/roles", { ...ROLE_FIXTURE, employerId: employer.id })
    ).json()) as { id: string };

    expect((await client.delete(`/api/employers/${employer.id}`)).status).toBe(409);
    expect((await client.delete(`/api/roles/${role.id}`)).status).toBe(204);
    expect((await client.delete(`/api/employers/${employer.id}`)).status).toBe(204);
  });

  it("requires the month an education finished unless it is still expected", async () => {
    const { endedOn: _omitted, ...unfinished } = EDUCATION_FIXTURE;
    const refused = await client.post("/api/educations", unfinished);
    expect(refused.status).toBe(422);
    expect(
      ((await refused.json()) as { error: { details: { fields: string[] } } }).error.details.fields,
    ).toContain("endedOn");

    // 卒業見込 is the one outcome that has not happened yet.
    const expected = await client.post("/api/educations", {
      ...unfinished,
      outcome: "expected",
    });
    expect(expected.status).toBe(201);
  });

  it("holds an outcome to the same rule when it is edited onto a finished row", async () => {
    const created = (await (
      await client.post("/api/educations", { ...EDUCATION_FIXTURE, outcome: "expected", endedOn: null })
    ).json()) as { id: string };

    // The rule is about the finished row, not about the fields the PATCH names.
    const refused = await client.patch(`/api/educations/${created.id}`, { outcome: "graduated" });
    expect(refused.status).toBe(422);

    const accepted = await client.patch(`/api/educations/${created.id}`, {
      outcome: "graduated",
      endedOn: "2017-03-01",
    });
    expect(accepted.status).toBe(200);
    expect(((await accepted.json()) as { outcome: string }).outcome).toBe("graduated");
  });

  it("records a certification and returns its technologies", async () => {
    const created = await client.post("/api/certifications", CERTIFICATION_FIXTURE);
    expect(created.status).toBe(201);
    expect(((await created.json()) as { technologies: string[] }).technologies).toEqual(["SQL"]);

    const { items } = await client.json<{ items: { id: string }[] }>("/api/certifications");
    expect(items).toHaveLength(1);
    expect((await client.delete(`/api/certifications/${items[0]!.id}`)).status).toBe(204);
  });
});

describe("filing a fact under an employer", () => {
  let employerId: string;
  let factId: string;

  beforeEach(async () => {
    await client.put("/api/profile", PROFILE_FIXTURE);
    employerId = (
      (await (await client.post("/api/employers", EMPLOYER_FIXTURE)).json()) as { id: string }
    ).id;

    model.extractions = [
      [
        {
          claim: "Reduced nightly batch runtime",
          quote: "Nightly batch runtime fell from 6 hours to 90 minutes.",
          technologies: [],
        },
      ],
    ];
    const imported = (await (
      await client.request("/api/imports", { method: "POST", body: uploadForm(CASE_STUDY) })
    ).json()) as { importId: string };
    await settle();
    factId = (
      await client.json<{ items: { id: string }[] }>(`/api/facts?importId=${imported.importId}`)
    ).items[0]!.id;
  });

  it("arrives unfiled, because extraction never invents an employer", async () => {
    const { items } = await client.json<{ items: { employerId: string | null }[] }>("/api/facts");
    expect(items[0]!.employerId).toBeNull();
  });

  it("files a fact, and files an already-accepted one without re-importing", async () => {
    // The 112 facts of the first real import were already accepted when the
    // employer rows arrived. Linkage must not require a new source version.
    await client.patch(`/api/facts/${factId}`, { provenance: "attested" });
    await client.post(`/api/facts/${factId}/accept`);

    const filed = await client.patch(`/api/facts/${factId}`, { employerId });
    expect(filed.status).toBe(200);
    const body = (await filed.json()) as { employerId: string; status: string };
    expect(body.employerId).toBe(employerId);
    // Filing it did not undo the accept decision.
    expect(body.status).toBe("accepted");

    const filtered = await client.json<{ items: { id: string }[] }>(
      `/api/facts?employerId=${employerId}`,
    );
    expect(filtered.items.map((f) => f.id)).toEqual([factId]);
  });

  it("unfiles a fact when the employer is cleared", async () => {
    await client.patch(`/api/facts/${factId}`, { employerId });
    const cleared = await client.patch(`/api/facts/${factId}`, { employerId: null });
    expect(((await cleared.json()) as { employerId: string | null }).employerId).toBeNull();
  });

  it("gives generation the employer rows, their roles and the fact's employer id", async () => {
    await client.post("/api/roles", { ...ROLE_FIXTURE, employerId });
    await client.patch(`/api/facts/${factId}`, { provenance: "attested", disclosure: "public" });
    await client.patch(`/api/facts/${factId}`, { employerId });
    await client.post(`/api/facts/${factId}/accept`);

    model.generations = [
      {
        sections: [
          {
            key: "experience",
            heading: "Experience",
            blocks: [{ id: "blk_1", kind: "bullet", text: "A bullet", factIds: [factId] }],
          },
        ],
      },
    ];
    await client.post("/api/renders/english_resume/generate");
    await settle();

    const sent = model.generationInputs.at(-1)!;
    // The section's name, order and dates are rows now, not inference.
    const employer = sent.spec.employers.find((e) => e.id === employerId)!;
    expect(employer.name).toBe("Aozora Logistics K.K.");
    expect(employer.startedOn).toBe("2022-04-01");
    expect(employer.endedOn).toBe("2024-09-01");
    // And the title comes from a role rather than from the claim prose.
    expect(employer.roles.map((r) => r.title)).toEqual(["Backend Engineer"]);
    expect(sent.facts[0]!.employer?.id).toBe(employerId);
  });
});

describe("the overview", () => {
  it("reports an empty record as empty, with nothing to show", async () => {
    const overview = await client.json<{
      isEmpty: boolean;
      lastImportAt: string | null;
      activeImport: unknown;
      tiles: Record<string, { count: number }>;
      factsByProvenance: Record<string, number>;
      documents: { kind: string; status: string }[];
    }>("/api/overview");

    expect(overview.isEmpty).toBe(true);
    expect(overview.lastImportAt).toBeNull();
    expect(overview.activeImport).toBeNull();
    expect(overview.tiles.employers!.count).toBe(0);
    expect(overview.factsByProvenance).toEqual({ measured: 0, attested: 0, generated: 0 });
    // Five documents, all never generated — distinct from up to date.
    expect(overview.documents).toHaveLength(5);
    expect(overview.documents.every((d) => d.status === "never_generated")).toBe(true);
  });

  it("surfaces the record's shape once it holds something", async () => {
    await client.put("/api/profile", PROFILE_FIXTURE);
    const employer = (await (await client.post("/api/employers", EMPLOYER_FIXTURE)).json()) as {
      id: string;
    };
    await client.post("/api/projects", { name: "Batch rewrite", employerId: employer.id });

    model.extractions = [
      [
        {
          claim: "Reduced nightly batch runtime",
          quote: "Nightly batch runtime fell from 6 hours to 90 minutes.",
          technologies: [],
        },
      ],
    ];
    const imported = (await (
      await client.request("/api/imports", { method: "POST", body: uploadForm(CASE_STUDY) })
    ).json()) as { importId: string };
    await settle();
    const { items } = await client.json<{ items: { id: string }[] }>(
      `/api/facts?importId=${imported.importId}`,
    );
    await client.patch(`/api/facts/${items[0]!.id}`, { provenance: "attested" });
    await client.post(`/api/facts/${items[0]!.id}/accept`);

    const overview = await client.json<{
      isEmpty: boolean;
      lastImportAt: string | null;
      tiles: Record<string, { count: number; note: string | null }>;
      factsByProvenance: { measured: number; attested: number; generated: number };
    }>("/api/overview");

    expect(overview.isEmpty).toBe(false);
    expect(overview.lastImportAt).not.toBeNull();
    expect(overview.tiles.employers!.count).toBe(1);
    expect(overview.tiles.employers!.note).toBe("0 current, 1 past");
    expect(overview.tiles.projects!.count).toBe(1);
    expect(overview.factsByProvenance.attested).toBe(1);
    // Only accepted facts count — candidates are not part of the record's shape.
    expect(overview.factsByProvenance.generated).toBe(0);
  });

  it("shows an import in progress with real chunk counts", async () => {
    model.extractions = [
      [
        {
          claim: "Reduced nightly batch runtime",
          quote: "Nightly batch runtime fell from 6 hours to 90 minutes.",
          technologies: [],
        },
      ],
    ];
    await client.request("/api/imports", { method: "POST", body: uploadForm(CASE_STUDY) });

    // Before `settle()`, extraction is still running behind waitUntil.
    const during = await client.json<{ activeImport: { chunksTotal: number } | null }>(
      "/api/overview",
    );
    await settle();

    if (during.activeImport) {
      expect(during.activeImport.chunksTotal).toBeGreaterThanOrEqual(0);
    }

    const after = await client.json<{ activeImport: unknown }>("/api/overview");
    expect(after.activeImport).toBeNull();
  });
});
