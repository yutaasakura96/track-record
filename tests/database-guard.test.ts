/**
 * The suite must never run against the development database.
 *
 * `tests/global-setup.ts` drops and rebuilds `public` on every run, which is
 * correct (`docs/11-testing-plan.md` §1) and total. When the two databases are
 * the same one, that correct behaviour destroys the signed-in session, the
 * profile, the imported documents and every accepted render version — silently,
 * as a side effect of running the suite before committing (issue #4).
 */
import { describe, expect, it } from "vitest";
import {
  assertConnectedTo,
  assertSuiteDatabaseIsNotDev,
  databaseTarget,
  devDatabaseUrl,
} from "./database-guard";

const SUITE = "postgresql://postgres:postgres@localhost:5432/track_record_test?sslmode=require";
const DEV = "postgresql://postgres:postgres@localhost:5432/track_record_dev?sslmode=disable";

const devVars = (line: string) => `# Local development.\n${line}\nBETTER_AUTH_URL="http://x"\n`;

describe("reading DATABASE_URL out of .dev.vars", () => {
  it("takes the value, quoted or bare", () => {
    expect(devDatabaseUrl(devVars(`DATABASE_URL="${DEV}"`))).toBe(DEV);
    expect(devDatabaseUrl(devVars(`DATABASE_URL=${DEV}`))).toBe(DEV);
    expect(devDatabaseUrl(devVars(`  DATABASE_URL = "${DEV}"  `))).toBe(DEV);
  });

  it("ignores a commented-out line, and a name that merely ends in DATABASE_URL", () => {
    expect(devDatabaseUrl(devVars(`# DATABASE_URL="${DEV}"`))).toBe(null);
    expect(devDatabaseUrl(devVars(`TEST_DATABASE_URL="${DEV}"`))).toBe(null);
  });

  it("reports nothing when there is no file at all", () => {
    expect(devDatabaseUrl(null)).toBe(null);
  });
});

describe("naming what a connection string points at", () => {
  it("carries host, port and database, defaulting the port Postgres defaults", () => {
    expect(databaseTarget(SUITE)).toEqual({
      host: "localhost",
      port: "5432",
      database: "track_record_test",
    });
    expect(databaseTarget("postgresql://user:pw@ep-x.neon.tech/track_record_test")).toEqual({
      host: "ep-x.neon.tech",
      port: "5432",
      database: "track_record_test",
    });
  });

  it("reports nothing for a string that is not a connection string", () => {
    expect(databaseTarget("")).toBe(null);
    expect(databaseTarget("not a url")).toBe(null);
  });

  /**
   * `src/server/db/client.ts` already treats these four as one place. A guard
   * that did not would be defeated by spelling the same server differently.
   */
  it("reads every spelling of the local server as one host", () => {
    const spellings = ["localhost", "127.0.0.1", "[::1]", "db.localtest.me", "postgres"];
    const hosts = spellings.map(
      (host) => databaseTarget(`postgresql://postgres:postgres@${host}:5432/track_record_test`)?.host,
    );
    expect(new Set(hosts).size).toBe(1);
  });
});

describe("the guard", () => {
  it("refuses to run when the suite and dev name the same database on the same server", () => {
    const collision = "postgresql://postgres:postgres@localhost:5432/track_record_test?sslmode=disable";
    expect(() => assertSuiteDatabaseIsNotDev(SUITE, devVars(`DATABASE_URL="${collision}"`))).toThrow(
      /track_record_test/,
    );
  });

  it("says how to fix it rather than only that it is broken", () => {
    const collision = "postgresql://postgres:postgres@localhost:5432/track_record_test";
    let message = "";
    try {
      assertSuiteDatabaseIsNotDev(SUITE, devVars(`DATABASE_URL="${collision}"`));
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain(".dev.vars");
    expect(message).toContain("track_record_dev");
  });

  it("allows the two databases the project ships with", () => {
    expect(() => assertSuiteDatabaseIsNotDev(SUITE, devVars(`DATABASE_URL="${DEV}"`))).not.toThrow();
  });

  it("is not defeated by spelling the same local server a different way", () => {
    const loopback = "postgresql://postgres:postgres@127.0.0.1:5432/track_record_test";
    expect(() => assertSuiteDatabaseIsNotDev(SUITE, devVars(`DATABASE_URL="${loopback}"`))).toThrow();
  });

  it("allows a dev database of the same name on a different server", () => {
    const remote = "postgresql://user:pw@ep-quiet-band.neon.tech/track_record_test?sslmode=require";
    expect(() => assertSuiteDatabaseIsNotDev(SUITE, devVars(`DATABASE_URL="${remote}"`))).not.toThrow();
  });

  it("allows a run with no .dev.vars — CI has none, and there is nothing to lose there", () => {
    expect(() => assertSuiteDatabaseIsNotDev(SUITE, null)).not.toThrow();
  });

  it("allows a .dev.vars that sets no DATABASE_URL at all", () => {
    expect(() => assertSuiteDatabaseIsNotDev(SUITE, "BETTER_AUTH_URL=\"http://x\"\n")).not.toThrow();
  });

  /**
   * Every branch below used to fall through to the drop. A guard that shrugs at
   * input it cannot read is not a guard — the run it lets past is exactly the
   * one nobody understood.
   */
  it("refuses when TEST_DATABASE_URL cannot be read, rather than dropping anyway", () => {
    expect(() => assertSuiteDatabaseIsNotDev("not a url", null)).toThrow(/TEST_DATABASE_URL/);
  });

  it("refuses when .dev.vars sets a DATABASE_URL it cannot read", () => {
    expect(() => assertSuiteDatabaseIsNotDev(SUITE, devVars(`DATABASE_URL="{{FILL_ME_IN}}"`))).toThrow(
      /\.dev\.vars/,
    );
  });

  it("refuses to aim the suite at the development database, whatever .dev.vars says", () => {
    const aimedAtDev = "postgresql://postgres:postgres@localhost:5432/track_record_dev";
    expect(() => assertSuiteDatabaseIsNotDev(aimedAtDev, null)).toThrow(/track_record_dev/);
  });

  it("also reads a DATABASE_URL exported into the environment, not only .dev.vars", () => {
    const exported = "postgresql://postgres:postgres@localhost:5432/track_record_test";
    expect(() => assertSuiteDatabaseIsNotDev(SUITE, null, exported)).toThrow(/same database/);
    expect(() => assertSuiteDatabaseIsNotDev(SUITE, null, DEV)).not.toThrow();
  });
});

describe("the second guard, after connecting", () => {
  /**
   * The Neon proxy is configured with its own PG_CONNECTION_STRING. It honours
   * the database named by each client, but a misconfiguration there would send
   * the drop to the wrong database with nothing in the URL to show for it.
   */
  it("refuses when the server answers from a database other than the one asked for", () => {
    expect(() => assertConnectedTo("track_record_test", "track_record_dev")).toThrow(
      /track_record_dev/,
    );
  });

  it("passes when the connection landed where it was aimed", () => {
    expect(() => assertConnectedTo("track_record_test", "track_record_test")).not.toThrow();
  });
});
