/**
 * Generation past the life of its request (`docs/06`, 2026-11-02).
 *
 * What is pinned here: with the binding present the route hands the proposal to
 * a Workflow and asks nothing of `waitUntil`, so a document may take far longer
 * than a request may live; the existing statuses and the dismiss path hold; a
 * retried step never bills twice for a document already landed; and `generating`
 * always ends, whatever goes wrong. The `GenerationWorkflow` class is run with a
 * fake step: no test reaches a real model.
 *
 * Every value here is INVENTED.
 */
import { env } from "cloudflare:test";
import type { WorkflowStep } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  GENERATE_STEP,
  GENERATION_DEADLINE_MS,
  GENERATION_LOST,
  GENERATION_STEP_LIMIT,
  generateProposal,
  generateStage,
  startGeneration,
  stepName,
} from "~/pipeline/generation";
import { GenerationWorkflow } from "~/pipeline/generation-workflow";
import { createDb } from "~/server/db/client";
import { facts, renderProposals } from "~/server/db/schema";
import type { Bindings } from "~/server/env";
import { newId } from "~/server/http/ids";
import { chaptersOf, writeStoryRound } from "~/model/generate";
import { FIRST_STAGE, RECORD_CHANGED_REASON, collectRenderInputs, generateIntoProposal, type GenerationStage } from "~/server/services/render";
import type { RenderContent } from "~/shared/render-content";
import { GenerationWorkflow as DeployedWorkflow } from "~/server/index";
import { harness, settle, stubModel, type Client, type SeededUser, type StubModel } from "./helpers/harness";
import { PROFILE_FIXTURE, postJob, seedAllowedUser } from "./helpers/seed";

const bindings = env as unknown as Bindings;
const db = createDb(bindings.DATABASE_URL);

const DOCUMENT = (factId: string): RenderContent => ({
  sections: [
    {
      key: "summary",
      heading: "Summary",
      blocks: [{ id: "blk_1", kind: "paragraph", text: "Runs a batch platform in Tokyo.", factIds: [factId] }],
    },
    {
      key: "projects",
      heading: "Projects",
      blocks: [{ id: "blk_2", kind: "bullet", text: "Cut the nightly batch to 90 minutes.", factIds: [factId] }],
    },
  ],
});

let model: StubModel;
let client: Client;
let user: SeededUser;
let factId: string;
let started: { id: string; params: unknown }[];

interface Proposal {
  status: string;
  generationStatus: string;
  error: { message: string } | null;
}

const proposal = (id: string) => client.json<Proposal>(`/api/proposals/${id}`);

/** What `run` in the Workflow does, for a proposal the test has in hand. */
const landing = (proposalId: string) => generateProposal({ db, model, userId: user.id, proposalId });

async function generate(): Promise<string> {
  const response = await client.post("/api/renders/english_resume/generate");
  expect(response.status).toBe(202);
  return ((await response.json()) as { proposalId: string }).proposalId;
}

/** Holds the next model call open until the test releases it. */
function holdModel(content: RenderContent) {
  let release = () => {};
  model.generations = [new Promise((resolve) => (release = () => resolve(content)))];
  return () => release();
}

/** A model that writes a story a round at a time, each part citing every fact it was sent. */
function storyWriter(rounds: string[][][], sentFacts: string[][] = []): StubModel["generateRender"] {
  return async (sent, spec) => {
    const calls: string[][] = [];
    const content = await writeStoryRound(sent, spec, async (partFacts, partSpec) => {
      calls.push(partSpec.part!.chapters);
      sentFacts.push(partFacts.map((f) => f.id));
      return {
        sections: chaptersOf(partSpec).map((chapter) => ({
          key: chapter.key,
          heading: partSpec.employers.find((e) => e.id === chapter.employerId)?.name ?? "Where it goes",
          blocks: [{
            kind: ["anchors", "routing"].includes(chapter.key) ? "row" : "paragraph",
            text: "Ran a batch platform.",
            factIds: partFacts.map((f) => f.id),
          }],
        })),
      };
    });
    rounds.push(calls);
    return content;
  };
}

beforeEach(async () => {
  model = stubModel();
  started = [];
  user = await seedAllowedUser();
  client = harness(model, {
    generationWorkflow: {
      create: async (options) => {
        started.push({ id: options!.id!, params: options!.params });
        return {} as WorkflowInstance;
      },
    },
  }).as(user);
  await client.put("/api/profile", PROFILE_FIXTURE);
  const employerId = await postJob(client);
  factId = newId("fact");
  await db.insert(facts).values({
    id: factId, userId: user.id, employerId, claim: "Cut the nightly batch to 90 minutes.",
    provenance: "attested", disclosure: "public", status: "accepted",
  });
});

