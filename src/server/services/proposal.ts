/**
 * What a proposal looks like to the author, and why each change is there.
 *
 * Split from the routes deliberately: the routes answer HTTP, and this answers
 * "where did this line come from?" — a question about the record, not about a
 * request. `docs/10-screen-specifications.md` calls a change with no explanation
 * a defect, which makes this the load-bearing half of the diff screen.
 */
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { facts, renderProposals, renderVersions, renders, sourceDocuments, sourceDocumentVersions } from "../db/schema";
import type { Rationale } from "~/diff";
import type { Block, RenderContent, RenderKind } from "~/shared/render-content";
import { collectRenderInputs } from "./render";

export async function proposalResponse(
  db: Db,
  userId: string,
  proposal: typeof renderProposals.$inferSelect,
  render: typeof renders.$inferSelect,
) {
  const kind = render.kind as RenderKind;
  const inputs = await collectRenderInputs(db, userId, kind, "");
  const basedOn = proposal.basedOnVersionId
    ? await db
        .select({ versionNo: renderVersions.versionNo })
        .from(renderVersions)
        .where(
          and(eq(renderVersions.userId, userId), eq(renderVersions.id, proposal.basedOnVersionId)),
        )
        .limit(1)
    : [];
  const basedOnVersionNo = basedOn[0]?.versionNo ?? null;

  const content = proposal.content as RenderContent;
  const currentContentForCompare = await currentContent(db, userId, render.currentVersionId);
  const unchanged =
    proposal.generationStatus === "ready" &&
    currentContentForCompare !== null &&
    JSON.stringify(currentContentForCompare) === JSON.stringify(content);

  return {
    id: proposal.id,
    renderKind: kind,
    /** The author's decision, once generation has produced something to decide. */
    status: proposal.generationStatus === "ready" ? proposal.status : proposal.generationStatus,
    generationStatus: proposal.generationStatus,
    error:
      proposal.generationStatus === "failed"
        ? { code: "generation_failed", message: proposal.generationError ?? "Generation failed." }
        : null,
    basedOnVersionNo,
    proposedVersionNo: (basedOnVersionNo ?? 0) + 1,
    generatedAt: proposal.generatedAt.toISOString(),
    reason: proposal.reason,
    warnings: [] as string[],
    /**
     * Told when nothing changed, rather than shown an empty diff — a no-op
     * regeneration must not look like a broken screen.
     */
    unchanged,
    /** A count and nothing else. The footer never says WHICH facts. */
    withheld: {
      privateFactCount: inputs.privateFactCount,
      generatedFactCount: inputs.generatedFactCount,
    },
  };
}

export async function currentContent(
  db: Db,
  userId: string,
  versionId: string | null,
): Promise<RenderContent | null> {
  if (!versionId) return null;
  const [version] = await db
    .select({ content: renderVersions.content })
    .from(renderVersions)
    .where(and(eq(renderVersions.userId, userId), eq(renderVersions.id, versionId)))
    .limit(1);
  return (version?.content as RenderContent | undefined) ?? null;
}

/**
 * The rationale bar is REQUIRED, not decorative. Every change states where it
 * came from; a change with no explanation is a defect
 * (`docs/10-screen-specifications.md`).
 */
export async function rationaleFor(
  db: Db,
  userId: string,
  current: RenderContent | null,
  proposed: RenderContent,
) {
  const ids = new Set<string>();
  for (const content of [current, proposed]) {
    for (const section of content?.sections ?? []) {
      for (const block of section.blocks) for (const id of block.factIds) ids.add(id);
    }
  }

  const rows =
    ids.size === 0
      ? []
      : await db
          .select({
            id: facts.id,
            provenance: facts.provenance,
            disclosure: facts.disclosure,
            status: facts.status,
            lineNumber: facts.lineNumber,
            filename: sourceDocuments.filename,
          })
          .from(facts)
          .leftJoin(
            sourceDocumentVersions,
            eq(sourceDocumentVersions.id, facts.sourceDocumentVersionId),
          )
          .leftJoin(sourceDocuments, eq(sourceDocuments.id, sourceDocumentVersions.sourceDocumentId))
          .where(and(eq(facts.userId, userId), inArray(facts.id, [...ids])));
  const byId = new Map(rows.map((r) => [r.id, r]));

  return ({
    currentBlock,
    proposedBlock,
  }: {
    currentBlock: Block | null;
    proposedBlock: Block | null;
  }): Rationale => {
    if (proposedBlock) {
      const supporting = proposedBlock.factIds.map((id) => byId.get(id)).filter(Boolean);
      if (supporting.length === 0) {
        return {
          kind: "from_facts",
          text: "Fixed scaffolding — not written from a fact",
          factIds: [],
        };
      }
      const restricted = supporting.filter((f) => f!.disclosure === "restricted");
      if (restricted.length === supporting.length) {
        return {
          kind: "from_restricted",
          text: `From ${count(supporting.length, "restricted fact")} · included in this document, withheld from public outputs`,
          factIds: proposedBlock.factIds,
        };
      }
      const provenance = supporting[0]!.provenance;
      return {
        kind: "from_facts",
        text: `From ${count(supporting.length, `${provenance} fact`)} · ${cite(supporting)}`,
        factIds: proposedBlock.factIds,
      };
    }

    const previous = (currentBlock?.factIds ?? []).map((id) => byId.get(id)).filter(Boolean);
    if (previous.some((f) => f!.provenance === "generated")) {
      return {
        kind: "removed_unverified",
        text: "Removed — the supporting fact is unverified (Generated) and is never rendered",
        factIds: currentBlock?.factIds ?? [],
      };
    }
    return {
      kind: "removed_no_support",
      text: "Removed — no fact in your record supports it",
      factIds: currentBlock?.factIds ?? [],
    };
  };
}

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** `aozora-batch.md, L79` — the evidence pointer, never the passage itself. */
function cite(supporting: ({ filename: string | null; lineNumber: number | null } | undefined)[]) {
  const cited = supporting
    .filter((f): f is { filename: string | null; lineNumber: number | null } => Boolean(f))
    .filter((f) => f.filename && f.lineNumber !== null);
  if (cited.length === 0) return "captured directly";
  const file = cited[0]!.filename!;
  const lines = cited.map((f) => `L${f.lineNumber}`);
  const joined =
    lines.length === 1 ? lines[0]! : `${lines.slice(0, -1).join(", ")} and ${lines.at(-1)}`;
  return `${file}, ${joined}`;
}

export function regenerationReason(newFactsSince: number | null, hasVersion: boolean): string {
  if (!hasVersion) return "Generated for the first time";
  if (!newFactsSince) return "Regenerated on request";
  return `Regenerated after ${count(newFactsSince, "new fact")} entered your record`;
}

