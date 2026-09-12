/**
 * Render gating, proposals, the diff and the download
 * (`docs/11-testing-plan.md` §2.3, §2.7).
 *
 * §2.3 is the leak the entire confidentiality model exists to prevent. The
 * third assertion in it matters as much as the first two: a Private fact is
 * filtered BEFORE the request is built, so it never leaves the database —
 * rather than being filtered out of the response afterwards.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { harness, settle, stubModel, type Client, type StubModel } from "./helpers/harness";
import {
  CERTIFICATION_FIXTURE,
  EDUCATION_FIXTURE,
  EMPLOYER_FIXTURE,
  PROFILE_FIXTURE,
  seedAllowedUser,
  uploadForm,
} from "./helpers/seed";
import { RENDER_DEFINITIONS } from "~/render/spec";
import { MOTIVATION_NOTICE, PROSE_SECTION_KEYS } from "~/render/rirekisho";
import { inDocumentOrder } from "~/server/services/render";
import type { RenderContent } from "~/shared/render-content";
import { ModelUnavailableError } from "~/model/types";

interface Fact {
  id: string;
  claim: string;
  provenance: string;
  disclosure: string;
}

interface RenderRow {
  kind: string;
  status: "never_generated" | "up_to_date" | "stale" | "proposal_pending";
  currentVersionNo: number | null;
  newFactsSince: number | null;
  pendingProposalId: string | null;
}

const SOURCE = [
  "Nightly batch runtime fell from 6 hours to 90 minutes.",
  "The team adopted trunk-based development that quarter.",
  "Latency on the public tracking route dropped after the rewrite.",
  "The ledger schema for the client was named acme_settlement_v2.",
].join("\n\n");

let model: StubModel;
let client: Client;

beforeEach(async () => {
  model = stubModel();
  client = harness(model).as(await seedAllowedUser());
  await client.put("/api/profile", PROFILE_FIXTURE);
});

/**
 * Builds the record §2.3 describes: a Measured/Public fact, an
 * Attested/Restricted fact, a Generated/Public fact accepted deliberately, and
 * a Measured/Private fact.
 */
async function seedRecord() {
  await client.post("/api/employers", EMPLOYER_FIXTURE);
  model.extractions = [
    [
      {
        claim: "Reduced nightly batch runtime from 6 hours to 90 minutes",
        quote: "Nightly batch runtime fell from 6 hours to 90 minutes.",
        technologies: ["Airflow"],
      },
      {
        claim: "Introduced trunk-based development",
        quote: "The team adopted trunk-based development that quarter.",
        technologies: [],
      },
      {
        claim: "Improved public route latency by around 30%",
        quote: "Latency on the public tracking route dropped after the rewrite.",
        technologies: [],
      },
      {
        claim: "Owned the client settlement ledger schema",
        quote: "The ledger schema for the client was named acme_settlement_v2.",
        technologies: ["PostgreSQL"],
      },
    ],
  ];

  const created = (await (
    await client.request("/api/imports", { method: "POST", body: uploadForm(SOURCE) })
  ).json()) as { importId: string };
  await settle();

  const { items } = await client.json<{ items: Fact[] }>(
    `/api/facts?importId=${created.importId}`,
  );
  const byClaim = (fragment: string) => items.find((f) => f.claim.includes(fragment))!;

  const measuredPublic = byClaim("nightly batch");
  const attestedRestricted = byClaim("trunk-based");
  const generatedPublic = byClaim("public route latency");
  const measuredPrivate = byClaim("settlement ledger");

  await client.patch(`/api/facts/${measuredPublic.id}`, {
    provenance: "measured",
    disclosure: "public",
  });
  await client.patch(`/api/facts/${attestedRestricted.id}`, {
    provenance: "attested",
    disclosure: "restricted",
  });
  await client.patch(`/api/facts/${generatedPublic.id}`, { disclosure: "public" });
  await client.patch(`/api/facts/${measuredPrivate.id}`, {
    provenance: "measured",
    disclosure: "private",
  });

  for (const fact of [measuredPublic, attestedRestricted, generatedPublic, measuredPrivate]) {
    await client.post(`/api/facts/${fact.id}/accept`);
  }

  return { measuredPublic, attestedRestricted, generatedPublic, measuredPrivate, importId: created.importId };
}

function resumeFrom(blocks: { text: string; factIds: string[] }[]): RenderContent {
  return {
    sections: [
      {
        key: "experience",
        heading: "Experience",
        blocks: blocks.map((b, i) => ({ id: `blk_${i + 1}`, kind: "bullet" as const, ...b })),
      },
    ],
  };
}

async function generate(content: RenderContent | Error) {
  model.generations = [content as RenderContent];
  const response = await client.post("/api/renders/english_resume/generate");
  await settle();
  return response;
}

/**
 * The 履歴書's two prose cells, under the keys `PROSE_SECTION_KEYS` fixes. Every
 * Japanese fixture here is INVENTED and visibly so.
 */
function rirekishoFrom(motivation: string, factIds: string[], kibou = "貴社規定に従います。"): RenderContent {
  return {
    sections: [
      {
        key: "motivation",
        heading: "志望動機・特技・アピールポイントなど",
        blocks: [{ id: "blk_1", kind: "paragraph", text: motivation, factIds }],
      },
      {
        key: "kibou",
        heading: "本人希望欄",
        blocks: [{ id: "blk_2", kind: "paragraph", text: kibou, factIds: [] }],
      },
    ],
  };
}

async function generateRirekisho(content: RenderContent) {
  model.generations = [content];
  const response = await client.post("/api/renders/rirekisho/generate");
  await settle();
  return response;
}

