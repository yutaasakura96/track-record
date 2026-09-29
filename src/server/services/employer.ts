/**
 * Which employer a fact belongs to — the one order every reader resolves it in
 * (`docs/04-database-schema.md` §3.12).
 *
 * Today: the fact's own employer, then its project's. #35 adds the document's
 * employer between the two, here and nowhere else, and changes how a hand-set
 * employer is told apart from a resolved one.
 *
 * A correlated subquery rather than a join, so a reader drops it into a select
 * or a where clause without restructuring its query. It filters by `user_id`
 * like every other query: a project row is only ever read for its own user.
 */
import { sql } from "drizzle-orm";
import { facts, projects } from "../db/schema";

export const effectiveEmployerId = sql<string | null>`coalesce(
  ${facts.employerId},
  (select ${projects.employerId} from ${projects}
    where ${projects.id} = ${facts.projectId} and ${projects.userId} = ${facts.userId})
)`;
