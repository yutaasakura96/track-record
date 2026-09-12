#!/usr/bin/env node
/**
 * The attribution checker (`docs/06`).
 *
 * The second committed instrument, alongside `npm run measure`. Measure asks
 * whether a render's bullets are the right shape; this asks whether they are
 * attached to the right facts — the invariants that were checked by hand after
 * every generation. The definition lives in `src/render/attribution.ts`; this
 * file only finds a render and a record and hands them over.
 *
 *   npm run check:attribution -- --latest
 *   npm run check:attribution -- --proposal prp_H8t4
 *   npm run check:attribution -- --json path/to/content.json --user usr_H8t4
 *
 * Options:
 *   --latest            the most recently generated proposal in the dev database
 *   --proposal <id>     a specific `render_proposals` row
 *   --json <file>       a `RenderContent` JSON file; needs --user
 *   --user <id>         whose record to check against — required with --json,
 *                       and otherwise taken from the proposal's own row
 *   --database <name>   default track_record_dev
 *   --psql <command>    how to reach psql (default: the docker-compose Postgres)
 *
 * The record ALWAYS comes from the database, because the invariants are about
 * a render and a record together and a JSON file is only half of that.
 *
 * IT PRINTS IDS AND COUNTS AND NEVER TEXT — no bullet, no heading, no fact
 * claim, not even in an error message. See the note at the top of
 * `src/render/attribution.ts`; the same rule and the same reason.
 *
 * Exit status is 1 when anything is found, so that this can be a check and not
 * only a report.
 *
 * psql rather than the application's own driver, for the same reason the
 * measurement and the restore drill use it: this is an operations task and must
 * not depend on the Worker being able to run.
 *
 * The dev database, never the test one: `track_record_test` is dropped and
 * rebuilt by every run of the suite and holds invented fixtures, which would
 * check nothing.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { checkAttribution, countByInvariant } from "../src/render/attribution.ts";
import { capitalInJapanese } from "../src/render/yen.ts";

const args = parseArgs(process.argv.slice(2));

const PSQL = args.psql ?? "docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U postgres";
const DB = args.database ?? "track_record_dev";

const { content, userId } = readRender();
const report = checkAttribution(content, readRecord(userId));
// A render with no blocks in it is not a clean render. `--latest` will happily
// pick up a proposal whose row exists while the generation is still running —
// its content is `{"sections":[]}` until the model answers — and checking that
// printed `clean` and exited 0, which is the one failure mode the definition
// module says a checker must not have. `measure` already refuses an empty
// document; this now refuses one on the same terms.
if (report.blocksChecked === 0) {
  fail("That render has no blocks. Nothing to check — if it was just generated, it may still be running.");
}
report_(report);
process.exit(report.findings.length > 0 ? 1 : 0);

function readRender() {
  if (args.json) {
    if (!args.user) fail("--json needs --user: a record belongs to somebody.");
    return { content: JSON.parse(readFileSync(args.json, "utf8")), userId: id(args.user) };
  }
  if (args.proposal) return proposal(id(args.proposal));
  if (args.latest) return proposal(null);
  fail("Pass one of --latest, --proposal <id> or --json <file> --user <id>.");
}

function proposal(proposalId) {
  const where = proposalId === null ? "" : `where id = '${proposalId}'`;
  const row = queryJson(
    `select json_build_object('userId', user_id, 'content', content) from render_proposals ` +
      `${where} order by generated_at desc limit 1`,
  );
  if (row === null) {
    fail(proposalId === null ? "No proposals in the database." : "No proposal with that id.");
  }
  // --user overrides nothing here. A proposal's record is its own user's, and
  // letting a flag cross that line is how a check against the wrong record
  // would come back clean.
  return { content: row.content, userId: row.userId };
}

/**
 * Every query filters by `user_id` (CLAUDE.md). No exceptions, and an
 * operations script is not one.
 *
 * A fact's EFFECTIVE employer is its own, or its project's when it is filed to
 * a project rather than straight to an employer. That hop is resolved here so
 * that the definition module stays a pure function of what it is given.
 *
 * Every fact, whatever its status: `unknown-fact` has to mean an id that is not
 * in the record, not an id that is merely not accepted yet.
 */
