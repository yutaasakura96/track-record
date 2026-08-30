#!/usr/bin/env node
/**
 * The restore drill (`docs/06`, 2026-08-29; `docs/12` §5).
 *
 * An untested export is not a backup. This loads a `GET /api/export` file into a
 * SCRATCH database, then asserts per-table row counts and referential integrity
 * across every foreign key. Failing loudly is the point.
 *
 *   node scripts/restore-drill.mjs --export path/to/export.json
 *
 * Options:
 *   --export <file>   the export to restore (required)
 *   --database <name> scratch database name (default track_record_restore_drill)
 *   --psql <command>  how to reach psql (default: the docker-compose Postgres)
 *   --keep            leave the scratch database behind for inspection
 *
 * psql rather than the application's own driver, deliberately: a restore is an
 * operations task, and it must not depend on the application being able to run.
 * Against Neon, pass `--psql "psql -v ON_ERROR_STOP=1 '<connection string>'"`.
 *
 * WHAT AN EXPORT CANNOT RESTORE, and why that is correct:
 * source documents never render, export, or appear in any output (PRD §6.1), so
 * `extracted_text` and `original_bytes` are not in the file. Versions are
 * restored as EVIDENCE STUBS — the pointer survives, the passage does not, and
 * the row says so. Re-importing the original file restores the evidence, and
 * every fact keeps the quote and offsets needed to re-verify it.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = new URL("..", import.meta.url).pathname;
const MIGRATIONS = join(ROOT, "src/server/db/migrations");

const args = parseArgs(process.argv.slice(2));
const exportPath = args.export;
if (!exportPath) fail("Pass --export <file>. Get one from GET /api/export.");

const DB = args.database ?? "track_record_restore_drill";
const PSQL =
  args.psql ?? "docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U postgres";

const data = JSON.parse(readFileSync(exportPath, "utf8"));

/**
 * Restore order is foreign-key order. It is written out rather than derived,
 * because a wrong order here fails as a constraint violation — loudly — and a
 * derived order would be one more thing that can be subtly wrong.
 */
const TABLES = [
  ["users", () => [restoredUser()]],
  ["profiles", () => withUser(data.profile ?? [], { photo: null })],
  ["employers", () => withUser(data.employers ?? [])],
  ["roles", () => withUser(data.roles ?? [])],
  ["projects", () => withUser(data.projects ?? [])],
  ["educations", () => withUser(data.educations ?? [])],
  ["certifications", () => withUser(data.certifications ?? [])],
  ["source_documents", () => withUser(data.sourceDocuments ?? [])],
  ["source_document_versions", () => (data.sourceDocumentVersions ?? []).map(evidenceStub)],
  ["facts", () => withUser(data.facts ?? [])],
  ["renders", () => withUser(data.renders ?? [])],
  ["render_versions", () => withUser(data.renderVersions ?? [])],
  ["render_proposals", () => withUser(data.renderProposals ?? [])],
];

/**
 * Every foreign key in the schema. The drill asserts each one resolves after the
 * load, which is what turns "the rows are there" into "the record is intact".
 */
const FOREIGN_KEYS = [
  ["profiles", "user_id", "users", "id"],
  ["employers", "user_id", "users", "id"],
  ["roles", "user_id", "users", "id"],
  ["roles", "employer_id", "employers", "id"],
  ["projects", "user_id", "users", "id"],
  ["projects", "employer_id", "employers", "id"],
  ["educations", "user_id", "users", "id"],
  ["certifications", "user_id", "users", "id"],
  ["source_documents", "user_id", "users", "id"],
  ["source_documents", "project_id", "projects", "id"],
  ["source_document_versions", "user_id", "users", "id"],
  ["source_document_versions", "source_document_id", "source_documents", "id"],
  ["facts", "user_id", "users", "id"],
  ["facts", "project_id", "projects", "id"],
  ["facts", "employer_id", "employers", "id"],
  ["facts", "source_document_version_id", "source_document_versions", "id"],
  ["renders", "user_id", "users", "id"],
  ["renders", "current_version_id", "render_versions", "id"],
  ["render_versions", "user_id", "users", "id"],
  ["render_versions", "render_id", "renders", "id"],
  ["render_proposals", "user_id", "users", "id"],
  ["render_proposals", "render_id", "renders", "id"],
  ["render_proposals", "based_on_version_id", "render_versions", "id"],
];

const RESTORED_USER_ID = "usr_restored";

const restoredUser = () => ({
  id: RESTORED_USER_ID,
  // The export carries no user row — it is the record of one account, and the
  // identity is re-established by signing in again.
  name: "Restored record",
  email: `restored-${Date.now()}@example.invalid`,
  email_verified: true,
  image: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});

const withUser = (rows, extra = {}) =>
  rows.map((row) => ({ ...snake(row), user_id: RESTORED_USER_ID, ...extra }));

/**
 * A version whose passage is gone. `import_status` says so, so nothing later
 * mistakes an empty document for a document that legitimately held nothing.
 */
const RAW_EMPTY_BYTEA = { sql: "'\\x'::bytea" };

