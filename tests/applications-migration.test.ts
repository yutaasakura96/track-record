/**
 * Migrations 0017 and 0019, run forward and back (issues #70 and #71).
 *
 * Two promises are checked on real rows: the migration is ADDITIVE, so every
 * tailored résumé that existed before it is an application afterwards and no
 * row of `renders` has lost anything; and it is REVERSIBLE, so
 * `down/0017_applications.sql` leaves `renders` exactly as it was found.
 *
 * 0019 is held to the same two: each carried-over résumé is listed as a
 * document of its application and nothing else changes, and
 * `down/0020_application_documents.sql` takes out what it added and no more.
 *
 * It runs the committed SQL in a schema of its own, built with the `users` and
 * `renders` tables as they stood before 0017. The suite's own tables are never
 * altered: dropping one here would take it from every test running beside
 * this one. Every row is INVENTED.
 */
import { env } from "cloudflare:test";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { createDb } from "~/server/db/client";
import type { Bindings } from "~/server/env";
import up from "../src/server/db/migrations/0017_applications.sql?raw";
import down from "../src/server/db/migrations/down/0017_applications.sql?raw";
import upDocuments from "../src/server/db/migrations/0020_application_documents.sql?raw";
import downDocuments from "../src/server/db/migrations/down/0020_application_documents.sql?raw";

const db = createDb((env as unknown as Bindings).DATABASE_URL);
const schema = `mig17_${Math.trunc(Math.random() * 1e9)}`;

/** The committed statements, aimed at this test's schema instead of `public`. */
const statements = (file: string) =>
  file
    .replaceAll('"public".', `"${schema}".`)
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement !== "");

/** One transaction, with every unqualified name resolving in this test's schema. */
async function run(queries: string[]): Promise<Record<string, unknown>[][]> {
  const [first, ...rest] = [`set local search_path to "${schema}"`, ...queries].map((query) => db.execute(sql.raw(query)));
  const results = (await db.batch([first!, ...rest])) as unknown as { rows: Record<string, unknown>[] }[];
  return results.slice(1).map((result) => result.rows);
}

const RENDERS = `select to_jsonb(r) as row from renders as r order by r.id`;
const USER = "usr_mig17";
const POSTING = "Corbel Lighthouse Trust is hiring a keeper of its tide tables.";

afterAll(async () => {
  await db.execute(sql.raw(`drop schema if exists "${schema}" cascade`));
});

