/**
 * Render state, and opening a proposal — shared by the render routes and the
 * MCP server (`docs/specs/mcp-spike.md`).
 *
 * Lifted out of `routes/renders.ts` so a second writer of proposals does not
 * fork the waiting-proposal rule, the profile gate, the unique-index race or
 * the staleness arithmetic. Every query filters by `user_id`.
 */
import { and, desc, eq, getTableColumns, ne, sql } from "drizzle-orm";
import { applications, facts, profiles, renderProposals, renderVersions, renders } from "../db/schema";
import { ApiError, preconditionFailed, violatesUnique } from "../http/errors";
import { newId } from "../http/ids";
import { failLostProposals, type RenderInputs } from "./render";
import { collectResumeRecord } from "./resume";
import { renderIdentity, resumeRefusal } from "./document-file";
import { assembleResume, assertResumeSpecNames, ResumeAssemblyError } from "~/render/resume";
import { tokyoToday } from "~/render/rirekisho";
import { GENERATION_LOST, GENERATION_LOST_AFTER_MS } from "~/pipeline/generation";
import { mainRender, refOf, titleOf, type RenderRef } from "./render-ref";
import { regenerationReason } from "./proposal";
import { RENDER_DEFINITIONS } from "~/render/spec";
import { RENDER_KINDS, RENDER_TITLE, type RenderContent, type RenderKind } from "~/shared/render-content";
import type { Db } from "../db/client";

/**
 * The facts a document may use: accepted, and neither Private nor Generated.
 * The overview's `canGenerate` asks whether there is one, and staleness compares
 * their ids (or their count for a legacy version). Other changes to generation
 * input do not affect this status (`docs/06`, 2026-10-08).
 */
export const usableFacts = (userId: string) =>
  and(
    eq(facts.userId, userId),
    eq(facts.status, "accepted"),
    ne(facts.disclosure, "private"),
    ne(facts.provenance, "generated"),
  );


/**
 * The id of the render's waiting proposal, if one exists. A failed generation
 * is not waiting: it has nothing to decide, and it sits outside the unique index
 * for the same reason.
 */
export async function waitingProposalId(db: Db, userId: string, target: RenderRef): Promise<string | null> {
  // Re-read rather than taken from `target.render`: the loser of a generate
  // race asks again after the winner has created the row.
  const [waiting] = await db
    .select({ id: renderProposals.id })
    .from(renderProposals)
    .innerJoin(renders, eq(renders.id, renderProposals.renderId))
    .where(
      and(
        eq(renderProposals.userId, userId),
        target.jobDescription === null ? mainRender(userId, target.kind) : eq(renders.id, target.ref),
        eq(renderProposals.status, "pending"),
        ne(renderProposals.generationStatus, "failed"),
      ),
    )
    .limit(1);
  return waiting?.id ?? null;
}

/**
 * The refusal, whether the read caught the waiting proposal or the index did.
 * The loser of a race rereads to name the winner, and the winner may already
 * have failed by then, in which case there is no id to name.
 */
export const proposalWaiting = (target: RenderRef, proposalId: string | null) =>
  new ApiError(
    "conflict",
    `${target.title} has a proposal waiting. Accept or dismiss it before generating again.`,
    proposalId ? { proposalId } : undefined,
  );

/**
 * A main document's `renders` row is created on first generation, not on
 * sign-up. A tailored résumé's row exists already: it is how it is addressed.
 */
export async function ensureRender(db: Db, userId: string, target: RenderRef) {
  const read = async () => {
    const state = await renderState(db, userId);
    return target.jobDescription === null
      ? state.documents.find((r) => r.kind === target.kind)!
      : state.tailored.find((r) => r.id === target.ref)!;
  };
  let state = await read();
  if (state.id === null) {
    await db
      .insert(renders)
      .values({ id: newId("render"), userId, kind: target.kind })
      .onConflictDoNothing();
    state = await read();
  }
  return { ...state, id: state.id! };
}