describe("what generation is given", () => {
  it("never sends a Private fact to the model", async () => {
    const record = await seedRecord();
    await generate(resumeFrom([{ text: "Reduced nightly batch runtime", factIds: [record.measuredPublic.id] }]));

    const sent = model.generationInputs.at(-1)!;
    const sentIds = sent.facts.map((f) => f.id);
    expect(sentIds).not.toContain(record.measuredPrivate.id);
    // Not merely absent by id — the claim itself never left the database.
    expect(JSON.stringify(sent.facts)).not.toContain("settlement ledger");
    expect(JSON.stringify(sent.facts)).not.toContain("acme_settlement_v2");
  });

  it("never sends a Generated fact to the model", async () => {
    const record = await seedRecord();
    await generate(resumeFrom([{ text: "Reduced nightly batch runtime", factIds: [record.measuredPublic.id] }]));

    const sent = model.generationInputs.at(-1)!;
    expect(sent.facts.map((f) => f.id)).not.toContain(record.generatedPublic.id);
    expect(sent.facts.every((f) => f.provenance !== "generated")).toBe(true);
  });

  it("does send the Measured and Restricted facts", async () => {
    const record = await seedRecord();
    await generate(resumeFrom([{ text: "Reduced nightly batch runtime", factIds: [record.measuredPublic.id] }]));

    const sentIds = model.generationInputs.at(-1)!.facts.map((f) => f.id);
    expect(sentIds).toContain(record.measuredPublic.id);
    expect(sentIds).toContain(record.attestedRestricted.id);
  });

  it("never sends source document text", async () => {
    await seedRecord();
    await generate(resumeFrom([{ text: "A bullet", factIds: [] }]));
    const sent = JSON.stringify(model.generationInputs.at(-1));
    expect(sent).not.toContain("Nightly batch runtime fell from");
  });

  it("reports withheld facts as a count and nothing else", async () => {
    const record = await seedRecord();
    const created = (await (
      await generate(resumeFrom([{ text: "Reduced nightly batch runtime", factIds: [record.measuredPublic.id] }]))
    ).json()) as { proposalId: string };

    const proposal = await client.json<{
      withheld: { privateFactCount: number; generatedFactCount: number };
    }>(`/api/proposals/${created.proposalId}`);

    expect(proposal.withheld.privateFactCount).toBe(1);
    expect(proposal.withheld.generatedFactCount).toBe(1);
    expect(JSON.stringify(proposal)).not.toContain("settlement ledger");
  });

  it("strips a fact id the model returned but was never given", async () => {
    const record = await seedRecord();
    const created = (await (
      await generate(
        resumeFrom([
          { text: "Reduced nightly batch runtime", factIds: [record.measuredPublic.id, record.measuredPrivate.id] },
        ]),
      )
    ).json()) as { proposalId: string };
    await client.post(`/api/proposals/${created.proposalId}/accept`);

    const download = await (
      await client.get("/api/renders/english_resume/download?format=md")
    ).text();
    expect(download).not.toContain(record.measuredPrivate.id);
  });
});

/**
 * The direction a document reads in belongs to the document, not to the record
 * (`docs/06`, 2026-09-07). Before that, it lived in the queries: the résumé
 * printed experience and certifications newest-first and education oldest-first,
 * because `educations` is queried ascending for 学歴 and the other two
 * descending. One document, two directions.
 */
describe("the order a document reads in", () => {
  it("hands the résumé every dated list newest-first", async () => {
    await seedRecord();
    // A row recorded only by the month it finished — the case migration 0005
    // exists for. `vocational` rather than a school rung so that the register
    // would actually print it: this asserts the order of the list, and a list
    // whose rows the résumé drops would assert nothing a reader sees.
    await client.post("/api/educations", {
      ...EDUCATION_FIXTURE,
      institution: "Sakaide Technical College",
      startedOn: null,
      endedOn: "2013-03-01",
      outcome: "completed",
      level: "vocational",
    });
    await client.post("/api/educations", EDUCATION_FIXTURE);
    await client.post("/api/educations", {
      ...EDUCATION_FIXTURE,
      institution: "Midorikawa Graduate School",
      startedOn: "2017-04-01",
      endedOn: "2019-03-01",
      level: "postgraduate",
    });
    await client.post("/api/certifications", CERTIFICATION_FIXTURE);
    await client.post("/api/certifications", {
      ...CERTIFICATION_FIXTURE,
      name: "Database Specialist",
      nameJa: "データベーススペシャリスト試験",
      issuedOn: "2021-06-01",
    });

    await generate(resumeFrom([{ text: "A bullet", factIds: [] }]));
    const sent = model.generationInputs.at(-1)!.spec;

    // Newest first, and the undated-start row sits at the month it does have
    // rather than at whichever end nulls sort to.
    expect(sent.educations.map((e) => e.institution)).toEqual([
      "Midorikawa Graduate School",
      "Midorikawa Institute of Technology",
      "Sakaide Technical College",
    ]);
    // The same direction, from a list whose query runs the other way round.
    expect(sent.certifications.map((c) => c.name)).toEqual([
      "Database Specialist",
      "Applied Information Technology Engineer",
    ]);
  });

  /**
   * `issued_on` is nullable and the query runs `desc`, which sorts nulls FIRST.
   * Until 2026-09-07 that put an undated licence at the head of the résumé's
   * certifications list, displacing the most recent real one from the only
   * position in that list a reader weighs.
   */
  it("reads a certification with no issue date last", async () => {
    await seedRecord();
    await client.post("/api/certifications", CERTIFICATION_FIXTURE);
    await client.post("/api/certifications", {
      ...CERTIFICATION_FIXTURE,
      name: "Ordinary Driving Licence",
      nameJa: "普通自動車第一種運転免許",
      issuedOn: null,
    });
    await client.post("/api/certifications", {
      ...CERTIFICATION_FIXTURE,
      name: "Database Specialist",
      issuedOn: "2021-06-01",
    });

    await generate(resumeFrom([{ text: "A bullet", factIds: [] }]));
    const sent = model.generationInputs.at(-1)!.spec;

    // The dated rows keep their direction, and the undated one is behind both
    // rather than in front of them.
    expect(sent.certifications.map((c) => c.name)).toEqual([
      "Database Specialist",
      "Applied Information Technology Engineer",
      "Ordinary Driving Licence",
    ]);
  });

  /**
   * Why that rule is at the boundary and not in the query: null placement flips
   * with the list. Nulls sort first in `desc` and last in `asc`, so a
   * query-level fix reads correctly for the résumé and puts the undated row at
   * the HEAD of the 履歴書's 免許・資格 — the same defect, mirrored.
   */
  it("keeps an undated row at the tail whichever direction the document reads", () => {
    const rows = [{ on: null }, { on: "2021-06-01" }, { on: "2019-06-01" }];
    const dateOf = (row: { on: string | null }) => row.on;

    expect(inDocumentOrder(rows, "newest_first", "newest_first", dateOf)).toEqual([
      { on: "2021-06-01" },
      { on: "2019-06-01" },
      { on: null },
    ]);
    expect(inDocumentOrder(rows, "newest_first", "oldest_first", dateOf)).toEqual([
      { on: "2019-06-01" },
      { on: "2021-06-01" },
      { on: null },
    ]);
  });

  it("states a direction on every render that can be generated", () => {
    for (const definition of Object.values(RENDER_DEFINITIONS)) {
      if (!definition.buildable) continue;
      expect(definition.chronology, `${definition.kind} states no chronology`).not.toBeNull();
    }
  });

  /**
   * The failure this exists to prevent is a specific one: `buildable` flipped
   * ahead of the register, so the first press of the button spends a real
   * generation on an empty prompt and produces a document from nothing
   * (`docs/06`, 2026-09-09).
   */
  it("states a register on every render that can be generated", () => {
    for (const definition of Object.values(RENDER_DEFINITIONS)) {
      if (!definition.buildable) continue;
      expect(definition.register.trim(), `${definition.kind} has an empty register`).not.toBe("");
    }
  });

  it("names both prose keys in the 履歴書 register, which is the reader's contract", () => {
    // `PROSE_SECTION_KEYS` is the reader's half; a register that emitted other
    // keys would produce a proposal whose cells are silently empty.
    const register = RENDER_DEFINITIONS.rirekisho.register;
    for (const key of Object.values(PROSE_SECTION_KEYS)) expect(register).toContain(`"${key}"`);
  });
});

