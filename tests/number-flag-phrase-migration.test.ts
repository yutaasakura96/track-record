import { env } from "cloudflare:test";
import { sql } from "drizzle-orm";
import { afterAll, expect, it } from "vitest";
import { unsourcedNumber } from "~/pipeline/flags";
import { createDb } from "~/server/db/client";
import type { Bindings } from "~/server/env";
import migration from "../src/server/db/migrations/0033_reraise_unsourced_number_phrases.sql?raw";

const db = createDb((env as unknown as Bindings).DATABASE_URL);
const schema = `number_flag_phrase_${Math.trunc(Math.random() * 1e9)}`;

afterAll(async () => {
  await db.execute(sql.raw(`drop schema if exists "${schema}" cascade`));
});

/**
 * Settled digit claims, with whether the flag comes back. The migration must
 * decide each as the code does, and the code as stated here.
 */
const cases: [string, string | null, string[], boolean][] = [
  // A ratio is one figure: neither of its numbers sources a plain count.
  ["Resolved 5 reports", "Resolved 2/5 reports.", [], true],
  ["Resolved 2 reports", "Resolved 2/5 reports.", [], true],
  ["Resolved 2/5 reports", "Resolved 5 reports.", [], true],
  ["Resolved 2/5 reports", "Resolved 2/50 reports.", [], true],
  ["Resolved 2/5 reports", "Resolved 2/5 reports.", [], false],
  ["Resolved 5 reports", "Resolved 1 in 5 reports.", [], true],
  ["Resolved 1", "Resolved 1 in 5 reports.", [], true],
  ["Resolved 2 reports", "Resolved 2 in 5 reports.", [], true],
  ["Resolved 5 reports", "Resolved 3 out of 5 reports.", [], true],
  ["Resolved 3 reports", "Resolved 3 out of 5 reports.", [], true],
  ["Resolved 3 out of 5 reports", "Resolved 3 out of 5 reports.", [], false],
  // A bound after a counter.
  ["5件以上を処理した", "5件以下を処理した。", [], true],
  ["5件以下を処理した", "5件以上を処理した。", [], true],
  ["5件以上を処理した", "5件を処理した。", [], true],
  ["5件を処理した", "5件以上を処理した。", [], true],
  ["5件以上を処理した", "5件以上を処理した。", [], false],
  ["5件以下を処理した", "5件以下を処理した。", [], false],
  // Every other word before the unit, held to the passage.
  ["Wrote 5 clinic reports", "Wrote 5 hospital reports.", [], true],
  ["Wrote 5 hospital reports", "Wrote 5 clinic reports.", [], true],
  ["Wrote 5 clinic reports", "Wrote 5 reports.", [], true],
  ["Wrote 5 reports", "Wrote 5 clinic reports.", [], true],
  ["Wrote 5 clinic reports", "For the clinic, I wrote 5 reports.", [], false],
  ["Wrote 5 clinic reports", "Wrote 5 clinic reports.", [], false],
  ["Served 5 million active users", "Served 5 million users.", [], false],
  ["Stayed clean for 21 days", "Stayed clean for 21 consecutive days.", [], true],
  ["Reached 5% of all users", "Reached 5% of all revenue.", [], true],
  ["Reached 5% of all revenue", "Reached 5% of all users.", [], true],
  ["Reached 5% of all clinic reports", "Reached 5% of all clinic revenue.", [], true],
  ["Reached 5% of all clinic revenue", "Reached 5% of all clinic reports.", [], true],
  ["Reached 5% of all clinic reports per month", "Reached 5% of all clinic reports per year.", [], true],
  ["Reached 5% of all clinic reports per month", "Reached 5% of all clinic reports per month.", [], false],
  ["Wrote 5 reports", "Wrote 5 separate reports.", [], true],
  ["Reached 5% of all users", "Reached 5% of all users.", [], false],
  ["Reached 5% of users", "Reached 5% of active users.", [], false],
  ["Reached 5% of active users", "Reached 5% of users.", [], false],
  ["Reached 5% of all active users", "Reached 5% of all users.", [], false],
  ["Reached 5% of all users", "Reached 5% of all active users.", [], false],
  ["Hired 5 within a year", "Hired 5 a year.", [], true],
  ["Hired 5 a year", "We hired 5 within a year.", [], true],
  ["Ranked in the top 3", "Ranked in the top 3 in 2022.", [], false],
  ["Ranked in the top 3 in 2022", "Ranked in the top 3.", [], false],
  ["Hired 5", "Hired 5 in 2023.", [], false],
  ["Hired 5 in 2023", "In 2023, we hired 5.", [], false],
  ["Resolved 5 reports", "Resolved 1 of 5 reports.", [], true],
  ["A team of 5 shipped the app", "A team of 5 shipped the mobile app.", [], false],
  ["A team of 5 shipped the mobile app", "A team of 5 shipped the app.", [], false],
  ["Handled 5", "Handled 5.", [], false],
  ["Led a team of 5 engineers", null, [], true],
  // The demo record's sourced lines, their number words written as digits.
  ["Wrote the runbook and trained 2 on-call engineers to take over the service", "I also wrote the runbook and trained the 2 on-call engineers who took over the service.", [], false],
  ["Led a team of 3 building a fraud rules engine the risk team could edit without a deploy", "I led a team of 3 to build a rules engine the risk team could edit themselves.", [], false],
  ["Reduced the chargeback rate from 0.42% to 0.18% over 2 quarters", "The chargeback rate fell from 0.42% to 0.18% over the following 2 quarters.", [], false],
  ["The engine evaluates about 1,200 payments per second at peak with 18 ms p99 latency", "The engine evaluates around 1,200 payments per second at peak with p99 latency of 18 ms.", ["Kotlin", "Spring Boot", "Redis"], false],
  ["Led the 5-engineer checkout squad as tech lead", "As tech lead for the checkout squad (5 engineers)", [], false],
  ["Set a 170 KB checkout bundle budget enforced in CI", "a pull request that pushed the checkout bundle past 170 KB compressed failed the build.", ["GitHub Actions"], false],
  ["Reduced mobile checkout abandonment from 31% to 22%, valued at about ¥140 million in annual GMV", "Mobile checkout abandonment fell from 31% to 22% over the following quarter, which the finance team valued at roughly ¥140 million in annual gross merchandise value.", [], false],
  ["Built an offline search evaluation set from 6 months of logs, labelled by click-through and purchase", "I built an offline evaluation set from 6 months of search logs, with click-through and purchase as relevance labels, so that every ranking change could be scored before it shipped.", ["Elasticsearch", "Python"], false],
  ["Moved search ranking to learning-to-rank, raising search conversion by 9% in a 4-week A/B test", "the team moved to learning-to-rank on top of Elasticsearch. Search conversion rose by 9% in an A/B test that ran for 4 weeks across all traffic.", ["Elasticsearch"], false],
  ["12 teams adopted the design system within a year", "12 teams adopted it within a year.", [], false],
  ["Led a team of 4 migrating the platform from hand-managed VMs to Azure Kubernetes Service", "I led the migration to Azure Kubernetes Service with a team of 4.", ["Azure Kubernetes Service", "Kubernetes", "Azure"], false],
  ["Moved the booking API behind a traffic split, sending 5% of requests to the new cluster first", "finishing with the booking API, which we moved behind a traffic split so that 5% of requests went to the new cluster first.", [], false],
  ["Moved all 23 services to AKS over 9 months with no unplanned downtime", "All 23 services moved to AKS over 9 months with no unplanned downtime during cut-over.", ["Azure Kubernetes Service"], false],
  ["Defined the first 5 clinic reports with the operations team at Sakura Family Clinic", "I worked with the clinic operations team at Sakura Family Clinic to define the first 5 reports.", [], false],
  ["Ran a 3-phase migration: 6 weeks of dual-write, a nightly comparison job, and cut-over after 21 clean days", "Migration ran in 3 phases: dual-write for 6 weeks, a nightly comparison job that reported any difference between the old balances and the new ones, and a cut-over once the comparison had been clean for 21 consecutive days.", [], true],
];

