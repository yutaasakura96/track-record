/**
 * The shape half of a hand edit (`docs/02` S16, `docs/06` 2026-09-11).
 *
 * A version is edited by sending the WHOLE document back, not a patch: both
 * real edits against a stored version were structural — one inserted a bullet,
 * one deleted a paragraph — and a text-only patch would have served neither.
 * The version row stores whole content regardless, so the payload matches what
 * is written.
 *
 * Block ids are the reason this is not just a JSON parse. The diff addresses
 * blocks by id (`src/shared/render-content.ts`), so an edit that renumbered
 * every block would make the next proposal read as a total rewrite. An id the
 * previous version carried is therefore KEPT — a reworded bullet is the same
 * bullet — and anything else is minted here, above every id the document
 * already uses. The client does not choose ids, the same rule generation
 * follows.
 *
 * Everything about FACTS lives in the route, because it needs the record.
 * This module is a pure function of the payload and the previous version.
 */
import type { Block, BlockKind, RenderContent, RenderSection } from "~/shared/render-content";

const KINDS = new Set<BlockKind>(["paragraph", "bullet", "row"]);

/**
 * A payload that cannot become a version. Thrown rather than returned so the
 * caller cannot forget to look: the route maps it to `422`, except
 * `unchanged`, which is a `409` because nothing is wrong with it.
 */
export class EditRejected extends Error {
  constructor(
    readonly problem: "shape" | "empty" | "duplicate-block-id" | "unchanged",
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "EditRejected";
  }
}

/** Every block in a document, in reading order. */
export function allBlocks(content: RenderContent): Block[] {
  return content.sections.flatMap((section) => section.blocks);
}

/** The ids a version carries — what an edit is allowed to keep. */
export function blockIds(content: RenderContent): Set<string> {
  return new Set(allBlocks(content).map((block) => block.id));
}

/** Distinct fact ids cited anywhere in a document, in first-citation order. */
export function citedFactIds(content: RenderContent): string[] {
  const seen = new Set<string>();
  for (const block of allBlocks(content)) {
    for (const factId of block.factIds) seen.add(factId);
  }
  return [...seen];
}

/**
 * Ids look like `blk_12`. Minting above the highest number already in use — in
 * the previous version AND in the payload — is what keeps a new block from
 * landing on the id of one the author deleted in the same edit, which would
 * make the next diff report a change to a block that no longer exists.
 */
function mintFrom(ids: Iterable<string>): () => string {
  let highest = 0;
  for (const id of ids) {
    const match = /^blk_(\d+)$/.exec(id);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return () => `blk_${++highest}`;
}

/**
 * Validate an edited document and settle its block ids.
 *
 * `previous` is the version being edited. An id it carries is kept; an id it
 * does not — missing, unrecognised, or invented by a client — is replaced with
 * a fresh one, because an id is a handle on a block's history and a client
 * cannot mint history.
 */
export function parseEditedContent(input: unknown, previous: RenderContent): RenderContent {
  if (typeof input !== "object" || input === null) {
    throw new EditRejected("shape", "That edit is not a document.");
  }
  const { sections } = input as { sections?: unknown };
  if (!Array.isArray(sections)) {
    throw new EditRejected("shape", "That edit has no sections.");
  }

  const known = blockIds(previous);
  const claimed = new Set<string>();
  const payloadIds = sections.flatMap((raw) =>
    typeof raw === "object" && raw !== null && Array.isArray((raw as { blocks?: unknown }).blocks)
      ? (raw as { blocks: unknown[] }).blocks.flatMap((b) =>
          typeof b === "object" && b !== null && typeof (b as { id?: unknown }).id === "string"
            ? [(b as { id: string }).id]
            : [],
        )
      : [],
  );
  const mint = mintFrom([...known, ...payloadIds]);

  const parsed: RenderSection[] = sections.map((raw, index) => {
    if (typeof raw !== "object" || raw === null) {
      throw new EditRejected("shape", `Section ${index + 1} is not a section.`);
    }
    const { key, heading, blocks } = raw as Record<string, unknown>;
    if (typeof key !== "string" || key.trim() === "") {
      throw new EditRejected("shape", `Section ${index + 1} has no key.`);
    }
    if (typeof heading !== "string") {
      throw new EditRejected("shape", `Section ${key} has no heading.`);
    }
    if (!Array.isArray(blocks)) {
      throw new EditRejected("shape", `Section ${key} has no blocks.`);
    }

    return {
      key,
      heading: heading.trim(),
      blocks: blocks.map((b) => parseBlock(b, key, known, claimed, mint)),
    };
  });

  if (parsed.every((section) => section.blocks.length === 0)) {
    throw new EditRejected("empty", "An edit cannot empty the document.");
  }
  return { sections: parsed };
}

function parseBlock(
  input: unknown,
  sectionKey: string,
  known: ReadonlySet<string>,
  claimed: Set<string>,
  mint: () => string,
): Block {
  if (typeof input !== "object" || input === null) {
    throw new EditRejected("shape", `Section ${sectionKey} has a block that is not a block.`);
  }
  const { id, kind, text, factIds } = input as Record<string, unknown>;

  if (typeof text !== "string" || text.trim() === "") {
    throw new EditRejected("shape", `Section ${sectionKey} has a block with no text.`);
  }
  if (!KINDS.has(kind as BlockKind)) {
    throw new EditRejected("shape", `Section ${sectionKey} has a block of an unknown kind.`);
  }
  if (
    factIds !== undefined &&
    (!Array.isArray(factIds) || factIds.some((f) => typeof f !== "string"))
  ) {
    throw new EditRejected("shape", `Section ${sectionKey} has a block with unreadable factIds.`);
  }

  // Two blocks claiming one previous id is corruption rather than an edit:
  // whichever the diff matched, it would report the other as new and this one
  // as changed. A client cannot recover from it, so it is refused rather than
  // repaired.
  const keeps = typeof id === "string" && known.has(id);
  if (keeps && claimed.has(id as string)) {
    throw new EditRejected("duplicate-block-id", "Two blocks claim the same id.", { blockId: id });
  }
  const blockId = keeps ? (id as string) : mint();
  if (keeps) claimed.add(blockId);

  return {
    id: blockId,
    kind: kind as BlockKind,
    text: text.trim(),
    // Empty stays legal: headings, fixed scaffolding and rows copied from an
    // entity table carry no fact by construction.
    factIds: Array.isArray(factIds) ? (factIds as string[]) : [],
  };
}

/**
 * Whether an edit changed anything a reader could see.
 *
 * Compared on the fields a version is made of — not on the object, which
 * carries key order the author did not choose. A version identical to its
 * predecessor is noise in a history that can never be cleaned up.
 */
export function sameContent(a: RenderContent, b: RenderContent): boolean {
  return canonical(a) === canonical(b);
}

function canonical(content: RenderContent): string {
  return JSON.stringify(
    content.sections.map((section) => [
      section.key,
      section.heading,
      section.blocks.map((block) => [block.id, block.kind, block.text, block.factIds]),
    ]),
  );
}
