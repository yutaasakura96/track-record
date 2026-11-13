/**
 * Renders and proposals (`docs/07-api-design.md` §7).
 *
 * A render proposal is accepted or rejected **as a whole**. There is no
 * per-change accept endpoint, deliberately: accepting 9 of 11 changes leaves
 * the document not matching the record, which is the exact drift this project
 * exists to remove. If a proposed line is wrong, the fix is the underlying fact.
 *
 * The one thing confirmed part by part is a draft: the 志望動機 and the
 * 本人希望欄 of a tailored 履歴書, which no fact states and the author makes
 * their own before the whole is accepted (`docs/06`, 2026-10-26).
 */
import type { Hono } from "hono";
import { and, desc, eq, getTableColumns, ne, sql } from "drizzle-orm";
import { facts, renderProposals, renderVersions, renders } from "../db/schema";
import { ApiError, notFound, pathParam, validationFailed } from "../http/errors";
import { routes } from "../http/registry";
import { newId } from "../http/ids";
import { collectRenderInputs, tailoringOf } from "../services/render";
import { settleLostGeneration, startGeneration } from "~/pipeline/generation";
import { parseBody } from "../services/validate";
import { z } from "zod";
import { refOf, resolveRender, titleOf, type RenderRef } from "../services/render-ref";
import {
  currentContent,
  diffEmployers,
  proposalResponse,
  rationaleFor,
} from "../services/proposal";
import {
  badCitations,
  citationMessage,
  collectEditableRecord,
  editWarnings,
} from "../services/version-edit";
import { EditRejected, citedFactIds, parseEditedContent, sameContent } from "~/render/edit";
import { diffRenders } from "~/diff";
import { RENDER_DEFINITIONS } from "~/render/spec";
import { toMarkdown } from "~/render/markdown";
import { assembleResume, ResumeAssemblyError, resumeMarkdown, resumeSentPage, validateResumeBounds, validateResumeEditShape } from "~/render/resume";
import { DOCX_MIME } from "~/render/docx";
import { PDF_MIME } from "~/render/resume-pdf";
import { rirekishoWarnings, tokyoToday } from "~/render/rirekisho";
import { rirekishoTemplateData } from "~/render/rirekisho";
import { japaneseSentPage, rirekishoSentPage, sentPage, type SentPage } from "~/render/sent-page";
import { fillRirekishoTemplate } from "~/render/rirekisho-template";
import { assembleJapanese, japaneseDefect, japaneseMarkdown } from "~/render/japanese";
import { attachment } from "../http/disposition";
import { collectRirekishoPhoto, collectRirekishoProfile, collectRirekishoRecord, hasProfilePhoto } from "../services/rirekisho";
import {
  buildDocumentFile,
  buildDocumentPage,
  buildDocumentPdf,
  collectJapaneseEmployers,
  filenameFor,
  PDF_KINDS,
  refuseWithheldCitations,
  renderIdentity,
  resumeRefusal,
} from "../services/document-file";
import { factEvidence } from "../services/evidence";
import { collectResumeRecord } from "../services/resume";
import {
  openProposal,
  refuseUngeneratable,
  renderState,
  requireRenderable,
  usableFacts,
  type RenderState,
} from "../services/render-state";
import {
  RENDER_LANGUAGE,
  RENDER_TITLE,
  draftedBlocks,
  type RenderContent,
  type RenderKind,
} from "~/shared/render-content";
import { citedOnPage } from "~/shared/evidence";
import type { AppEnv } from "../env";
import type { Db } from "../db/client";

/**
 * A drafted part as the author confirms it. Bounded well above the 300
 * characters the cell is written to, because the author may say more than the
 * draft did; the layout test prints four times the bound.
 */
export const DRAFT_TEXT_MAX = 1200;
const draftBody = z.strictObject({
  text: z
    .string()
    .trim()
    .min(1, "A drafted part cannot be left empty. Write what it should say.")
    .max(DRAFT_TEXT_MAX, `Keep a drafted part under ${DRAFT_TEXT_MAX.toLocaleString("en-US")} characters.`),
});

/** Accept refused while drafts wait: how many, and nothing they say. */
const draftsWaiting = (drafts: number) =>
  new ApiError(
    "conflict",
    `${drafts === 1 ? "One part was" : `${drafts} parts were`} drafted for you and ${drafts === 1 ? "is" : "are"} not confirmed yet. Confirm or edit each before accepting.`,
    { drafts },
  );

