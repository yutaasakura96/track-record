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
import { ApiError, notFound, preconditionFailed, pathParam } from "../http/errors";
import { routes } from "../http/registry";
import { newId } from "../http/ids";
import { collectRenderInputs, generateIntoProposal } from "../services/render";
import {
  currentContent,
  proposalResponse,
  rationaleFor,
  regenerationReason,
} from "../services/proposal";
import { diffRenders } from "~/diff";
import { RENDER_DEFINITIONS } from "~/render/spec";
import { toMarkdown } from "~/render/markdown";
import { DOCX_MIME, downloadFilename, toDocx } from "~/render/docx";
import type { RenderIdentity } from "~/render/identity";
import {
  RENDER_KINDS,
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

    return c.json({ proposalId, renderKind: kind, status: "generating" }, 202);
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

    // Only the English résumé is buildable in M1, so only English content can
    // reach this. Japanese diffing arrives with the first Japanese render.
    const diff = diffRenders(current, proposed, { language: "en", explain });
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

    const [{ highest } = { highest: 0 }] = await db
      .select({ highest: sql<number>`coalesce(max(${renderVersions.versionNo}), 0)::int` })
      .from(renderVersions)
      .where(and(eq(renderVersions.userId, user.id), eq(renderVersions.renderId, render.id)));

    const versionId = newId("renderVersion");
    const acceptedAt = new Date();
    const [{ accepted } = { accepted: 0 }] = await db
      .select({ accepted: sql<number>`count(*)::int` })
      .from(facts)
      .where(and(eq(facts.userId, user.id), eq(facts.status, "accepted")));

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
    const title = RENDER_TITLE[kind];
    const filename = downloadFilename(kind, format, version.acceptedAt);
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
