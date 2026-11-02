/**
 * Generation as a run of its own (`docs/06`, 2026-11-02).
 *
 * A real document takes 75 to 145 seconds, and a request's `waitUntil` lasts 30
 * after the response. So the route writes the proposal and hands it here; the
 * Workflow in `./generation-workflow.ts` carries it, and in disposable tests
 * and the demo seed the same function runs behind
 * `waitUntil`, as an import does.
 *
 * The run carries ids and reads the record itself. What the model is sent is
 * far past what a Workflow's parameters should hold, and none of it belongs in
 * a Workflow's stored state.
 */
import { and, eq } from "drizzle-orm";
import type { Db } from "~/server/db/client";
import { profiles, renderProposals, renders } from "~/server/db/schema";
import type { Bindings } from "~/server/env";
import { collectRenderInputs, failProposal, generateIntoProposal, tailoringOf } from "~/server/services/render";
import type { RenderKind } from "~/shared/render-content";
import type { ModelSeam } from "~/model/types";

export const GENERATION_LOST = "This document could not be generated. Nothing was saved. Generate it again.";

/**
 * Per attempt, and an attempt can hold two model calls: a document that fails
 * its language check is written once more. At 32,000 tokens and about 100 a
 * second that is under eleven minutes.
 *
 * One retry, not the default five. A model failure is written to the proposal
 * and does not reach here, so what retries is a lost run or a database that did
 * not answer, and each attempt is billed.
 */
export const GENERATE_STEP = {
  retries: { limit: 1, delay: "30 seconds", backoff: "constant" },
  timeout: "20 minutes",
} as const;

/**
 * Past both attempts of {@link GENERATE_STEP}, a proposal still `generating`
 * has no run left behind it. Reading it fails it, so the author gets the failed
 * screen's way out and not a page that says it is writing forever.
 */
export const GENERATION_DEADLINE_MS = 45 * 60 * 1000;

export interface GenerationDeps {
  db: Db;
  model: ModelSeam;
  userId: string;
  proposalId: string;
}

/**
 * Reads the record as it stands and writes the document to the proposal.
 *
 * A proposal already dismissed or already landed costs nothing: this is what a
 * retried step meets when the attempt before it got that far, and what a run
 * that was queued meets when the author changed their mind.
 */
export async function generateProposal({ db, model, userId, proposalId }: GenerationDeps): Promise<null> {
  const [row] = await db
    .select({ proposal: renderProposals, render: renders, nameLatin: profiles.nameLatin })
    .from(renderProposals)
    .innerJoin(renders, and(eq(renders.id, renderProposals.renderId), eq(renders.userId, userId)))
    .leftJoin(profiles, eq(profiles.userId, userId))
    .where(and(eq(renderProposals.userId, userId), eq(renderProposals.id, proposalId)))
    .limit(1);
  if (!row || row.proposal.generationStatus !== "generating") return null;
  if (row.proposal.status !== "pending") {
    await failProposal(db, userId, proposalId, "Dismissed before it was written.");
    return null;
  }

  const tailoring = await tailoringOf(db, userId, row.render);
  const inputs = await collectRenderInputs(db, userId, row.render.kind as RenderKind, row.nameLatin ?? "", tailoring, { forModel: true });
  // Counts only.
  if (inputs.omittedFactCount > 0) {
    console.log(JSON.stringify({ event: "generation_facts_left_out", proposalId, sent: inputs.facts.length, omitted: inputs.omittedFactCount }));
  }
  await generateIntoProposal({ db, model, userId, proposalId, inputs });
  return null;
}

/** The last word on a run that could not finish. Ids only in the log. */
export async function stopGeneration({ db, userId, proposalId }: Pick<GenerationDeps, "db" | "userId" | "proposalId">): Promise<null> {
  await failProposal(db, userId, proposalId, GENERATION_LOST);
  console.error(JSON.stringify({ event: "generation_lost", proposalId }));
  return null;
}

/**
 * Hands the proposal to the Workflow when the binding exists; otherwise runs
 * the same function behind `waitUntil`. A Workflow that will not start fails
 * the proposal, which the screen can say, and not the request: the proposal
 * row is written and the author would otherwise be left polling it.
 */
export async function startGeneration(
  deps: GenerationDeps & {
    workflow: Bindings["GENERATION_WORKFLOW"];
    inlineTest: Bindings["GENERATION_INLINE_TEST"];
    waitUntil: (work: Promise<unknown>) => void;
  },
): Promise<void> {
  const { workflow, inlineTest, waitUntil, ...run } = deps;
  if (!workflow) {
    if (inlineTest !== "true") {
      await stopGeneration(run);
      return;
    }
    waitUntil(generateProposal(run).catch(() => stopGeneration(run)));
    return;
  }
  try {
    await workflow.create({ id: run.proposalId, params: { userId: run.userId, proposalId: run.proposalId } });
  } catch {
    await stopGeneration(run);
  }
}

/** How a proposal reads now: failed, once its deadline has passed with no result. */
export async function settleLostGeneration<P extends Pick<typeof renderProposals.$inferSelect, "id" | "generationStatus" | "generationError" | "generatedAt">>(
  db: Db,
  userId: string,
  proposal: P,
  now = Date.now(),
): Promise<P> {
  if (proposal.generationStatus !== "generating" || now - proposal.generatedAt.getTime() < GENERATION_DEADLINE_MS) return proposal;
  await stopGeneration({ db, userId, proposalId: proposal.id });
  return { ...proposal, generationStatus: "failed", generationError: GENERATION_LOST };
}
