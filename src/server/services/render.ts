/**
 * Generation, and the two exclusions that are the whole point of it.
 *
 * **Enforcement point 2 — generation input.** Private facts are filtered out
 * BEFORE the request is built. They never leave the database, rather than being
 * filtered out of the response afterwards.
 *
 * **Enforcement point 3 — render output.** Generated-provenance facts are
 * excluded at render time. A Generated fact may be *accepted* into the record;
 * the block lives here, at the point where disclosure actually happens, and not
 * at review, which would depend on review having happened correctly.
 *
 * (`docs/03-technical-design.md` §7.)
 */
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import {
  certifications,
  educations,
  employers,
  facts,
  projects,
  renderProposals,
  roles,
} from "../db/schema";
import type { ModelSeam, RenderFact, RenderSpec } from "~/model/types";
import { ModelUnavailableError, type ModelUsage } from "~/model/types";
import type { RenderContent, RenderKind } from "~/shared/render-content";
import { RENDER_DEFINITIONS, type RenderDefinition } from "~/render/spec";

export interface RenderInputs {
  facts: RenderFact[];
  spec: RenderSpec;
  /** A COUNT and nothing else. The footer states that something was withheld. */
  privateFactCount: number;
  /** Accepted facts held back because their provenance is Generated. */
  generatedFactCount: number;
  /** Every accepted fact, however excluded — what staleness is measured against. */
  acceptedFactCount: number;
}

type Chronology = NonNullable<RenderDefinition["chronology"]>;

/**
 * Turns a list's SQL order into the order the document reads in.
 *
 * The SQL order is canonical and load-bearing — `educations` orders on
 * `coalesce(started_on, ended_on)` precisely so a row carrying only a
 * graduation month does not sort last — so a document that reads the other way
 * is served by reversing here, never by reordering the query. Reversing keeps
 * the coalesce and inverts only the `id` tie-break, which orders nothing a
 * reader can see. A `null` chronology belongs to a kind that cannot generate;
 * it takes the query's order and reaches no document.
 *
 * `dateOf` is passed by the one list whose sort key can be null, and moves the
 * rows carrying no date to the end of THE DOCUMENT'S list — after the direction
 * is applied, never before. Null placement does not survive a reversal:
 * Postgres sorts nulls first in `desc` and last in `asc`, so a rule fixed in
 * the query reads correctly in one direction and backwards in the other
 * (`docs/06`, 2026-09-07).
 */
export function inDocumentOrder<T>(
  rows: T[],
  sqlOrder: Chronology,
  document: Chronology | null,
  dateOf?: (row: T) => string | null,
): T[] {
  const read = document === null || document === sqlOrder ? rows : [...rows].reverse();
  if (!dateOf) return read;
  return [...read.filter((r) => dateOf(r) !== null), ...read.filter((r) => dateOf(r) === null)];
}

