/**
 * Model cost telemetry: every call the pipeline makes records what it cost.
 *
 * These assertions read columns rather than an API response, which `docs/11`
 * §2 otherwise rules out. The exception is deliberate and narrow: the stored
 * row IS the deliverable here. There is no screen and no endpoint that reports
 * token counts, so there is no higher seam to observe — asserting through the
 * API would mean inventing a surface for the test's benefit.
 *
 * What is being protected is the claim in `docs/06` (2026-09-04) that the seam
 * "streams and discards `usage` entirely". Once that stops being true, the way
 * it silently becomes true again is a refactor that drops the callback, which
 * no other test would notice.
 *
 * All fixtures are INVENTED. Nothing is sampled from `local/`.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { harness, settle, stubModel, type Client, type Harness, type StubModel } from "./helpers/harness";
import { CASE_STUDY, PROFILE_FIXTURE, seedAllowedUser, uploadForm } from "./helpers/seed";
import { importChunks, renderProposals } from "~/server/db/schema";
import { ModelUnavailableError, type ModelUsage } from "~/model/types";

/**
 * Distinct values per field, so a test cannot pass by reading the right number
 * out of the wrong column.
 */
const USAGE: ModelUsage = {
  inputTokens: 1200,
  outputTokens: 340,
  cacheCreationInputTokens: 933,
  cacheReadInputTokens: 872,
};

let model: StubModel;
let app: Harness;
let client: Client;
let userId: string;

beforeEach(async () => {
  model = stubModel();
  app = harness(model);
  const user = await seedAllowedUser();
  userId = user.id;
  client = app.as(user);
});

async function importDocument() {
  const response = await client.request("/api/imports", {
    method: "POST",
    body: uploadForm(CASE_STUDY),
  });
  await settle();
  return response;
}

const chunkRows = () =>
  app.db.select().from(importChunks).where(eq(importChunks.userId, userId));

describe("extraction usage", () => {
  it("records what each chunk's extraction call cost", async () => {
    model.usage = USAGE;
    await importDocument();

    const rows = await chunkRows();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.status).toBe("done");
      expect(row.inputTokens).toBe(USAGE.inputTokens);
      expect(row.outputTokens).toBe(USAGE.outputTokens);
      expect(row.cacheCreationInputTokens).toBe(USAGE.cacheCreationInputTokens);
      // The reading the 1-hour breakpoint has never been observed producing.
      expect(row.cacheReadInputTokens).toBe(USAGE.cacheReadInputTokens);
    }
  });

  it("leaves the columns null when the provider reports nothing", async () => {
    model.usage = undefined;
    await importDocument();

    const rows = await chunkRows();
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      // Null, not zero. "Not recorded" and "cost nothing" must stay tellable
      // apart, or every pre-telemetry row reads as a free import.
      expect(row.inputTokens).toBeNull();
      expect(row.cacheReadInputTokens).toBeNull();
    }
  });

  it("records nothing for a call that failed", async () => {
    model.usage = USAGE;
    model.extractions = [new ModelUnavailableError("The model service returned 529.")];
    await importDocument();

    const [row] = await chunkRows();
    expect(row?.status).toBe("failed");
    expect(row?.inputTokens).toBeNull();
  });
});

describe("generation usage", () => {
  it("records what the generation call cost on the proposal", async () => {
    model.usage = USAGE;
    await client.put("/api/profile", PROFILE_FIXTURE);
    model.extractions = [
      [
        {
          claim: "Reduced nightly batch runtime from 6 hours to 90 minutes",
          quote: "Nightly batch runtime fell from 6 hours to 90 minutes.",
          technologies: ["Airflow"],
        },
      ],
    ];
    await importDocument();

    const { items } = await client.json<{ items: { id: string }[] }>("/api/facts");
    expect(items.length).toBeGreaterThan(0);
    for (const fact of items) {
      // Generated-provenance facts never reach a render, so a fact left at the
      // extraction default would leave nothing to generate from.
      await client.patch(`/api/facts/${fact.id}`, { provenance: "attested", disclosure: "public" });
      await client.post(`/api/facts/${fact.id}/accept`);
    }

    model.generations = [{ sections: [] }];
    const response = await client.post("/api/renders/english_resume/generate");
    expect(response.status).toBe(202);
    const created = (await response.json()) as { proposalId: string };
    await settle();

    const [row] = await app.db
      .select()
      .from(renderProposals)
      .where(and(eq(renderProposals.userId, userId), eq(renderProposals.id, created.proposalId)));

    expect(row?.generationStatus).toBe("ready");
    expect(row?.inputTokens).toBe(USAGE.inputTokens);
    expect(row?.outputTokens).toBe(USAGE.outputTokens);
    expect(row?.cacheReadInputTokens).toBe(USAGE.cacheReadInputTokens);
  });

  it("records both calls when an English document came back in Japanese and was retried", async () => {
    model.usage = USAGE;
    await client.put("/api/profile", PROFILE_FIXTURE);
    model.extractions = [
      [
        {
          claim: "Reduced nightly batch runtime from 6 hours to 90 minutes",
          quote: "Nightly batch runtime fell from 6 hours to 90 minutes.",
          technologies: [],
        },
      ],
    ];
    await importDocument();
    const { items } = await client.json<{ items: { id: string }[] }>("/api/facts");
    for (const fact of items) {
      await client.patch(`/api/facts/${fact.id}`, { provenance: "attested", disclosure: "public" });
      await client.post(`/api/facts/${fact.id}/accept`);
    }

    const resume = (text: string) => ({
      sections: [{ key: "summary", heading: "Summary", blocks: [{ id: "blk_1", kind: "paragraph" as const, text, factIds: [] }] }],
    });
    model.generations = [resume("夜間バッチを6時間から90分に短縮しました。"), resume("Cut the nightly batch from 6 hours to 90 minutes.")];
    const created = (await (await client.post("/api/renders/english_resume/generate")).json()) as { proposalId: string };
    await settle();

    const [row] = await app.db
      .select()
      .from(renderProposals)
      .where(and(eq(renderProposals.userId, userId), eq(renderProposals.id, created.proposalId)));
    expect(row?.generationStatus).toBe("ready");
    // Two billed calls. A row reporting only the one that landed would make a
    // retried document look as cheap as one that was right first time.
    expect(row?.inputTokens).toBe(USAGE.inputTokens * 2);
    expect(row?.outputTokens).toBe(USAGE.outputTokens * 2);
    expect(row?.cacheCreationInputTokens).toBe(USAGE.cacheCreationInputTokens * 2);
    expect(row?.cacheReadInputTokens).toBe(USAGE.cacheReadInputTokens * 2);

    // Refused after its retry: no proposal, but still two billed calls.
    await client.post(`/api/proposals/${created.proposalId}/dismiss`);
    model.generations = [resume("夜間バッチを短縮しました。"), resume("夜間バッチを短縮しました。")];
    const refused = (await (await client.post("/api/renders/english_resume/generate")).json()) as { proposalId: string };
    await settle();
    const [failed] = await app.db
      .select()
      .from(renderProposals)
      .where(and(eq(renderProposals.userId, userId), eq(renderProposals.id, refused.proposalId)));
    expect(failed?.generationStatus).toBe("failed");
    expect(failed?.inputTokens).toBe(USAGE.inputTokens * 2);
    expect(failed?.outputTokens).toBe(USAGE.outputTokens * 2);
  });
});
