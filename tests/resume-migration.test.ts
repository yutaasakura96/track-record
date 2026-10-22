import { env } from "cloudflare:test";
import { sql } from "drizzle-orm";
import { afterAll, expect, it } from "vitest";
import { createDb } from "~/server/db/client";
import type { Bindings } from "~/server/env";
import migration from "../src/server/db/migrations/0027_resume_layout.sql?raw";
import classification from "../src/server/db/migrations/0028_certification_kind.sql?raw";

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

it("classifies again, moves licences and missed language tests, and makes the kind required", async () => {
  const second = `${schema}_b`;
  await db.execute(sql.raw(`create schema "${second}"`));
  const statements = [
    `set local search_path to "${second}"`,
    `create type certification_kind as enum ('technical', 'language', 'other')`,
    `create table certifications (id text primary key, name text not null, name_ja text, kind certification_kind)`,
    `insert into certifications values
      ('licence_en', 'Driver''s License', null, 'technical'),
      ('licence_ja', 'Ordinary licence', '普通自動車第一種運転免許', 'technical'),
      ('toeic_unset', 'TOEIC Listening & Reading 880', null, null),
      ('versant', 'Versant English Test', null, 'technical'),
      ('cloud_unset', 'Cloud Architect', null, null),
      ('cloud', 'Cloud Architect Professional', null, 'technical'),
      ('modeler', 'Certified Data Modeler', null, 'technical'),
      ('kept_other', 'TOEIC Speaking', null, 'other'),
      ('kept_language', 'Driving licence', null, 'language')`,
    ...split(classification.replaceAll('"public".', `"${second}".`)),
    `select id, kind from certifications order by id`,
    `select is_nullable from information_schema.columns where table_schema = '${second}' and table_name = 'certifications' and column_name = 'kind'`,
  ];
  try {
    const [first, ...rest] = statements.map((statement) => db.execute(sql.raw(statement)));
    const results = await db.batch([first!, ...rest]);
    expect(results.at(-2)?.rows).toEqual([
      { id: "cloud", kind: "technical" },
      { id: "cloud_unset", kind: "technical" },
      { id: "kept_language", kind: "language" },
      { id: "kept_other", kind: "other" },
      { id: "licence_en", kind: "other" },
      { id: "licence_ja", kind: "other" },
      { id: "modeler", kind: "technical" },
      { id: "toeic_unset", kind: "language" },
      { id: "versant", kind: "language" },
    ]);
    expect(results.at(-1)?.rows).toEqual([{ is_nullable: "NO" }]);
  } finally {
    await db.execute(sql.raw(`drop schema if exists "${second}" cascade`));
  }
});

function split(sqlText: string) {
  return sqlText.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean);
}
