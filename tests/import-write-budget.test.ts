import { describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { harness, settle, stubModel } from "./helpers/harness";
import { seedAllowedUser } from "./helpers/seed";
import { createDb } from "~/server/db/client";
import { sourceDocuments } from "~/server/db/schema";
import type { Bindings } from "~/server/env";

vi.mock("~/shared/import-file", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/shared/import-file")>()),
  MAX_IMPORT_WRITE_BYTES: 80,
}));

describe("the encoded import write budget", () => {
  it("keeps accepted batch rows and lets a later small row fit", async () => {
    const user = await seedAllowedUser();
    const model = stubModel();
    const client = harness(model).as(user);
    const form = new FormData();
    for (const file of [
      new File(["a".repeat(20)], "first.txt"),
      new File(["b".repeat(20)], "second.txt"),
      new File(["c"], "later.txt"),
    ]) {
      form.append("file", file);
      form.append("filing", "{}");
    }

    const response = await client.request("/api/imports/batch", { method: "POST", body: form });
    expect(response.status).toBe(202);
    const { results } = (await response.json()) as { results: { importId?: string; reason?: string }[] };
    expect(results.map((row) => row.reason ?? "imported")).toEqual([
      "imported",
      "That file would make this import too large. Import it separately.",
      "imported",
    ]);
    await settle();
    const db = createDb((env as unknown as Bindings).DATABASE_URL);
    const stored = await db.select({ filename: sourceDocuments.filename }).from(sourceDocuments)
      .where(eq(sourceDocuments.userId, user.id));
    expect(stored.map((document) => document.filename).sort()).toEqual(["first.txt", "later.txt"]);
    expect(model.extractCalls).toHaveLength(2);
  });
});