describe("a generation in a Workflow", () => {
  it("is started with ids, and nothing of it runs on the request", async () => {
    const proposalId = await generate();
    await settle();

    expect(started).toEqual([{ id: proposalId, params: { userId: user.id, proposalId } }]);
    expect(model.generationInputs).toHaveLength(0);
    expect((await proposal(proposalId)).generationStatus).toBe("generating");
  });

  it("finishes long after the request is over, and the document can be accepted", async () => {
    const proposalId = await generate();
    await settle();
    const release = holdModel(DOCUMENT(factId));
    const run = landing(proposalId);

    // The request, and everything it gave `waitUntil`, ended before the model did.
    await vi.waitFor(() => expect(model.generationInputs).toHaveLength(1), { timeout: 20_000 });
    expect((await proposal(proposalId)).generationStatus).toBe("generating");
    const { items } = await client.json<{ items: { kind: string; status: string }[] }>("/api/renders");
    expect(items.find((row) => row.kind === "english_resume")?.status).toBe("proposal_generating");

    release();
    await run;
    expect((await proposal(proposalId)).generationStatus).toBe("ready");
    expect((await client.post(`/api/proposals/${proposalId}/accept`)).status).toBe(200);
  });

  it("gives a step long enough for the longest call, and few retries", () => {
    const minutes = Number(/^(\d+) minutes$/.exec(GENERATE_STEP.timeout)?.[1]);
    // A step is one call. The longest measured, a 職務経歴書 of 44,101 tokens,
    // and a call at the full 64,000, at about 48 a second. Thirty minutes is
    // Cloudflare's ceiling.
    expect(minutes * 60).toBeGreaterThan(44_101 / 48);
    expect(minutes * 60).toBeGreaterThan(64_000 / 48);
    expect(minutes).toBeLessThanOrEqual(30);
    expect(GENERATE_STEP.retries.limit).toBe(1);
    expect(GENERATION_DEADLINE_MS).toBeGreaterThan(GENERATION_STEP_LIMIT * 2 * minutes * 60_000);
  });

  it("gives the language check's retry and a résumé's long lines each a step of its own", async () => {
    const proposalId = await generate();
    const japanese: RenderContent = {
      sections: DOCUMENT(factId).sections.map((section) => ({
        ...section,
        blocks: section.blocks.map((block) => ({ ...block, text: "東京でバッチ基盤を運用した。" })),
      })),
    };
    const long = DOCUMENT(factId);
    long.sections[1]!.blocks[0]!.text = "Cut the nightly batch to 90 minutes. ".repeat(8).trim();
    model.generations = [japanese, long];
    model.shortenings = [{ blk_2: "Cut the nightly batch to 90 minutes." }];
    const deps = { db, model, userId: user.id, proposalId };

    const steps: string[] = [];
    const calls: number[] = [];
    let stage: GenerationStage | null = FIRST_STAGE;
    while (stage !== null) {
      expect((await proposal(proposalId)).generationStatus).toBe("generating");
      steps.push(stepName(stage));
      stage = await generateStage(deps, stage);
      calls.push(model.generationInputs.length + model.shortenCalls.length);
    }

    expect(steps).toEqual(["generate", "generate again", "shorten again"]);
    // One model call a step.
    expect(calls).toEqual([1, 2, 3]);
    const [row] = await db.select().from(renderProposals).where(eq(renderProposals.id, proposalId));
    expect(row!.generationStatus).toBe("ready");
    expect((row!.content as RenderContent).sections[1]!.blocks[0]!.text).toBe("Cut the nightly batch to 90 minutes.");
  });

  it("adds every step's usage to the proposal", async () => {
    model.usage = { inputTokens: 10, outputTokens: 5, cacheCreationInputTokens: 1, cacheReadInputTokens: 2 };
    const proposalId = await generate();
    const long = DOCUMENT(factId);
    long.sections[1]!.blocks[0]!.text = "x".repeat(300);
    model.generations = [long];
    model.shortenings = [{ blk_2: "Cut the nightly batch to 90 minutes." }];
    await landing(proposalId);

    const [row] = await db.select().from(renderProposals).where(eq(renderProposals.id, proposalId));
    expect(row).toMatchObject({ generationStatus: "ready", inputTokens: 20, outputTokens: 10, cacheCreationInputTokens: 2, cacheReadInputTokens: 4 });
  });

  it("stops a résumé's draft, rather than landing it against another read, when a cited fact turns Private", async () => {
    const proposalId = await generate();
    const long = DOCUMENT(factId);
    long.sections[1]!.blocks[0]!.text = "x".repeat(300);
    model.generations = [long];
    model.shortenings = [{ blk_2: "Cut the nightly batch to 90 minutes." }];
    const deps = { db, model, userId: user.id, proposalId };
    const next = await generateStage(deps, FIRST_STAGE);
    expect(next?.call).toBe("shorten");

    await db.update(facts).set({ disclosure: "private" }).where(eq(facts.id, factId));
    expect(await generateStage(deps, next!)).toBeNull();

    expect(model.shortenCalls).toHaveLength(0);
    const [row] = await db.select().from(renderProposals).where(eq(renderProposals.id, proposalId));
    expect(row).toMatchObject({ generationStatus: "failed", generationError: RECORD_CHANGED_REASON, content: { sections: [] } });
  });

  it("writes a career story a round per step: the employers, the chapters of no employer, the tables", async () => {
    const response = await client.post("/api/renders/career_story_en/generate");
    const { proposalId } = (await response.json()) as { proposalId: string };
    const rounds: string[][][] = [];
    model.generateRender = storyWriter(rounds);

    const steps: string[] = [];
    let stage: GenerationStage | null = FIRST_STAGE;
    while (stage !== null) {
      steps.push(stepName(stage));
      stage = await generateStage({ db, model, userId: user.id, proposalId }, stage);
    }

    expect(steps).toEqual(["generate", "generate round 2", "generate round 3"]);
    expect(rounds.map((round) => round.map((call) => call[0]))).toEqual([[expect.stringMatching(/^employer:/)], ["opening"], ["anchors"]]);
    expect((await proposal(proposalId)).generationStatus).toBe("ready");
  });

  it("stops a story when a fact is accepted between its rounds", async () => {
    const response = await client.post("/api/renders/career_story_en/generate");
    const { proposalId } = (await response.json()) as { proposalId: string };
    const sentFacts: string[][] = [];
    model.generateRender = storyWriter([], sentFacts);
    const deps = { db, model, userId: user.id, proposalId };

    const second = await generateStage(deps, FIRST_STAGE);
    expect(second?.round).toBe(2);
    const later = newId("fact");
    await db.insert(facts).values({
      id: later, userId: user.id, claim: "Wrote a side project's release tooling.", provenance: "attested", disclosure: "public", status: "accepted",
    });
    const sentBefore = sentFacts.length;
    expect(await generateStage(deps, second!)).toBeNull();

    expect(sentFacts).toHaveLength(sentBefore);
    expect((await proposal(proposalId)).error?.message).toBe(RECORD_CHANGED_REASON);
    // The same story, with the record left alone, lands.
    const next = (await (await client.post("/api/renders/career_story_en/generate")).json()) as { proposalId: string };
    let stage: GenerationStage | null = FIRST_STAGE;
    while (stage !== null) stage = await generateStage({ ...deps, proposalId: next.proposalId }, stage);
    expect((await proposal(next.proposalId)).generationStatus).toBe("ready");
  });

  it("keeps nothing a step wrote when the run ends without a document", async () => {
    const proposalId = await generate();
    const long = DOCUMENT(factId);
    long.sections[1]!.blocks[0]!.text = "x".repeat(300);
    model.generations = [long];
    const next = await generateStage({ db, model, userId: user.id, proposalId }, FIRST_STAGE);
    expect(next?.call).toBe("shorten");

    await client.post(`/api/proposals/${proposalId}/dismiss`);
    expect(await generateStage({ db, model, userId: user.id, proposalId }, next!)).toBeNull();
    expect(model.shortenCalls).toHaveLength(0);
    const [row] = await db.select().from(renderProposals).where(eq(renderProposals.id, proposalId));
    expect(row!.content).toEqual({ sections: [] });
  });

  it("uses the record as the run read it, not as the route did", async () => {
    const proposalId = await generate();
    const later = newId("fact");
    await db.insert(facts).values({
      id: later, userId: user.id, claim: "Wrote the on-call handbook.", provenance: "attested", disclosure: "public", status: "accepted",
    });
    model.generations = [DOCUMENT(factId)];
    await landing(proposalId);

    expect(model.generationInputs[0]!.facts.map((f) => f.id)).toContain(later);
    const [row] = await db.select().from(renderProposals).where(eq(renderProposals.id, proposalId));
    expect(row!.usableFactIds).toContain(later);
  });

  it("still fails with its stated reason when the model does", async () => {
    const proposalId = await generate();
    model.generations = [new Error("not a reason the author should read")];
    await landing(proposalId);

    const read = await proposal(proposalId);
    expect(read.generationStatus).toBe("failed");
    expect(read.error?.message).not.toContain("not a reason");
  });
});