function readRecord(userId) {
  const facts = queryJson(
    `select coalesce(json_agg(json_build_object(` +
      `'id', f.id, 'employerId', coalesce(f.employer_id, p.employer_id))), '[]') ` +
      `from facts f left join projects p on p.id = f.project_id and p.user_id = f.user_id ` +
      `where f.user_id = '${userId}'`,
  );
  const employers = queryJson(
    `select coalesce(json_agg(json_build_object(` +
      `'id', e.id, 'names', array_remove(array[e.name_ja, e.name_latin], null), ` +
      `'businessDescription', e.business_description, ` +
      `'capitalYen', e.capital_yen, 'headcount', e.headcount, ` +
      `'projects', (select coalesce(json_agg(array_remove(array[p.name_ja, p.name], null)), '[]') ` +
      `from projects p where p.employer_id = e.id and p.user_id = e.user_id))), '[]') ` +
      `from employers e where e.user_id = '${userId}'`,
  );
  if (employers.length === 0) fail("That user has no employers. There is nothing to check against.");
  return { facts, employers: employers.map(withCopySources) };
}

/**
 * What the register is permitted to have copied, per employer.
 *
 * The yen is converted HERE and handed over as the string the document writes,
 * because that is exactly what the register was handed. Doing it in the
 * definition module would put arithmetic in a pure function of its input; doing
 * it twice would give the two copies somewhere to drift apart.
 *
 * A project contributes every name it has, 日本語 and Latin both, for the same
 * reason an employer does: the row writes whichever the document's language
 * calls for.
 */
function withCopySources(e) {
  const copy = [];
  if (e.businessDescription) copy.push({ field: "事業内容", value: e.businessDescription });
  if (e.capitalYen !== null) copy.push({ field: "資本金", value: capitalInJapanese(e.capitalYen) });
  if (e.headcount !== null) copy.push({ field: "従業員数", value: String(e.headcount) });
  for (const names of e.projects ?? []) {
    for (const name of names) copy.push({ field: "プロジェクト", value: name });
  }
  return { id: e.id, names: e.names, copy };
}

/** An id reaches a shell command, so it is checked against the shape ids
 * actually have rather than quoted and hoped for. */
function id(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) fail("That is not an id.");
  return value;
}

function queryJson(sql) {
  const out = execSync(`${PSQL} -d ${DB} -tAc "${sql}"`, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
  return out === "" ? null : JSON.parse(out);
}

/** Ids and counts. The headline first, then what it is made of. */
function report_(r) {
  const counts = countByInvariant(r);
  const verdict = r.findings.length === 0 ? "clean" : `${r.findings.length} finding(s)`;
  console.log(`${verdict} — ${r.factReferencesChecked} fact references in ${r.blocksChecked} blocks`);
  console.log("");
  console.log(`blocks checked      ${r.blocksChecked}`);
  console.log(`fact references     ${r.factReferencesChecked}`);
  console.log(`employer groups     ${r.groups} (${r.resolvedGroups} resolved)`);
  console.log("");
  console.log(`unknown fact        ${counts["unknown-fact"]}`);
  console.log(`unfiled fact        ${counts["unfiled-fact"]}`);
  console.log(`misfiled fact       ${counts["misfiled-fact"]}`);
  console.log(`uncited copy        ${counts["uncited-copy"]}`);
  console.log(`unresolved heading  ${counts["unresolved-heading"]}`);

  if (r.findings.length === 0) return;
  console.log("");
  for (const f of r.findings) {
    const parts = [f.invariant.padEnd(19), `block ${f.blockId}`];
    if (f.factId !== null) parts.push(`fact ${f.factId}`);
    if (f.headingEmployerId !== null) parts.push(`heading ${f.headingEmployerId}`);
    if (f.factEmployerId !== null) parts.push(`filed ${f.factEmployerId}`);
    // The LABEL, never the value. A register label is the register's word, not
    // the author's; the row's text stays out for the same reason a bullet does.
    if (f.field !== null) parts.push(`field ${f.field}`);
    console.log(parts.join("  "));
  }
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) fail(`Unexpected argument ${arg}.`);
    const key = arg.slice(2);
    if (key === "latest") {
      parsed.latest = true;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) fail(`${arg} needs a value.`);
    parsed[key] = value;
    i += 1;
  }
  return parsed;
}

function fail(message) {
  console.error(message);
  process.exit(2);
}
