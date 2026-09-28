/**
 * `npm run db:reset` — stops the stack and removes the `pgdata` volume, which
 * destroys `track_record_dev`. Refuses without the confirmation flag
 * (`./db-volume-core.ts`). `npm run db:down` is the non-destructive stop.
 */
import { execFileSync } from "node:child_process";
import { resetArgs } from "./db-volume-core";

const decision = resetArgs(process.argv.slice(2));
if (!decision.ok) {
  console.error(decision.reason);
  process.exit(1);
}
execFileSync("docker", decision.args, { stdio: "inherit" });
