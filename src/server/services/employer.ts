/**
 * Which employer a fact belongs to — the one order every reader resolves it in
 * (`docs/04-database-schema.md` §3.12): the fact's hand-set employer, then its
 * document's, then its project's.
 *
 * The SQL itself lives in `../db/fact-employer.ts`, which has no imports so
 * that the attribution script reads the same text. This is that text for
 * Drizzle, where every query names the table `"facts"`.
 *
 * Read by the render, Version Edit, the fact list and its filter, and the
 * overlap matcher. A reader that reads `facts.employer_id` alone sees only the
 * hand-set employers and files every other fact under nothing.
 */
import { getTableColumns, sql } from "drizzle-orm";
import { facts } from "../db/schema";
import { effectiveEmployerSql, employerSetByHandSql } from "../db/fact-employer";

export const effectiveEmployerId = sql<string | null>`${sql.raw(effectiveEmployerSql('"facts"'))}`;

/** Whether a fact's employer was set on its card, and so does not follow its document. */
export const employerSetByHand = sql<boolean>`${sql.raw(employerSetByHandSql('"facts"'))}`;

/**
 * Every column of a fact, and the employer it resolves to. For a select that
 * hands whole rows on, so the resolved employer travels with the row rather
 * than being looked up again downstream.
 */
export const factWithEmployer = { ...getTableColumns(facts), resolvedEmployerId: effectiveEmployerId };

export type FactWithEmployer = typeof facts.$inferSelect & { resolvedEmployerId: string | null };