describe("a retried or abandoned run", () => {
  it("does not call the model again for a document that landed", async () => {
    const proposalId = await generate();
    model.generations = [DOCUMENT(factId)];
    await landing(proposalId);
    await landing(proposalId);

    expect(model.generationInputs).toHaveLength(1);
  });

  it("does not call the model for a proposal dismissed before it started", async () => {
    const proposalId = await generate();
    await client.post(`/api/proposals/${proposalId}/dismiss`);
    await landing(proposalId);

    expect(model.generationInputs).toHaveLength(0);
    const [row] = await db.select().from(renderProposals).where(eq(renderProposals.id, proposalId));
    expect(row).toMatchObject({ status: "dismissed", generationStatus: "failed" });
  });

  it("keeps a proposal dismissed while the model was writing, and a new one can start", async () => {
    const proposalId = await generate();
    const release = holdModel(DOCUMENT(factId));
    const run = landing(proposalId);
    await vi.waitFor(() => expect(model.generationInputs).toHaveLength(1), { timeout: 20_000 });

    expect((await client.post(`/api/proposals/${proposalId}/dismiss`)).status).toBe(200);
    const next = await generate();
    release();
    await run;

    expect((await proposal(proposalId)).status).toBe("dismissed");
    expect((await proposal(next)).generationStatus).toBe("generating");
  });
});