export interface RenderState {
  id: string | null;
  /** What the render routes address it by: its kind, or a tailored résumé's id. */
  ref: string;
  /** A tailored résumé's name and when it was made. `null` on a main document. */
  tailored: { label: string; createdAt: string } | null;
  kind: RenderKind;
  language: "en" | "ja";
  title: string;
  buildable: boolean;
  currentVersionId: string | null;
  currentVersionNo: number | null;
  generatedAt: string | null;
  status: "never_generated" | "up_to_date" | "stale" | "proposal_pending" | "proposal_generating";
  /** Facts a document may use now that the current version was not generated from. */
  newFactsSince: number | null;
  /** Facts the current version was generated from that a document may no longer use. */
  withdrawnFactsSince: number | null;
  pendingProposalId: string | null;
  /** When a proposal being generated last finished a step; `null` otherwise. */
  progressAt: string | null;
}

/**
 * One query set backs `GET /api/renders`, the overview's Documents section and
 * the résumé an application shows. All five kinds are always reported, whether
 * or not a row exists; a tailored résumé is reported because its row does.
 */
export async function renderState(
  db: Db,
  userId: string,
): Promise<{ documents: RenderState[]; tailored: RenderState[]; usableFacts: number }> {
  // One round trip, not four in a row: this backs the home screen (issue #58).
  //
  // Counts, not ids. This is polled every 1.5 s while a document is written or
  // an import runs, and it read every usable fact's id and, for each current
  // version, every id that version was made from — about 870 KB from the
  // database on each poll of a nine-thousand-fact record, for two numbers per
  // document (`docs/06`, 2026-11-04). The set difference runs in Postgres now.
  const usableNow = db.$with("usable_now").as(db.select({ id: facts.id }).from(facts).where(usableFacts(userId)));
  // First, so the proposals read below see it: a run that has gone silent past
  // a step's bound is failed here as its own route would fail it, and every
  // screen polling this stops (`docs/06`, 2026-11-04).
  const [lost, rows, versions, pending, [usable]] = await db.batch([
    failLostProposals(db, userId, new Date(Date.now() - GENERATION_LOST_AFTER_MS), GENERATION_LOST),
    db.select({
      id: renders.id,
      kind: renders.kind,
      label: renders.label,
      currentVersionId: renders.currentVersionId,
      staleSinceFactCount: renders.staleSinceFactCount,
      createdAt: renders.createdAt,
      // Whether it is tailored, and not the posting: the posting is a page of text
      // and nothing here reads more of it than that it is there.
      tailored: sql<boolean>`${renders.jobDescription} is not null`,
      applicationCompany: applications.company,
    })
      .from(renders)
      .leftJoin(applications, and(eq(applications.id, renders.applicationId), eq(applications.userId, userId)))
      .where(eq(renders.userId, userId)),
    // Each render's current version, by join rather than by a list of ids read
    // first, which is what made this a query that had to wait for another.
    db
      .with(usableNow)
      .select({
        id: renderVersions.id,
        versionNo: renderVersions.versionNo,
        acceptedAt: renderVersions.acceptedAt,
        recorded: sql<boolean>`${renderVersions.usableFactIds} is not null`,
        // `except` is a set difference, as `factsSince` took one over two Sets.
        added: sql<number>`(select count(*) from (select id from ${usableNow} except select unnest(${renderVersions.usableFactIds})) as added)::int`,
        withdrawn: sql<number>`(select count(*) from (select unnest(${renderVersions.usableFactIds}) except select id from ${usableNow}) as withdrawn)::int`,
      })
      .from(renderVersions)
      .innerJoin(
        renders,
        and(eq(renders.currentVersionId, renderVersions.id), eq(renders.userId, userId)),
      )
      .where(eq(renderVersions.userId, userId)),
    // A proposal whose generation failed stays `pending` — nothing was decided —
    // but it holds no document: there is no diff to review and generating again is
    // the way out. Excluded here exactly as it is at generation time.
    db
      .select({
        id: renderProposals.id,
        renderId: renderProposals.renderId,
        generationStatus: renderProposals.generationStatus,
        updatedAt: renderProposals.updatedAt,
      })
      .from(renderProposals)
      .where(
        and(
          eq(renderProposals.userId, userId),
          eq(renderProposals.status, "pending"),
          ne(renderProposals.generationStatus, "failed"),
        ),
      )
      .orderBy(desc(renderProposals.generatedAt)),
    db.select({ n: sql<number>`count(*)::int` }).from(facts).where(usableFacts(userId)),
  ]);
  // Ids only, as `stopGeneration` logs it.
  for (const { id } of lost) console.error(JSON.stringify({ event: "generation_lost", proposalId: id }));
  const usableCount = usable?.n ?? 0;
  // The row as `refOf` and `titleOf` read it: they ask only whether there is a posting.
  const named = (row: (typeof rows)[number]) => ({ ...row, jobDescription: row.tailored ? "" : null });
  const byKind = new Map(rows.filter((r) => !r.tailored).map((r) => [r.kind, r]));
  const versionById = new Map(versions.map((v) => [v.id, v]));
  const pendingByRender = new Map<string, (typeof pending)[number]>();
  for (const p of pending) if (!pendingByRender.has(p.renderId)) pendingByRender.set(p.renderId, p);

  const stateOf = (kind: RenderKind, row: (typeof rows)[number] | undefined): RenderState => {
    const version = row?.currentVersionId ? versionById.get(row.currentVersionId) : undefined;
    const proposal = row ? pendingByRender.get(row.id) : undefined;
    const pendingProposalId = proposal?.id ?? null;
    const since = version
      ? factsSince(version, usableCount, row?.staleSinceFactCount ?? 0)
      : null;

    // A pending proposal outranks a missing version: a first generation awaiting
    // review is not "never generated", and offering Generate there makes a second.
    const status: RenderState["status"] = proposal
      ? proposal.generationStatus === "generating"
        ? "proposal_generating"
        : "proposal_pending"
      : !since
        ? "never_generated"
        : since.added + since.withdrawn > 0
          ? "stale"
          : "up_to_date";

    return {
      id: row?.id ?? null,
      ref: row ? refOf(named(row)) : kind,
      tailored:
        row && row.tailored
          ? { label: row.applicationCompany ?? row.label ?? "", createdAt: row.createdAt.toISOString() }
          : null,
      kind,
      language: RENDER_DEFINITIONS[kind].language,
      title: row ? titleOf(named(row), row.applicationCompany) : RENDER_TITLE[kind],
      buildable: RENDER_DEFINITIONS[kind].buildable,
      currentVersionId: row?.currentVersionId ?? null,
      currentVersionNo: version?.versionNo ?? null,
      generatedAt: version?.acceptedAt.toISOString() ?? null,
      status,
      newFactsSince: since?.added ?? null,
      withdrawnFactsSince: since?.withdrawn ?? null,
      pendingProposalId,
      progressAt: proposal?.generationStatus === "generating" ? proposal.updatedAt.toISOString() : null,
    };
  };

  return {
    documents: RENDER_KINDS.map((kind) => stateOf(kind, byKind.get(kind))),
    // Newest first: the one just made is the one being worked on.
    tailored: rows
      .filter((r) => r.tailored)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((row) => stateOf(row.kind as RenderKind, row)),
    usableFacts: usableCount,
  };
}