it("re-raises the settled number flags the noun-phrase rule keeps, as the code decides them", async () => {
  await db.execute(sql.raw(`create schema "${schema}"`));
  const settled = `'2026-10-24T00:00:00Z'`;
  const facts = [
    ...cases.map(([claim, quote, technologies], index) => ({ id: `case_${index}`, claim, quote, technologies })),
    { id: "word", claim: "Wrote five clinic reports", quote: "Wrote five clinic reports.", technologies: [] as string[] },
    { id: "guard", claim: "Wrote 5 clinic reports", quote: "Wrote 5 hospital reports.", technologies: [] as string[] },
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
      // What is never touched, though the fact's figure is unsourced: the author's
      // check, an explained flag, one edited since, an open flag, and another kind.
      `('author_checked', 'u', 'guard', 'number', ${settled}, null, null, ${settled}, ${settled})`,
      `('explained', 'u', 'guard', 'number', ${settled}, ${settled}, 'Author note', ${settled}, ${settled})`,
      `('edited', 'u', 'guard', 'number', ${settled}, ${settled}, null, ${settled}, '2026-10-24T01:00:00Z')`,
      `('open', 'u', 'guard', 'number', null, null, null, ${settled}, ${settled})`,
      `('other_kind', 'u', 'guard', 'unsure', ${settled}, ${settled}, null, ${settled}, ${settled})`,
    ].join(", ")}`,
    // Twice: the second run finds nothing to do.
    ...[migration, migration].flatMap((file) => file.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean)),
    `select id, checked_at is null as raised, system_settled_at is null as unsettled, updated_at = ${settled} as untouched from fact_flags order by id`,
    `select id, claim, quote, technologies from facts order by id`,
    `select count(*)::int as left from pg_proc where proname like 'number_flag_%' and pronamespace = '"${schema}"'::regnamespace`,
  ];
  const [first, ...rest] = commands.map((command) => db.execute(sql.raw(command)));
  const results = await db.batch([first!, ...rest]);
  const [flagRows, factRows, functionRows] = results.slice(-3).map((result) => result.rows as Record<string, unknown>[]);
  const byId = new Map(flagRows!.map((row) => [row.id as string, row]));

  for (const [index, [claim, quote, technologies, raised]] of cases.entries()) {
    expect({ claim, quote, code: unsourcedNumber(claim, quote, technologies) }).toEqual({ claim, quote, code: raised });
    expect({ claim, quote, raised: byId.get(`case_${index}`)?.raised }).toEqual({ claim, quote, raised });
    expect(byId.get(`case_${index}`)).toMatchObject({ unsettled: raised, untouched: !raised });
  }
  // A number word is never read, and its flag comes back, as in 0032.
  expect(byId.get("word")).toMatchObject({ raised: true, unsettled: true });
  for (const id of ["author_checked", "explained", "edited", "other_kind"]) {
    expect(byId.get(id)).toMatchObject({ raised: false, untouched: id !== "edited" });
  }
  expect(byId.get("edited")).toMatchObject({ raised: false, unsettled: false });
  expect(byId.get("open")).toMatchObject({ raised: true, untouched: true });
  const byKey = (rows: Record<string, unknown>[]) => [...rows].sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1));
  expect(byKey(factRows!)).toEqual(byKey(facts.map(({ id, claim, quote, technologies }) => ({ id, claim, quote, technologies }))));
  expect(functionRows).toEqual([{ left: 0 }]);
});
