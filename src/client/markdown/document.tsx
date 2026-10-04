/**
 * A source document, rendered (`docs/10` Screen 1, `docs/05` §2).
 *
 * One element per node type over the parser's tree, with each fact's mark laid
 * over whatever rendered text its quote's characters became.
 *
 * **It loads nothing and runs nothing.** A link is shown and not followed, an
 * image is its alt text, and raw HTML is the text it is. A source document
 * holds internal addresses by design, and a reading pane that fetches an image
 * from one tells a third party it was read.
 */
import { memo, type ReactNode } from "react";
import type { Nodes, Root, RootContent } from "mdast";
import { headingId, span } from "./parse";
import { clip, pieces, type MarkRange } from "./ranges";

interface Context {
  source: string;
  ranges: MarkRange[];
  onMark?: (id: string) => void;
}

/**
 * A portfolio is hundreds of blocks and every decision refetches the facts.
 * Each top-level block is memoised on the marks that touch it, so accepting
 * one fact re-renders the block it is quoted from and not the document.
 */
export function MarkdownDocument({
  tree,
  source,
  ranges,
  onMark,
  className = "",
}: {
  tree: Root;
  source: string;
  /** Sorted and not overlapping: `resolveRanges`. */
  ranges: MarkRange[];
  onMark?: (id: string) => void;
  className?: string;
}) {
  let first = 0;
  return (
    <article className={`md-doc ${className}`}>
      {tree.children.map((block, index) => {
        const at = span(block);
        if (!at) return <Block key={index} node={block} source={source} ranges={NONE} markKey="" onMark={onMark} />;
        // Both lists are in document order, so one pass finds each block's marks.
        while (first < ranges.length && ranges[first]!.end <= at.start) first += 1;
        let last = first;
        while (last < ranges.length && ranges[last]!.start < at.end) last += 1;
        const own = last > first ? ranges.slice(first, last) : NONE;
        return (
          <Block
            key={at.start}
            node={block}
            source={source}
            ranges={own}
            markKey={own.map((r) => `${r.id}:${r.start}:${r.end}:${r.className}`).join("|")}
            onMark={onMark}
          />
        );
      })}
    </article>
  );
}

const NONE: MarkRange[] = [];

const Block = memo(
  function Block({
    node,
    source,
    ranges,
    onMark,
  }: {
    node: RootContent;
    source: string;
    ranges: MarkRange[];
    /** What `ranges` says, as a string: the array is rebuilt on every render and this is not. */
    markKey: string;
    onMark?: (id: string) => void;
  }) {
    return <>{render(node, { source, ranges, onMark }, 0)}</>;
  },
  (before, after) =>
    before.node === after.node &&
    before.markKey === after.markKey &&
    before.source === after.source &&
    before.onMark === after.onMark,
);

function children(node: { children: Nodes[] }, context: Context): ReactNode {
  return node.children.map((child, index) => render(child, context, index));
}

/** A node's text, with a `<mark>` over each run that a quote covers. */
function text(value: string, node: Nodes, context: Context, from?: number): ReactNode {
  const at = span(node);
  if (!at) return value;
  return pieces(value, context.source, from ?? at.start, at.end, context.ranges).map((piece, index) =>
    piece.range ? (
      <mark
        key={index}
        data-fact={piece.range.id}
        className={`mark-base ${piece.range.className}`}
        onClick={() => context.onMark?.(piece.range!.id)}
      >
        {piece.text}
      </mark>
    ) : (
      piece.text
    ),
  );
}

/**
 * Where a code block's text starts in the source. A fenced block opens with a
 * line of its own (the fence and its language), and that line is markup.
 */
