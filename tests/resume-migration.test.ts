import { env } from "cloudflare:test";
import { sql } from "drizzle-orm";
import { afterAll, expect, it } from "vitest";
import { createDb } from "~/server/db/client";
import type { Bindings } from "~/server/env";
import migration from "../src/server/db/migrations/0027_resume_layout.sql?raw";

const db = createDb((env as unknown as Bindings).DATABASE_URL);
const schema = `resume_mig_${Math.trunc(Math.random() * 1e9)}`;

afterAll(async () => {
  await db.execute(sql.raw(`drop schema if exists "${schema}" cascade`));
});

it("classifies existing language qualifications during migration", async () => {
  await db.execute(sql.raw(`create schema "${schema}"`));
  const statements = [
    `set local search_path to "${schema}"`,
    `create table certifications (id text primary key, name text not null, name_ja text)`,
    `create table employers (id text primary key)`,
    `create table profiles (id text primary key)`,
    `insert into certifications values ('toeic', 'TOEIC Listening & Reading', null), ('eiken', 'Eiken 1', '英検'), ('technical', 'Cloud Architect', null)`,
    ...migration.replaceAll('"public".', `"${schema}".`).split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean),
    `select id, kind from certifications order by id`,
  ];
  const [first, ...rest] = statements.map((statement) => db.execute(sql.raw(statement)));
  const results = await db.batch([first!, ...rest]);
  expect(results.at(-1)?.rows).toEqual([
    { id: "eiken", kind: "language" },
    { id: "technical", kind: "technical" },
    { id: "toeic", kind: "language" },
  ]);
});
