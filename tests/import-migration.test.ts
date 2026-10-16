import { env } from "cloudflare:test";
import { sql } from "drizzle-orm";
import { afterAll, expect, it } from "vitest";
import { createDb } from "~/server/db/client";
import type { Bindings } from "~/server/env";
import migration from "../src/server/db/migrations/0023_one_import_reading.sql?raw";

const db = createDb((env as unknown as Bindings).DATABASE_URL);
const schema = `mig23_${Math.trunc(Math.random() * 1e9)}`;

async function run(statements: string[]) {
  const [first, ...rest] = [`set local search_path to "${schema}"`, ...statements].map((statement) => db.execute(sql.raw(statement)));
  const results = await db.batch([first!, ...rest]);
  return results.slice(1) as { rows: Record<string, unknown>[] }[];
}

async function select(statement: string) {
  const [result] = await run([statement]);
  if (!result) throw new Error("select returned no result");
  return result.rows;
}

afterAll(async () => {
  await db.execute(sql.raw(`drop schema if exists "${schema}" cascade`));
});

it("refuses migration 0023 while imports read and preserves their rows", async () => {
  await db.execute(sql.raw(`create schema "${schema}"`));
  await run([
    `create table source_document_versions (id text primary key, user_id text not null, import_status text not null, import_error text)`,
    `insert into source_document_versions values
      ('sdv_invented_one', 'usr_invented', 'extracting', null),
      ('sdv_invented_two', 'usr_invented', 'extracting', null)`,
  ]);

  await expect(run([migration])).rejects.toThrow(/2 imports are extracting/);
  expect(await select(`select id, import_status, import_error from source_document_versions order by id`)).toEqual([
    { id: "sdv_invented_one", import_status: "extracting", import_error: null },
    { id: "sdv_invented_two", import_status: "extracting", import_error: null },
  ]);

  await run([`update source_document_versions set import_status = 'ready' where id = 'sdv_invented_two'`]);
  await expect(run([migration])).rejects.toThrow(/1 import is extracting/);
  await run([`update source_document_versions set import_status = 'ready' where id = 'sdv_invented_one'`]);
  await run([migration]);

  const rows = await select(`select id, import_status, import_error from source_document_versions order by id`);
  expect(rows.map((row) => row.import_status)).toEqual(["ready", "ready"]);
  const index = await select(`select indexname from pg_indexes where schemaname = '${schema}' and indexname = 'sdv_one_extracting_uq'`);
  expect(index).toEqual([{ indexname: "sdv_one_extracting_uq" }]);
});
