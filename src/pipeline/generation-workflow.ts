/**
 * The Cloudflare Workflows adapter over `generateProposal` (`docs/06`,
 * 2026-11-02). It carries no logic; the steps' settings are in `./generation.ts`.
 *
 * The `try` is what keeps a proposal from reading `generating` for ever: a step
 * that runs out of attempts ends here, and the author is told it failed.
 */
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { createDb } from "~/server/db/client";
import { createModelSeam } from "~/model";
import { GENERATE_STEP, generateProposal, stopGeneration } from "./generation";
import type { Bindings } from "~/server/env";

export interface GenerationWorkflowParams {
  userId: string;
  proposalId: string;
}

export class GenerationWorkflow extends WorkflowEntrypoint<Bindings, GenerationWorkflowParams> {
  override async run(event: WorkflowEvent<GenerationWorkflowParams>, step: WorkflowStep) {
    const { userId, proposalId } = event.payload;
    const db = createDb(this.env.DATABASE_URL);
    try {
      await step.do("generate", GENERATE_STEP, () =>
        generateProposal({ db, model: createModelSeam(this.env), userId, proposalId }),
      );
    } catch {
      await step.do("stopped", () => stopGeneration({ db, userId, proposalId }));
    }
  }
}
