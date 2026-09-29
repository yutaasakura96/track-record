/**
 * `npm run db:reset` is the only way to remove the local volume (`docs/06`,
 * 2026-09-28).
 *
 * The volume holds `track_record_dev`, the only copy of the record until #40.
 * These prove `resetArgs` refuses without confirmation; the CI job also runs
 * `db:down` against its own stack and checks the volume is still there afterwards.
 */
import { describe, expect, it } from "vitest";
import { RESET_CONFIRMATION, resetArgs } from "../scripts/db-volume-core";

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
});
