import { env } from "cloudflare:test";
import { sql } from "drizzle-orm";
import { afterAll, expect, it } from "vitest";
import { createDb } from "~/server/db/client";
import type { Bindings } from "~/server/env";
import migration from "../src/server/db/migrations/0031_settle_sourced_number_flags.sql?raw";

const db = createDb((env as unknown as Bindings).DATABASE_URL);
const schema = `number_flag_mig_${Math.trunc(Math.random() * 1e9)}`;

afterAll(async () => {
  await db.execute(sql.raw(`drop schema if exists "${schema}" cascade`));
});

it("settles only untouched number flags with certain sources or years", async () => {
  await db.execute(sql.raw(`create schema "${schema}"`));
  const commands = [
    `set local search_path to "${schema}"`,
    `create type fact_flag_kind as enum ('number', 'unsure')`,
    `create table facts (id text primary key, user_id text, claim text, quote text)`,
    `create table fact_flags (id text primary key, user_id text, fact_id text, kind fact_flag_kind, checked_at timestamptz, system_settled_at timestamptz, explanation text, created_at timestamptz, updated_at timestamptz)`,
    `insert into facts values
      ('sourced', 'u', 'Served 5 million users', 'Served 5 million users in total.'),
      ('year', 'u', 'Gave a talk in 2023', 'Gave a talk about queues.'),
      ('japanese_year', 'u', '2023年に登壇した', '設計について登壇した。'),
      ('percent', 'u', 'Raised coverage to 2023%', 'Raised coverage.'),
      ('counter', 'u', '売上を2023万円に伸ばした', '売上を伸ばした。'),
      ('duration', 'u', '2023年間継続した', '継続した。'),
      ('absent', 'u', 'Served 5 million users', 'Served 5 users.'),
      ('edited', 'u', 'Served 5 million users', 'Served 5 million users in total.')`,
    `insert into fact_flags values
      ('sourced', 'u', 'sourced', 'number', null, null, null, now(), now()),
      ('year', 'u', 'year', 'number', null, null, null, now(), now()),
      ('japanese_year', 'u', 'japanese_year', 'number', null, null, null, now(), now()),
      ('percent', 'u', 'percent', 'number', null, null, null, now(), now()),
      ('counter', 'u', 'counter', 'number', null, null, null, now(), now()),
      ('duration', 'u', 'duration', 'number', null, null, null, now(), now()),
      ('absent', 'u', 'absent', 'number', null, null, null, now(), now()),
      ('edited', 'u', 'edited', 'number', null, null, 'Author note', now(), now()),
      ('other', 'u', 'sourced', 'unsure', null, null, null, now(), now())`,
    migration,
    migration,
    `select id, checked_at is not null as checked, system_settled_at is not null as settled from fact_flags order by id`,
  ];
  const [first, ...rest] = commands.map((command) => db.execute(sql.raw(command)));
  const results = await db.batch([first!, ...rest]);
  expect(results.at(-1)?.rows).toEqual([
    { id: "absent", checked: false, settled: false },
    { id: "counter", checked: false, settled: false },
    { id: "duration", checked: false, settled: false },
    { id: "edited", checked: false, settled: false },
    { id: "japanese_year", checked: true, settled: true },
    { id: "other", checked: false, settled: false },
    { id: "percent", checked: false, settled: false },
    { id: "sourced", checked: true, settled: true },
    { id: "year", checked: true, settled: true },
  ]);
});
