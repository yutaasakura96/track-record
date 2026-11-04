/**
 * The Cloudflare Workflows adapter over `generateStage` (`docs/06`, 2026-11-02,
 * 2026-11-04): one step per stage, each with the whole step timeout. It carries
 * no logic; the steps' settings are in `./generation.ts`, and what passes from
 * one step to the next is a stage's labels, never what the model wrote.
 *
 * The `try` is what keeps a proposal from reading `generating` for ever: a step
 * that runs out of attempts ends here, and the author is told it failed.
 */
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { createDb } from "~/server/db/client";
import { createModelSeam } from "~/model";
import { GENERATE_STEP, generateStage, stepName, stopGeneration } from "./generation";
import { FIRST_STAGE, type GenerationStage } from "~/server/services/render";
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
      const deps = { db, model: createModelSeam(this.env), userId, proposalId };
      let stage: GenerationStage | null = FIRST_STAGE;
      while (stage !== null) {
        const current: GenerationStage = stage;
        stage = await step.do(stepName(current), GENERATE_STEP, () => generateStage(deps, current));
      }
    } catch {
      await step.do("stopped", () => stopGeneration({ db, userId, proposalId }));
    }
  }
}