describe("generating always ends", () => {
  /** The Workflow's own `run`, with a step that does what the test says. */
  const runWorkflow = async (proposalId: string, doStep: (name: string, run: () => Promise<unknown>) => Promise<unknown>) => {
    const instance = Object.create(GenerationWorkflow.prototype) as GenerationWorkflow & { env: Bindings };
    instance.env = bindings;
    const step = {
      do: (name: string, ...rest: unknown[]) => doStep(name, rest.at(-1) as () => Promise<unknown>),
    } as unknown as WorkflowStep;
    await instance.run({ payload: { userId: user.id, proposalId }, timestamp: new Date(), instanceId: proposalId, workflowName: "track-record-generation" }, step);
  };

  it("is deployed from the Worker's entry", () => {
    expect(DeployedWorkflow).toBe(GenerationWorkflow);
  });

  it("fails the proposal when the generate step runs out of attempts, and the author can try again", async () => {
    const proposalId = await generate();
    const steps: string[] = [];
    await runWorkflow(proposalId, async (name, run) => {
      steps.push(name);
      if (name === "generate") throw new Error("step timed out");
      return run();
    });

    expect(steps).toEqual(["generate", "stopped"]);
    const read = await proposal(proposalId);
    expect(read.generationStatus).toBe("failed");
    expect(read.error?.message).toBe(GENERATION_LOST);
    await generate();
  });

  it("fails the proposal, not the request, when a Workflow will not start", async () => {
    const refusing = harness(model, {
      generationWorkflow: {
        create: async () => {
          throw new Error("429");
        },
      },
    }).as(user);
    const response = await refusing.post("/api/renders/english_resume/generate");

    expect(response.status).toBe(202);
    const { proposalId } = (await response.json()) as { proposalId: string };
    expect((await proposal(proposalId)).generationStatus).toBe("failed");
  });

  it("refuses inline generation outside disposable test configuration", async () => {
    const proposalId = await generate();
    const waitUntil = vi.fn();
    await startGeneration({ db, model, userId: user.id, proposalId, workflow: undefined, inlineTest: undefined, waitUntil });
    expect(waitUntil).not.toHaveBeenCalled();
    expect(model.generationInputs).toHaveLength(0);
    expect((await proposal(proposalId)).generationStatus).toBe("failed");
  });

  it("fails a proposal read past its deadline, which a late run then cannot revive", async () => {
    const proposalId = await generate();
    await db
      .update(renderProposals)
      .set({ generatedAt: new Date(Date.now() - GENERATION_DEADLINE_MS - 1000) })
      .where(and(eq(renderProposals.userId, user.id), eq(renderProposals.id, proposalId)));

    expect((await proposal(proposalId)).generationStatus).toBe("failed");

    const next = await generate();
    model.generations = [DOCUMENT(factId)];
    await landing(next);
    expect((await proposal(next)).generationStatus).toBe("ready");

    // The run nobody was waiting for lands after all, beside a proposal now waiting.
    model.generations = [DOCUMENT(factId)];
    await generateIntoProposal({
      db, model, userId: user.id, proposalId,
      inputs: await collectRenderInputs(db, user.id, "english_resume", "Yosuke Aoki"),
    });
    expect((await proposal(proposalId)).generationStatus).toBe("failed");
  });

  it("leaves a proposal inside its deadline alone", async () => {
    const proposalId = await generate();
    expect((await proposal(proposalId)).generationStatus).toBe("generating");
  });
});
