/** Run the demo seed in Node with the repository's binary-module loader. */
import { eq } from "drizzle-orm";
import { seedDemo } from "../../scripts/demo-seed/demo";
import { createDb } from "~/server/db/client";
import { users } from "~/server/db/schema";
import { DEMO_SEED_IDENTITY, E2E_DATABASE_URL } from "./env";

const db = createDb(E2E_DATABASE_URL);
const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, DEMO_SEED_IDENTITY.email));
if (!user) throw new Error("Disposable demo user was not created");
// The sent copy falls before the June birthday and the seed's "today" after it.
// This makes a stale age observable, as well as a stale 作成日.
const RealDate = Date;
const today = new RealDate("2026-06-20T12:00:00+09:00");
class SeedDate extends RealDate {
  constructor(...args: ConstructorParameters<DateConstructor>) {
    super(args.length ? args[0] : today.getTime());
  }
  static override now() { return today.getTime(); }
}
globalThis.Date = SeedDate as DateConstructor;
try {
  await seedDemo(E2E_DATABASE_URL, user.id);
} finally {
  globalThis.Date = RealDate;
}
console.log("Disposable demo record seeded");
