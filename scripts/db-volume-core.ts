/**
 * What `npm run db:down` and `npm run db:reset` hand to Docker (`docs/06`,
 * 2026-09-28).
 *
 * The `pgdata` volume holds `track_record_dev`, and until #40 moves the record
 * into Neon that is the only copy of it (`docs/12` §1). `db:down` used to be
 * `docker compose down -v`, which removes the named volumes the compose file
 * declares, so stopping the stack also destroyed the record. `db:down` now stops
 * the containers and nothing else; removing the volume is `db:reset`, and it
 * refuses unless the confirmation flag below is passed.
 *
 * Pure, so the suite can prove both inside the Workers runtime.
 */

/** The only argument that lets `db:reset` remove the volume. */
export const RESET_CONFIRMATION = "--destroy-local-record";

/** `docker compose down` with no volume flag: containers go, the volume stays. */
export const DOWN_ARGS = ["compose", "down"] as const;

/** Whether an argument list to `docker compose down` would remove a volume. */
export function removesVolumes(args: readonly string[]): boolean {
  return args.some((arg) => arg === "--volumes" || /^-[a-zA-Z]*v[a-zA-Z]*$/.test(arg));
}

export type ResetDecision =
  | { ok: true; args: readonly string[] }
  | { ok: false; reason: string };

/** The docker arguments for `db:reset`, or why it refuses to run. */
export function resetArgs(argv: readonly string[]): ResetDecision {
  if (!argv.includes(RESET_CONFIRMATION)) {
    return {
      ok: false,
      reason:
        `db:reset removes the pgdata volume, and with it track_record_dev — the only copy of the ` +
        `record until #40 moves it into Neon. Nothing was run. To stop the stack and keep the data, ` +
        `use npm run db:down. To destroy it anyway: npm run db:reset -- ${RESET_CONFIRMATION}`,
    };
  }
  return { ok: true, args: [...DOWN_ARGS, "--volumes"] };
}
