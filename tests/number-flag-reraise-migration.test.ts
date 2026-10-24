import { env } from "cloudflare:test";
import { sql } from "drizzle-orm";
import { afterAll, expect, it } from "vitest";
import { unsourcedNumber } from "~/pipeline/flags";
import { createDb } from "~/server/db/client";
import type { Bindings } from "~/server/env";
import migration from "../src/server/db/migrations/0032_reraise_unsourced_number_flags.sql?raw";

const db = createDb((env as unknown as Bindings).DATABASE_URL);
const schema = `number_flag_reraise_${Math.trunc(Math.random() * 1e9)}`;

afterAll(async () => {
  await db.execute(sql.raw(`drop schema if exists "${schema}" cascade`));
});

/** Claims 0031 could have settled: digits only. The migration must decide each as the code does. */
const digitCases: [string, string | null, string[]][] = [
  ["Served 5 million users", "Served 5 users.", []],
  ["Served 5 users", "Served 5 million users.", []],
  ["Served 5 million users", "Served 5 million active users.", []],
  ["Served 5 million active users", "Served 5 million users.", []],
  ["Served 5 users", "The service reached 5 active users.", []],
  ["Served 5 users", "Served 5 more users.", []],
  ["Served 5 active users", "Served 5 active orders.", []],
  ["Resolved 1 in 5 reports", "Resolved 1 in 50 reports.", []],
  ["Resolved 1 in 5 reports", "We resolved 1 in 5 reports.", []],
  ["Resolved 5 reports", "Resolved 1 in 5 reports.", []],
  ["Handled 5", "Handled 5% of requests.", []],
  ["Handled 5%", "Handled 5 of the requests.", []],
  ["Handled 5", "Handled 5.", []],
  ["3カ月で導入した", "3カ国で導入した。", []],
  ["3カ国で導入した", "3カ月で導入した。", []],
  ["3カ国で導入した", "3カ国で導入した。", []],
  ["3人の作業", "3人月の作業。", []],
  ["3名のチームを率いた", "3名体制のチームを率いた。", []],
  ["3万人が利用した", "3万人が利用した。", []],
  ["応答時間を３秒に短縮した", "応答時間を3秒に短縮した。", []],
  ["Processed 2023 tickets", "Processed tickets.", []],
  ["Processed 2023 tickets", "Processed 2023 tickets in total.", []],
  ["Processed 2023 tickets", "Processed tickets in 2023.", []],
  ["Processed 5 tickets", "Processed 5 orders.", []],
  ["Processed 5 orders", "Processed 5 tickets.", []],
  ["Processed 5 tickets", "Processed 5tickets.", []],
  ["Processed 5 tickets", "Processed 5 tickets in total.", []],
  ["Processed 5 tickets and 6 orders", "Processed 5 tickets.", []],
  ["Hired 5 full-time engineers", "Hired 5 full-stack engineers.", []],
  ["Handled 5 requests", "Saved $5 requests.", []],
  ["Saved $2.5M", "We saved $2.5M.", []],
  ["Saved $2.5M", "Saved $2.5 million.", []],
  ["Handled 10k requests", "It handled 10k requests.", []],
  ["Cut response time by 30-40%", "Response time fell by 30-40% overall.", []],
  ["Grew the team from 5-10 engineers", "Grew the team from 5 engineers.", []],
  ["Led a 5-person team", "I led a 5-person team.", []],
  ["Led a 5-person team", "Led a 5-member team.", []],
  ["Grew to 5+ teams", "Grew to 5 teams.", []],
  ["Served 40 teams", "Served 140 teams.", []],
  ["Cut latency by 3 seconds", "Latency fell by 3.5 seconds.", []],
  ["Served １，２００ users", "It served 1,200 users.", []],
  ["Served 5 daily users", "Served 5 monthly users.", []],
  ["Served 5 monthly users", "Served 5 daily users.", []],
  ["Served 5 unique users", "Served 5 new users.", []],
  ["Served 5 new users", "Served 5 unique users.", []],
  ["Served 5 users per month", "Served 5 users per year.", []],
  ["Served 5 users per year", "Served 5 users per month.", []],
  ["Served 5 users a day", "Served 5 users.", []],
  ["Served 5 users", "Served 5 users a day.", []],
  ["Served 5 users per month", "Served 5 users per month.", []],
  ["Served 5 users a day", "Served 5 users a day.", []],
  ["Served 5 per month", "Served 5 per year.", []],
  ["Served 5 per year", "Served 5 per month.", []],
  ["Served 5 per month", "Served 5 per month.", []],
  ["Served 5 users/month", "Served 5 users/year.", []],
  ["Served 5 users/year", "Served 5 users/month.", []],
  ["Served 5 users/month", "Served 5 users/month.", []],
  ["5件毎月処理した", "5件毎年処理した。", []],
  ["5件毎年処理した", "5件毎月処理した。", []],
  ["5件月間処理した", "5件処理した。", []],
  ["5件処理した", "5件月間処理した。", []],
  ["5件毎月処理した", "5件毎月処理した。", []],
  ["Handled 5 requests per user", "Handled 5 requests per server.", []],
  ["Handled 5 requests per server", "Handled 5 requests per user.", []],
  ["Handled 5 requests per user", "Handled 5 requests per user.", []],
  ["Served 5 users monthly", "Served 5 users daily.", []],
  ["Served 5 users daily", "Served 5 users monthly.", []],
  ["Served 5 users monthly", "Served 5 users monthly.", []],
  ["Resolved 5 reports", "Resolved two in 5 reports.", []],
  ["Resolved 5 reports", "Resolved 2 of 5 reports.", []],
  ["Resolved 2 of 5 reports", "Resolved 5 reports.", []],
  ["Resolved 2 of 5 reports", "Resolved 2 of 50 reports.", []],
  ["Resolved 2 of 5 reports", "Resolved 2 of 5 reports.", []],
  ["Mentored 5 engineers", "Mentored 5 senior engineers.", []],
  ["Mentored 5 senior engineers", "Mentored 5 engineers.", []],
  ["Handled 5件/日", "Handled 5件/月.", []],
  ["Handled 5件/月", "Handled 5件/日.", []],
  ["Handled 5件/日", "Handled 5件/日.", []],
  ["Reached 5% of users", "Reached 5% of revenue.", []],
  ["Reached 5% of revenue", "Reached 5% of users.", []],
  ["Reached 5% of users", "Reached 5%.", []],
  ["Reached 5%", "Reached 5% of users.", []],
  ["Reached 5% of users", "Reached 5% of users.", []],
  ["Reached 5%", "Reached 5% overall.", []],
  ["Resolved 5 reports", "Resolved 3 out of 5 reports.", []],
  ["Resolved 3 out of 5 reports", "Resolved 5 reports.", []],
  ["Resolved 3 out of 5 reports", "Resolved 3 out of 50 reports.", []],
  ["Resolved 3 out of 5 reports", "Resolved 3 out of 5 reports.", []],
  ["Gave a talk on queue design in 2023", "Gave a talk on queue design.", []],
  ["2023年に社内勉強会で登壇した", "社内勉強会で登壇した。", []],
  ["Upgraded to version 3.12.1", "Upgraded the service.", []],
  ["Treated COVID-19 patients", "Treated patients.", []],
  ["Moved 40 buckets to S3", "Moved the buckets to S3.", ["S3"]],
  ["Upgraded the service to Java 17", "Upgraded the service.", ["Java 17"]],
  ["Led a team of 5 engineers", null, []],
];