export function registerRenderRoutes(app: Hono<AppEnv>) {
  const api = routes(app);

  /** All five, with status. `never_generated` is distinct from `up_to_date`. */
  api.get("/api/renders", async (c) => {
    const user = c.get("user");
    const db = c.get("db");
    const state = await renderState(db, user.id);
    return c.json({ items: state.documents });
  });

  api.post("/api/renders/:ref/generate", async (c) => {
    const user = c.get("user");
    const db = c.get("db");
    const target = await resolveRender(db, user.id, pathParam(c, "ref"));
    const { kind } = target;
    const profile = await requireRenderable(db, user.id, target);

    const tailoring = target.render ? await tailoringOf(db, user.id, target.render) : null;
    // What generation would be given, to refuse before starting it. The claims
    // are read by the run itself, which reads the record again.
    const inputs = await collectRenderInputs(db, user.id, kind, profile.nameLatin, tailoring, { claims: false });
    await refuseUngeneratable(db, user.id, kind, inputs);

    // Advisory and never blocking (`docs/04` §4). The 履歴書 is the only kind
    // with a rule about gaps, because it is the only one required to be
    // complete: the English résumé's register drops entries by level. The
    // notice is unconditional and comes last, so a gap — which is about this
    // record, and may not be there next time — is read first. The gaps are
    // read from the rows the download prints, explanations included, so a
    // gap the author has explained does not warn.
    const warnings =
      kind === "rirekisho"
        ? rirekishoWarnings(await collectRirekishoRecord(db, user.id), {
            hasPhoto: await hasProfilePhoto(db, user.id),
            tailored: tailoring ? { motivationNote: tailoring.application?.motivationNote ?? null } : null,
          })
        : [];

    const proposalId = await openProposal(db, user.id, target, {
      content: { sections: [] },
      generationStatus: "generating",
      // What the record held when generation read it, not when the author
      // accepts: a fact that becomes usable in between is new to the version.
      usableFactIds: inputs.usableFactIds,
    });

    // Returns immediately with a resource to poll. The current version stays
    // fully readable while the proposal generates — never a blank screen.
    await startGeneration({
      db,
      model: c.get("model"),
      userId: user.id,
      proposalId,
      workflow: c.env.GENERATION_WORKFLOW,
      inlineTest: c.env.GENERATION_INLINE_TEST,
      waitUntil: (work) => c.executionCtx.waitUntil(work),
    });

    return c.json({ proposalId, renderKind: kind, renderRef: target.ref, status: "generating", warnings }, 202);
  });

  /**
   * One render's proposals, decided and undecided.
   *
   * The other half of the version history: a dismissed proposal is retained
   * and is not a version, and Screen 5 shows both outcomes of a generation
   * rather than only the one that produced a document. It stays on the
   * proposals route instead of being merged into the versions payload
   * (`docs/06`, 2026-09-12).
   */
  api.get("/api/proposals", async (c) => {
    const user = c.get("user");
    const db = c.get("db");
    // `kind` names the document: a kind, or a tailored résumé's id.
    const target = await resolveRender(db, user.id, c.req.query("kind"));

    const rows = target.render
      ? await db
          .select({
            id: renderProposals.id,
            status: renderProposals.status,
            generationStatus: renderProposals.generationStatus,
            generatedAt: renderProposals.generatedAt,
            decidedAt: renderProposals.decidedAt,
            reason: renderProposals.reason,
            // Whether the proposal said the same as the version it was written
            // against. Judged against THAT version, not today's current one, so a later
            // version does not turn a real proposal into a "no change" one.
            noChange: sql<boolean>`coalesce(${renderProposals.generationStatus} = 'ready' and ${renderVersions.content} = ${renderProposals.content}, false)`,
          })
          .from(renderProposals)
          .leftJoin(
            renderVersions,
            and(eq(renderVersions.userId, user.id), eq(renderVersions.id, renderProposals.basedOnVersionId)),
          )
          .where(and(eq(renderProposals.userId, user.id), eq(renderProposals.renderId, target.render.id)))
          .orderBy(desc(renderProposals.generatedAt))
      : [];

    return c.json({
      renderKind: target.kind,
      renderRef: target.ref,
      items: rows.map((row) => ({
        id: row.id,
        status: row.status,
        generationStatus: row.generationStatus,
        generatedAt: row.generatedAt.toISOString(),
        decidedAt: row.decidedAt?.toISOString() ?? null,
        reason: row.reason,
        noChange: row.noChange,
      })),
    });
  });

  api.get("/api/proposals/:id", async (c) => {
    const { proposal, render } = await requireProposal(
      c.get("db"),
      c.get("user").id,
      pathParam(c, "id"),
    );
    const read = await settleLostGeneration(c.get("db"), c.get("user").id, proposal);
    return c.json(await proposalResponse(c.get("db"), c.get("user").id, read, render));
  });

  /** The split view. Two passes have already run server-side. */
  api.get("/api/proposals/:id/diff", async (c) => {
    const user = c.get("user");
    const db = c.get("db");
    const { proposal, render } = await requireProposal(db, user.id, pathParam(c, "id"));

    if (proposal.generationStatus !== "ready") {
      throw new ApiError("conflict", "This proposal has not finished generating.");
    }

    const current = await currentContent(db, user.id, render.currentVersionId);
    const proposed = proposal.content as RenderContent;
    const explain = await rationaleFor(db, user.id, current, proposed);

    // The render's own language decides the tokenizer — words for English,
    // BudouX phrases for Japanese. Taken from `RENDER_LANGUAGE` rather than
    // from the content, which would make the diff a property of what the model
    // happened to write.
    const diff = diffRenders(current, proposed, {
      language: RENDER_LANGUAGE[render.kind as RenderKind],
      explain,
      employers: await diffEmployers(db, user.id),
    });
    // A first version has nothing to be a diff against, so the screen shows the
    // document itself. Sent only then: every other review reads the changes.
    if (current) return c.json({ ...diff, preview: null });
    const kind = render.kind as RenderKind;
    const today = tokyoToday();
    const page = kind === "rirekisho"
      ? await rirekishoPreviewPage(db, user.id, proposed, today)
      : kind === "english_resume"
        ? await resumePreviewPage(db, user.id, proposed, today)
        : kind === "shokumu_keirekisho" || kind === "career_story_ja"
          ? japaneseSentPage(
              assembleJapanese({
                kind,
                content: proposed,
                identity: await renderIdentity(db, user.id),
                today,
                employers: await collectJapaneseEmployers(db, user.id),
              }),
            )
          : sentPage(kind, proposed, await renderIdentity(db, user.id), today);
    const tailoring = render.jobDescription !== null ? await tailoringOf(db, user.id, render) : null;
    return c.json({ ...diff, preview: { title: titleOf(render, tailoring?.application?.company), page } });
  });

  api.post("/api/proposals/:id/accept", async (c) => {
    const user = c.get("user");
    const db = c.get("db");
    const { proposal, render } = await requireProposal(db, user.id, pathParam(c, "id"));

    // A proposal decided in another tab refreshes to its decided state rather
    // than producing a second outcome.
    if (proposal.status !== "pending") throw alreadyDecided();
    if (proposal.generationStatus !== "ready") {
      throw new ApiError("conflict", "This proposal has not finished generating.");
    }

    // A draft nobody confirmed would become a signed document's reason for
    // applying, in the author's name. The author confirms or edits each first.
    const drafts = draftedBlocks(proposal.content as RenderContent).length;
    if (drafts > 0) throw draftsWaiting(drafts);

    const highest = await highestVersionNo(db, user.id, render.id);

    const versionId = newId("renderVersion");
    const acceptedAt = new Date();
    const accepted = await usableFactCount(db, user.id);

    // Three statements, one transaction. `db.transaction()` throws on the
    // neon-http driver; `db.batch([...])` reaches the driver's own
    // non-interactive transaction and is atomic (`docs/03` §5).
    await db.batch([
      db.insert(renderVersions).values({
        id: versionId,
        userId: user.id,
        renderId: render.id,
        versionNo: highest + 1,
        content: proposal.content,
        acceptedAt,
        // The same number `staleSinceFactCount` is being set to, kept on the
        // version as well as on the render: the render only ever remembers its
        // CURRENT era, and restore needs an older one (`docs/06`, 2026-09-12).
        factCountAt: accepted,
        // Copied inside the database: the ids are the proposal's, and reading
        // them out only to write them back sent about 100 KB each way.
        usableFactIds: sql<string[] | null>`(select ${renderProposals.usableFactIds} from ${renderProposals} where ${renderProposals.userId} = ${user.id} and ${renderProposals.id} = ${proposal.id})`,
      }),
      db
        .update(renders)
        .set({ currentVersionId: versionId, staleSinceFactCount: accepted, updatedAt: acceptedAt })
        .where(and(eq(renders.userId, user.id), eq(renders.id, render.id))),
      db
        .update(renderProposals)
        .set({ status: "accepted", decidedAt: acceptedAt, updatedAt: acceptedAt })
        .where(and(eq(renderProposals.userId, user.id), eq(renderProposals.id, proposal.id))),
    ]);

    return c.json({
      renderKind: render.kind,
      renderRef: refOf(render),
      newVersionNo: highest + 1,
      acceptedAt: acceptedAt.toISOString(),
    });
  });

  /**
   * Confirms one drafted part of a proposal, as it was drafted or as the
   * author edited it (`docs/06`, 2026-10-26). The text sent is what the
   * document says from now on, and the block is a draft no longer. Its fact
   * ids stay: what the draft was written from is still what it was written
   * from, and the diff says so.
   *
   * The write is conditional on the content it was read from, so two
   * confirmations at once cannot lose one: the second is told to reload.
   */
  api.post("/api/proposals/:id/drafts/:blockId", async (c) => {
    const user = c.get("user");
    const db = c.get("db");
    const { text } = await parseBody(c, draftBody);
    const { proposal, render } = await requireProposal(db, user.id, pathParam(c, "id"));
    if (proposal.status !== "pending") throw alreadyDecided();
    if (proposal.generationStatus !== "ready") {
      throw new ApiError("conflict", "This proposal has not finished generating.");
    }

    const blockId = pathParam(c, "blockId");
    const read = proposal.content as RenderContent;
    const found = draftedBlocks(read).find(({ block }) => block.id === blockId);
    if (!found) throw notFound("That drafted part");
    const tailoring = await tailoringOf(db, user.id, render);
    const inputs = await collectRenderInputs(db, user.id, "rirekisho", "", tailoring);
    const defect = japaneseDefect({ sections: [{ ...found.section, blocks: [{ ...found.block, text }] }] }, inputs.spec, inputs.facts);
    if (defect === "onsha") {
      throw validationFailed("御社 is the spoken form. A 履歴書 writes 貴社.", ["text"]);
    }
    if (defect === "english") throw validationFailed("A 履歴書 draft must be written in Japanese.", ["text"]);

    const edited = text !== found.block.text;
    const content: RenderContent = {
      sections: read.sections.map((section) => ({
        ...section,
        blocks: section.blocks.map(({ drafted, ...block }) =>
          block.id === blockId ? { ...block, text } : drafted ? { ...block, drafted } : block,
        ),
      })),
    };
    const updated = await db
      .update(renderProposals)
      .set({ content, updatedAt: new Date() })
      .where(
        and(
          eq(renderProposals.userId, user.id),
          eq(renderProposals.id, proposal.id),
          eq(renderProposals.status, "pending"),
          sql`${renderProposals.content} = ${JSON.stringify(read)}::jsonb`,
        ),
      )
      .returning({ id: renderProposals.id });
    if (updated.length === 0) {
      throw new ApiError("conflict", "This proposal changed after you opened it. Reload it and confirm again.");
    }
    // Ids and a flag. Never the draft, never the edit.
    console.log(JSON.stringify({ event: "proposal_draft_confirmed", proposalId: proposal.id, edited }));
    return c.json(await proposalResponse(db, user.id, { ...proposal, content }, render));
  });

  /**
   * A waiting proposal as content rather than as a diff, block ids included:
   * what a hand edit of a draft is made from, as `GET /api/renders/:ref/versions/:id`
   * is for a stored version. Kept off `GET /api/proposals/:id`, which a
   * generating proposal is polled on and which never needs the document.
   */
  api.get("/api/proposals/:id/content", async (c) => {
    const { proposal, render } = await requireProposal(c.get("db"), c.get("user").id, pathParam(c, "id"));
    if (proposal.generationStatus !== "ready") {
      throw new ApiError("conflict", "This proposal has not finished generating.");
    }
    return c.json({
      id: proposal.id,
      renderKind: render.kind,
      renderRef: refOf(render),
      status: proposal.status,
      content: proposal.content,
    });
  });

  /**
   * A draft edited by hand before it is accepted (`docs/06`, 2026-11-04).
   *
   * One request, two versions, one batch: the proposal is accepted as it was
   * generated, and the author's edit is appended on top of it as an
   * `edited` version whose source is the one just accepted. The history then
   * says what happened in the words it already has — `ACCEPTED · from a
   * proposal`, then `EDITED BY HAND · Edited from v<n>` — and what the model
   * wrote stays readable and downloadable beside what the author made of it.
   * Editing the proposal's content in place would have lost the one thing a
   * reviewer of this document most needs to see.
   *
   * It runs every check accept runs (no drafted part left unconfirmed) and
   * every check the hand-edit route runs (`checkHandEdit`), and it calls no
   * model. Staleness is set as accept sets it, because the content accepted
   * here was generated from today's record; the edit on top consumes no facts.
   */
  api.post("/api/proposals/:id/edit", async (c) => {
    const user = c.get("user");
    const db = c.get("db");
    // Found before the body is read: someone else's proposal is a 404 whatever was sent.
    const { proposal, render } = await requireProposal(db, user.id, pathParam(c, "id"));
    const body = await c.req.json().catch(() => null);
    if (typeof body !== "object" || body === null) {
      throw validationFailed("That edit is not a document.", ["content"]);
    }
    const { content: submitted } = body as Record<string, unknown>;
    if (proposal.status !== "pending") throw alreadyDecided();
    if (proposal.generationStatus !== "ready") {
      throw new ApiError("conflict", "This proposal has not finished generating.");
    }
    const generated = proposal.content as RenderContent;
    const drafts = draftedBlocks(generated).length;
    if (drafts > 0) throw draftsWaiting(drafts);

    const { content, record } = await checkHandEdit(
      db,
      user.id,
      render.kind as RenderKind,
      submitted,
      generated,
      "That edit changes nothing. Accept the proposal as it is instead.",
    );

    const highest = await highestVersionNo(db, user.id, render.id);
    const acceptedId = newId("renderVersion");
    const editedId = newId("renderVersion");
    const acceptedAt = new Date();
    const accepted = await usableFactCount(db, user.id);

    await db.batch([
      db.insert(renderVersions).values({
        id: acceptedId,
        userId: user.id,
        renderId: render.id,
        versionNo: highest + 1,
        content: proposal.content,
        acceptedAt,
        factCountAt: accepted,
        usableFactIds: sql<string[] | null>`(select ${renderProposals.usableFactIds} from ${renderProposals} where ${renderProposals.userId} = ${user.id} and ${renderProposals.id} = ${proposal.id})`,
      }),
      db.insert(renderVersions).values({
        id: editedId,
        userId: user.id,
        renderId: render.id,
        versionNo: highest + 2,
        content,
        acceptedAt,
        origin: "edited",
        sourceVersionId: acceptedId,
        // The accepted version's era, carried forward as every edit carries
        // its source's: the edit consumes no facts.
        factCountAt: accepted,
        usableFactIds: sql<string[] | null>`(select ${renderProposals.usableFactIds} from ${renderProposals} where ${renderProposals.userId} = ${user.id} and ${renderProposals.id} = ${proposal.id})`,
      }),
      db
        .update(renders)
        .set({ currentVersionId: editedId, staleSinceFactCount: accepted, updatedAt: acceptedAt })
        .where(and(eq(renders.userId, user.id), eq(renders.id, render.id))),
      db
        .update(renderProposals)
        .set({ status: "accepted", decidedAt: acceptedAt, updatedAt: acceptedAt })
        .where(and(eq(renderProposals.userId, user.id), eq(renderProposals.id, proposal.id))),
    ]);
    // Ids and numbers. Never the draft, never the edit.
    console.log(JSON.stringify({ event: "proposal_edited_and_accepted", proposalId: proposal.id, versionNo: highest + 2 }));

    return c.json(
      {
        renderKind: render.kind,
        renderRef: refOf(render),
        acceptedVersionNo: highest + 1,
        newVersionNo: highest + 2,
        origin: "edited" as const,
        sourceVersionId: acceptedId,
        acceptedAt: acceptedAt.toISOString(),
        warnings: editWarnings(content, record.record),
      },
      201,
    );
  });

  /**
   * Rejecting is one action even when nearly every line changed, and it leaves
   * the stored version BYTE-IDENTICAL. The proposal is retained rather than
   * deleted — the decision is recoverable, though it is not a version.
   */
  api.post("/api/proposals/:id/dismiss", async (c) => {
    const user = c.get("user");
    const db = c.get("db");
    const { proposal } = await requireProposal(db, user.id, pathParam(c, "id"));
    if (proposal.status === "accepted") throw alreadyDecided();
    if (proposal.status === "dismissed") {
      return c.json({ proposalId: proposal.id, status: "dismissed" });
    }

    const decidedAt = new Date();
    await db
      .update(renderProposals)
      .set({ status: "dismissed", decidedAt, updatedAt: decidedAt })
      .where(and(eq(renderProposals.userId, user.id), eq(renderProposals.id, proposal.id)));

    return c.json({ proposalId: proposal.id, status: "dismissed" });
  });

  /**
   * The version history (S14, `docs/10` Screen 5).
   *
   * **Versions only.** A dismissed proposal is retained and the screen shows
   * it, but it comes from the proposals route and is merged in the one place
   * that needs it — a merged payload would hand every consumer a discriminated
   * union to unpack before it could answer which row is current
   * (`docs/06`, 2026-09-12).
   *
   * Ancestry is resolved to a version NUMBER here, because "Restored from v2"
   * is what the row says and an id is not a thing the author has ever seen.
   * A never-generated render answers `200` with nothing in it: having no
   * history is a state, not a missing resource.
   */
  api.get("/api/renders/:ref/versions", async (c) => {
    const user = c.get("user");
    const db = c.get("db");
    const target = await resolveRender(db, user.id, pathParam(c, "ref"));
    const { kind, render } = target;
    // What the screen is headed with, and whether Generate can be offered on it.
    const named = {
      renderKind: kind,
      renderRef: target.ref,
      title: target.title,
      tailored: target.jobDescription !== null,
      buildable: RENDER_DEFINITIONS[kind].buildable,
    };

    if (!render) {
      return c.json({ ...named, currentVersionId: null, currentVersionNo: null, items: [] });
    }

    const rows = await db
      .select({
        id: renderVersions.id,
        versionNo: renderVersions.versionNo,
        origin: renderVersions.origin,
        sourceVersionId: renderVersions.sourceVersionId,
        acceptedAt: renderVersions.acceptedAt,
      })
      .from(renderVersions)
      .where(and(eq(renderVersions.userId, user.id), eq(renderVersions.renderId, render.id)))
      .orderBy(desc(renderVersions.versionNo));

    const numberById = new Map(rows.map((r) => [r.id, r.versionNo]));
    return c.json({
      ...named,
      currentVersionId: render.currentVersionId,
      currentVersionNo: render.currentVersionId
        ? (numberById.get(render.currentVersionId) ?? null)
        : null,
      items: rows.map((row) => ({
        id: row.id,
        versionNo: row.versionNo,
        origin: row.origin,
        sourceVersionId: row.sourceVersionId,
        sourceVersionNo: row.sourceVersionId ? (numberById.get(row.sourceVersionId) ?? null) : null,
        acceptedAt: row.acceptedAt.toISOString(),
        isCurrent: row.id === render.currentVersionId,
      })),
    });
  });

  /**
   * Two versions of one render, side by side — the restore preview
   * (`docs/10` Screen 5).
   *
   * `from` is the LEFT column, and the screen passes the current version as
   * `from`, so the diff reports what committing the restore will change rather
   * than what it will undo.
   *
   * It addresses versions and nothing else. Letting `to` name a dismissed
   * proposal would make one handler guess what an id is, and its `404` would
   * then mean three different things; proposals keep their own diff route
   * (`docs/06`, 2026-09-12). **Nothing here writes to `render_proposals`** —
   * this comparison is not a proposal.
   */
  api.get("/api/renders/:ref/diff", async (c) => {
    const user = c.get("user");
    const db = c.get("db");
    const target = await resolveRender(db, user.id, pathParam(c, "ref"));
    const { kind } = target;

    const from = c.req.query("from");
    const to = c.req.query("to");
    if (!from || !to) {
      throw validationFailed("A comparison needs two versions.", ["from", "to"]);
    }

    const before = await requireVersion(db, user.id, target, from);
    const after = await requireVersion(db, user.id, target, to);

    const beforeContent = before.content as RenderContent;
    const afterContent = after.content as RenderContent;
    const explain = await rationaleFor(db, user.id, beforeContent, afterContent);

    return c.json(
      diffRenders(beforeContent, afterContent, {
        language: RENDER_LANGUAGE[kind],
        explain,
        employers: await diffEmployers(db, user.id),
      }),
    );
  });

  /**
   * Restore (S14, `docs/06` 2026-09-12).
   *
   * The third writer of `render_versions`, and it APPENDS like the other two:
   * the restored version is copied forward as a new one, and every version in
   * between stays readable and downloadable.
   *
   * It refuses in exactly TWO cases, and the edit route's other two refusals
   * deliberately do not transfer — restoring is not made against the current
   * version, and the content it produces is by definition not new.
   */
  api.post("/api/renders/:ref/versions/:id/restore", async (c) => {
    const user = c.get("user");
    const db = c.get("db");
    const target = await resolveRender(db, user.id, pathParam(c, "ref"));
    const { kind, render } = target;
    if (!render) throw notFound("That version");

    // The same reason the edit route refuses: a proposal generated against the
    // current version would still be accepted afterwards, and its accept would
    // silently discard the restore. The author decides it first. A proposal
    // whose generation failed is not one of them: accept refuses it, so it can
    // discard nothing.
    const [pending] = await db
      .select({ id: renderProposals.id })
      .from(renderProposals)
      .where(
        and(
          eq(renderProposals.userId, user.id),
          eq(renderProposals.renderId, render.id),
          eq(renderProposals.status, "pending"),
          ne(renderProposals.generationStatus, "failed"),
        ),
      )
      .limit(1);
    if (pending) {
      throw new ApiError(
        "conflict",
        `${target.title} has a proposal waiting. Accept or dismiss it before restoring.`,
        { proposalId: pending.id },
      );
    }

    const restored = await requireVersion(db, user.id, target, pathParam(c, "id"), { factIds: true });
    // Not an error the author can act on by retrying, and not a silent no-op
    // that appends an identical version to the history.
    if (restored.id === render.currentVersionId) {
      throw new ApiError("conflict", `v${restored.versionNo} is already the current version.`, {
        currentVersionId: render.currentVersionId,
      });
    }

    /**
     * **Enforcement point 4 again, at the moment it becomes render time.** A
     * version is a snapshot of what could be rendered in August, and a fact can
     * be set Private in September. Restoring makes that content current, so the
     * citations are held to the rule the edit route holds them to — and the
     * dead end this can leave the author in is correct: the alternative is a
     * route whose purpose is to put a withheld claim back into the live
     * document.
     */
    const content = restored.content as RenderContent;
    const record = await collectEditableRecord(db, user.id);
    const bad = badCitations(citedFactIds(content), record);
    if (bad.length > 0) {
      throw new ApiError("validation_failed", citationMessage(bad), {
        facts: bad.map((b) => ({ factId: b.factId, problem: b.problem })),
      });
    }

    const highest = await highestVersionNo(db, user.id, render.id);
    const versionId = newId("renderVersion");
    const acceptedAt = new Date();

    await db.batch([
      db.insert(renderVersions).values({
        id: versionId,
        userId: user.id,
        renderId: render.id,
        versionNo: highest + 1,
        content,
        acceptedAt,
        origin: "restored",
        sourceVersionId: restored.id,
        /**
         * The TARGET's era, not today's. The column describes the content, and
         * a restore copies the content forward unchanged, so the era comes
         * with it. Writing today's count here would make a restore of a
         * restore silently forget how old the content is, because the second
         * restore would read the first one's creation date as its era
         * (`docs/06`, 2026-09-12 second entry, superseding the first).
         */
        factCountAt: restored.factCountAt,
        // The same rule, for the set the count stood in for.
        usableFactIds: restored.usableFactIds,
      }),
      db
        .update(renders)
        .set({
          currentVersionId: versionId,
          /**
           * Staleness MOVES, which is the opposite of what the edit route does
           * and for the opposite reason. An edit consumes no facts; a restore
           * moves the document's content back to a version generated from a
           * smaller record, and the number describes the content rather than
           * the act that produced it. A render that was current before a
           * restore is usually stale after one, and saying so is the honest
           * reading (`docs/06`, 2026-09-12). It is the new row's own
           * `factCountAt` because the two now mean the same thing.
           */
          staleSinceFactCount: restored.factCountAt,
          updatedAt: acceptedAt,
        })
        .where(and(eq(renders.userId, user.id), eq(renders.id, render.id))),
    ]);

    return c.json(
      {
        renderKind: kind,
        renderRef: target.ref,
        newVersionNo: highest + 1,
        origin: "restored" as const,
        sourceVersionId: restored.id,
        sourceVersionNo: restored.versionNo,
        acceptedAt: acceptedAt.toISOString(),
      },
      201,
    );
  });

  /**
   * One stored version, as content rather than as a document.
   *
   * The companion to the edit below, and the reason it exists: an edit sends
   * the whole document back, so something has to hand the whole document out.
   * `download` assembles a `.docx` or Markdown and cannot be edited and
   * returned; this is the structure itself, block ids included, which is what
   * an edit addresses.
   *
   * `:id` rather than "the current one" because a version never stops being
   * readable — the one an edit was made from is still here afterwards.
   */
  api.get("/api/renders/:ref/versions/:id", async (c) => {
    const user = c.get("user");
    const db = c.get("db");
    const target = await resolveRender(db, user.id, pathParam(c, "ref"));
    const { kind } = target;

    const version = await requireVersion(db, user.id, target, pathParam(c, "id"));

    return c.json({
      id: version.id,
      renderKind: kind,
      renderRef: target.ref,
      versionNo: version.versionNo,
      origin: version.origin,
      sourceVersionId: version.sourceVersionId,
      acceptedAt: version.acceptedAt.toISOString(),
      content: version.content,
    });
  });

  /**
   * A hand edit (`docs/02` S16, `docs/06` 2026-09-11).
   *
   * The second writer of `render_versions`, and it APPENDS. An edit is a new
   * version pointing at the one it was made from, which is the shape
   * `source_version_id` already held for restore: nothing is deleted and
   * nothing is overwritten, so the version the author edited stays readable and
   * downloadable beside the one they produced.
   *
   * It does not go through the diff gate. The gate exists to review a MODEL's
   * work; showing the author the sentence they just typed is ceremony, and the
   * version history is where an edit is read back.
   */
  api.post("/api/renders/:ref/versions", async (c) => {
    const user = c.get("user");
    const db = c.get("db");
    const target = await resolveRender(db, user.id, pathParam(c, "ref"));
    const { kind, render } = target;

    const body = await c.req.json().catch(() => null);
    if (typeof body !== "object" || body === null) {
      throw validationFailed("That edit is not a document.", ["content"]);
    }
    const { basedOnVersionId, content: submitted } = body as Record<string, unknown>;
    if (typeof basedOnVersionId !== "string") {
      throw validationFailed(
        "An edit must say which version it was made from.",
        ["basedOnVersionId"],
      );
    }

    if (!render?.currentVersionId) throw notFound("A version of that document");

    // A proposal generated against the version being edited would still be
    // accepted afterwards, and its accept would silently discard the edit. The
    // author decides it first; deciding it for them is not this route's call.
    // A failed proposal is excluded: accept refuses it, so it can discard
    // nothing, and holding the edit would leave the author no way forward.
    const [pending] = await db
      .select({ id: renderProposals.id })
      .from(renderProposals)
      .where(
        and(
          eq(renderProposals.userId, user.id),
          eq(renderProposals.renderId, render.id),
          eq(renderProposals.status, "pending"),
          ne(renderProposals.generationStatus, "failed"),
        ),
      )
      .limit(1);
    if (pending) {
      throw new ApiError(
        "conflict",
        `${target.title} has a proposal waiting. Accept or dismiss it before editing.`,
        { proposalId: pending.id },
      );
    }

    // Editing anything but the current version is refused rather than merged:
    // the author is looking at a document that has moved underneath them.
    if (basedOnVersionId !== render.currentVersionId) {
      throw new ApiError(
        "conflict",
        "That edit was made against a version that is no longer current. Reload and edit again.",
        { currentVersionId: render.currentVersionId },
      );
    }

    const [current] = await db
      .select()
      .from(renderVersions)
      .where(
        and(
          eq(renderVersions.userId, user.id),
          eq(renderVersions.renderId, render.id),
          eq(renderVersions.id, basedOnVersionId),
        ),
      )
      .limit(1);
    if (!current) throw notFound("That version");

    const { content, record } = await checkHandEdit(
      db,
      user.id,
      kind,
      submitted,
      current.content as RenderContent,
      "That edit changes nothing.",
    );

    const highest = await highestVersionNo(db, user.id, render.id);
    const versionId = newId("renderVersion");
    const acceptedAt = new Date();

    // `staleSinceFactCount` is deliberately NOT touched. An edit consumes no
    // facts, so a render that was stale before it is still stale after it —
    // resetting the counter would report a document as current because the
    // author fixed a sentence in it.
    await db.batch([
      db.insert(renderVersions).values({
        id: versionId,
        userId: user.id,
        renderId: render.id,
        versionNo: highest + 1,
        content,
        acceptedAt,
        origin: "edited",
        sourceVersionId: current.id,
        // Written even though this route does not READ it: the column holds
        // the era of every row alike, and a restore of this version later is
        // what reads it back.
        factCountAt: current.usableFactIds === null
          ? current.factCountAt
          : await usableFactCount(db, user.id),
        // The source's, because an edit consumes no facts: the document is
        // still out of date by exactly what it was before the edit.
        usableFactIds: current.usableFactIds,
      }),
      db
        .update(renders)
        .set({ currentVersionId: versionId, updatedAt: acceptedAt })
        .where(and(eq(renders.userId, user.id), eq(renders.id, render.id))),
    ]);

    return c.json(
      {
        renderKind: kind,
        renderRef: target.ref,
        newVersionNo: highest + 1,
        origin: "edited" as const,
        sourceVersionId: current.id,
        acceptedAt: acceptedAt.toISOString(),
        // Read by definition: the only caller of this route is a human making
        // a deliberate call. That stops being true the day a screen calls it.
        warnings: editWarnings(content, record.record),
      },
      201,
    );
  });

  /**
   * One version to read on a screen (issue #106): the page its download would
   * hold today, assembled from the same inputs and refused on the same facts
   * (`409`, the ids named). Like the download, it is never stored, so a read
   * after the profile changes shows the new contact line. A sent copy keeps
   * its own page; this is not that.
   */
  api.get("/api/renders/:ref/page", async (c) => {
    const user = c.get("user");
    const db = c.get("db");
    const target = await resolveRender(db, user.id, pathParam(c, "ref"));
    const { kind, render } = target;

    const versionId = c.req.query("versionId") ?? render?.currentVersionId ?? null;
    if (!versionId) throw notFound("A version of that document");
    const version = await requireVersion(db, user.id, target, versionId);
    const page = await buildDocumentPage(db, user.id, kind, version);
    // What stands behind each line (issue #110), looked up only once the page
    // has passed the download's refusal.
    const evidence = await factEvidence(db, user.id, citedOnPage(page), RENDER_LANGUAGE[kind]);
    // Where it stands, for the header's one button: the row Home or the
    // application would show for it, by the same query.
    const state = await renderState(db, user.id);
    const document = [...state.documents, ...state.tailored].find((row) => row.ref === target.ref)!;
    const tailoring = kind === "rirekisho" && render ? await tailoringOf(db, user.id, render) : null;

    return c.json({
      renderKind: kind,
      renderRef: target.ref,
      title: target.title,
      language: RENDER_LANGUAGE[kind],
      tailored: target.jobDescription !== null,
      applicationId: render?.applicationId ?? null,
      motivationNote: tailoring?.application?.motivationNote ?? null,
      document,
      canGenerate: state.usableFacts > 0,
      version: {
        id: version.id,
        versionNo: version.versionNo,
        origin: version.origin,
        acceptedAt: version.acceptedAt.toISOString(),
        isCurrent: version.id === render?.currentVersionId,
      },
      page,
      evidence,
    });
  });

  /** Assembled from the stored content on each request. NEVER stored. */
  api.get("/api/renders/:ref/download", async (c) => {
    const user = c.get("user");
    const db = c.get("db");
    const target = await resolveRender(db, user.id, pathParam(c, "ref"));
    const { kind, render } = target;
    // `.docx` unless asked otherwise. The English résumé, the 履歴書 and the
    // 職務経歴書 have a PDF, and the screen asks for it by default for each
    // (issues #109, #117).
    const asked = c.req.query("format");
    const format = asked === "md" || asked === "pdf" ? asked : "docx";
    if (format === "pdf" && !PDF_KINDS.includes(kind)) {
      throw new ApiError("conflict", "Only the résumé, the 履歴書 and the 職務経歴書 are produced as a PDF.");
    }

    const versionId = c.req.query("versionId") ?? render?.currentVersionId ?? null;
    if (!versionId) throw notFound("A version of that document");

    // A version of this document and no other: a tailored résumé's version is
    // not served under the main résumé's address, nor the reverse.
    const version = await requireVersion(db, user.id, target, versionId);

    if (format === "md") {
      const content = version.content as RenderContent;
      // Withheld before the file is assembled, as the `.docx` is (`../services/document-file`).
      await refuseWithheldCitations(db, user.id, content);
      if (kind === "rirekisho") {
        throw new ApiError("conflict", "A 履歴書 is a form and is produced as .docx only.");
      }
      // Read at download rather than stored with the version: the identity block
      // is not a claim about a career, and an accepted version must not go stale
      // because a phone number changed (`src/render/identity.ts`).
      const identity = await renderIdentity(db, user.id);
      // The résumé's Markdown is the same document its `.docx` is (issue #107).
      const today = tokyoToday();
      let markdown: string;
      try {
        markdown = kind === "english_resume"
          ? resumeMarkdown(
              assembleResume({ content, record: await collectResumeRecord(db, user.id), identity, today }),
            )
          : kind === "shokumu_keirekisho" || kind === "career_story_ja"
            ? japaneseMarkdown(
                assembleJapanese({ kind, content, identity, today, employers: await collectJapaneseEmployers(db, user.id) }),
              )
            : toMarkdown(content, RENDER_TITLE[kind], kind, identity, today);
      } catch (error) {
        if (error instanceof ResumeAssemblyError) throw resumeRefusal(error);
        throw error;
      }
      const names = filenameFor(kind, format, version, identity, today);
      return new Response(markdown, {
        headers: {
          "content-type": "text/markdown; charset=utf-8",
          "content-disposition": attachment(names.filename, names.asciiFilename),
        },
      });
    }

    const file = format === "pdf"
      ? await buildDocumentPdf(db, user.id, kind, version)
      : await buildDocumentFile(db, user.id, kind, version);
    return new Response(file.bytes as BodyInit, {
      headers: {
        "content-type": format === "pdf" ? PDF_MIME : DOCX_MIME,
        "content-disposition": attachment(file.filename, file.asciiFilename),
      },
    });
  });
}

