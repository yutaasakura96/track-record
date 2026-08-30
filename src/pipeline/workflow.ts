/**
 * The Cloudflare Workflows adapter over `runImport` (`docs/06`, 2026-08-30).
 *
 * It carries no logic. Every step it wraps is a database checkpoint that the
 * inline runner reaches identically, which is why the pipeline is exercised by
 * ordinary API tests and this file is covered by the end-to-end smoke path.
 */
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { createDb } from "~/server/db/client";
import { createModelSeam } from "~/model";
import { runImport, type StepRunner } from "./import";
import type { Bindings } from "~/server/env";

export interface ImportWorkflowParams {
  userId: string;
  versionId: string;
}

export class ImportWorkflow extends WorkflowEntrypoint<Bindings, ImportWorkflowParams> {
  override async run(event: WorkflowEvent<ImportWorkflowParams>, step: WorkflowStep) {
    const runner: StepRunner = {
      // Every step here returns ids or a small literal — serializable by
      // construction, which the generic cannot prove.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      do: (name, fn) => step.do(name, fn as any) as any,
    };
    await runImport({
      db: createDb(this.env.DATABASE_URL),
      model: createModelSeam(this.env),
      userId: event.payload.userId,
      versionId: event.payload.versionId,
      step: runner,
    });
  }
}
