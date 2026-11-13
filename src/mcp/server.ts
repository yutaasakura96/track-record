/**
 * Track Record as an MCP server — the spike (`docs/specs/mcp-spike.md`).
 *
 * The inversion: instead of this application calling a model, a model the
 * author already pays for (Claude Desktop, Claude Code, a claude.ai connector)
 * calls this. Thinking moves to the author's plan; the record, and every
 * invariant around it, stays here.
 *
 * - **Every query filters by `user_id`.** The server is built for ONE user, and
 *   that id is bound when the server is constructed, never taken from a tool
 *   argument.
 * - **A fact's quote must exist verbatim** in its source. `add_fact` runs the
 *   import pipeline's own anchor (`pipeline/quote.ts`), dedupe hash
 *   (`pipeline/dedupe.ts`) and grading floor (`pipeline/flags.ts`): a quote that
 *   fails is refused and nothing is stored, and the caller is held to the rules
 *   the importer is — never Public, the scrub a floor, Measured only with a
 *   passage (`docs/06`, 2026-10-08).
 * - **Generated and Private facts never reach a render.** `get_record` returns
 *   exactly what `collectRenderInputs` gives the model seam. `save_render`
 *   refuses a withheld citation, runs the generator's own post-model checks
 *   (`settleContent`) and lands as a proposal the author reads as a diff.
 * - **Nothing here logs content.** stdout is the protocol on stdio; the one log
 *   line goes to stderr and carries a tool name and nothing else.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "~/server/db/client";
import { factFlags, facts, sourceDocuments, sourceDocumentVersions } from "~/server/db/schema";
import { ApiError, notFound, violatesUnique } from "~/server/http/errors";
import { newId } from "~/server/http/ids";
import { anchorQuote } from "~/pipeline/quote";
import { dedupeHash } from "~/pipeline/dedupe";
import { sortFact } from "~/pipeline/flags";
import { collectRenderInputs, settleContent, tailoringOf } from "~/server/services/render";
import { resolveRender } from "~/server/services/render-ref";
import {
  openProposal,
  refuseUngeneratable,
  renderState,
  requireProfile,
  requireRenderable,
} from "~/server/services/render-state";
import {
  badCitations,
  citationMessage,
  collectEditableRecord,
  editWarnings,
} from "~/server/services/version-edit";
import { collectRirekishoRecord, hasProfilePhoto } from "~/server/services/rirekisho";
import { EditRejected, citedFactIds, parseEditedContent } from "~/render/edit";
import { rirekishoWarnings, tokyoToday } from "~/render/rirekisho";
import { isChapteredStory } from "~/render/chapters";
import { isStoryComplete, linesToShorten } from "~/model/generate";

/** A refusal Claude can read and act on. Ids and reasons, never record text. */
class Refused extends Error {}

const ok = (payload: unknown): CallToolResult => ({
  content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
});

const refused = (message: string): CallToolResult => ({
  content: [{ type: "text", text: message }],
  isError: true,
});

/**
 * Every handler runs through this. An `ApiError` or `Refused` is a message
 * written for the caller; anything else is not, and becomes a generic one.
 */
async function guarded(tool: string, run: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof Refused || err instanceof ApiError || err instanceof EditRejected) {
      return refused(err.message);
    }
    // The tool name only. Never the arguments, which carry claims and quotes.
    console.error(JSON.stringify({ event: "mcp_tool_failed", tool }));
    return refused(`${tool} failed. Nothing was changed.`);
  }
}

/**
 * A main document by its kind (`english_resume`, `rirekisho`, …) or a tailored
 * document by its id, exactly as the render routes address them
 * (`services/render-ref.ts`).
 */
const documentSchema = z
  .string()
  .default("english_resume")
  .describe("A document kind (english_resume, rirekisho, shokumu_keirekisho, career_story_en, career_story_ja) or a tailored document's id from get_record's `documents`.");

const blockSchema = z.object({
  id: z.string().optional(),
  kind: z.enum(["paragraph", "bullet", "row"]),
  text: z.string(),
  factIds: z.array(z.string()).default([]),
});

const contentSchema = z.object({
  sections: z.array(
    z.object({ key: z.string(), heading: z.string(), blocks: z.array(blockSchema) }),
  ),
});