/** Claims the migration does not read, because 0031 never settled them: they stay flagged. */
const unreadCases: [string, string | null][] = [
  ["Mentored five engineers", "I mentored five engineers."],
  ["五名のチームを率いた", "五名のチームを率いた。"],
];

it("re-raises the settled number flags the stricter rule keeps, as the code decides them", async () => {
  await db.execute(sql.raw(`create schema "${schema}"`));
  const settled = `'2026-10-22T00:00:00Z'`;
  const facts = [
    ...digitCases.map(([claim, quote, technologies], index) => ({ id: `digit_${index}`, claim, quote, technologies })),
    ...unreadCases.map(([claim, quote], index) => ({ id: `unread_${index}`, claim, quote, technologies: [] as string[] })),
    { id: "guard", claim: "Served 5 million users", quote: "Served 5 users.", technologies: [] as string[] },
  ];
  const literal = (value: string | null) => (value === null ? "null" : `'${value.replaceAll("'", "''")}'`);
  const settledFlag = (id: string) => `('${id}', 'u', '${id}', 'number', ${settled}, ${settled}, null, ${settled}, ${settled})`;
  const commands = [
    `set local search_path to "${schema}"`,
    `create type fact_flag_kind as enum ('number', 'unsure')`,
    `create table facts (id text primary key, user_id text, claim text, quote text, technologies text[] not null default '{}')`,
    `create table fact_flags (id text primary key, user_id text, fact_id text, kind fact_flag_kind, checked_at timestamptz, system_settled_at timestamptz, explanation text, created_at timestamptz, updated_at timestamptz)`,
    `insert into facts values ${facts
      .map((fact) => `('${fact.id}', 'u', ${literal(fact.claim)}, ${literal(fact.quote)}, array[${fact.technologies.map(literal).join(", ")}]::text[])`)
      .join(", ")}`,
    `insert into fact_flags values ${[
      ...facts.filter((fact) => fact.id !== "guard").map((fact) => settledFlag(fact.id)),
      // What is never touched: the author's check, an explained flag, one edited since,
      // an open flag, and another kind the system settled.
      `('author_checked', 'u', 'guard', 'number', ${settled}, null, null, ${settled}, ${settled})`,
      `('explained', 'u', 'guard', 'number', ${settled}, ${settled}, 'Author note', ${settled}, ${settled})`,
      `('edited', 'u', 'guard', 'number', ${settled}, ${settled}, null, ${settled}, '2026-10-22T01:00:00Z')`,
      `('open', 'u', 'guard', 'number', null, null, null, ${settled}, ${settled})`,
      `('other_kind', 'u', 'guard', 'unsure', ${settled}, ${settled}, null, ${settled}, ${settled})`,
    ].join(", ")}`,
    ...[migration, migration].flatMap((file) => file.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean)),
    `select id, checked_at is null as raised, system_settled_at is null as unsettled, updated_at = ${settled} as untouched from fact_flags order by id`,
    `select id, claim, quote, technologies from facts order by id`,
    `select count(*)::int as left from pg_proc where proname like 'number_flag_%' and pronamespace = '"${schema}"'::regnamespace`,
  ];
  const [first, ...rest] = commands.map((command) => db.execute(sql.raw(command)));
  const results = await db.batch([first!, ...rest]);
  const [flagRows, factRows, functionRows] = results.slice(-3).map((result) => result.rows as Record<string, unknown>[]);
  const byId = new Map(flagRows!.map((row) => [row.id as string, row]));

  for (const [index, [claim, quote, technologies]] of digitCases.entries()) {
    const raised = unsourcedNumber(claim, quote, technologies);
    expect({ claim, quote, raised: byId.get(`digit_${index}`)?.raised }).toEqual({ claim, quote, raised });
    expect(byId.get(`digit_${index}`)?.unsettled).toBe(raised);
  }
  for (const index of unreadCases.keys()) expect(byId.get(`unread_${index}`)).toMatchObject({ raised: true, unsettled: true });
  for (const id of ["author_checked", "explained", "edited", "other_kind"]) {
    expect(byId.get(id)).toMatchObject({ raised: false, untouched: id !== "edited" });
  }
  expect(byId.get("edited")).toMatchObject({ raised: false, unsettled: false });
  expect(byId.get("open")).toMatchObject({ raised: true, untouched: true });
  const byKey = (rows: Record<string, unknown>[]) => [...rows].sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1));
  expect(byKey(factRows!)).toEqual(byKey(facts.map(({ id, claim, quote, technologies }) => ({ id, claim, quote, technologies }))));
  expect(functionRows).toEqual([{ left: 0 }]);
});
