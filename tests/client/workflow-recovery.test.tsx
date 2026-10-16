import { expect, it } from "vitest";
import { ensureWorkflow } from "~/pipeline/queue";
import type { Bindings } from "~/server/env";

it("creates a missing instance with the version ID and leaves a running one alone", async () => {
  const created: { id: string; params: unknown }[] = [];
  const instance = { status: async () => ({ status: "running" }), restart: async () => { throw new Error("Restarted a running instance"); } };
  let exists = false;
  const workflow = {
    async get(id: string) {
      if (!exists || id !== "version-a") throw new Error("Missing instance");
      return instance;
    },
    async create(options: { id: string; params: unknown }) {
      created.push(options);
      exists = true;
      return instance;
    },
  } as unknown as NonNullable<Bindings["IMPORT_WORKFLOW"]>;
  await ensureWorkflow(workflow, "user-a", "version-a");
  await ensureWorkflow(workflow, "user-a", "version-a");
  expect(created).toEqual([{ id: "version-a", params: { userId: "user-a", versionId: "version-a" } }]);
});

it("restarts a completed instance when its import is retried", async () => {
  let restarted = 0;
  const workflow = {
    async get() {
      return { status: async () => ({ status: "complete" }), restart: async () => { restarted++; } };
    },
    async create() { throw new Error("Created a duplicate instance"); },
  } as unknown as NonNullable<Bindings["IMPORT_WORKFLOW"]>;
  await ensureWorkflow(workflow, "user-a", "version-a");
  expect(restarted).toBe(1);
});
