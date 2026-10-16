/**
 * The import cost readout (`docs/06`, 2026-10-16; issue #92).
 *
 * The query runs against the real schema, the arithmetic is checked on figures
 * chosen so a wrong rate or a wrong column cannot look right, and the output is
 * checked for the text it must never carry. Every fixture is INVENTED.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createDb } from "~/server/db/client";
import { importChunks, sourceDocumentVersions, sourceDocuments } from "~/server/db/schema";
import { env } from "cloudflare:test";
import type { Bindings } from "~/server/env";
import {
  BATCH_FACTOR,
  RATES,
  RATES_READ_ON,
  RATES_SOURCE,
  estimateCost,
  formatReport,
  importUsageSql,
  type ImportUsage,
} from "~/pipeline/cost";
import { seedUser } from "./helpers/seed";

const db = createDb((env as unknown as Bindings).DATABASE_URL);

const FILENAME = "kakuu-shokumu-keirekisho-secret.docx";
const TEXT = "架空商事株式会社で架空の基幹システムを刷新した。";
const ERROR = "The model refused: 架空の機密文言 leaked-error-body";

let userId: string;
let counter = 0;

beforeEach(async () => {
  userId = (await seedUser()).id;
});

type Chunk = {
  status: "pending" | "done" | "failed";
  usage?: [number, number, number, number];
  error?: string;
};

async function seedImport(chunks: Chunk[], createdAt?: string): Promise<string> {
  const n = ++counter;
  const documentId = `doc_cost_${n}_${Math.trunc(Math.random() * 1e9)}`;
  const versionId = `sdv_cost_${n}_${Math.trunc(Math.random() * 1e9)}`;
  await db.insert(sourceDocuments).values({ id: documentId, userId, filename: FILENAME, mimeType: "text/plain" });
  await db.insert(sourceDocumentVersions).values({
    id: versionId,
    userId,
    sourceDocumentId: documentId,
    versionNo: 1,
    originalBytes: new TextEncoder().encode(TEXT),
    extractedText: TEXT,
    extractorVersion: "test",
    byteSize: TEXT.length,
    wordCount: 3,
    chunksTotal: chunks.length,
    ...(createdAt ? { createdAt: new Date(createdAt) } : {}),
  });
  for (const [index, chunk] of chunks.entries()) {
    const [i, o, w, r] = chunk.usage ?? [null, null, null, null];
    await db.insert(importChunks).values({
      id: `chk_cost_${n}_${index}_${Math.trunc(Math.random() * 1e9)}`,
      userId,
      sourceDocumentVersionId: versionId,
      chunkIndex: index,
      startOffset: 0,
      endOffset: TEXT.length,
      status: chunk.status,
      error: chunk.error ?? null,
      inputTokens: i,
      outputTokens: o,
      cacheCreationInputTokens: w,
      cacheReadInputTokens: r,
    });
  }
  return versionId;
}

async function readUsage(versionId: string | null) {
  const result = await db.execute<{ json_build_object: ImportUsage & { id: string } }>(sql.raw(importUsageSql(versionId)));
  const row = result.rows[0]?.json_build_object;
  if (!row) throw new Error("no row");
  const { id, ...usage } = row;
  return { id, usage: usage as ImportUsage };
}

describe("the rates", () => {
  it("name their source and the day they were read", () => {
    expect(RATES_SOURCE).toMatch(/^https:\/\/platform\.claude\.com\/.*pricing$/);
    expect(RATES_READ_ON).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("the cost arithmetic", () => {
  // One million of each kind, so each rate is read straight off the total.
  const MILLION: ImportUsage = {
    chunksTotal: 1,
    chunksDone: 1,
    chunksFailed: 0,
    chunksWithoutUsage: 0,
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
    cacheCreationInputTokens: 1_000_000,
    cacheReadInputTokens: 1_000_000,
  };

  it("prices each token kind at its own rate", () => {
    const cost = estimateCost(MILLION);
    expect(cost.input).toBeCloseTo(RATES.input);
    expect(cost.output).toBeCloseTo(RATES.output);
    expect(cost.cacheWrite).toBeCloseTo(RATES.cacheWrite);
    expect(cost.cacheRead).toBeCloseTo(RATES.cacheRead);
    expect(cost.total).toBeCloseTo(RATES.input + RATES.output + RATES.cacheWrite + RATES.cacheRead);
  });

  it("halves the whole bill on the batch route", () => {
    expect(estimateCost(MILLION, RATES, BATCH_FACTOR).total).toBeCloseTo(estimateCost(MILLION).total / 2);
  });
});

describe("reading an import", () => {
  it("sums the four columns and counts done and failed chunks", async () => {
    const id = await seedImport([
      { status: "done", usage: [1200, 340, 933, 0] },
      { status: "done", usage: [800, 100, 0, 872] },
      { status: "failed", error: ERROR },
    ]);
    const { usage } = await readUsage(id);

    expect(usage).toEqual({
      chunksTotal: 3,
      chunksDone: 2,
      chunksFailed: 1,
      chunksWithoutUsage: 1,
      inputTokens: 2000,
      outputTokens: 440,
      cacheCreationInputTokens: 933,
      cacheReadInputTokens: 872,
    });
    // (2000*5 + 440*25 + 933*10 + 872*0.5) / 1e6
    expect(estimateCost(usage).total).toBeCloseTo(0.030766, 6);
  });

  it("reports chunks with no usage as unrecorded, not free", async () => {
    const id = await seedImport([{ status: "done" }, { status: "done" }]);
    const { usage } = await readUsage(id);

    expect(usage.chunksWithoutUsage).toBe(2);
    expect(usage.inputTokens).toBe(0);
    expect(estimateCost(usage).total).toBe(0);
    expect(formatReport(id, usage)).toContain("2 chunk(s) carry no usage");
  });

  it("picks the newest import when none is named", async () => {
    await seedImport([{ status: "done", usage: [1, 1, 1, 1] }], "2020-01-01T00:00:00Z");
    const newest = await seedImport([{ status: "done", usage: [7, 7, 7, 7] }], "2099-01-01T00:00:00Z");
    expect((await readUsage(null)).id).toBe(newest);
  });

  it("refuses an id that is not shaped like one", () => {
    expect(() => importUsageSql("x'; drop table users; --")).toThrow();
  });
});

describe("what the output carries", () => {
  it("holds no filename, source text, claim or error body", async () => {
    const id = await seedImport([
      { status: "done", usage: [1200, 340, 933, 872] },
      { status: "failed", error: ERROR },
    ]);
    const { id: read, usage } = await readUsage(id);
    const output = formatReport(read, usage);

    expect(output).toContain(id);
    for (const secret of [FILENAME, "docx", TEXT, "架空", ERROR, "leaked-error-body"]) {
      expect(output).not.toContain(secret);
    }
    // The query's own result has nothing but an id and counts either.
    expect(Object.keys(usage).sort()).toEqual([
      "cacheCreationInputTokens",
      "cacheReadInputTokens",
      "chunksDone",
      "chunksFailed",
      "chunksTotal",
      "chunksWithoutUsage",
      "inputTokens",
      "outputTokens",
    ]);
  });
});