describe("generation is blocked rather than producing an empty document", () => {
  it("states the reason when nothing has been accepted", async () => {
    const response = await client.post("/api/renders/english_resume/generate");
    expect(response.status).toBe(428);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("precondition_failed");
    expect(body.error.message).toMatch(/no accepted facts/i);
  });

  it("states the reason when every accepted fact is excluded", async () => {
    model.extractions = [
      [
        {
          claim: "Owned the client settlement ledger schema",
          quote: "The ledger schema for the client was named acme_settlement_v2.",
          technologies: [],
        },
      ],
    ];
    const created = (await (
      await client.request("/api/imports", { method: "POST", body: uploadForm(SOURCE) })
    ).json()) as { importId: string };
    await settle();
    const { items } = await client.json<{ items: Fact[] }>(`/api/facts?importId=${created.importId}`);
    await client.post(`/api/facts/${items[0]!.id}/accept`);

    const response = await client.post("/api/renders/english_resume/generate");
    expect(response.status).toBe(428);
    expect(((await response.json()) as { error: { message: string } }).error.message).toMatch(
      /unverified or private/i,
    );
  });
});

describe("the proposal", () => {
  it("is a proposal rather than a replacement, and shows as a diff", async () => {
    const record = await seedRecord();
    const first = (await (
      await generate(resumeFrom([{ text: "Reduced nightly batch runtime to 3 hours", factIds: [record.measuredPublic.id] }]))
    ).json()) as { proposalId: string };
    await client.post(`/api/proposals/${first.proposalId}/accept`);

    const second = (await (
      await generate(resumeFrom([{ text: "Reduced nightly batch runtime to 90 minutes", factIds: [record.measuredPublic.id] }]))
    ).json()) as { proposalId: string };

    // The stored version is untouched until the proposal is accepted.
    const renders = await client.json<{ items: RenderRow[] }>("/api/renders");
    const resume = renders.items.find((r) => r.kind === "english_resume")!;
    expect(resume.currentVersionNo).toBe(1);
    expect(resume.status).toBe("proposal_pending");
    expect(resume.pendingProposalId).toBe(second.proposalId);

    const diff = await client.json<{
      additions: number;
      removals: number;
      changes: {
        tokens: { op: string; text: string }[];
        rationale: { kind: string; text: string; factIds: string[] };
      }[];
    }>(`/api/proposals/${second.proposalId}/diff`);

    expect(diff.changes.length).toBeGreaterThan(0);
    const change = diff.changes[0]!;
    // Word-level, not line-level: the unchanged opening survives as `equal`.
    expect(change.tokens.some((t) => t.op === "equal" && t.text.includes("Reduced"))).toBe(true);
    expect(change.tokens.some((t) => t.op === "remove" && t.text.includes("3 hours"))).toBe(true);
    expect(change.tokens.some((t) => t.op === "add" && t.text.includes("90 minutes"))).toBe(true);

    // Every change states where it came from. A change with no rationale is a defect.
    for (const c of diff.changes) {
      expect(c.rationale.text.length).toBeGreaterThan(0);
      expect(c.rationale.kind).toBeTruthy();
    }
  });

  it("cites the facts and the source line behind a change", async () => {
    const record = await seedRecord();
    const created = (await (
      await generate(resumeFrom([{ text: "Reduced nightly batch runtime", factIds: [record.measuredPublic.id] }]))
    ).json()) as { proposalId: string };

    const diff = await client.json<{
      changes: { rationale: { kind: string; text: string; factIds: string[] } }[];
    }>(`/api/proposals/${created.proposalId}/diff`);

    const rationale = diff.changes[0]!.rationale;
    expect(rationale.kind).toBe("from_facts");
    expect(rationale.factIds).toContain(record.measuredPublic.id);
    expect(rationale.text).toMatch(/L\d+/);
    // The pointer, never the passage.
    expect(rationale.text).not.toContain("Nightly batch runtime fell");
  });

  it("accepts as a whole and leaves no per-change endpoint", async () => {
    const record = await seedRecord();
    const created = (await (
      await generate(resumeFrom([{ text: "Reduced nightly batch runtime", factIds: [record.measuredPublic.id] }]))
    ).json()) as { proposalId: string };

    const accepted = (await (
      await client.post(`/api/proposals/${created.proposalId}/accept`)
    ).json()) as { newVersionNo: number };
    expect(accepted.newVersionNo).toBe(1);

    // Deciding it twice cannot produce two outcomes.
    const again = await client.post(`/api/proposals/${created.proposalId}/accept`);
    expect(again.status).toBe(409);
  });

  it("leaves the stored version byte-identical when dismissed", async () => {
    const record = await seedRecord();
    const first = (await (
      await generate(resumeFrom([{ text: "First version bullet", factIds: [record.measuredPublic.id] }]))
    ).json()) as { proposalId: string };
    await client.post(`/api/proposals/${first.proposalId}/accept`);
    const before = await (await client.get("/api/renders/english_resume/download?format=md")).text();

    const second = (await (
      await generate(resumeFrom([{ text: "Wholly different bullet", factIds: [record.measuredPublic.id] }]))
    ).json()) as { proposalId: string };
    await client.post(`/api/proposals/${second.proposalId}/dismiss`);

    const after = await (await client.get("/api/renders/english_resume/download?format=md")).text();
    expect(after).toBe(before);

    // Retained rather than deleted — the decision is recoverable.
    const dismissed = await client.json<{ status: string }>(`/api/proposals/${second.proposalId}`);
    expect(dismissed.status).toBe("dismissed");
  });

  it("says nothing changed rather than showing an empty diff", async () => {
    const record = await seedRecord();
    const content = resumeFrom([{ text: "Identical bullet", factIds: [record.measuredPublic.id] }]);
    const first = (await (await generate(content)).json()) as { proposalId: string };
    await client.post(`/api/proposals/${first.proposalId}/accept`);

    const second = (await (await generate(content)).json()) as { proposalId: string };
    const proposal = await client.json<{ unchanged: boolean }>(`/api/proposals/${second.proposalId}`);
    expect(proposal.unchanged).toBe(true);

    const diff = await client.json<{ changes: unknown[] }>(
      `/api/proposals/${second.proposalId}/diff`,
    );
    expect(diff.changes).toHaveLength(0);
  });
});

