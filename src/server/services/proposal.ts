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
import { employers, facts, renderProposals, renderVersions, renders, sourceDocuments, sourceDocumentVersions } from "../db/schema";
import type { Rationale } from "~/diff";
import type { EmployerNames } from "~/render/attribution";
import { RENDER_LANGUAGE, draftedBlocks, type Block, type RenderContent, type RenderKind } from "~/shared/render-content";
import { collectRenderInputs, tailoringOf } from "./render";
import { refOf, titleOf } from "./render-ref";
import { rirekishoWarnings } from "~/render/rirekisho";
import { japaneseAdvisories } from "~/render/japanese";
import { CREDITS_EXHAUSTED_MESSAGE } from "~/model/types";
import { CREDITS_REASON } from "./model-credits";
import { collectRirekishoRecord, hasProfilePhoto } from "./rirekisho";

export async function proposalResponse(
  db: Db,
  userId: string,
  proposal: typeof renderProposals.$inferSelect,
  render: typeof renders.$inferSelect,
) {
  const kind = render.kind as RenderKind;
  // A tailored document is checked as one: a tailored 履歴書's 志望動機 is
  // written to 貴社, and its company's name in a cell is worth saying.
  const tailoring = await tailoringOf(db, userId, render);
  const inputs = await collectRenderInputs(db, userId, kind, "", tailoring);
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
    /** What the render routes address this document by, and what it is called. */
    renderRef: refOf(render),
    title: titleOf(render, tailoring?.application?.company),
    /** The application a tailored document belongs to, which is where its review returns to. */
    applicationId: render.applicationId,
    /** The author's decision, once generation has produced something to decide. */
    status: proposal.generationStatus === "ready" ? proposal.status : proposal.generationStatus,
    generationStatus: proposal.generationStatus,
    error:
      proposal.generationStatus === "failed"
        ? {
            code: proposal.generationError === CREDITS_EXHAUSTED_MESSAGE ? CREDITS_REASON : "generation_failed",
            message: proposal.generationError ?? "Generation failed.",
          }
        : null,
    basedOnVersionNo,
    proposedVersionNo: (basedOnVersionNo ?? 0) + 1,
    generatedAt: proposal.generatedAt.toISOString(),
    reason: proposal.reason,
    // Advisory and never blocking, and stated HERE as well as on the 202,
    // because this is the response the review screen reads. A Japanese
    // document's register slips are read off the content, so they exist only
    // once it does.
    warnings: [
      ...(kind === "rirekisho"
        ? rirekishoWarnings(await collectRirekishoRecord(db, userId), {
            hasPhoto: await hasProfilePhoto(db, userId),
            tailored: tailoring ? { motivationNote: tailoring.application?.motivationNote ?? null } : null,
          })
        : []),
      ...(RENDER_LANGUAGE[kind] === "ja" && proposal.generationStatus === "ready" ? japaneseAdvisories(content, inputs.spec) : []),
    ],
    /**
     * The parts drafted for the author to confirm or edit, in document order
     * (`docs/06`, 2026-10-26). Accept is refused while any is here. The text
     * is the proposal's own, sent to the author who owns it, as the diff is.
     */
    drafts:
      proposal.generationStatus === "ready"
        ? draftedBlocks(content).map(({ section, block }) => ({
            blockId: block.id,
            sectionKey: section.key,
            heading: section.heading,
            text: block.text,
          }))
        : [],
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
 * The record's employers by the names a render writes them under, 日本語 and
 * Latin both — what the diff reads to tell which employer an `experience`
 * group's opening paragraph names.
 */
export async function diffEmployers(db: Db, userId: string): Promise<EmployerNames[]> {
  const rows = await db
    .select({ id: employers.id, nameJa: employers.nameJa, nameLatin: employers.nameLatin })
    .from(employers)
    .where(eq(employers.userId, userId));
  return rows.map((e) => ({
    id: e.id,
    names: [e.nameJa, e.nameLatin].filter((n): n is string => n !== null && n !== ""),
  }));
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
      // A draft says so first: what it rests on matters less than that the
      // author has not yet said it is theirs.
      if (proposedBlock.drafted) {
        return {
          kind: "from_facts",
          text:
            supporting.length > 0
              ? `Drafted for you · from the posting and ${count(supporting.length, "fact")} · confirm or edit it below`
              : "Drafted for you from the posting · confirm or edit it below",
          factIds: proposedBlock.factIds,
        };
      }
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
          text: `From ${count(supporting.length, "restricted fact")} · Restricted, so check the wording names no client or system`,
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

export function regenerationReason(
  newFactsSince: number | null,
  withdrawnFactsSince: number | null,
  hasVersion: boolean,
): string {
  if (!hasVersion) return "Generated for the first time";
  const entered = newFactsSince ? `${count(newFactsSince, "new fact")} entered your record` : null;
  const withdrawn = withdrawnFactsSince
    ? `${count(withdrawnFactsSince, "fact")} could no longer be used`
    : null;
  if (!entered && !withdrawn) return "Regenerated on request";
  return `Regenerated after ${[entered, withdrawn].filter(Boolean).join(" and ")}`;
}
