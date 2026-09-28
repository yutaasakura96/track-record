/**
 * `npm run db:down` keeps the local volume (`docs/06`, 2026-09-28).
 *
 * The volume holds `track_record_dev`, the only copy of the record until #40.
 * These prove the scripts as written; the CI job also runs `db:down` against its
 * own stack and checks the volume is still there afterwards.
 */
import { describe, expect, it } from "vitest";
import pkg from "../package.json";
import {
  DOWN_ARGS,
  RESET_CONFIRMATION,
  removesVolumes,
  resetArgs,
} from "../scripts/db-volume-core";

describe("npm run db:down", () => {
  it("stops the stack without removing a volume", () => {
    expect(pkg.scripts["db:down"]).toBe(`docker ${DOWN_ARGS.join(" ")}`);
    expect(removesVolumes(pkg.scripts["db:down"].split(/\s+/))).toBe(false);
  });

  it("recognises every spelling of the volume flag", () => {
    for (const flag of ["-v", "--volumes", "-tv", "-vt"]) {
      expect(removesVolumes(["compose", "down", flag])).toBe(true);
    }
    expect(removesVolumes(["compose", "down", "--timeout", "5"])).toBe(false);
  });

  it("is the only script that calls docker compose down directly", () => {
    const downs = Object.entries(pkg.scripts).filter(([, command]) => /compose\s+down/.test(command));
    expect(downs.map(([name]) => name)).toEqual(["db:down"]);
  });
});

describe("npm run db:reset", () => {
  it("refuses without the confirmation flag, and names the safe command", () => {
    for (const argv of [[], ["--yes"], ["--force"], [`${RESET_CONFIRMATION}=false`]]) {
      const decision = resetArgs(argv);
      expect(decision.ok).toBe(false);
      if (!decision.ok) expect(decision.reason).toContain("npm run db:down");
    }
  });

  it("removes the volume only when confirmed", () => {
    const decision = resetArgs([RESET_CONFIRMATION]);
    expect(decision).toEqual({ ok: true, args: ["compose", "down", "--volumes"] });
  });

  it("goes through the guard, not straight to docker", () => {
    expect(pkg.scripts["db:reset"]).toBe("tsx scripts/db-reset.ts");
  });
});