describe("a failure never destroys a stored version", () => {
  it("keeps the current version readable when the model is unavailable", async () => {
    const record = await seedRecord();
    const first = (await (
      await generate(resumeFrom([{ text: "A good bullet", factIds: [record.measuredPublic.id] }]))
    ).json()) as { proposalId: string };
    await client.post(`/api/proposals/${first.proposalId}/accept`);
    const before = await (await client.get("/api/renders/english_resume/download?format=md")).text();

    model.generations = [new ModelUnavailableError("The model service returned 529.")];
    const failed = (await (await client.post("/api/renders/english_resume/generate")).json()) as {
      proposalId: string;
    };
    await settle();

    const proposal = await client.json<{
      generationStatus: string;
      error: { code: string; message: string } | null;
    }>(`/api/proposals/${failed.proposalId}`);
    expect(proposal.generationStatus).toBe("failed");
    expect(proposal.error?.message).toMatch(/529/);

    const after = await (await client.get("/api/renders/english_resume/download?format=md")).text();
    expect(after).toBe(before);
  });
});

describe("documents and downloads", () => {
  it("reports never_generated as distinct from up_to_date", async () => {
    const renders = await client.json<{ items: RenderRow[] }>("/api/renders");
    expect(renders.items).toHaveLength(5);
    expect(renders.items.every((r) => r.status === "never_generated")).toBe(true);
    expect(renders.items.every((r) => r.newFactsSince === null)).toBe(true);
  });

  it("counts the new facts that have arrived since a render was generated", async () => {
    const record = await seedRecord();
    const created = (await (
      await generate(resumeFrom([{ text: "A bullet", factIds: [record.measuredPublic.id] }]))
    ).json()) as { proposalId: string };
    await client.post(`/api/proposals/${created.proposalId}/accept`);

    let resume = (await client.json<{ items: RenderRow[] }>("/api/renders")).items.find(
      (r) => r.kind === "english_resume",
    )!;
    expect(resume.status).toBe("up_to_date");
    expect(resume.newFactsSince).toBe(0);

    // A fifth fact enters the record. It has to be a genuinely new claim about a
    // genuinely new passage: a re-offer of one already judged is suppressed, and
    // suppression is the behaviour a different test covers.
    model.extractions = [
      [
        {
          claim: "Added read replicas for reporting",
          quote: "A later pass added read replicas for reporting.",
          technologies: [],
        },
      ],
    ];
    const another = (await (
      await client.request("/api/imports", {
        method: "POST",
        body: uploadForm("A later pass added read replicas for reporting.\n", "second.md"),
      })
    ).json()) as { importId: string };
    await settle();
    const more = await client.json<{ items: Fact[] }>(`/api/facts?importId=${another.importId}`);
    for (const fact of more.items) await client.post(`/api/facts/${fact.id}/accept`);

    resume = (await client.json<{ items: RenderRow[] }>("/api/renders")).items.find(
      (r) => r.kind === "english_resume",
    )!;
    expect(resume.status).toBe("stale");
    expect(resume.newFactsSince).toBe(more.items.length);
  });

  it("downloads a .docx that is a zip with the Word MIME type", async () => {
    const record = await seedRecord();
    const created = (await (
      await generate(
        resumeFrom([{ text: "Reduced nightly batch runtime to 90 minutes", factIds: [record.measuredPublic.id] }]),
      )
    ).json()) as { proposalId: string };
    await client.post(`/api/proposals/${created.proposalId}/accept`);

    const response = await client.get("/api/renders/english_resume/download?format=docx");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(response.headers.get("content-disposition")).toMatch(/attachment; filename="resume-\d{4}-\d{2}-\d{2}\.docx"/);

    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(1000);
    // A zip local file header — "PK\x03\x04".
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  /**
   * Issue #7: the `.docx` opened, was structurally sound, and carried the
   * subject's name nowhere — no contact block, and `docProps/core.xml` reading
   * the `docx` library's `Un-named`. The router gates the whole application on
   * collecting a name *because* every render needs one to put on it.
   *
   * Unlike the rest of the 2026-09-02 walk's findings this one is not a
   * property of rendered pixels, so it has an automated home. It is asserted on
   * the Markdown download, which is built from the same `identityLines` the
   * `.docx` is: a `.docx` is a zip, and unzipping one to read it back would be
   * testing the `docx` library rather than this decision.
   */
  it("puts the subject's name and contact on every download", async () => {
    const record = await seedRecord();
    const created = (await (
      await generate(resumeFrom([{ text: "Reduced nightly batch runtime", factIds: [record.measuredPublic.id] }]))
    ).json()) as { proposalId: string };
    await client.post(`/api/proposals/${created.proposalId}/accept`);

    const markdown = await (await client.get("/api/renders/english_resume/download?format=md")).text();
    expect(markdown).toContain(PROFILE_FIXTURE.nameLatin);
    expect(markdown).toContain(PROFILE_FIXTURE.email);
  });

  /**
   * `docs/11` §2.3, second half, and the reason the identity block is composed
   * by the renderer from a narrow projection rather than written by the model:
   * `date_of_birth`, `phone`, `postal_code` and `address` are readable only by
   * the 履歴書 spec (`docs/04` §3.2). A header the model wrote would need the
   * profile in the prompt to write it.
   */
  it("keeps 履歴書-only PII out of the English résumé", async () => {
    const record = await seedRecord();
    const created = (await (
      await generate(resumeFrom([{ text: "Reduced nightly batch runtime", factIds: [record.measuredPublic.id] }]))
    ).json()) as { proposalId: string };
    await client.post(`/api/proposals/${created.proposalId}/accept`);

    const markdown = await (await client.get("/api/renders/english_resume/download?format=md")).text();
    expect(markdown).not.toContain(PROFILE_FIXTURE.phone);
    expect(markdown).not.toContain(PROFILE_FIXTURE.address);
    expect(markdown).not.toContain(PROFILE_FIXTURE.postalCode);
    expect(markdown).not.toContain(PROFILE_FIXTURE.dateOfBirth);
  });

  it("emits no source document text in a render or its download", async () => {
    const record = await seedRecord();
    const created = (await (
      await generate(resumeFrom([{ text: "Reduced nightly batch runtime", factIds: [record.measuredPublic.id] }]))
    ).json()) as { proposalId: string };
    await client.post(`/api/proposals/${created.proposalId}/accept`);

    const markdown = await (
      await client.get("/api/renders/english_resume/download?format=md")
    ).text();
    expect(markdown).not.toContain("Nightly batch runtime fell from");
    expect(markdown).not.toContain("acme_settlement_v2");
  });
});

describe("export", () => {
  it("carries every entity, provenance, disclosure and evidence pointer", async () => {
    const record = await seedRecord();
    const created = (await (
      await generate(resumeFrom([{ text: "A bullet", factIds: [record.measuredPublic.id] }]))
    ).json()) as { proposalId: string };
    await client.post(`/api/proposals/${created.proposalId}/accept`);

    const response = await client.get("/api/export");
    expect(response.headers.get("content-disposition")).toMatch(/attachment; filename="track-record-/);
    const body = (await response.json()) as Record<string, unknown[]> & {
      facts: { provenance: string; disclosure: string; quoteStart: number | null; quote: string | null }[];
    };

    for (const key of [
      "profile",
      "employers",
      "projects",
      "facts",
      "sourceDocuments",
      "sourceDocumentVersions",
      "renders",
      "renderVersions",
      "renderProposals",
    ]) {
      expect(body[key], key).toBeDefined();
    }
    expect(body.facts.length).toBe(4);
    expect(body.facts.every((f) => f.provenance && f.disclosure)).toBe(true);
    expect(body.facts.some((f) => f.quoteStart !== null)).toBe(true);

    // The evidence pointer is part of what makes this a real backup rather than
    // a summary: a fact's quote and offsets restore alongside it. What the
    // export does NOT carry is the source document body — a source document
    // never renders, exports, or appears in any output.
    expect(body.facts.some((f) => typeof f.quote === "string" && f.quote.length > 0)).toBe(true);
    const versions = body.sourceDocumentVersions as Record<string, unknown>[];
    expect(versions).toHaveLength(1);
    expect(versions[0]).not.toHaveProperty("extractedText");
    expect(versions[0]).not.toHaveProperty("originalBytes");
    expect(JSON.stringify(body)).not.toContain("We replaced the row-by-row");
  });
});

/**
 * The second buildable render, and the first Japanese one. What is asserted
 * here is the path the flip opened — the register reaching the model, the
 * warning reaching the author, and the diff reading the proposal with Japanese
 * rules — not the prose itself, which is the model's to write.
 */
describe("the 履歴書 is generable, and is generated in Japanese", () => {
  it("hands the model the 履歴書 register rather than the résumé's", async () => {
    await seedRecord();
    const response = await generateRirekisho(rirekishoFrom("架空商事で受発注データの移行を担当しました。", []));
    expect(response.status).toBe(202);

    const sent = model.generationInputs.at(-1)!.spec;
    expect(sent.kind).toBe("rirekisho");
    expect(sent.language).toBe("ja");
    expect(sent.register).toBe(RENDER_DEFINITIONS.rirekisho.register);
    // The 職歴 table reads ascending, and the payload is what decides it.
    expect(sent.register).not.toBe(RENDER_DEFINITIONS.english_resume.register);
  });

  it("says out loud that the 志望動機 half is not generated", async () => {
    await seedRecord();
    const response = await generateRirekisho(rirekishoFrom("架空商事で受発注データの移行を担当しました。", []));
    const body = (await response.json()) as { warnings: string[] };

    // A known gap rather than a silent one: the register refuses to invent a
    // company, and the author is told so rather than left to notice.
    expect(body.warnings).toContain(MOTIVATION_NOTICE);
  });

  it("repeats the notice on the proposal the author actually reviews", async () => {
    await seedRecord();
    const created = (await (
      await generateRirekisho(rirekishoFrom("架空商事で受発注データの移行を担当しました。", []))
    ).json()) as { proposalId: string };

    // The 202 is a response the author may never see; the review screen reads
    // this one, and it is where the decision is taken.
    const proposal = await client.json<{ warnings: string[] }>(`/api/proposals/${created.proposalId}`);
    expect(proposal.warnings).toContain(MOTIVATION_NOTICE);
  });

  it("carries no such notice on the English résumé", async () => {
    await seedRecord();
    const response = await generate(resumeFrom([{ text: "Reduced nightly batch runtime", factIds: [] }]));
    const { proposalId, warnings } = (await response.json()) as {
      proposalId: string;
      warnings: string[];
    };
    expect(warnings).toEqual([]);
    expect((await client.json<{ warnings: string[] }>(`/api/proposals/${proposalId}`)).warnings).toEqual([]);
  });

  it("seeds 本人希望欄 from the author's own note", async () => {
    await seedRecord();
    await client.put("/api/profile", { ...PROFILE_FIXTURE, desiredRoleNote: "在宅勤務を希望します。" });
    await generateRirekisho(rirekishoFrom("架空商事で受発注データの移行を担当しました。", []));

    expect(model.generationInputs.at(-1)!.spec.desiredRoleNote).toBe("在宅勤務を希望します。");
  });

  it("diffs a Japanese proposal at phrase granularity, not as a whole rewritten cell", async () => {
    const record = await seedRecord();
    const first = (await (
      await generateRirekisho(
        rirekishoFrom("社内システムの移行を担当し、処理時間を40%短縮しました。", [record.measuredPublic.id]),
      )
    ).json()) as { proposalId: string };
    await client.post(`/api/proposals/${first.proposalId}/accept`);

    const second = (await (
      await generateRirekisho(
        rirekishoFrom("社内システムの移行を担当し、処理時間を55%短縮しました。", [record.measuredPublic.id]),
      )
    ).json()) as { proposalId: string };

    const diff = await client.json<{
      changes: { tokens: { op: string; text: string }[] }[];
    }>(`/api/proposals/${second.proposalId}/diff`);

    const change = diff.changes[0]!;
    // Under the English tokenizer the whole sentence is one token, and this
    // whole cell reads as removed and re-added.
    expect(change.tokens.some((t) => t.op === "equal" && t.text.includes("社内システム"))).toBe(true);
    expect(change.tokens.some((t) => t.op === "remove" && t.text.includes("40%"))).toBe(true);
    expect(change.tokens.some((t) => t.op === "add" && t.text.includes("55%"))).toBe(true);
  });
});

/**
 * A hand edit (`docs/02` S16).
 *
 * The second writer of `render_versions`, and the first that no model touches.
 * What is asserted is that it APPENDS — the version an edit was made from stays
 * readable and downloadable afterwards — and that the four refusals hold, since
 * each of them exists to stop a silent loss rather than to be tidy.
 */
describe("a version is edited by hand", () => {
  interface Version {
    id: string;
    versionNo: number;
    origin: string;
    sourceVersionId: string | null;
    content: RenderContent;
  }

  async function acceptedResume() {
    const record = await seedRecord();
    const created = (await (
      await generate(
        resumeFrom([
          { text: "Cut nightly batch runtime from six hours to ninety minutes", factIds: [record.measuredPublic.id] },
          { text: "Introduced trunk-based development", factIds: [record.attestedRestricted.id] },
        ]),
      )
    ).json()) as { proposalId: string };
    await client.post(`/api/proposals/${created.proposalId}/accept`);
    return { record, version: await currentVersion() };
  }

  async function currentVersion(): Promise<Version> {
    const { items } = await client.json<{ items: { kind: string; currentVersionId: string }[] }>(
      "/api/renders",
    );
    const id = items.find((i) => i.kind === "english_resume")!.currentVersionId;
    return client.json<Version>(`/api/renders/english_resume/versions/${id}`);
  }

  const edit = (basedOnVersionId: string, content: unknown) =>
    client.post("/api/renders/english_resume/versions", { basedOnVersionId, content });

  /** The 履歴書 edit, in shape: one block comes off. */
  function without(content: RenderContent, index: number): RenderContent {
    return {
      sections: content.sections.map((s) => ({ ...s, blocks: s.blocks.filter((_, i) => i !== index) })),
    };
  }

  it("appends a version and leaves the one it was made from readable", async () => {
    const { version } = await acceptedResume();
    expect(version.versionNo).toBe(1);
    expect(version.origin).toBe("accepted");
    expect(version.sourceVersionId).toBeNull();

    const response = await edit(version.id, without(version.content, 1));
    expect(response.status).toBe(201);
    const body = (await response.json()) as { newVersionNo: number; origin: string; sourceVersionId: string };
    expect(body.newVersionNo).toBe(2);
    expect(body.origin).toBe("edited");
    expect(body.sourceVersionId).toBe(version.id);

    const now = await currentVersion();
    expect(now.content.sections[0]!.blocks).toHaveLength(1);

    // The point of the never-delete rule: what the edit removed is still there,
    // in the version it was removed from, and still assembles into a document.
    const v1 = await client.json<Version>(`/api/renders/english_resume/versions/${version.id}`);
    expect(v1.content.sections[0]!.blocks).toHaveLength(2);
    const download = await client.get(`/api/renders/english_resume/download?format=md&versionId=${version.id}`);
    expect(await download.text()).toContain("trunk-based development");
  });

  it("keeps the ids of the blocks it did not change and mints for the ones it adds", async () => {
    const { record, version } = await acceptedResume();
    const kept = version.content.sections[0]!.blocks[0]!;

    // The résumé edit, in shape: a bullet is transplanted in beside one that
    // stays. A client cannot mint an id, so the one it offers is discarded.
    const response = await edit(version.id, {
      sections: [
        {
          ...version.content.sections[0],
          blocks: [
            { ...kept, text: `${kept.text}, sustained` },
            { id: "blk_whatever", kind: "bullet", text: "Ran the migration in a single window", factIds: [record.measuredPublic.id] },
          ],
        },
      ],
    });
    expect(response.status).toBe(201);

    const blocks = (await currentVersion()).content.sections[0]!.blocks;
    expect(blocks[0]!.id).toBe(kept.id);
    expect(blocks[0]!.text).toBe(`${kept.text}, sustained`);
    expect(blocks[1]!.id).not.toBe("blk_whatever");
    expect(blocks[1]!.id).not.toBe(kept.id);
    // Above every id the previous version used, so it cannot land on the id of
    // a block the same edit deleted.
    expect(blocks[1]!.id).toBe("blk_3");
  });

  it("refuses an edit while a proposal is waiting", async () => {
    const { record, version } = await acceptedResume();
    await generate(resumeFrom([{ text: "A regenerated bullet", factIds: [record.measuredPublic.id] }]));

    const response = await edit(version.id, without(version.content, 1));
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { message: string; details: { proposalId: string } } };
    expect(body.error.message).toContain("proposal");
    expect(body.error.details.proposalId).toMatch(/^prp_/);

    // And the stored version is untouched by the refusal.
    expect((await currentVersion()).id).toBe(version.id);
  });

  it("refuses an edit made against a version that is no longer current", async () => {
    const { version } = await acceptedResume();
    await edit(version.id, without(version.content, 1));

    const stale = await edit(version.id, without(version.content, 0));
    expect(stale.status).toBe(409);
    expect((await currentVersion()).versionNo).toBe(2);
  });

  it("refuses an edit that changes nothing", async () => {
    const { version } = await acceptedResume();
    const response = await edit(version.id, version.content);
    expect(response.status).toBe(409);
    expect((await currentVersion()).versionNo).toBe(1);
  });

  it("refuses an edit that empties the document", async () => {
    const { version } = await acceptedResume();
    const response = await edit(version.id, {
      sections: version.content.sections.map((s) => ({ ...s, blocks: [] })),
    });
    expect(response.status).toBe(422);
    expect((await currentVersion()).versionNo).toBe(1);
  });

  /**
   * Enforcement point 4. A hand-typed block is the one way into a render that
   * generation's two filters never see, so the citations it carries are held to
   * the same rule they are.
   */
  it("refuses a block citing a Private, Generated, unaccepted or unknown fact", async () => {
    const { record, version } = await acceptedResume();
    const block = version.content.sections[0]!.blocks[0]!;

    const cases: [string, string][] = [
      [record.measuredPrivate.id, "Private"],
      [record.generatedPublic.id, "Generated"],
      ["fct_nosuchfactatall", "not in your record"],
    ];
    for (const [factId, reason] of cases) {
      const response = await edit(version.id, {
        sections: [
          {
            ...version.content.sections[0],
            blocks: [{ ...block, text: "A hand-typed line", factIds: [factId] }],
          },
        ],
      });
      expect(response.status, reason).toBe(422);
      const body = (await response.json()) as { error: { message: string } };
      expect(body.error.message).toContain(factId);
      // Ids and reasons, never claim text.
      expect(body.error.message).not.toContain("settlement ledger");
    }
    expect((await currentVersion()).versionNo).toBe(1);
  });

  it("does not report a stale document as current because it was edited", async () => {
    const record = await seedRecord();
    // Held back so that accepting it AFTER the version makes the render stale
    // by exactly one fact. It is cited by nothing, so no edit below depends on
    // its status.
    await client.post(`/api/facts/${record.measuredPrivate.id}/reject`);

    const created = (await (
      await generate(
        resumeFrom([
          { text: "Cut nightly batch runtime from six hours to ninety minutes", factIds: [record.measuredPublic.id] },
          { text: "Introduced trunk-based development", factIds: [record.attestedRestricted.id] },
        ]),
      )
    ).json()) as { proposalId: string };
    await client.post(`/api/proposals/${created.proposalId}/accept`);
    await client.post(`/api/facts/${record.measuredPrivate.id}/accept`);

    const version = await currentVersion();
    const before = await client.json<{ items: RenderRow[] }>("/api/renders");
    expect(before.items.find((i) => i.kind === "english_resume")!.newFactsSince).toBe(1);

    await edit(version.id, without(version.content, 1));

    // An edit consumes no fact. Resetting the counter here would report a
    // document as current because the author fixed a sentence in it.
    const after = await client.json<{ items: RenderRow[] }>("/api/renders");
    const row = after.items.find((i) => i.kind === "english_resume")!;
    expect(row.currentVersionNo).toBe(2);
    expect(row.status).toBe("stale");
    expect(row.newFactsSince).toBe(1);
  });

  it("refuses two blocks claiming one id rather than guessing which is which", async () => {
    const { version } = await acceptedResume();
    const block = version.content.sections[0]!.blocks[0]!;
    const response = await edit(version.id, {
      sections: [
        { ...version.content.sections[0], blocks: [block, { ...block, text: "A second line" }] },
      ],
    });
    expect(response.status).toBe(422);
    expect((await currentVersion()).versionNo).toBe(1);
  });

  it("does not hand out a version belonging to another render kind", async () => {
    const { version } = await acceptedResume();
    const response = await client.get(`/api/renders/rirekisho/versions/${version.id}`);
    expect(response.status).toBe(404);
  });
});

/**
 * Restore, the version list and the version diff (S14, `docs/06` 2026-09-12).
 *
 * The third writer of `render_versions`, and the one that can put a document
 * back into an era the record has moved on from. What is asserted is that it
 * APPENDS, that staleness MOVES with the content — the opposite of what an edit
 * does, deliberately — and that both refusals hold, since each exists to stop a
 * silent loss rather than to be tidy.
 */
describe("a version is restored", () => {
  interface Version {
    id: string;
    versionNo: number;
    origin: string;
    sourceVersionId: string | null;
    sourceVersionNo: number | null;
    acceptedAt: string;
    isCurrent: boolean;
    content: RenderContent;
  }

  const history = () =>
    client.json<{ currentVersionNo: number | null; items: Version[] }>(
      "/api/renders/english_resume/versions",
    );

  const version = (id: string) =>
    client.json<Version>(`/api/renders/english_resume/versions/${id}`);

  const restore = (id: string) =>
    client.post(`/api/renders/english_resume/versions/${id}/restore`);

  /** The new version as BOTH the list reports it and the content route does. */
  async function accept(content: RenderContent): Promise<Version> {
    const created = (await (await generate(content)).json()) as { proposalId: string };
    await client.post(`/api/proposals/${created.proposalId}/accept`);
    const listed = (await history()).items[0]!;
    return { ...listed, ...(await version(listed.id)) };
  }

  /**
   * Two versions, and one accepted fact that entered the record between them —
   * so v1 belongs to a three-fact era and v2 to a four-fact one, which is what
   * makes the staleness assertion below mean anything.
   */
  async function twoVersions() {
    const record = await seedRecord();
    // Held back so it can enter the record BETWEEN the two versions. It is
    // cited by neither, so no restore below depends on its status.
    await client.post(`/api/facts/${record.measuredPrivate.id}/reject`);

    const v1 = await accept(
      resumeFrom([
        { text: "Cut nightly batch runtime from six hours to ninety minutes", factIds: [record.measuredPublic.id] },
        { text: "Introduced trunk-based development", factIds: [record.attestedRestricted.id] },
      ]),
    );
    await client.post(`/api/facts/${record.measuredPrivate.id}/accept`);
    const v2 = await accept(
      resumeFrom([{ text: "Ran the migration in a single window", factIds: [record.measuredPublic.id] }]),
    );
    return { record, v1, v2 };
  }

  it("appends a version, leaves the one it replaced readable, and moves staleness back", async () => {
    const { v1, v2 } = await twoVersions();

    const before = await client.json<{ items: RenderRow[] }>("/api/renders");
    expect(before.items.find((i) => i.kind === "english_resume")!.status).toBe("up_to_date");

    const response = await restore(v1.id);
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      newVersionNo: number;
      origin: string;
      sourceVersionId: string;
      sourceVersionNo: number;
    };
    expect(body.newVersionNo).toBe(3);
    expect(body.origin).toBe("restored");
    expect(body.sourceVersionId).toBe(v1.id);
    expect(body.sourceVersionNo).toBe(1);

    // The content came back...
    const now = (await history()).items[0]!;
    expect(now.versionNo).toBe(3);
    expect((await version(now.id)).content).toEqual(v1.content);

    // ...and nothing was erased on the way: v2 is still readable and still
    // assembles into a document.
    expect((await version(v2.id)).content.sections[0]!.blocks).toHaveLength(1);
    const download = await client.get(
      `/api/renders/english_resume/download?format=md&versionId=${v2.id}`,
    );
    expect(download.status).toBe(200);
    expect(await download.text()).toContain("single window");

    // Staleness MOVED. The document's content is back in the three-fact era, so
    // the fact accepted after v1 is new again — the opposite of what an edit
    // does, and the honest reading of what a restore changed.
    const after = await client.json<{ items: RenderRow[] }>("/api/renders");
    const row = after.items.find((i) => i.kind === "english_resume")!;
    expect(row.currentVersionNo).toBe(3);
    expect(row.status).toBe("stale");
    expect(row.newFactsSince).toBe(1);
  });

  it("refuses a restore while a proposal is waiting", async () => {
    const { record, v1 } = await twoVersions();
    await generate(resumeFrom([{ text: "A regenerated bullet", factIds: [record.measuredPublic.id] }]));

    const response = await restore(v1.id);
    expect(response.status).toBe(409);
    const body = (await response.json()) as {
      error: { message: string; details: { proposalId: string } };
    };
    expect(body.error.message).toContain("proposal");
    expect(body.error.details.proposalId).toMatch(/^prp_/);
    expect((await history()).currentVersionNo).toBe(2);
  });

  it("refuses restoring the version that is already current", async () => {
    const { v2 } = await twoVersions();
    const response = await restore(v2.id);
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toContain("already the current version");
    // No identical version was appended to the history to say so.
    expect((await history()).items).toHaveLength(2);
  });

  /**
   * A version is a snapshot of what could be rendered in August, and a fact can
   * be set Private in September. The block sits at RENDER time, and the moment
   * the author chooses what the document is now is exactly render time.
   */
  it("refuses a restore whose target cites a fact that can no longer be rendered", async () => {
    const { record, v1 } = await twoVersions();
    await client.patch(`/api/facts/${record.measuredPublic.id}`, { disclosure: "private" });

    const response = await restore(v1.id);
    expect(response.status).toBe(422);
    const body = (await response.json()) as {
      error: { message: string; details: { facts: { factId: string; problem: string }[] } };
    };
    expect(body.error.message).toContain(record.measuredPublic.id);
    expect(body.error.details.facts).toEqual([
      { factId: record.measuredPublic.id, problem: "private" },
    ]);
    // Ids and reasons, never claim text.
    expect(body.error.message).not.toContain("nightly batch");
    expect((await history()).currentVersionNo).toBe(2);
  });

  it("does not restore a version belonging to another render kind", async () => {
    const { v1 } = await twoVersions();
    const response = await client.post(`/api/renders/rirekisho/versions/${v1.id}/restore`);
    expect(response.status).toBe(404);
  });

  it("reports how every version came to exist, and what each was made from", async () => {
    const { v1 } = await twoVersions();
    await restore(v1.id);

    const listed = await history();
    expect(listed.currentVersionNo).toBe(3);
    // Newest first.
    expect(listed.items.map((v) => v.versionNo)).toEqual([3, 2, 1]);
    expect(listed.items.map((v) => v.origin)).toEqual(["restored", "accepted", "accepted"]);
    // A history that shows the origin but not the parent says a restore
    // happened without saying to what.
    expect(listed.items[0]!.sourceVersionNo).toBe(1);
    expect(listed.items[1]!.sourceVersionNo).toBeNull();
    expect(listed.items.map((v) => v.isCurrent)).toEqual([true, false, false]);
  });

  it("answers with an empty history rather than a 404 before anything is generated", async () => {
    const listed = await history();
    expect(listed.currentVersionNo).toBeNull();
    expect(listed.items).toEqual([]);
  });

  it("compares two versions with the current one on the left", async () => {
    const { v1, v2 } = await twoVersions();

    const diff = await client.json<{
      additions: number;
      removals: number;
      changes: { tokens: { op: string; text: string }[]; rationale: { text: string } }[];
    }>(`/api/renders/english_resume/diff?from=${v2.id}&to=${v1.id}`);

    // `from` is the left column, so the diff reports what restoring v1 would
    // ADD rather than what it would undo.
    const added = diff.changes.flatMap((c) => c.tokens.filter((t) => t.op === "add").map((t) => t.text));
    expect(added.join(" ")).toContain("trunk-based");
    const removed = diff.changes.flatMap((c) => c.tokens.filter((t) => t.op === "remove").map((t) => t.text));
    expect(removed.join(" ")).toContain("single window");
    // Every change carries a rationale; one with none is a defect.
    expect(diff.changes.every((c) => c.rationale.text.length > 0)).toBe(true);
  });

  it("refuses a comparison that names only one version, and one of another kind", async () => {
    const { v1 } = await twoVersions();
    const incomplete = await client.get(`/api/renders/english_resume/diff?from=${v1.id}`);
    expect(incomplete.status).toBe(422);
    const wrongKind = await client.get(
      `/api/renders/rirekisho/diff?from=${v1.id}&to=${v1.id}`,
    );
    expect(wrongKind.status).toBe(404);
  });

  /**
   * The other half of the history. A dismissed proposal is retained and is not
   * a version, and it stays on the proposals route rather than being merged
   * into the versions payload.
   */
  it("lists a dismissed proposal separately from the versions", async () => {
    const { record } = await twoVersions();
    const created = (await (
      await generate(resumeFrom([{ text: "A bullet nobody wanted", factIds: [record.measuredPublic.id] }]))
    ).json()) as { proposalId: string };
    await client.post(`/api/proposals/${created.proposalId}/dismiss`);

    const listed = await client.json<{
      items: { id: string; status: string; decidedAt: string | null }[];
    }>("/api/proposals?kind=english_resume");
    const dismissed = listed.items.find((p) => p.id === created.proposalId)!;
    expect(dismissed.status).toBe("dismissed");
    expect(dismissed.decidedAt).not.toBeNull();

    // It never became a version, and the versions payload does not pretend it
    // did.
    expect((await history()).items).toHaveLength(2);
  });
});

/**
 * Issue #17. A stored version is a snapshot of what could be rendered when it
 * was accepted, not a standing permission to keep rendering it. Download is
 * render time, and it is the LAST render time there is: whatever a version
 * stores, the file that leaves the tool today obeys today's record.
 */
describe("a fact withheld after acceptance stops the download", () => {
  interface Version {
    id: string;
    content: RenderContent;
  }

  async function acceptedResume() {
    const record = await seedRecord();
    const created = (await (
      await generate(
        resumeFrom([
          { text: "Cut nightly batch runtime from six hours to ninety minutes", factIds: [record.measuredPublic.id] },
          { text: "Introduced trunk-based development", factIds: [record.attestedRestricted.id] },
        ]),
      )
    ).json()) as { proposalId: string };
    await client.post(`/api/proposals/${created.proposalId}/accept`);
    const { items } = await client.json<{ items: { id: string }[] }>(
      "/api/renders/english_resume/versions",
    );
    return { record, versionId: items[0]!.id };
  }

  it("refuses with 409 and names the fact, whether asked for by id or as the current version", async () => {
    const { record, versionId } = await acceptedResume();
    // It downloaded the day it was accepted.
    expect((await client.get("/api/renders/english_resume/download?format=md")).status).toBe(200);

    await client.patch(`/api/facts/${record.measuredPublic.id}`, { disclosure: "private" });

    for (const url of [
      "/api/renders/english_resume/download?format=md",
      `/api/renders/english_resume/download?format=md&versionId=${versionId}`,
      `/api/renders/english_resume/download?format=docx&versionId=${versionId}`,
    ]) {
      const response = await client.get(url);
      expect(response.status).toBe(409);
      const body = (await response.json()) as {
        error: { message: string; details: { facts: { factId: string; problem: string }[] } };
      };
      expect(body.error.message).toContain(record.measuredPublic.id);
      expect(body.error.details.facts).toEqual([
        { factId: record.measuredPublic.id, problem: "private" },
      ]);
      // Ids and reasons, never claim text.
      expect(body.error.message).not.toContain("nightly batch");
    }
  });

  /**
   * Why the refusal names the ids rather than stopping at "no". A refusal the
   * author cannot act on would leave a document they accepted permanently
   * inside the tool; the hand-edit route is the way out, and it produces a
   * version that downloads.
   */
  it("leaves the hand-edit route as the way out", async () => {
    const { record, versionId } = await acceptedResume();
    await client.patch(`/api/facts/${record.measuredPublic.id}`, { disclosure: "private" });

    const stored = await client.json<Version>(
      `/api/renders/english_resume/versions/${versionId}`,
    );
    const edited = await client.post("/api/renders/english_resume/versions", {
      basedOnVersionId: versionId,
      content: {
        sections: stored.content.sections.map((s) => ({
          ...s,
          blocks: s.blocks.filter((b) => !b.factIds.includes(record.measuredPublic.id)),
        })),
      },
    });
    expect(edited.status).toBe(201);

    const download = await client.get("/api/renders/english_resume/download?format=md");
    expect(download.status).toBe(200);
    const text = await download.text();
    expect(text).toContain("trunk-based development");
    expect(text).not.toContain("nightly batch");

    // The version that cited it is still stored and still refuses on its own.
    const old = await client.get(
      `/api/renders/english_resume/download?format=md&versionId=${versionId}`,
    );
    expect(old.status).toBe(409);
  });

  /**
   * The check sits before the 履歴書 branch, so the form path is held to it
   * too — a 履歴書 is filled rather than built, but its prose blocks cite facts
   * like any other.
   */
  it("holds the 履歴書 to the same rule", async () => {
    const record = await seedRecord();
    const created = (await (
      await generateRirekisho(
        rirekishoFrom("貴社の基盤刷新に携わりたいと考えております。", [record.measuredPublic.id]),
      )
    ).json()) as { proposalId: string };
    await client.post(`/api/proposals/${created.proposalId}/accept`);
    expect((await client.get("/api/renders/rirekisho/download?format=docx")).status).toBe(200);

    await client.patch(`/api/facts/${record.measuredPublic.id}`, { disclosure: "private" });
    const response = await client.get("/api/renders/rirekisho/download?format=docx");
    expect(response.status).toBe(409);
    const body = (await response.json()) as {
      error: { details: { facts: { factId: string; problem: string }[] } };
    };
    expect(body.error.details.facts).toEqual([
      { factId: record.measuredPublic.id, problem: "private" },
    ]);
  });
});
