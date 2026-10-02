/**
 * Which employer a fact belongs to, as SQL text — the one definition every
 * reader resolves it by (`docs/04-database-schema.md` §3.12).
 *
 *   1. the employer set on the fact by hand, `No employer` included;
 *   2. its document's employer;
 *   3. its project's employer.
 *
 * A hand set is `employer_set_at` stamped, or `employer_id` not null: nothing
 * but the card's picker ever writes `employer_id`, so a non-null one is a hand
 * set even on a fact filed before the stamp existed (`docs/04` §3.7).
 *
 * Plain text with NO IMPORTS, so that `scripts/check-attribution.mjs` loads it
 * under Node exactly as the Worker does through `effectiveEmployerId`
 * (`src/server/services/employer.ts`). A second copy of this order in the
 * script is how the readers came to disagree before (`docs/06`, 2026-09-28).
 *
 * Correlated subqueries rather than joins, so a reader drops it into a select
 * or a where clause without restructuring its query. Every row read is
 * filtered by the fact's own `user_id`.
 *
 * @param fact how the calling query names the `facts` row: `"facts"` in a
 *   Drizzle query, or the alias a hand-written one gives it.
 */
export function effectiveEmployerSql(fact: string): string {
  return `(case
  when ${employerSetByHandSql(fact)} then ${fact}.employer_id
  else coalesce(
    (select fe_d.employer_id
      from source_document_versions fe_v
      join source_documents fe_d on fe_d.id = fe_v.source_document_id and fe_d.user_id = fe_v.user_id
      where fe_v.id = ${fact}.source_document_version_id and fe_v.user_id = ${fact}.user_id),
    (select fe_p.employer_id from projects fe_p
      where fe_p.id = ${fact}.project_id and fe_p.user_id = ${fact}.user_id)
  )
end)`;
}

/** Whether the fact's employer is its own, set on its card — the first step above. */
export function employerSetByHandSql(fact: string): string {
  return `(${fact}.employer_id is not null or ${fact}.employer_set_at is not null)`;
}

/** The same rule, for one fact already read. */
export function employerSetByHand(fact: { employerId: string | null; employerSetAt: Date | null }): boolean {
  return fact.employerId !== null || fact.employerSetAt !== null;
}