const evidenceStub = (row) => ({
  ...snake(row),
  user_id: RESTORED_USER_ID,
  extracted_text: "",
  // `original_bytes` is NOT NULL, so the stub is empty rather than absent. It is
  // never read: `import_status = 'failed'` is what says the evidence is gone.
  original_bytes: RAW_EMPTY_BYTEA,
  import_status: "failed",
  import_error:
    "Source text is not part of an export. Re-import the original file to restore this evidence.",
});

/* --------------------------------------------------------------------- run */

console.log(`restore drill → ${DB}`);
psql("postgres", `drop database if exists ${DB}`);
psql("postgres", `create database ${DB}`);

try {
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    runFile(DB, readFileSync(join(MIGRATIONS, file), "utf8").split("--> statement-breakpoint").join(";\n"));
  }
  console.log("  migrations applied");

  const expected = new Map();
  for (const [table, rowsOf] of TABLES) {
    const rows = rowsOf();
    expected.set(table, rows.length);
    if (rows.length === 0) continue;
    runFile(DB, rows.map((row) => insert(table, row)).join("\n"));
  }
  console.log("  rows loaded");

  const failures = [];

  for (const [table, count] of expected) {
    const actual = Number(query(DB, `select count(*) from "${table}"`));
    if (actual !== count) failures.push(`${table}: expected ${count} rows, found ${actual}`);
  }

  for (const [table, column, parent, parentColumn] of FOREIGN_KEYS) {
    const orphans = Number(
      query(
        DB,
        `select count(*) from "${table}" c where c."${column}" is not null
         and not exists (select 1 from "${parent}" p where p."${parentColumn}" = c."${column}")`,
      ),
    );
    if (orphans > 0) failures.push(`${table}.${column} has ${orphans} row(s) pointing nowhere`);
  }

  // Invariant 1 of docs/04 §3.7: a Measured fact must carry its evidence.
  const unproved = Number(
    query(
      DB,
      `select count(*) from "facts"
       where provenance = 'measured'
         and (quote is null or quote_start is null or quote_end is null
              or source_document_version_id is null)`,
    ),
  );
  if (unproved > 0) failures.push(`${unproved} Measured fact(s) restored without evidence`);

  console.log("\n  restored:");
  for (const [table, count] of expected) if (count > 0) console.log(`    ${table.padEnd(28)} ${count}`);

  const stubs = expected.get("source_document_versions") ?? 0;
  if (stubs > 0) {
    console.log(
      `\n  NOT restorable from an export: the text of ${stubs} source document version(s).\n` +
        "  Source documents never export (PRD §6.1). The evidence POINTERS survived — every\n" +
        "  fact kept its quote and offsets — so re-importing the original files restores the\n" +
        "  evidence and the quotes can be re-verified against it.",
    );
  }

  if (failures.length > 0) {
    console.error("\nRESTORE DRILL FAILED");
    for (const failure of failures) console.error(`  ${failure}`);
    process.exit(1);
  }
  console.log("\nrestore drill passed");
} finally {
  if (!args.keep) psql("postgres", `drop database if exists ${DB}`);
}

/* ----------------------------------------------------------------- helpers */

function insert(table, row) {
  const columns = Object.keys(row);
  const values = columns.map((column) => literal(row[column]));
  return `insert into "${table}" (${columns.map((c) => `"${c}"`).join(",")}) values (${values.join(",")});`;
}

function literal(value) {
  if (value === null || value === undefined) return "null";
  // A raw SQL escape hatch, used only for the empty-bytea stub.
  if (typeof value === "object" && value !== null && typeof value.sql === "string") return value.sql;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    return value.every((v) => typeof v === "string")
      ? `ARRAY[${value.map(quote).join(",")}]::text[]`
      : `${quote(JSON.stringify(value))}::jsonb`;
  }
  if (typeof value === "object") return `${quote(JSON.stringify(value))}::jsonb`;
  return quote(String(value));
}

function quote(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

/** The API is camelCase; the database is snake_case (`docs/07` §1). */
function snake(row) {
  return Object.fromEntries(
    Object.entries(row)
      // `hasPhoto` is a report, not a column.
      .filter(([key]) => key !== "hasPhoto")
      .map(([key, value]) => [key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`), value]),
  );
}

function psql(database, sql) {
  // One line: the statement crosses a shell argument, and a real newline in it
  // arrives at psql as a literal backslash-n.
  return run(`${PSQL} -d ${database} -tAc ${JSON.stringify(sql.replace(/\s+/g, " ").trim())}`);
}

function query(database, sql) {
  return psql(database, sql).trim();
}

function runFile(database, sql) {
  const path = join(tmpdir(), `restore-drill-${process.pid}-${Math.random().toString(36).slice(2)}.sql`);
  writeFileSync(path, sql);
  try {
    run(`${PSQL} -d ${database} -f - < ${JSON.stringify(path)}`);
  } finally {
    unlinkSync(path);
  }
}

function run(command) {
  try {
    return execFileSync("/bin/sh", ["-c", command], { cwd: ROOT, encoding: "utf8" });
  } catch (error) {
    fail(`${command}\n${error.stderr ?? error.message}`);
  }
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) parsed[key] = true;
    else {
      parsed[key] = next;
      i++;
    }
  }
  return parsed;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
