/**
 * An organisation out of credits is not an outage (issue #144,
 * `docs/06` 2026-10-24).
 *
 * The provider answers 400 `invalid_request_error` "Your credit balance is too
 * low…". The member is told in plain words that generation is paused, the work
 * is retryable, and the log carries an event of its own. The provider is
 * stubbed throughout; nothing here reaches the network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { harness, settle, stubModel, type Client, type StubModel } from "./helpers/harness";
import { asCandidates, PROFILE_FIXTURE, seedAllowedUser, uploadForm } from "./helpers/seed";
import { createAnthropicSeam } from "~/model/providers/anthropic";
import { CREDITS_EXHAUSTED_MESSAGE, ModelCreditsExhaustedError, ModelUnavailableError } from "~/model/types";

const SOURCE = "The overnight reconciliation job at Meridian Freight took eight hours.";
const CANDIDATE = {
  claim: "Cut the overnight reconciliation job from eight hours to fifty minutes",
  quote: SOURCE,
  technologies: [],
  provenance: "attested" as const,
  confidential: true,
  note: "It names a client",
};

let model: StubModel;
let client: Client;
let captured: string[];

beforeEach(async () => {
  captured = [];
  for (const method of ["log", "error", "warn", "info", "debug"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      captured.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    });
  }
  model = stubModel();
  client = harness(model).as(await seedAllowedUser());
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const outOfCredits = () => new ModelCreditsExhaustedError();
const creditEvents = () => captured.filter((line) => line.includes('"model_credits_exhausted"'));

describe("the provider's answer", () => {
  /** The SDK's own fetch is replaced, so the real client parses a stubbed response. */
  function answering(status: number, body: unknown) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })),
    );
    return createAnthropicSeam({ apiKey: "test-key-not-real", model: "stub-model" });
  }

  const flag = { kind: "unclear_impact", reason: "r", claim: "c", quote: "q", provenance: "attested", disclosure: "public" } as never;

  it("reads a credit-balance 400 as running out of credits, on every call it makes", async () => {
    const seam = answering(400, {
      type: "error",
      error: {
        type: "invalid_request_error",
        message:
          "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.",
      },
    });
    for (const call of [
      () => seam.extractFacts("text", { waiting: "interactive" }),
      () => seam.explainFlag(flag),
      () => seam.gradeFacts([{ id: "f", claim: "c", quote: "q" }]),
      () => seam.readPosting("a posting"),
    ]) {
      const err = await call().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ModelCreditsExhaustedError);
      expect(err).toBeInstanceOf(ModelUnavailableError);
      expect((err as Error).message).toBe(CREDITS_EXHAUSTED_MESSAGE);
    }
  });

  it("does not read any other 400 as running out of credits, and carries no body", async () => {
    const seam = answering(400, {
      type: "error",
      error: { type: "invalid_request_error", message: "max_tokens: field required — SECRET-SOURCE-TEXT" },
    });
    const err = await seam.explainFlag(flag).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelUnavailableError);
    expect(err).not.toBeInstanceOf(ModelCreditsExhaustedError);
    expect((err as Error).message).toBe("The model service returned 400.");
    expect(JSON.stringify(err)).not.toContain("SECRET-SOURCE-TEXT");
  });

  it("does not read a 529 as running out of credits", async () => {
    const seam = answering(529, { type: "error", error: { type: "overloaded_error", message: "Overloaded" } });
    const err = await seam.explainFlag(flag).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(ModelCreditsExhaustedError);
  });
});

describe("an import that runs out of credits", () => {
  it("says so plainly, logs its own event, and finishes when retried", async () => {
    await client.put("/api/profile", PROFILE_FIXTURE);
    model.extractions = [outOfCredits()];
    const created = (await (
      await client.request("/api/imports", { method: "POST", body: uploadForm(SOURCE) })
    ).json()) as { importId: string };
    await settle();

    const failed = await client.json<{ status: string; error: { code: string; message: string } | null }>(
      `/api/imports/${created.importId}`,
    );
    expect(failed.status).toBe("failed");
    expect(failed.error).toEqual({ code: "credits_exhausted", message: CREDITS_EXHAUSTED_MESSAGE });
    const listing = await client.json<{ documents: { versions: { importId: string; error: { code: string; message: string } | null }[] }[] }>(
      "/api/imports",
    );
    expect(listing.documents.flatMap((document) => document.versions).find((version) => version.importId === created.importId)?.error)
      .toEqual(failed.error);
    expect(creditEvents()).toHaveLength(1);
    expect(captured.join("\n")).not.toContain('"import_chunk_failed"');
    expect(captured.join("\n")).not.toContain("Meridian");

    // Credits arrived: the same import is retried, with no new upload.
    model.extractions = [[CANDIDATE]];
    await client.post(`/api/imports/${created.importId}/retry`);
    await settle();
    const recovered = await client.json<{ status: string; error: unknown }>(`/api/imports/${created.importId}`);
    expect(recovered.status).toBe("ready");
    expect(recovered.error).toBeNull();
  });
});

