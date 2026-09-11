/**
 * The record half of a hand edit (`docs/02` S16).
 *
 * **Enforcement point 4 — a hand-typed block.** Generation filters Private
 * facts out of its input and Generated facts out of its output
 * (`services/render.ts`), and a sentence the author types reaches a version
 * without passing either. What a typed sentence SAYS cannot be checked by any
 * code here — the author is the discloser, and a check that pretended
 * otherwise would read as a guarantee it is not. What it CITES can be, and is:
 * an edited block may not cite a fact the record does not hold, nor one that a
 * generation would have been forbidden to use.
 *
 * The attribution instrument's other three findings — unfiled, misfiled,
 * unresolved heading — come back as WARNINGS rather than refusals. They are
 * judgements about headings, and an author restructuring a section by hand may
 * be right where the checker is wrong. Refusing on them would block the edit
 * this route exists to serve.
 */
import { and, eq, sql } from "drizzle-orm";
import { employers, facts, projects } from "../db/schema";
import type { Db } from "../db/client";
import type { CareerRecord } from "~/render/attribution";
import { checkAttribution } from "~/render/attribution";
import type { RenderContent } from "~/shared/render-content";

/** Why a cited fact may not appear in a document. */
export type CitationProblem = "unknown" | "not-accepted" | "private" | "generated";

interface FactRow {
  status: string;
  provenance: string;
  disclosure: string;
}

export interface EditableRecord {
  record: CareerRecord;
  byId: Map<string, FactRow>;
}

/**
 * Every fact, whatever its status — `unknown` has to mean an id that is not in
 * the record, not an id that is merely not accepted yet, or the two refusals
 * would name each other's cause.
 *
 * A fact's EFFECTIVE employer is its own, or its project's when it is filed to
 * a project rather than straight to an employer. Resolved here, in SQL, so that
 * `checkAttribution` stays a pure function of what it is given — the same hop
 * `scripts/check-attribution.mjs` resolves for the instrument.
 */
export async function collectEditableRecord(db: Db, userId: string): Promise<EditableRecord> {
  const factRows = await db
    .select({
      id: facts.id,
      employerId: sql<string | null>`coalesce(${facts.employerId}, ${projects.employerId})`,
      status: facts.status,
      provenance: facts.provenance,
      disclosure: facts.disclosure,
    })
    .from(facts)
    .leftJoin(projects, and(eq(projects.id, facts.projectId), eq(projects.userId, facts.userId)))
    .where(eq(facts.userId, userId));

  const employerRows = await db
    .select({ id: employers.id, nameJa: employers.nameJa, nameLatin: employers.nameLatin })
    .from(employers)
    .where(eq(employers.userId, userId));

  return {
    record: {
      facts: factRows.map((f) => ({ id: f.id, employerId: f.employerId })),
      employers: employerRows.map((e) => ({
        // 日本語 and Latin both: a render writes whichever its language calls for.
        id: e.id,
        names: [e.nameJa, e.nameLatin].filter((n): n is string => n !== null && n !== ""),
      })),
    },
    byId: new Map(
      factRows.map((f) => [
        f.id,
        { status: f.status, provenance: f.provenance, disclosure: f.disclosure },
      ]),
    ),
  };
}

export interface BadCitation {
  factId: string;
  problem: CitationProblem;
}

/**
 * The mechanical refusals, in the order they are worth reporting. A fact that
 * is Private is reported as Private even if it is also Generated: the stronger
 * reason is the one the author needs to hear.
 */
export function badCitations(cited: readonly string[], record: EditableRecord): BadCitation[] {
  const bad: BadCitation[] = [];
  for (const factId of cited) {
    const fact = record.byId.get(factId);
    if (!fact) {
      bad.push({ factId, problem: "unknown" });
    } else if (fact.disclosure === "private") {
      bad.push({ factId, problem: "private" });
    } else if (fact.status !== "accepted") {
      bad.push({ factId, problem: "not-accepted" });
    } else if (fact.provenance === "generated") {
      bad.push({ factId, problem: "generated" });
    }
  }
  return bad;
}

const PROBLEM_TEXT: Record<CitationProblem, string> = {
  unknown: "is not in your record",
  "not-accepted": "has not been accepted into your record",
  private: "is Private and never reaches a document",
  generated: "is Generated-provenance and never reaches a document",
};

/**
 * Ids and reasons, never claim text — a fact's claim does not belong in an
 * error message any more than it belongs in a log line.
 */
export function citationMessage(bad: readonly BadCitation[]): string {
  const first = bad[0]!;
  const rest = bad.length - 1;
  const tail = rest === 0 ? "" : ` (and ${rest} other${rest === 1 ? "" : "s"})`;
  return `${first.factId} ${PROBLEM_TEXT[first.problem]}${tail}.`;
}

/**
 * Advisory findings on an accepted edit, stated the way `rirekishoWarnings`
 * states its own: plain sentences, ids and counts, no render text.
 *
 * `unknown-fact` cannot appear here — it is a refusal, and an edit carrying one
 * never reaches this function.
 */
export function editWarnings(content: RenderContent, record: CareerRecord): string[] {
  const report = checkAttribution(content, record);
  const warnings: string[] = [];
  for (const finding of report.findings) {
    if (finding.invariant === "unfiled-fact") {
      warnings.push(
        `${finding.factId} is filed to no employer, and ${finding.blockId} sits under an employer heading.`,
      );
    } else if (finding.invariant === "misfiled-fact") {
      warnings.push(
        `${finding.blockId} cites ${finding.factId}, which is filed to a different employer than its heading names.`,
      );
    } else if (finding.invariant === "unresolved-heading") {
      warnings.push(`The heading above ${finding.blockId} names no employer in your record.`);
    }
  }
  return warnings;
}