/* ------------------------------------------------------------------ shared */

const alreadyDecided = () =>
  new ApiError("conflict", "That proposal has already been decided.");

/**
 * One version of one document, or a 404.
 *
 * A version of another document is not this one's, and saying so would confirm
 * it exists — so the wrong document and a missing row give the same answer. A
 * tailored résumé shares its kind with the main résumé, so the test is the
 * render row and not the kind.
 */
/**
 * Every column but the ids of the facts the version was made from, unless
 * `factIds` asks for them: only a restore copies them, and they are thousands
 * of ids read on every poll of a document's page (`docs/06`, 2026-11-04).
 */
const { usableFactIds: _usableFactIds, ...versionColumns } = getTableColumns(renderVersions);

async function requireVersion(db: Db, userId: string, target: RenderRef, id: string): Promise<Omit<typeof renderVersions.$inferSelect, "usableFactIds">>;
async function requireVersion(db: Db, userId: string, target: RenderRef, id: string, options: { factIds: true }): Promise<typeof renderVersions.$inferSelect>;
async function requireVersion(db: Db, userId: string, target: RenderRef, id: string, options?: { factIds: true }) {
  if (!target.render) throw notFound("That version");
  const [version] = await db
    .select(options?.factIds ? getTableColumns(renderVersions) : versionColumns)
    .from(renderVersions)
    .where(
      and(
        eq(renderVersions.userId, userId),
        eq(renderVersions.renderId, target.render.id),
        eq(renderVersions.id, id),
      ),
    )
    .limit(1);
  if (!version) throw notFound("That version");
  return version;
}