function codeStart(node: Nodes, source: string): number | undefined {
  const at = span(node);
  if (!at) return undefined;
  const opening = source.slice(at.start, at.end).match(/^\s*(?:`{3,}|~{3,})[^\n]*\n/);
  return opening ? at.start + opening[0].length : at.start;
}

const HEADINGS = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;

function render(node: Nodes, context: Context, key: number): ReactNode {
  switch (node.type) {
    case "heading": {
      const Tag = HEADINGS[node.depth - 1] ?? "h6";
      return (
        <Tag key={key} data-heading={headingId(node)}>
          {children(node, context)}
        </Tag>
      );
    }
    case "paragraph":
      return <p key={key}>{children(node, context)}</p>;
    case "text":
      return <span key={key}>{text(node.value, node, context)}</span>;
    case "strong":
      return <strong key={key}>{children(node, context)}</strong>;
    case "emphasis":
      return <em key={key}>{children(node, context)}</em>;
    case "delete":
      return <del key={key}>{children(node, context)}</del>;
    case "inlineCode":
      return <code key={key}>{text(node.value, node, context)}</code>;
    case "break":
      return <br key={key} />;
    case "link":
      // Shown, not followed. The address is on hover for a reader who wants it.
      return (
        <span key={key} className="md-link" title={node.url}>
          {children(node, context)}
        </span>
      );
    case "linkReference":
      return (
        <span key={key} className="md-link">
          {children(node, context)}
        </span>
      );
    case "image":
    case "imageReference":
      // Never fetched. The alt text is what the document says is there.
      return (
        <span key={key} className="md-image">
          [image{node.alt ? `: ${node.alt}` : ""}]
        </span>
      );
    case "list": {
      const Tag = node.ordered ? "ol" : "ul";
      return (
        <Tag key={key} start={node.ordered ? (node.start ?? undefined) : undefined}>
          {children(node, context)}
        </Tag>
      );
    }
    case "listItem":
      return (
        <li key={key} className={node.checked === null || node.checked === undefined ? undefined : "md-task"}>
          {node.checked === null || node.checked === undefined ? null : (
            <span className="md-check" aria-label={node.checked ? "Done" : "Not done"}>
              {node.checked ? "[x]" : "[ ]"}
            </span>
          )}
          {children(node, context)}
        </li>
      );
    case "blockquote":
      return <blockquote key={key}>{children(node, context)}</blockquote>;
    case "code":
      return (
        <pre key={key}>
          <code>{text(node.value, node, context, codeStart(node, context.source))}</code>
        </pre>
      );
    case "thematicBreak":
      return <hr key={key} />;
    case "table": {
      const [head, ...body] = node.children;
      const row = (cells: typeof node.children[number], header: boolean, rowKey: number) => (
        <tr key={rowKey}>
          {cells.children.map((cell, index) => {
            const Cell = header ? "th" : "td";
            return (
              <Cell key={index} style={{ textAlign: node.align?.[index] ?? undefined }}>
                {children(cell, context)}
              </Cell>
            );
          })}
        </tr>
      );
      return (
        // A wide table scrolls inside the measure rather than widening the page.
        <div key={key} className="md-table">
          <table>
            {head ? <thead>{row(head, true, 0)}</thead> : null}
            <tbody>{body.map((cells, index) => row(cells, false, index))}</tbody>
          </table>
        </div>
      );
    }
    case "html":
      // Text, never markup: nothing in a source document is interpreted.
      return <span key={key}>{text(node.value, node, context)}</span>;
    case "footnoteReference":
      return <sup key={key}>[{node.label ?? node.identifier}]</sup>;
    case "footnoteDefinition":
      return (
        <div key={key} className="md-footnote">
          <sup>[{node.label ?? node.identifier}]</sup>
          {children(node, context)}
        </div>
      );
    case "definition":
    case "yaml":
      // A link's address written out of line. Markup, not text.
      return null;
    default:
      return "children" in node ? <span key={key}>{children(node as { children: Nodes[] }, context)}</span> : null;
  }
}

/* ------------------------------------------------------------------ excerpt */

/** Node types whose children are blocks, each on its own line in an excerpt. */
const STACKS = new Set(["root", "list", "listItem", "blockquote", "table", "footnoteDefinition"]);

/**
 * One quoted passage, rendered: the fact card's view of its evidence (`docs/10`
 * Screen 1, "The quoted passage on the card").
 *
 * The passage is cut out of the document's own tree rather than parsed again
 * on its own, because a fragment does not parse as what it was a part of: one
 * row of a table is, alone, a line of text with pipes in it. Block structure is
 * flattened — a line break between blocks, ` · ` between the cells of a row —
 * and inline formatting is kept. `null` when the passage is markup and nothing
 * else, so the caller can show the stored characters instead.
 */
export function quoteExcerpt(tree: Root, source: string, start: number, end: number): ReactNode | null {
  const cut = excerpt(tree, { source, start, end }, 0);
  return cut === null ? null : <span className="md-quote">{cut}</span>;
}

function excerpt(node: Nodes, range: { source: string; start: number; end: number }, key: number): ReactNode {
  const at = span(node);
  if (at && (at.end <= range.start || at.start >= range.end)) return null;

  if ("value" in node) {
    if (!at || node.type === "yaml") return null;
    const from = node.type === "code" ? (codeStart(node, range.source) ?? at.start) : at.start;
    const value = clip(node.value, range.source, from, at.end, range.start, range.end);
    if (value === "") return null;
    return node.type === "inlineCode" || node.type === "code" ? <code key={key}>{value}</code> : value;
  }
  if (node.type === "break") return " ";
  if (!("children" in node)) return null;

  const parts = (node.children as Nodes[])
    .map((child, index) => excerpt(child, range, index))
    .filter((part) => part !== null);
  if (parts.length === 0) return null;

  const separator = node.type === "tableRow" ? " · " : STACKS.has(node.type) ? <br /> : null;
  const joined = parts.flatMap((part, index) =>
    index === 0 || separator === null
      ? [<span key={index}>{part}</span>]
      : [<span key={`s${index}`}>{separator}</span>, <span key={index}>{part}</span>],
  );

  if (node.type === "strong" || node.type === "heading") return <strong key={key}>{joined}</strong>;
  if (node.type === "emphasis") return <em key={key}>{joined}</em>;
  if (node.type === "delete") return <del key={key}>{joined}</del>;
  if (node.type === "link" || node.type === "linkReference") {
    return (
      <span key={key} className="md-link">
        {joined}
      </span>
    );
  }
  return <span key={key}>{joined}</span>;
}
