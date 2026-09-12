/**
 * Renders and proposals (`docs/07-api-design.md` §7).
 *
 * A render proposal is accepted or rejected **as a whole**. There is no
 * per-change accept endpoint, deliberately: accepting 9 of 11 changes leaves
 * the document not matching the record, which is the exact drift this project
 * exists to remove. If a proposed line is wrong, the fix is the underlying fact.
 */
import type { Hono } from "hono";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { facts, profiles, renderProposals, renderVersions, renders } from "../db/schema";
import { ApiError, notFound, preconditionFailed, pathParam, validationFailed } from "../http/errors";
import { routes } from "../http/registry";
import { newId } from "../http/ids";
import { collectRenderInputs, generateIntoProposal } from "../services/render";
import {
  currentContent,
  proposalResponse,
  rationaleFor,
  regenerationReason,
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
import { DOCX_MIME, downloadFilename, toDocx } from "~/render/docx";
import { buildRirekisho, rirekishoWarnings, tokyoToday } from "~/render/rirekisho";
import { collectRirekishoProfile, collectRirekishoRecord } from "../services/rirekisho";
import type { RenderIdentity } from "~/render/identity";
import {
  RENDER_KINDS,
  RENDER_LANGUAGE,
  RENDER_TITLE,
  type RenderContent,
  type RenderKind,
} from "~/shared/render-content";
import type { AppEnv } from "../env";
import type { Db } from "../db/client";

export function registerRenderRoutes(app: Hono<AppEnv>) {
  const api = routes(app);

  /** All five, with status. `never_generated` is distinct from `up_to_date`. */
  api.get("/api/renders", async (c) => {
    const user = c.get("user");
    const db = c.get("db");
    const state = await renderState(db, user.id);
    return c.json({ items: state });
  });

  api.post("/api/renders/:kind/generate", async (c) => {
    const user = c.get("user");
    const db = c.get("db");
    const kind = requireKind(pathParam(c, "kind"));
    const definition = RENDER_DEFINITIONS[kind];

    if (!definition.buildable) {
      throw new ApiError("conflict", `${RENDER_TITLE[kind]} is not built yet.`);
    }

    const [profile] = await db
      .select()
      .from(profiles)
      .where(eq(profiles.userId, user.id))
      .limit(1);

    // Generation is BLOCKED and the missing fields are NAMED — never a document
    // produced with a hole in it.
    const missing = definition.requiredProfileFields.filter(
      (field) => !profile || !String((profile as Record<string, unknown>)[field] ?? "").trim(),
    );
    if (missing.length > 0) {
      throw preconditionFailed(
        `A ${RENDER_TITLE[kind]} cannot be generated without ${missing.join(", ")}.`,
        missing,
      );
    }

    const inputs = await collectRenderInputs(db, user.id, kind, profile!.nameLatin);
    // The tool never silently produces an empty document, and the reason is
    // stated rather than left to the author to work out.
    if (inputs.facts.length === 0) {
      throw preconditionFailed(
        inputs.acceptedFactCount === 0
          ? "There are no accepted facts to generate from yet."
          : "Every accepted fact is either unverified or private, so none can be used in a document.",
        ["facts"],
      );
    }

    // Advisory and never blocking (`docs/04` §4). The 履歴書 is the only kind
    // with a rule about gaps, because it is the only one required to be
    // complete: the English résumé's register drops entries by level. The
    // notice is unconditional and comes last, so a gap — which is about this
    // record, and may not be there next time — is read first.
    const warnings = kind === "rirekisho" ? rirekishoWarnings(inputs.spec) : [];

    const render = await ensureRender(db, user.id, kind);
    const proposalId = newId("renderProposal");
    await db.insert(renderProposals).values({
      id: proposalId,
      userId: user.id,
      renderId: render.id,
      content: { sections: [] } satisfies RenderContent,
      status: "pending",
      generationStatus: "generating",
      basedOnVersionId: render.currentVersionId,
      reason: regenerationReason(render.newFactsSince, render.currentVersionNo !== null),
    });

    // Returns immediately with a resource to poll. The current version stays
    // fully readable while the proposal generates — never a blank screen.
    const run = generateIntoProposal({
      db,
      model: c.get("model"),
      userId: user.id,
      proposalId,
      inputs,
    });
    c.executionCtx.waitUntil(run);

    return c.json({ proposalId, renderKind: kind, status: "generating", warnings }, 202);
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
    const kind = requireKind(c.req.query("kind"));

    const rows = await db
      .select({
        id: renderProposals.id,
        status: renderProposals.status,
        generationStatus: renderProposals.generationStatus,
        generatedAt: renderProposals.generatedAt,
        decidedAt: renderProposals.decidedAt,
        reason: renderProposals.reason,
      })
      .from(renderProposals)
      .innerJoin(renders, eq(renders.id, renderProposals.renderId))
      .where(and(eq(renderProposals.userId, user.id), eq(renders.kind, kind)))
      .orderBy(desc(renderProposals.generatedAt));

    return c.json({
      renderKind: kind,
      items: rows.map((row) => ({
        id: row.id,
        status: row.status,
        generationStatus: row.generationStatus,
        generatedAt: row.generatedAt.toISOString(),
        decidedAt: row.decidedAt?.toISOString() ?? null,
        reason: row.reason,
      })),
    });
  });

  api.get("/api/proposals/:id", async (c) => {
    const { proposal, render } = await requireProposal(
      c.get("db"),
      c.get("user").id,
      pathParam(c, "id"),
    );
    return c.json(await proposalResponse(c.get("db"), c.get("user").id, proposal, render));
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
    });
    return c.json(diff);
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

    const highest = await highestVersionNo(db, user.id, render.id);

    const versionId = newId("renderVersion");
    const acceptedAt = new Date();
    const accepted = await acceptedFactCount(db, user.id);

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
      newVersionNo: highest + 1,
      acceptedAt: acceptedAt.toISOString(),
    });
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
  api.get("/api/renders/:kind/versions", async (c) => {
    const user = c.get("user");
    const db = c.get("db");
    const kind = requireKind(pathParam(c, "kind"));

    const [render] = await db
      .select()
      .from(renders)
      .where(and(eq(renders.userId, user.id), eq(renders.kind, kind)))
      .limit(1);
    if (!render) {
      return c.json({ renderKind: kind, currentVersionId: null, currentVersionNo: null, items: [] });
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
      renderKind: kind,
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
  api.get("/api/renders/:kind/diff", async (c) => {
    const user = c.get("user");
    const db = c.get("db");
    const kind = requireKind(pathParam(c, "kind"));

    const from = c.req.query("from");
    const to = c.req.query("to");
    if (!from || !to) {
      throw validationFailed("A comparison needs two versions.", ["from", "to"]);
    }

    const before = await requireVersion(db, user.id, kind, from);
    const after = await requireVersion(db, user.id, kind, to);

    const beforeContent = before.content as RenderContent;
    const afterContent = after.content as RenderContent;
    const explain = await rationaleFor(db, user.id, beforeContent, afterContent);

    return c.json(
      diffRenders(beforeContent, afterContent, { language: RENDER_LANGUAGE[kind], explain }),
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
  api.post("/api/renders/:kind/versions/:id/restore", async (c) => {
    const user = c.get("user");
    const db = c.get("db");
    const kind = requireKind(pathParam(c, "kind"));

    const [render] = await db
      .select()
      .from(renders)
      .where(and(eq(renders.userId, user.id), eq(renders.kind, kind)))
      .limit(1);
    if (!render) throw notFound("That version");

    // The same reason the edit route refuses: a proposal generated against the
    // current version would still be accepted afterwards, and its accept would
    // silently discard the restore. The author decides it first.
    const [pending] = await db
      .select({ id: renderProposals.id })
      .from(renderProposals)
      .where(
        and(
          eq(renderProposals.userId, user.id),
          eq(renderProposals.renderId, render.id),
          eq(renderProposals.status, "pending"),
        ),
      )
      .limit(1);
    if (pending) {
      throw new ApiError(
        "conflict",
        `${RENDER_TITLE[kind]} has a proposal waiting. Accept or dismiss it before restoring.`,
        { proposalId: pending.id },
      );
    }

    const target = await requireVersion(db, user.id, kind, pathParam(c, "id"));
    // Not an error the author can act on by retrying, and not a silent no-op
    // that appends an identical version to the history.
    if (target.id === render.currentVersionId) {
      throw new ApiError("conflict", `v${target.versionNo} is already the current version.`, {
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
    const content = target.content as RenderContent;
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
    const accepted = await acceptedFactCount(db, user.id);

    await db.batch([
      db.insert(renderVersions).values({
        id: versionId,
        userId: user.id,
        renderId: render.id,
        versionNo: highest + 1,
        content,
        acceptedAt,
        origin: "restored",
        sourceVersionId: target.id,
        factCountAt: accepted,
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
           * reading (`docs/06`, 2026-09-12).
           */
          staleSinceFactCount: target.factCountAt,
          updatedAt: acceptedAt,
        })
        .where(and(eq(renders.userId, user.id), eq(renders.id, render.id))),
    ]);

    return c.json(
      {
        renderKind: kind,
        newVersionNo: highest + 1,
        origin: "restored" as const,
        sourceVersionId: target.id,
        sourceVersionNo: target.versionNo,
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
  api.get("/api/renders/:kind/versions/:id", async (c) => {
    const user = c.get("user");
    const db = c.get("db");
    const kind = requireKind(pathParam(c, "kind"));

    const version = await requireVersion(db, user.id, kind, pathParam(c, "id"));

    return c.json({
      id: version.id,
      renderKind: kind,
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
  api.post("/api/renders/:kind/versions", async (c) => {
    const user = c.get("user");
    const db = c.get("db");
    const kind = requireKind(pathParam(c, "kind"));

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

    const [render] = await db
      .select()
      .from(renders)
      .where(and(eq(renders.userId, user.id), eq(renders.kind, kind)))
      .limit(1);
    if (!render?.currentVersionId) throw notFound("A version of that document");

    // A proposal generated against the version being edited would still be
    // accepted afterwards, and its accept would silently discard the edit. The
    // author decides it first; deciding it for them is not this route's call.
    const [pending] = await db
      .select({ id: renderProposals.id })
      .from(renderProposals)
      .where(
        and(
          eq(renderProposals.userId, user.id),
          eq(renderProposals.renderId, render.id),
          eq(renderProposals.status, "pending"),
        ),
      )
      .limit(1);
    if (pending) {
      throw new ApiError(
        "conflict",
        `${RENDER_TITLE[kind]} has a proposal waiting. Accept or dismiss it before editing.`,
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
      .where(and(eq(renderVersions.userId, user.id), eq(renderVersions.id, basedOnVersionId)))
      .limit(1);
    if (!current) throw notFound("That version");

    let content: RenderContent;
    try {
      content = parseEditedContent(submitted, current.content as RenderContent);
    } catch (err) {
      if (err instanceof EditRejected) throw validationFailed(err.message, ["content"]);
      throw err;
    }
    if (sameContent(content, current.content as RenderContent)) {
      throw new ApiError("conflict", "That edit changes nothing.");
    }

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
        factCountAt: await acceptedFactCount(db, user.id),
      }),
      db
        .update(renders)
        .set({ currentVersionId: versionId, updatedAt: acceptedAt })
        .where(and(eq(renders.userId, user.id), eq(renders.id, render.id))),
    ]);

    return c.json(
      {
        renderKind: kind,
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

  /** Assembled from the stored content on each request. NEVER stored. */
  api.get("/api/renders/:kind/download", async (c) => {
    const user = c.get("user");
    const db = c.get("db");
    const kind = requireKind(pathParam(c, "kind"));
    const format = c.req.query("format") === "md" ? "md" : "docx";

    const [render] = await db
      .select()
      .from(renders)
      .where(and(eq(renders.userId, user.id), eq(renders.kind, kind)))
      .limit(1);

    const versionId = c.req.query("versionId") ?? render?.currentVersionId ?? null;
    if (!versionId) throw notFound("A version of that document");

    const [version] = await db
      .select()
      .from(renderVersions)
      .where(and(eq(renderVersions.userId, user.id), eq(renderVersions.id, versionId)))
      .limit(1);
    if (!version) throw notFound("That version");

    const content = version.content as RenderContent;

    /**
     * **Enforcement point 4 at the last render time there is** (issue #17). A
     * version is a snapshot of what could be rendered in August, not a standing
     * permission to keep rendering it. A fact set Private in September is
     * withheld from the file that leaves the tool in September, whatever the
     * stored content says.
     *
     * `409` rather than the restore route's `422`: restore submits content to
     * be made current and the content is what fails validation, while a
     * download asks for a file the record's CURRENT state will not allow. The
     * ids are named because a refusal the author cannot act on is a dead end —
     * the way out is the hand-edit route, which lifts the block and produces a
     * version that downloads (`docs/06`, 2026-09-12 third entry).
     */
    const record = await collectEditableRecord(db, user.id);
    const withheld = badCitations(citedFactIds(content), record);
    if (withheld.length > 0) {
      throw new ApiError("conflict", citationMessage(withheld), {
        facts: withheld.map((b) => ({ factId: b.factId, problem: b.problem })),
      });
    }

    const title = RENDER_TITLE[kind];
    const filename = downloadFilename(kind, format, version.acceptedAt);

    // A 履歴書 is FILLED, not built (`docs/03` §30). Its three tables are
    // derived from the record rather than read out of the version, its identity
    // block comes from the profile row, and the only generated text in it is
    // the two prose blocks. The submission date is stamped now, in Tokyo, and
    // the age is computed against it (`docs/04` §4).
    if (kind === "rirekisho") {
      if (format === "md") {
        throw new ApiError("conflict", "A 履歴書 is a form and is produced as .docx only.");
      }
      const profile = await collectRirekishoProfile(db, user.id);
      const record = await collectRirekishoRecord(db, user.id);
      let filled: Uint8Array;
      try {
        filled = buildRirekisho({ profile, record, submittedOn: tokyoToday(), content });
      } catch {
        console.error(JSON.stringify({ event: "docx_build_failed", versionId }));
        throw new ApiError(
          "internal",
          "That document could not be assembled. Your saved version is unchanged.",
        );
      }
      return new Response(filled as BodyInit, {
        headers: {
          "content-type": DOCX_MIME,
          "content-disposition": `attachment; filename="${filename}"`,
        },
      });
    }

    // Read at download rather than stored with the version: the identity block
    // is not a claim about a career, and an accepted version must not go stale
    // because a phone number changed (`src/render/identity.ts`).
    const identity = await renderIdentity(db, user.id);

    if (format === "md") {
      return new Response(toMarkdown(content, title, kind, identity), {
        headers: {
          "content-type": "text/markdown; charset=utf-8",
          "content-disposition": `attachment; filename="${filename}"`,
        },
      });
    }

    let bytes: Uint8Array;
    try {
      bytes = await toDocx(content, title, kind, identity);
    } catch {
      // The download fails; the stored content is untouched and the next
      // download can succeed.
      console.error(JSON.stringify({ event: "docx_build_failed", versionId }));
      throw new ApiError("internal", "That document could not be assembled. Your saved version is unchanged.");
    }

    return new Response(bytes as BodyInit, {
      headers: {
        "content-type": DOCX_MIME,
        "content-disposition": `attachment; filename="${filename}"`,
      },
    });
  });
}

/* ------------------------------------------------------------------ shared */

const alreadyDecided = () =>
  new ApiError("conflict", "That proposal has already been decided.");

/**
 * The identity block's source, narrowed to the three fields a header may read.
 * The restricted PII columns are never selected, so they cannot reach a render
 * by accident — `src/render/identity.ts` and `docs/04` §3.2.
 *
 * A missing profile is a precondition failure, not a nameless document: nothing
 * can be generated without one (`requiredProfileFields`), so its absence at
 * download time means the row went away underneath an existing version.
 */
async function renderIdentity(db: Db, userId: string): Promise<RenderIdentity> {
  const [profile] = await db
    .select({
      nameLatin: profiles.nameLatin,
      familyNameKanji: profiles.familyNameKanji,
      givenNameKanji: profiles.givenNameKanji,
      email: profiles.email,
    })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1);

  if (!profile) {
    throw preconditionFailed(
      "That document cannot be assembled without your name. Add it to your profile and download again.",
      ["nameLatin"],
    );
  }

  return {
    nameLatin: profile.nameLatin,
    nameKanji: `${profile.familyNameKanji} ${profile.givenNameKanji}`.trim(),
    email: profile.email,
  };
}

function requireKind(value: string | undefined): RenderKind {
  if (!value || !(RENDER_KINDS as readonly string[]).includes(value)) {
    throw notFound("That document");
  }
  return value as RenderKind;
}

/** A `renders` row is created on first generation, not on sign-up. */
async function ensureRender(db: Db, userId: string, kind: RenderKind) {
  const read = async () => (await renderState(db, userId)).find((r) => r.kind === kind)!;
  let state = await read();
  if (state.id === null) {
    await db
      .insert(renders)
      .values({ id: newId("render"), userId, kind })
      .onConflictDoNothing();
    state = await read();
  }
  return { ...state, id: state.id! };
}

interface RenderState {
  id: string | null;
  kind: RenderKind;
  language: "en" | "ja";
  title: string;
  buildable: boolean;
  currentVersionId: string | null;
  currentVersionNo: number | null;
  generatedAt: string | null;
  status: "never_generated" | "up_to_date" | "stale" | "proposal_pending";
  newFactsSince: number | null;
  pendingProposalId: string | null;
}

/**
 * One query set backs both `GET /api/renders` and the overview's Documents
 * section. All five kinds are always reported, whether or not a row exists.
 */
export async function renderState(db: Db, userId: string): Promise<RenderState[]> {
  const rows = await db.select().from(renders).where(eq(renders.userId, userId));
  const byKind = new Map(rows.map((r) => [r.kind, r]));

  const versionIds = rows.map((r) => r.currentVersionId).filter((id): id is string => id !== null);
  const versions =
    versionIds.length === 0
      ? []
      : await db
          .select({
            id: renderVersions.id,
            versionNo: renderVersions.versionNo,
            acceptedAt: renderVersions.acceptedAt,
          })
          .from(renderVersions)
          .where(and(eq(renderVersions.userId, userId), inArray(renderVersions.id, versionIds)));
  const versionById = new Map(versions.map((v) => [v.id, v]));

  const pending = await db
    .select({ id: renderProposals.id, renderId: renderProposals.renderId })
    .from(renderProposals)
    .where(and(eq(renderProposals.userId, userId), eq(renderProposals.status, "pending")))
    .orderBy(desc(renderProposals.generatedAt));
  const pendingByRender = new Map<string, string>();
  for (const p of pending) if (!pendingByRender.has(p.renderId)) pendingByRender.set(p.renderId, p.id);

  const [{ accepted } = { accepted: 0 }] = await db
    .select({ accepted: sql<number>`count(*)::int` })
    .from(facts)
    .where(and(eq(facts.userId, userId), eq(facts.status, "accepted")));

  return RENDER_KINDS.map((kind) => {
    const row = byKind.get(kind);
    const version = row?.currentVersionId ? versionById.get(row.currentVersionId) : undefined;
    const pendingProposalId = row ? (pendingByRender.get(row.id) ?? null) : null;
    const newFactsSince = version ? Math.max(0, accepted - (row?.staleSinceFactCount ?? 0)) : null;

    const status: RenderState["status"] = !version
      ? "never_generated"
      : pendingProposalId
        ? "proposal_pending"
        : (newFactsSince ?? 0) > 0
          ? "stale"
          : "up_to_date";

    return {
      id: row?.id ?? null,
      kind,
      language: RENDER_DEFINITIONS[kind].language,
      title: RENDER_TITLE[kind],
      buildable: RENDER_DEFINITIONS[kind].buildable,
      currentVersionId: row?.currentVersionId ?? null,
      currentVersionNo: version?.versionNo ?? null,
      generatedAt: version?.acceptedAt.toISOString() ?? null,
      status,
      newFactsSince,
      pendingProposalId,
    };
  });
}

/**
 * One version of one render kind, or a 404.
 *
 * A version of another kind is not this render's, and saying so would confirm
 * it exists — so the wrong kind and a missing row give the same answer.
 */
async function requireVersion(db: Db, userId: string, kind: RenderKind, id: string) {
  const [row] = await db
    .select({ version: renderVersions, renderKind: renders.kind })
    .from(renderVersions)
    .innerJoin(renders, eq(renders.id, renderVersions.renderId))
    .where(and(eq(renderVersions.userId, userId), eq(renderVersions.id, id)))
    .limit(1);
  if (!row || row.renderKind !== kind) throw notFound("That version");
  return row.version;
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
 * The staleness number, counted the one way `renders.stale_since_fact_count`
 * and `render_versions.fact_count_at` both mean it.
 */
async function acceptedFactCount(db: Db, userId: string): Promise<number> {
  const [{ accepted } = { accepted: 0 }] = await db
    .select({ accepted: sql<number>`count(*)::int` })
    .from(facts)
    .where(and(eq(facts.userId, userId), eq(facts.status, "accepted")));
  return accepted;
}

async function requireProposal(db: Db, userId: string, id: string) {
  const [row] = await db
    .select({ proposal: renderProposals, render: renders })
    .from(renderProposals)
    .innerJoin(renders, eq(renders.id, renderProposals.renderId))
    .where(and(eq(renderProposals.userId, userId), eq(renderProposals.id, id)))
    .limit(1);
  if (!row) throw notFound("That proposal");
  return row;
}

/** Re-exported for the overview, which reports the same state. */
export type { RenderState };
