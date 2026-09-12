#!/usr/bin/env node
/**
 * The measurement script (`docs/06`, 2026-09-08).
 *
 * Prints the numbers every register decision in the decision log is argued
 * against: how many experience bullets a render carries, their mean length,
 * and the share carrying a number — plus the tail and the composition figures
 * the later entries report. The definition lives in `src/render/metrics.ts`;
 * this file only finds a document and hands it over.
 *
 *   npm run measure -- --latest
 *   npm run measure -- --proposal prp_H8t4
 *   npm run measure -- --json path/to/content.json
 *   npm run measure -- --markdown path/to/hand-written.md
 *
 * Options:
 *   --latest            the most recently generated proposal in the dev database
 *   --proposal <id>     a specific `render_proposals` row
 *   --json <file>       a `RenderContent` JSON file
 *   --markdown <file>   a hand-written document, read as bullet LINES — this is
 *                       how the 30 / 191 / 57% target was measured
 *   --database <name>   default track_record_dev
 *   --psql <command>    how to reach psql (default: the docker-compose Postgres)
 *
 * IT PRINTS NUMBERS AND NEVER TEXT. Not the longest bullet, not a sample, not
 * an excerpt in an error message. Renders are built from the author's real
 * career record, `local/` material and NDA-bound client names reach them, and
 * the rule that logs never contain render content (CLAUDE.md) does not stop
 * applying because the output is a measurement. Every figure below is a count,
 * a length or a percentage, and that is the whole contract.
 *
 * The dev database, never the test one: `track_record_test` is dropped and
 * rebuilt by every run of the suite and holds invented fixtures, which would
 * measure nothing.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  bulletsFromLines,
  experienceBullets,
  measureBullets,
} from "../src/render/metrics.ts";

const args = parseArgs(process.argv.slice(2));

const PSQL = args.psql ?? "docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U postgres";
const DB = args.database ?? "track_record_dev";

const { bullets, blocks } = readBullets();
// An empty document is a refusal, on the same argument the attribution checker
// makes (`docs/06`, 2026-09-12): a proposal row exists from the moment a
// generation starts, so `--latest` reaches one in that state as a matter of
// course.
if (blocks === 0) {
  fail("This document is empty. Nothing to measure, and a generation may still be running.");
}
// A document with blocks but no bullets is NOT a refusal. Both career stories
// are prose and two tables and carry no bullet anywhere by design, and an
// instrument that exits non-zero on a correct document is an instrument nobody
// can put in a check (`docs/06`, 2026-09-13). "I cannot answer this question
// about this render" and "this render is wrong" are different answers.
if (bullets.length === 0) {
  console.log("This document carries no bullets. Nothing to measure.");
  process.exit(0);
}
report(measureBullets(bullets));

function readBullets() {
  if (args.markdown) {
    const text = readFileSync(args.markdown, "utf8");
    return {
      bullets: bulletsFromLines(text),
      blocks: text.split("\n").filter((line) => line.trim() !== "").length,
    };
  }
  if (args.json) return fromContent(JSON.parse(readFileSync(args.json, "utf8")));
  if (args.proposal) return fromContent(proposalContent(args.proposal));
  if (args.latest) return fromContent(proposalContent(null));
  fail("Pass one of --latest, --proposal <id>, --json <file> or --markdown <file>.");
}

/** The bullets this measures, and the blocks that say the document exists. */
function fromContent(content) {
  const sections = Array.isArray(content?.sections) ? content.sections : [];
  return {
    bullets: experienceBullets(content),
    blocks: sections.reduce((n, s) => n + (Array.isArray(s.blocks) ? s.blocks.length : 0), 0),
  };
}

/**
 * psql rather than the application's own driver, for the same reason the
 * restore drill uses it: a measurement is an operations task and must not
 * depend on the Worker being able to run.
 */
function proposalContent(id) {
  // An id reaches a shell command, so it is checked against the shape ids
  // actually have rather than quoted and hoped for.
  if (id !== null && !/^[A-Za-z0-9_-]+$/.test(id)) fail("That is not a proposal id.");
  const where = id === null ? "" : `where id = '${id}'`;
  const sql = `select content from render_proposals ${where} order by generated_at desc limit 1`;
  const out = execSync(`${PSQL} -d ${DB} -tAc "${sql}"`, { encoding: "utf8" }).trim();
  if (!out) fail(id === null ? "No proposals in the database." : "No proposal with that id.");
  return JSON.parse(out);
}

/** Numbers only. The log's shorthand first, then what it is made of. */
function report(m) {
  console.log(`${m.bullets} / ${m.meanCharacters} / ${m.quantifiedPercent}%`);
  console.log("");
  console.log(`bullets             ${m.bullets}`);
  console.log(`mean characters     ${m.meanCharacters}`);
  console.log(`carrying a number   ${m.quantifiedPercent}%`);
  console.log(`longest             ${m.longestCharacters}`);
  console.log(`over 250            ${m.overLongBullets}`);
  console.log(`fact references     ${m.factReferences}`);
  console.log(`facts per bullet    ${m.factsPerBullet.toFixed(2)}`);
  console.log(`multi-fact bullets  ${m.multiFactBullets}`);
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
  process.exit(1);
}