export function createTrackRecordServer(db: Db, userId: string): McpServer {
  const server = new McpServer({ name: "track-record", version: "0.2.0" });

  /** The facts and spec the generator would be sent for this document, held to its budget. */
  const inputsFor = async (document: string) => {
    const target = await resolveRender(db, userId, document);
    const profile = await requireProfile(db, userId, target.kind);
    const tailoring = target.render ? await tailoringOf(db, userId, target.render) : null;
    const inputs = await collectRenderInputs(db, userId, target.kind, profile.nameLatin, tailoring, { forModel: true });
    return { target, inputs, tailoring };
  };

  server.registerTool(
    "get_record",
    {
      title: "Get the career record",
      description:
        "The author's render-eligible record for one document: accepted facts that are neither " +
        "Private nor Generated-provenance, the employers, roles, projects, education and certifications " +
        "that document draws on, the register (style instruction) it is written in and, for a tailored " +
        "document, the posting it is written toward. This is exactly the input Track Record's own " +
        "generator receives. Cite facts by their `id` in save_render. `documents` lists every document, " +
        "main and tailored, with the ref to pass back.",
      inputSchema: { document: documentSchema },
    },
    ({ document }) =>
      guarded("get_record", async () => {
        const { target, inputs } = await inputsFor(document);
        const state = await renderState(db, userId);
        return ok({
          document: target.ref,
          kind: target.kind,
          title: target.title,
          spec: inputs.spec,
          facts: inputs.facts,
          withheld: {
            private: inputs.privateFactCount,
            generated: inputs.generatedFactCount,
            overBudget: inputs.omittedFactCount,
          },
          documents: [...state.documents, ...state.tailored].map((d) => ({
            ref: d.ref,
            kind: d.kind,
            title: d.title,
            status: d.status,
            currentVersionNo: d.currentVersionNo,
          })),
        });
      }),
  );

  server.registerTool(
    "list_sources",
    {
      title: "List source documents",
      description:
        "The author's uploaded source documents, with the id add_fact takes. Read one with get_source.",
      inputSchema: {},
    },
    () =>
      guarded("list_sources", async () => {
        const rows = await db
          .select({ id: sourceDocuments.id, filename: sourceDocuments.filename })
          .from(sourceDocuments)
          .where(eq(sourceDocuments.userId, userId))
          .orderBy(desc(sourceDocuments.createdAt));
        return ok({ items: rows });
      }),
  );

  server.registerTool(
    "get_source",
    {
      title: "Read a source document",
      description:
        "The extracted text of a source document's latest version. A fact's quote must be copied " +
        "from this text character for character.",
      inputSchema: { source_document_id: z.string() },
    },
    ({ source_document_id }) =>
      guarded("get_source", async () => {
        const version = await latestVersion(db, userId, source_document_id);
        return ok({
          sourceDocumentId: source_document_id,
          versionNo: version.versionNo,
          text: version.extractedText,
        });
      }),
  );

  server.registerTool(
    "add_fact",
    {
      title: "Add a fact",
      description:
        "Adds a fact backed by a verbatim quote from a source document, the way Track Record's importer " +
        "does. The quote is checked by exact string match against the source text (no normalisation of " +
        "any kind); a quote that is not found is refused and nothing is stored, and so is a fact repeating " +
        "one already in the record. Grade it as the importer would: `measured` only when the quote states " +
        "it, `attested` when the author's word is the evidence, `generated` when the passage does not " +
        "state it. Mark `confidential` anything naming a client, a person or an internal system. The fact " +
        "is accepted with that grade, never Public, kept Private when confidential or when its text has a " +
        "confidential shape, and flagged for the author where it is worth a look.",
      inputSchema: {
        claim: z.string(),
        quote: z.string(),
        source_document_id: z.string(),
        technologies: z.array(z.string()).default([]),
        grade: z
          .object({
            provenance: z.enum(["measured", "attested", "generated"]),
            confidential: z.boolean().default(false),
            unsure: z.boolean().default(false),
            note: z.string().default(""),
          })
          .optional(),
      },
    },
    ({ claim, quote, source_document_id, technologies, grade }) =>
      guarded("add_fact", async () => {
        const version = await latestVersion(db, userId, source_document_id);
        const anchor = anchorQuote(version.extractedText, quote);
        if (!anchor) {
          throw new Refused(
            "That quote does not appear verbatim in the source document. Nothing was stored. " +
              "Copy the passage exactly from get_source, including punctuation and spacing.",
          );
        }
        const trimmed = claim.trim();
        if (trimmed === "") throw new Refused("A claim cannot be empty. Nothing was stored.");

        const hash = await dedupeHash(anchor.quote, trimmed);
        const [existing] = await db
          .select({ id: facts.id })
          .from(facts)
          .where(and(eq(facts.userId, userId), eq(facts.dedupeHash, hash)))
          .limit(1);
        if (existing) {
          throw new Refused(`That fact is already in the record as ${existing.id}. Nothing was stored.`);
        }

        // The importer's floor, applied to this caller as to the importer.
        const sorted = sortFact({ claim: trimmed, quote: anchor.quote, technologies }, grade ?? null);
        const id = newId("fact");
        const now = new Date();
        try {
          await db.batch([
            db.insert(facts).values({
              id,
              userId,
              projectId: version.projectId,
              claim: trimmed,
              provenance: sorted.provenance,
              disclosure: sorted.disclosure,
              status: "accepted",
              autoAcceptedAt: now,
              resolvedAt: now,
              sourceDocumentVersionId: version.id,
              quote: anchor.quote,
              quoteStart: anchor.quoteStart,
              quoteEnd: anchor.quoteEnd,
              lineNumber: anchor.lineNumber,
              dedupeHash: hash,
              technologies,
              isClientIdentifying: sorted.isClientIdentifying,
            }),
            ...(sorted.flags.length > 0
              ? [
                  db.insert(factFlags).values(
                    sorted.flags.map((flag) => ({
                      id: newId("factFlag"),
                      userId,
                      factId: id,
                      kind: flag.kind,
                      reason: flag.reason,
                    })),
                  ),
                ]
              : []),
          ]);
        } catch (err) {
          if (!violatesUnique(err, "facts_user_dedupe_uq")) throw err;
          throw new Refused("That fact is already in the record. Nothing was stored.");
        }

        return ok({
          id,
          status: "accepted",
          provenance: sorted.provenance,
          disclosure: sorted.disclosure,
          flags: sorted.flags.map((flag) => flag.kind),
          lineNumber: anchor.lineNumber,
        });
      }),
  );

  server.registerTool(
    "save_render",
    {
      title: "Save a document",
      description:
        "Stores a document as a proposal. Content is sections of blocks; each block is a paragraph, " +
        "bullet or row with its text and the ids of the facts (from get_record) it was written from. " +
        "Citing a fact that is Private, Generated, not accepted, unknown, or not given for this document " +
        "is refused. The document is then held to the same checks Track Record's generator is (language, " +
        "record names, résumé line lengths, a complete career story). The author reviews the diff and " +
        "accepts or dismisses it as a whole in Track Record; nothing becomes a version until they do.",
      inputSchema: { document: documentSchema, content: contentSchema },
    },
    ({ document, content }) =>
      guarded("save_render", async () => {
        const target = await resolveRender(db, userId, document);
        await requireRenderable(db, userId, target);
        const { inputs, tailoring } = await inputsFor(document);
        await refuseUngeneratable(db, userId, target.kind, inputs);

        // Shape, and fresh block ids: there is no previous version a model may
        // claim history from.
        const parsed = parseEditedContent(content, { sections: [] });

        const record = await collectEditableRecord(db, userId);
        const cited = citedFactIds(parsed);
        const bad = badCitations(cited, record);
        if (bad.length > 0) throw new Refused(`${citationMessage(bad)} Nothing was stored.`);

        // Accepted and disclosable is not enough: a fact this document was not
        // given — an excluded entry's (S13), or one over the budget — is not
        // one it may cite. The generator strips these; a caller is told.
        const allowed = new Set(inputs.facts.map((f) => f.id));
        const excluded = cited.filter((id) => !allowed.has(id));
        if (excluded.length > 0) {
          throw new Refused(`${excluded[0]} was not given for ${target.title}. Cite facts from get_record. Nothing was stored.`);
        }

        // The checks the generator answers by writing again, stated instead.
        if (target.kind === "english_resume") {
          const long = linesToShorten(parsed, inputs.facts).length;
          if (long > 0) {
            throw new Refused(`${long} line${long === 1 ? " is" : "s are"} over the résumé's length bounds. Shorten and save again. Nothing was stored.`);
          }
        }
        if (isChapteredStory(target.kind) && !isStoryComplete(parsed, inputs.spec)) {
          throw new Refused("The story is missing a chapter its record plans. Write every chapter and save again. Nothing was stored.");
        }

        const settled = settleContent(parsed, inputs, tokyoToday());
        if (!settled.ok) throw new Refused(`${settled.reason} Nothing was stored.`);

        const proposalId = await openProposal(db, userId, target, {
          content: settled.content,
          generationStatus: "ready",
          usableFactIds: inputs.usableFactIds,
        });

        const warnings = [
          ...editWarnings(settled.content, record.record),
          ...(target.kind === "rirekisho"
            ? rirekishoWarnings(await collectRirekishoRecord(db, userId), {
                hasPhoto: await hasProfilePhoto(db, userId),
                tailored: tailoring ? { motivationNote: tailoring.application?.motivationNote ?? null } : null,
              })
            : []),
        ];
        return ok({
          proposalId,
          document: target.ref,
          status: "proposal_pending",
          warnings,
          next: "The author reviews the diff and accepts or dismisses it in Track Record.",
        });
      }),
  );

  return server;
}

async function latestVersion(db: Db, userId: string, sourceDocumentId: string) {
  const [row] = await db
    .select({
      id: sourceDocumentVersions.id,
      versionNo: sourceDocumentVersions.versionNo,
      extractedText: sourceDocumentVersions.extractedText,
      projectId: sourceDocuments.projectId,
    })
    .from(sourceDocumentVersions)
    .innerJoin(
      sourceDocuments,
      and(
        eq(sourceDocuments.id, sourceDocumentVersions.sourceDocumentId),
        eq(sourceDocuments.userId, sourceDocumentVersions.userId),
      ),
    )
    .where(
      and(
        eq(sourceDocumentVersions.userId, userId),
        eq(sourceDocumentVersions.sourceDocumentId, sourceDocumentId),
      ),
    )
    .orderBy(desc(sourceDocumentVersions.versionNo))
    .limit(1);
  if (!row) throw notFound("That source document");
  return row;
}