describe("migrations 0017 and 0019, applications and their documents", () => {
  it("carries every tailored résumé over as an application with its document, loses nothing, and reverses cleanly", async () => {
    await db.execute(sql.raw(`create schema "${schema}"`));

    // `renders` as it stood before 0017: today's table without the column 0017 adds.
    const before = (
      await run([
        `create table users (like public.users including all)`,
        `create table renders (like public.renders including all)`,
        `create table render_versions (like public.render_versions including all)`,
        `alter table renders drop column application_id`,
        `insert into users (id, name, email) values ('${USER}', 'Invented Author', 'mig17@example.invalid')`,
        `insert into renders (id, user_id, kind, current_version_id, stale_since_fact_count, created_at) values
           ('rnd_main000000000001', '${USER}', 'english_resume', 'rvr_main', 4, '2026-09-01T00:00:00Z')`,
        // Made at 23:30 UTC, which is the next morning in Japan.
        `insert into renders (id, user_id, kind, label, job_description, current_version_id, stale_since_fact_count, created_at) values
           ('rnd_corbel0000000001', '${USER}', 'english_resume', 'Corbel Lighthouse, keeper', '${POSTING}', 'rvr_corbel_2', 7, '2026-10-08T23:30:00Z'),
           ('rnd_unwritten0000001', '${USER}', 'english_resume', 'Dunmore Ferries, deckhand', 'Deckhand on the Dunmore crossing.', null, null, '2026-10-09T02:00:00Z')`,
        RENDERS,
      ])
    ).at(-1)!;
    expect(before).toHaveLength(3);

    const [applications, steps, after] = (
      await run([
        ...statements(up),
        `select id, user_id, company, position, job_description, posting_url, requirements, current_step, closed_as, last_activity_at, created_at from applications order by id`,
        `select id, user_id, application_id, status, happened_on::text as happened_on, superseded_at from application_steps order by id`,
        RENDERS,
      ])
    ).slice(-3) as [Record<string, unknown>[], Record<string, unknown>[], Record<string, unknown>[]];

    // One application per tailored résumé, none for the main résumé.
    expect(applications).toMatchObject([
      {
        id: "app_corbel0000000001",
        user_id: USER,
        company: "Corbel Lighthouse, keeper",
        position: "",
        job_description: POSTING,
        posting_url: null,
        requirements: [],
        current_step: "not_applied",
        closed_as: null,
      },
      {
        id: "app_unwritten0000001",
        company: "Dunmore Ferries, deckhand",
        job_description: "Deckhand on the Dunmore crossing.",
        current_step: "not_applied",
      },
    ]);
    expect(new Date(String(applications[0]!.last_activity_at)).toISOString()).toBe("2026-10-08T23:30:00.000Z");
    expect(steps).toMatchObject([
      { id: "aps_corbel0000000001", application_id: "app_corbel0000000001", status: "not_applied", happened_on: "2026-10-09", superseded_at: null },
      { id: "aps_unwritten0000001", application_id: "app_unwritten0000001", status: "not_applied", happened_on: "2026-10-09", superseded_at: null },
    ]);

    // Additive: each row of `renders` is what it was, plus the pointer.
    const pointer: Record<string, string | null> = {
      rnd_main000000000001: null,
      rnd_corbel0000000001: "app_corbel0000000001",
      rnd_unwritten0000001: "app_unwritten0000001",
    };
    expect(after.map(({ row }) => row)).toEqual(
      before.map(({ row }) => ({ ...(row as Record<string, unknown>), application_id: pointer[(row as { id: string }).id] })),
    );

    // Run again, it carries nothing over twice.
    const [again] = (await run([...statements(up).slice(-3), `select count(*)::int as n from applications`])).slice(-1);
    expect(again).toEqual([{ n: 2 }]);

    // 0019: each carried-over résumé is a document of its application, and one application holds one.
    const [listed, afterDocuments, indexes] = (
      await run([
        // `render_kind` is older than both migrations and lives in `public`. It is named
        // there outright, so this schema's search path never has to include `public`.
        ...statements(upDocuments).map((statement) => statement.replaceAll('"render_kind"', "public.render_kind")),
        `select id, user_id, application_id, render_id, removed_at from application_documents order by id`,
        RENDERS,
        `select indexname from pg_indexes where schemaname = '${schema}' and tablename = 'renders' and indexname like 'renders_application%'`,
      ])
    ).slice(-3) as [Record<string, unknown>[], Record<string, unknown>[], Record<string, unknown>[]];
    expect(listed).toEqual([
      { id: "apd_corbel0000000001", user_id: USER, application_id: "app_corbel0000000001", render_id: "rnd_corbel0000000001", removed_at: null },
      { id: "apd_unwritten0000001", user_id: USER, application_id: "app_unwritten0000001", render_id: "rnd_unwritten0000001", removed_at: null },
    ]);
    expect(afterDocuments).toEqual(after);
    expect(indexes).toEqual([{ indexname: "renders_application_uq" }]);
    // A second tailored résumé for one application is refused by that index.
    await expect(
      run([
        `insert into renders (id, user_id, kind, label, job_description, application_id) values
           ('rnd_corbel0000000002', '${USER}', 'english_resume', 'Corbel again', '${POSTING}', 'app_corbel0000000001')`,
      ]),
    ).rejects.toThrow();
    // Run again, it lists nothing twice.
    const [listedAgain] = (await run([statements(upDocuments).at(-1)!, `select count(*)::int as n from application_documents`])).slice(-1);
    expect(listedAgain).toEqual([{ n: 2 }]);

    // And back: the two tables are gone, the plain index is back, `renders` is untouched.
    const [goneDocuments, afterDown] = (
      await run([
        ...statements(downDocuments),
        `select to_regclass('"${schema}".application_documents')::text as documents,
                to_regclass('"${schema}".application_sent_copies')::text as copies,
                (select string_agg(indexname, ',') from pg_indexes where schemaname = '${schema}' and tablename = 'renders' and indexname like 'renders_application%') as indexes`,
        RENDERS,
      ])
    ).slice(-2);
    expect(goneDocuments).toEqual([{ documents: null, copies: null, indexes: "renders_application_idx" }]);
    expect(afterDown).toEqual(after);

    // Reversible: the tables and the type are gone, and `renders` is as it was found.
    const [gone, restored] = (
      await run([
        ...statements(down),
        `select to_regclass('"${schema}".applications')::text as applications,
                to_regclass('"${schema}".application_steps')::text as steps,
                (select count(*)::int from pg_type as t join pg_namespace as n on n.oid = t.typnamespace
                  where n.nspname = '${schema}' and t.typname = 'application_status') as types`,
        RENDERS,
      ])
    ).slice(-2);
    expect(gone).toEqual([{ applications: null, steps: null, types: 0 }]);
    expect(restored).toEqual(before);
  });
});
