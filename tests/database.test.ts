/**
 * The batch-write rule (`docs/03-technical-design.md` §5,
 * `docs/11-testing-plan.md` §2 blocking list).
 *
 * Every multi-statement write in this codebase goes through `db.batch([...])`.
 * That is not a preference — `db.transaction()` THROWS on the neon-http driver,
 * and a driver upgrade that quietly changed either half of this would be
 * invisible until a partially-applied write corrupted a record.
 */
import { describe, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { createDb } from "~/server/db/client";
import { employers, users } from "~/server/db/schema";
import { seedAllowedUser } from "./helpers/seed";
import type { Bindings } from "~/server/env";

const db = createDb((env as unknown as Bindings).DATABASE_URL);

describe("the neon-http driver", () => {
  it("still refuses interactive transactions, which is why batch is the rule", async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.select().from(users).limit(1);
      }),
    ).rejects.toThrow(/no transactions support/i);
  });

  it("executes db.batch as a single atomic transaction", async () => {
    const user = await seedAllowedUser();
    const base = {
      userId: user.id,
      employmentType: "full_time" as const,
      startedOn: "2022-04-01",
    };

    // Two inserts, the second violating the primary key. If batch were not a
    // transaction, the first would survive.
    const duplicate = `emp_batch_${Date.now()}`;
    await expect(
      db.batch([
        db.insert(employers).values({ ...base, id: `emp_ok_${Date.now()}`, nameJa: "一社目" }),
        db.insert(employers).values({ ...base, id: duplicate, nameJa: "二社目" }),
        db.insert(employers).values({ ...base, id: duplicate, nameJa: "同じID" }),
      ]),
    ).rejects.toThrow();

    const survivors = await db.select().from(employers).where(eq(employers.userId, user.id));
    expect(survivors).toHaveLength(0);
  });
});