export async function collectRenderInputs(
  db: Db,
  userId: string,
  kind: RenderKind,
  subjectName: string,
): Promise<RenderInputs> {
  const accepted = await db
    .select()
    .from(facts)
    .where(and(eq(facts.userId, userId), eq(facts.status, "accepted")));

  const employerRows = await db
    .select()
    .from(employers)
    .where(eq(employers.userId, userId))
    .orderBy(desc(employers.startedOn));
  const projectRows = await db.select().from(projects).where(eq(projects.userId, userId));
  // Roles are what give an employer section its TITLE. Without them the model
  // had only the claim prose to take one from (`docs/06`, 2026-09-04).
  const roleRows = await db
    .select()
    .from(roles)
    .where(eq(roles.userId, userId))
    .orderBy(desc(roles.startedOn));
  // 学歴 and 免許・資格. Neither reached this spec until 2026-09-06, and the
  // consequence was not a thinner education section but no education section
  // at all: a career fact that happened at no employer and on no project had
  // nowhere in the register to land, so it left the document (`docs/06`).
  const educationRows = await db
    .select()
    .from(educations)
    .where(eq(educations.userId, userId))
    // Ascending is the canonical order, because that is the order 学歴 is read
    // in. A document that reads the other way reverses it at the boundary
    // below, never here. Ordered on the coalesce rather than on `started_on`,
    // because a row that carries only a graduation month has a null there and
    // Postgres sorts nulls LAST in ASC — which would put the author's oldest
    // schooling at the bottom of the list, in either direction.
    .orderBy(asc(sql`coalesce(${educations.startedOn}, ${educations.endedOn})`), asc(educations.id));
  // Nulls sort FIRST in `desc`, so this query leads with the undated rows. That
  // is not corrected here: where an undated certification belongs is a question
  // about the document, and the boundary below answers it in both directions.
  const certificationRows = await db
    .select()
    .from(certifications)
    .where(eq(certifications.userId, userId))
    .orderBy(desc(certifications.issuedOn), asc(certifications.id));
  const employerById = new Map(employerRows.map((e) => [e.id, e]));
  const projectById = new Map(projectRows.map((p) => [p.id, p]));
  const rolesByEmployer = new Map<string, typeof roleRows>();
  for (const role of roleRows) {
    const held = rolesByEmployer.get(role.employerId) ?? [];
    held.push(role);
    rolesByEmployer.set(role.employerId, held);
  }

  const privateFacts = accepted.filter((f) => f.disclosure === "private");
  const generatedFacts = accepted.filter(
    (f) => f.disclosure !== "private" && f.provenance === "generated",
  );

  // Both filters run here, before the request is built. Nothing downstream can
  // reintroduce an excluded fact, because nothing downstream ever sees one.
  const usable = accepted.filter(
    (f) => f.disclosure !== "private" && f.provenance !== "generated",
  );

  const renderFacts: RenderFact[] = usable.map((f) => {
    const employer = f.employerId ? employerById.get(f.employerId) : undefined;
    const project = f.projectId ? projectById.get(f.projectId) : undefined;
    return {
      id: f.id,
      claim: f.claim,
      provenance: f.provenance as "measured" | "attested",
      disclosure: f.disclosure as "public" | "restricted",
      technologies: f.technologies,
      ...(employer
        ? {
            employer: {
              id: employer.id,
              name: employer.nameLatin ?? employer.nameJa,
              startedOn: employer.startedOn,
              endedOn: employer.endedOn,
              industry: employer.industryJa,
            },
          }
        : {}),
      ...(project ? { project: { name: project.name, summary: project.summary } } : {}),
    };
  });

  const definition = RENDER_DEFINITIONS[kind];
  return {
    facts: renderFacts,
    spec: {
      kind,
      language: definition.language,
      subjectName,
      register: definition.register,
      // Newest-first out of SQL; the document decides whether it stays that
      // way. The 履歴書's 職歴 block reads ascending (`docs/04` §4).
      employers: inDocumentOrder(employerRows, "newest_first", definition.chronology).map((e) => ({
        id: e.id,
        name: e.nameLatin ?? e.nameJa,
        industry: e.industryJa,
        startedOn: e.startedOn,
        endedOn: e.endedOn,
        businessDescription: e.businessDescription,
        // An English render prefers the Latin title and a Japanese one the
        // Japanese title, but either is better than none, so each falls back to
        // the other. A role with neither carries no title and is dropped: it
        // still bounds the employer's dates, which the employer row already has.
        roles: (rolesByEmployer.get(e.id) ?? []).flatMap((r) => {
          const title =
            definition.language === "ja"
              ? (r.titleJa ?? r.titleLatin)
              : (r.titleLatin ?? r.titleJa);
          return title ? [{ title, startedOn: r.startedOn, endedOn: r.endedOn }] : [];
        }),
      })),
      projects: projectRows.map((p) => ({
        id: p.id,
        name: p.name,
        employerId: p.employerId,
        summary: p.summary,
      })),
      // The same language rule a role title follows, with one difference: the
      // Latin name is required by the schema and the Japanese one is optional,
      // so only the Japanese render needs a fallback.
      educations: inDocumentOrder(educationRows, "oldest_first", definition.chronology).map((e) => ({
        id: e.id,
        institution:
          definition.language === "ja" ? (e.institutionJa ?? e.institution) : e.institution,
        faculty: e.faculty,
        degree: e.degree,
        fieldOfStudy: e.fieldOfStudy,
        startedOn: e.startedOn,
        endedOn: e.endedOn,
        outcome: e.outcome,
        // The rung the register tests. Sent even when null: the register is
        // told that an unstated level prints, so the model never has to fall
        // back to reading the institution's name (`docs/06`, 2026-09-06).
        level: e.level,
      })),
      // The only list here whose sort key can be null: `employers.started_on`
      // is not null, and an education is required to carry a start, an end or
      // both. A certification with no issue date is printed, and printed last —
      // position in a dated list is a claim about when, and this row makes none.
      // The 履歴書 omits it outright, because 免許・資格 is 年 / 月 / 名称 and has
      // nowhere to put it (`docs/04` §4); that is the register's rule, not this
      // boundary's, and until it exists the tail is where the row does least.
      certifications: inDocumentOrder(
        certificationRows,
        "newest_first",
        definition.chronology,
        (c) => c.issuedOn,
      ).map((c) => ({
        id: c.id,
        name: definition.language === "ja" ? (c.nameJa ?? c.name) : c.name,
        issuingOrganization: c.issuingOrganization,
        issuedOn: c.issuedOn,
        expiresOn: c.expiresOn,
        technologies: c.technologies,
      })),
    },
    privateFactCount: privateFacts.length,
    generatedFactCount: generatedFacts.length,
    acceptedFactCount: accepted.length,
  };
}