/**
 * A first 履歴書 read as its file lays it out, its 写真 included, as the
 * document view reads a version (`../services/document-file`).
 */
async function rirekishoPreviewPage(db: Db, userId: string, content: RenderContent, today: string): Promise<SentPage> {
  const data = rirekishoTemplateData({
    profile: await collectRirekishoProfile(db, userId),
    record: await collectRirekishoRecord(db, userId),
    submittedOn: today,
    content,
  });
  return rirekishoSentPage(data, content, fillRirekishoTemplate(data, await collectRirekishoPhoto(db, userId)));
}

/**
 * A first English résumé read as its file lays it out, as the document view
 * reads a version (`../services/document-file`): no title above the name, the
 * headline set apart. A proposal that cannot be laid out is refused as a
 * download of it would be.
 */
async function resumePreviewPage(db: Db, userId: string, content: RenderContent, today: string): Promise<SentPage> {
  const record = await collectResumeRecord(db, userId);
  const identity = await renderIdentity(db, userId);
  try {
    return resumeSentPage(assembleResume({ content, record, identity, today }));
  } catch (error) {
    if (error instanceof ResumeAssemblyError) throw resumeRefusal(error);
    throw error;
  }
}

/** The next version number for a render. Versions are numbered per render. */
async function highestVersionNo(db: Db, userId: string, renderId: string): Promise<number> {
  const [{ highest } = { highest: 0 }] = await db
    .select({ highest: sql<number>`coalesce(max(${renderVersions.versionNo}), 0)::int` })
    .from(renderVersions)
    .where(and(eq(renderVersions.userId, userId), eq(renderVersions.renderId, renderId)));
  return highest;
}

