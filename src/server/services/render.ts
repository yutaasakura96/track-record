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
import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { employers, facts, projects, renderProposals } from "../db/schema";
import type { ModelSeam, RenderFact, RenderSpec } from "~/model/types";
import { ModelUnavailableError, type ModelUsage } from "~/model/types";
import type { RenderContent, RenderKind } from "~/shared/render-content";
import { RENDER_DEFINITIONS } from "~/render/spec";

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

  const employerRows = await db.select().from(employers).where(eq(employers.userId, userId));
  const projectRows = await db.select().from(projects).where(eq(projects.userId, userId));
  const employerById = new Map(employerRows.map((e) => [e.id, e]));
  const projectById = new Map(projectRows.map((p) => [p.id, p]));

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
      employers: employerRows.map((e) => ({
        id: e.id,
        name: e.nameLatin ?? e.nameJa,
        industry: e.industryJa,
        startedOn: e.startedOn,
        endedOn: e.endedOn,
        businessDescription: e.businessDescription,
      })),
      projects: projectRows.map((p) => ({
        id: p.id,
        name: p.name,
        employerId: p.employerId,
        summary: p.summary,
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
