/**
 * A source document's Markdown, as a syntax tree (`docs/06`, 2026-10-05).
 *
 * A tree rather than HTML because of one property: every node carries the
 * offsets of the source it came from. A fact's quote is a pair of offsets into
 * the stored text, and placing its mark in a rendered document means knowing
 * which rendered text those characters became. `ranges.ts` does that projection.
 *
 * Client-side only. Nothing here verifies a quote; that is exact, against the
 * stored text, at import (`src/pipeline/quote.ts`).
 */
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfm } from "micromark-extension-gfm";
import { gfmFromMarkdown } from "mdast-util-gfm";
import type { Heading, Nodes, Root } from "mdast";

/**
 * The filename decides, as it decides the extractor. A `.txt` file put through
 * a Markdown parser has its lines joined into paragraphs and its indented lines
 * turned into code, so plain text is never rendered.
 */
export const isMarkdownFile = (filename: string) => /\.(md|markdown)$/i.test(filename);

/** `null` when the text cannot be parsed. The caller falls back to the stored text. */
export function parseMarkdown(text: string): Root | null {
  try {
    return fromMarkdown(text, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  } catch {
    return null;
  }
}

/** A node's source range, or `null` for a node the parser gave no position. */
export function span(node: Nodes): { start: number; end: number } | null {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return start === undefined || end === undefined ? null : { start, end };
}

/** The text a reader sees for a node: its own value, an image's alt, or its children's. */
export function plainText(node: Nodes): string {
  if ("value" in node) return node.value;
  if (node.type === "image" || node.type === "imageReference") return node.alt ?? "";
  if ("children" in node) return (node.children as Nodes[]).map(plainText).join("");
  return "";
}

/** The level of heading the contents column lists down to (`docs/10` Screen 1). */
const CONTENTS_DEPTH = 3;

export interface ContentsEntry {
  id: string;
  depth: number;
  text: string;
}

/** One id per heading, from its source offset, which no two headings share. */
export const headingId = (node: Heading) => `h${node.position?.start.offset ?? 0}`;

/**
 * The contents of a rendered document: its headings of level 1 to 3, in order.
 * Top-level headings only. A heading inside a list item or a quotation is part
 * of that block, not a section of the document.
 */
export function contents(tree: Root): ContentsEntry[] {
  return tree.children
    .filter((node): node is Heading => node.type === "heading" && node.depth <= CONTENTS_DEPTH)
    .map((node) => ({ id: headingId(node), depth: node.depth, text: plainText(node).trim() }))
    .filter((entry) => entry.text !== "");
}