/**
 * How the facts a document may use now differ from the ones a version was
 * generated from. With a recorded set, a document is out of date exactly when
 * either number is nonzero (`docs/06`, 2026-10-08).
 *
 * A version made before the set was recorded has only the count taken then, so
 * it keeps the count difference and its blind spot (`docs/06`, 2026-10-06): a
 * fact withdrawn hides one that arrived, and none is ever reported withdrawn.
 */
function factsSince(
  version: { recorded: boolean; added: number; withdrawn: number },
  usableNow: number,
  countThen: number,
): { added: number; withdrawn: number } {
  if (!version.recorded) return { added: Math.max(0, usableNow - countThen), withdrawn: 0 };
  return { added: version.added, withdrawn: version.withdrawn };
}


/**
 * The generate route's refusals before anything is written, in its order: a
 * kind not built yet, a proposal already waiting, then the profile fields the
 * document cannot be made without — named, never a document with a hole in it.
 *
 * @returns the profile, every column but the photo, which no required field is
 * and no generation request may carry.
 */
export async function requireRenderable(db: Db, userId: string, target: RenderRef) {
  const { kind } = target;
  const definition = RENDER_DEFINITIONS[kind];
  if (!definition.buildable) {
    throw new ApiError("conflict", `${target.title} is not built yet.`);
  }

  // A second proposal beside a waiting one means accepting either discards the
  // other unread. A failed generation has nothing to decide, so it does not
  // hold the render: refusing on it would leave no way to try again.
  const waiting = await waitingProposalId(db, userId, target);
  if (waiting) throw proposalWaiting(target, waiting);

  return requireProfile(db, userId, kind);
}