/**
 * The count retained for versions with no recorded usable-fact set. Both
 * `renders.stale_since_fact_count` and `render_versions.fact_count_at` use it.
 */
async function usableFactCount(db: Db, userId: string): Promise<number> {
  const [{ accepted } = { accepted: 0 }] = await db
    .select({ accepted: sql<number>`count(*)::int` })
    .from(facts)
    .where(usableFacts(userId));
  return accepted;
}

/**
 * Every column of the proposal but its fact ids: about a hundred kilobytes on a
 * large record, and the one route that needs them, accept, copies them in SQL.
 */
const { usableFactIds: _proposalFactIds, ...proposalColumns } = getTableColumns(renderProposals);

/**
 * Every check a hand edit is held to, whatever it was made from: a stored
 * version (`POST /api/renders/:ref/versions`) or a waiting draft
 * (`POST /api/proposals/:id/edit`, `docs/06` 2026-11-04). One function, so the
 * two cannot drift apart on what a typed block may cite.
 *
 * Shape and ids first (`parseEditedContent`), then the English résumé's bounds
 * against the record's names, then sameness, then the four citation refusals.
 * The order is the edit route's own, and its tests pin it.
 */
async function checkHandEdit(
  db: Db,
  userId: string,
  kind: RenderKind,
  submitted: unknown,
  previous: RenderContent,
  unchanged: string,
) {
  let content: RenderContent;
  try {
    content = parseEditedContent(submitted, previous);
  } catch (err) {
    if (err instanceof EditRejected) throw validationFailed(err.message, ["content"]);
    throw err;
  }
  if (kind === "english_resume") {
    const resume = await collectResumeRecord(db, userId);
    try {
      validateResumeEditShape(content, previous);
      validateResumeBounds(content, resume.employers, previous);
    } catch (error) {
      if (error instanceof Error) throw validationFailed(error.message, ["content"]);
      throw error;
    }
  }
  if (sameContent(content, previous)) throw new ApiError("conflict", unchanged);

  const record = await collectEditableRecord(db, userId);
  const bad = badCitations(citedFactIds(content), record);
  if (bad.length > 0) {
    throw new ApiError("validation_failed", citationMessage(bad), {
      facts: bad.map((b) => ({ factId: b.factId, problem: b.problem })),
    });
  }
  return { content, record };
}

async function requireProposal(db: Db, userId: string, id: string) {
  const [row] = await db
    .select({ proposal: proposalColumns, render: renders })
    .from(renderProposals)
    .innerJoin(renders, eq(renders.id, renderProposals.renderId))
    .where(and(eq(renderProposals.userId, userId), eq(renderProposals.id, id)))
    .limit(1);
  if (!row) throw notFound("That proposal");
  return row;
}

/** Re-exported for the overview and the application documents, which report the same state. */
export { renderState, usableFacts };
export type { RenderState };