describe("a generation that runs out of credits", () => {
  it("says so plainly on the proposal, logs its own event, and can be generated again", async () => {
    await client.put("/api/profile", PROFILE_FIXTURE);
    model.extractions = [[CANDIDATE]];
    const created = (await (
      await client.request("/api/imports", { method: "POST", body: uploadForm(SOURCE) })
    ).json()) as { importId: string };
    await settle();
    const { items } = await client.json<{ items: { id: string }[] }>(`/api/facts?importId=${created.importId}`);
    await client.patch(`/api/facts/${items[0]!.id}`, { provenance: "measured", disclosure: "public" });
    await client.post(`/api/facts/${items[0]!.id}/accept`);

    model.generations = [outOfCredits()];
    const started = (await (await client.post("/api/renders/english_resume/generate")).json()) as {
      proposalId: string;
    };
    await settle();

    const proposal = await client.json<{ generationStatus: string; error: { code: string; message: string } | null }>(
      `/api/proposals/${started.proposalId}`,
    );
    expect(proposal.generationStatus).toBe("failed");
    expect(proposal.error).toEqual({ code: "credits_exhausted", message: CREDITS_EXHAUSTED_MESSAGE });
    expect(creditEvents()).toHaveLength(1);
    expect(captured.join("\n")).not.toContain('"generation_failed"');

    model.generations = [outOfCredits()];
    expect((await client.post("/api/renders/english_resume/generate")).status).toBe(202);
    // The retry runs in the background and fails the same way; let it finish
    // before the next test starts counting events.
    await settle();
  });
});

describe("the calls the member waits on", () => {
  async function aFlag(): Promise<string> {
    await client.put("/api/profile", PROFILE_FIXTURE);
    model.extractions = [[CANDIDATE]];
    await client.request("/api/imports", { method: "POST", body: uploadForm(SOURCE) });
    await settle();
    const { items } = await client.json<{ items: { id: string }[] }>("/api/flags");
    return items[0]!.id;
  }

  it("answers Explain this with the plain message as a 503, and keeps the flag unexplained", async () => {
    const id = await aFlag();
    model.explanations = [outOfCredits(), "It names a client."];

    const failed = await client.post(`/api/flags/${id}/explain`);
    expect(failed.status).toBe(503);
    expect(await failed.json()).toMatchObject({
      error: {
        code: "upstream_unavailable",
        message: CREDITS_EXHAUSTED_MESSAGE,
        // What lets a screen that words its own fallback say the true reason.
        details: { reason: "credits_exhausted" },
      },
    });
    expect(creditEvents()).toHaveLength(1);

    // Retryable: the next press explains it.
    expect((await client.post(`/api/flags/${id}/explain`)).status).toBe(200);
  });

  it("answers sorting facts with the plain message and changes nothing", async () => {
    await client.put("/api/profile", PROFILE_FIXTURE);
    model.extractions = [[CANDIDATE]];
    const created = (await (
      await client.request("/api/imports", { method: "POST", body: uploadForm(SOURCE) })
    ).json()) as { importId: string };
    await settle();
    await asCandidates(created.importId);
    model.gradings = [outOfCredits()];

    const failed = await client.post("/api/facts/sort", {});
    expect(failed.status).toBe(503);
    expect(await failed.json()).toMatchObject({ error: { message: CREDITS_EXHAUSTED_MESSAGE } });
    expect(creditEvents()).toHaveLength(1);
  });

  it("answers reading a posting with the plain message", async () => {
    model.postings = [outOfCredits()];
    const failed = await client.post("/api/applications/read-posting", {
      jobDescription: "Harrowgate Shipping is hiring a platform lead for its quayside systems.",
    });
    expect(failed.status).toBe(503);
    expect(await failed.json()).toMatchObject({ error: { message: CREDITS_EXHAUSTED_MESSAGE } });
    expect(creditEvents()).toHaveLength(1);
    expect(captured.join("\n")).not.toContain("Harrowgate");
  });

  it("answers quick capture with the plain message", async () => {
    model.captures = [outOfCredits()];
    const failed = await client.post("/api/capture/read", { text: "Led the quayside cutover last month." });
    expect(failed.status).toBe(503);
    expect(await failed.json()).toMatchObject({ error: { message: CREDITS_EXHAUSTED_MESSAGE } });
    expect(creditEvents()).toHaveLength(1);
  });
});