/**
 * The profile a document of this kind is made from, every column but the
 * photo, or a refusal naming the fields it cannot be made without.
 */
export async function requireProfile(db: Db, userId: string, kind: RenderKind) {
  const definition = RENDER_DEFINITIONS[kind];
  const { photo: _photo, ...profileColumns } = getTableColumns(profiles);
  void _photo;
  const [profile] = await db
    .select(profileColumns)
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1);

  const missing = definition.requiredProfileFields.filter(
    (field) => !profile || !String((profile as Record<string, unknown>)[field] ?? "").trim(),
  );
  if (missing.length > 0) {
    throw preconditionFailed(
      `A ${RENDER_TITLE[kind]} cannot be generated without ${missing.join(", ")}.`,
      missing,
    );
  }
  if (!profile) throw preconditionFailed(`A ${RENDER_TITLE[kind]} cannot be generated without a profile.`, ["profile"]);
  return profile;
}

/**
 * The generate route's refusals once the inputs are read: an English résumé
 * whose job headers the record cannot fill, and a document with no usable fact
 * to be written from. Stated, never left to the author to work out.
 */
export async function refuseUngeneratable(
  db: Db,
  userId: string,
  kind: RenderKind,
  inputs: Pick<RenderInputs, "spec" | "facts" | "acceptedFactCount">,
): Promise<void> {
  if (kind === "english_resume") {
    try {
      assertResumeSpecNames(inputs.spec);
      assembleResume({
        content: { sections: [] },
        record: await collectResumeRecord(db, userId),
        identity: await renderIdentity(db, userId),
        today: tokyoToday(),
      });
    } catch (error) {
      // A job header with a gap is named per job, with what each lacks, so
      // the screen can link to the field rather than leave the author to find it.
      if (error instanceof ResumeAssemblyError) throw resumeRefusal(error, "precondition_failed", ["english_resume"]);
      throw error;
    }
  }
  // The tool never silently produces an empty document.
  if (inputs.facts.length === 0) {
    throw preconditionFailed(
      inputs.acceptedFactCount === 0
        ? "There are no accepted facts to generate from yet."
        : "Every accepted fact is either unverified or private, or belongs to an entry left out of this document, so none can be used.",
      ["facts"],
    );
  }
}

export interface ProposalInit {
  /** `{ sections: [] }` while a model generates into it; the document when it arrives whole. */
  content: RenderContent;
  generationStatus: "generating" | "ready";
  /** What the record held when the document's inputs were read, not when the author accepts. */
  usableFactIds: string[];
}

/**
 * Opens the render's one waiting proposal. It never touches a `render_versions`
 * row: the author accepts or dismisses it as a whole, through the same route,
 * whatever wrote it.
 */
export async function openProposal(
  db: Db,
  userId: string,
  target: RenderRef,
  init: ProposalInit,
): Promise<string> {
  const render = await ensureRender(db, userId, target);
  const proposalId = newId("renderProposal");
  // The waiting check is a read, then this insert, with no lock between them.
  // Two simultaneous requests can both pass it; the unique index lets one
  // proposal through, and the other lost to a proposal that is now waiting.
  try {
    await db.insert(renderProposals).values({
      id: proposalId,
      userId,
      renderId: render.id,
      content: init.content,
      status: "pending",
      generationStatus: init.generationStatus,
      basedOnVersionId: render.currentVersionId,
      reason: regenerationReason(
        render.newFactsSince,
        render.withdrawnFactsSince,
        render.currentVersionNo !== null,
      ),
      usableFactIds: init.usableFactIds,
    });
  } catch (err) {
    if (!violatesUnique(err, "render_proposals_one_waiting_uq")) throw err;
    const winner = await waitingProposalId(db, userId, target);
    throw proposalWaiting(target, winner);
  }
  return proposalId;
}