/**
 * The last line of defence: even if a model echoed an id it was never given,
 * a block referencing an excluded fact cannot carry it into a stored version.
 */
export function stripUnknownFactIds(content: RenderContent, allowed: Set<string>): RenderContent {
  return {
    sections: content.sections.map((section) => ({
      ...section,
      blocks: section.blocks.map((block) => ({
        ...block,
        factIds: block.factIds.filter((id) => allowed.has(id)),
      })),
    })),
  };
}

export interface GenerateArgs {
  db: Db;
  model: ModelSeam;
  userId: string;
  proposalId: string;
  inputs: RenderInputs;
}

/**
 * Runs the model and lands the result on the proposal row. It never touches a
 * `render_versions` row and never moves `renders.current_version_id`, which is
 * what makes "a failure never destroys or mutates a stored version" true by
 * construction rather than by care.
 */
export async function generateIntoProposal(args: GenerateArgs): Promise<void> {
  const { db, model, userId, proposalId, inputs } = args;
  try {
    let usage: ModelUsage | null = null;
    const content = await model.generateRender(inputs.facts, inputs.spec, {
      onUsage: (u) => {
        usage = u;
      },
    });
    const allowed = new Set(inputs.facts.map((f) => f.id));
    await db
      .update(renderProposals)
      .set({
        content: stripUnknownFactIds(content, allowed),
        generationStatus: "ready",
        generationError: null,
        // Four keys, four columns of the same name. See `ModelUsage`.
        ...(usage ?? {}),
        updatedAt: new Date(),
      })
      .where(and(eq(renderProposals.userId, userId), eq(renderProposals.id, proposalId)));
  } catch (err) {
    const reason =
      err instanceof ModelUnavailableError
        ? err.message
        : "This document could not be generated. Your current version is unchanged.";
    await db
      .update(renderProposals)
      .set({ generationStatus: "failed", generationError: reason, updatedAt: new Date() })
      .where(and(eq(renderProposals.userId, userId), eq(renderProposals.id, proposalId)));
    // Ids only. Never the facts sent, never the content returned.
    console.error(JSON.stringify({ event: "generation_failed", proposalId }));
  }
}
