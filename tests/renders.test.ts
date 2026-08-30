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
import { EMPLOYER_FIXTURE, PROFILE_FIXTURE, seedAllowedUser, uploadForm } from "./helpers/seed";
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
