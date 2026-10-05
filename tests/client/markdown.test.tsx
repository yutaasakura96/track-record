/**
 * The rendered source document (`src/client/markdown/`, `docs/10` Screen 1).
 *
 * What is checked here is the projection: a fact's quote is a pair of offsets
 * into the stored text, and a mark must land on the rendered text those
 * characters became. The cases are the ones where the two differ. All fixtures
 * are invented.
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { MarkdownDocument, quoteExcerpt } from "~/client/markdown/document";
import { contents, isMarkdownFile, parseMarkdown } from "~/client/markdown/parse";
import { alignOffsets, pieces, resolveRanges, type MarkRange } from "~/client/markdown/ranges";

const range = (source: string, quote: string, id = "f-1"): MarkRange => {
  const start = source.indexOf(quote);
  if (start < 0) throw new Error(`Fixture quote not in the source: ${quote}`);
  return { id, start, end: start + quote.length, className: "mark-normal" };
};

function show(source: string, ranges: MarkRange[] = []) {
  const tree = parseMarkdown(source)!;
  const { container } = render(<MarkdownDocument tree={tree} source={source} ranges={resolveRanges(ranges)} />);
  const marks = () => [...container.querySelectorAll<HTMLElement>("mark")].map((m) => [m.dataset.fact, m.textContent]);
  return { container, marks };
}

describe("which documents are rendered", () => {
  it("renders Markdown and leaves plain text as stored", () => {
    expect(isMarkdownFile("portfolio.md")).toBe(true);
    expect(isMarkdownFile("PORTFOLIO.MARKDOWN")).toBe(true);
    expect(isMarkdownFile("notes.txt")).toBe(false);
    expect(isMarkdownFile("notes.md.txt")).toBe(false);
  });
});

describe("aligning displayed text to the stored text", () => {
  it("maps each character to itself when nothing was rewritten", () => {
    expect(alignOffsets("abc", "xxabcxx", 2, 5)).toEqual([2, 3, 4]);
  });

  it("steps over the backslash of an escape", () => {
    // Stored `a \* b`, displayed `a * b`.
    expect(alignOffsets("a * b", "a \\* b", 0, 6)).toEqual([0, 1, 3, 4, 5]);
  });

  it("counts an entity as the one character it displays as", () => {
    // Stored `R&amp;D team`, displayed `R&D team`.
    expect(alignOffsets("R&D team", "R&amp;D team", 0, 12)).toEqual([0, 1, 6, 7, 8, 9, 10, 11]);
  });

  it("steps over the indent a list strips from a continuation line", () => {
    const source = "- one\n  two";
    // The paragraph's text is `one\ntwo`, read from offset 2.
    expect(alignOffsets("one\ntwo", source, 2, source.length)).toEqual([2, 3, 4, 5, 8, 9, 10]);
  });

  it("holds its place for a character the source does not contain, rather than running ahead", () => {
    const map = alignOffsets("a?b", "a".padEnd(40, "-") + "b", 0, 41);
    expect(map[0]).toBe(0);
    expect(map[1]).toBe(1);
  });
});

describe("splitting a node's text into marked runs", () => {
  it("returns the text whole when no quote touches it", () => {
    expect(pieces("plain", "plain", 0, 5, [])).toEqual([{ text: "plain", range: null }]);
  });

  it("marks only the characters inside the quote", () => {
    const source = "Cut the batch to 9 minutes.";
    const quote = range(source, "to 9 minutes");
    expect(pieces(source, source, 0, source.length, [quote]).map((p) => [p.text, p.range?.id ?? null])).toEqual([
      ["Cut the batch ", null],
      ["to 9 minutes", "f-1"],
      [".", null],
    ]);
  });

  it("keeps the first of two overlapping quotes, as the stored-text view does", () => {
    const first = { id: "a", start: 0, end: 10, className: "" };
    const inner = { id: "b", start: 5, end: 12, className: "" };
    const later = { id: "c", start: 12, end: 14, className: "" };
    expect(resolveRanges([later, inner, first]).map((r) => r.id)).toEqual(["a", "c"]);
  });
});

describe("marks in a rendered document", () => {
  it("covers a quote that crosses emphasis, and leaves the markup out", () => {
    const source = "Cut the batch from **40 minutes** to *9 minutes* overall.";
    const { marks, container } = show(source, [range(source, "from **40 minutes** to *9 minutes*")]);

    expect(marks()).toEqual([
      ["f-1", "from "],
      ["f-1", "40 minutes"],
      ["f-1", " to "],
      ["f-1", "9 minutes"],
    ]);
    expect(container.textContent).toBe("Cut the batch from 40 minutes to 9 minutes overall.");
  });

  it("covers a quote that runs across two list items", () => {
    const source = "- Ran the weekly review\n- Mentored two engineers\n- Wrote the runbook";
    const { marks } = show(source, [range(source, "weekly review\n- Mentored two")]);

    expect(marks()).toEqual([
      ["f-1", "weekly review"],
      ["f-1", "Mentored two"],
    ]);
  });

  it("covers a quote inside a wrapped list item, past the stripped indent", () => {
    const source = "- Ran the weekly\n  plinth review with four teams";
    const { marks } = show(source, [range(source, "plinth review")]);

    expect(marks()).toEqual([["f-1", "plinth review"]]);
  });

  it("covers a quote after an escape and an entity at the right characters", () => {
    const source = "Led R&amp;D for the 5\\* team and cut cost by 30%.";
    const { marks, container } = show(source, [range(source, "cut cost by 30%")]);

    expect(container.textContent).toBe("Led R&D for the 5* team and cut cost by 30%.");
    expect(marks()).toEqual([["f-1", "cut cost by 30%"]]);
  });

  it("covers a quote inside a fenced code block, not its fence", () => {
    const source = "```latex\nlet total = 40\n```";
    const { marks } = show(source, [range(source, "let total")]);

    expect(marks()).toEqual([["f-1", "let total"]]);
  });

  it("keeps two facts' marks apart in one paragraph", () => {
    const source = "Cut the batch to 9 minutes and ran the weekly review.";
    const { marks } = show(source, [range(source, "9 minutes", "f-a"), range(source, "weekly review", "f-b")]);

    expect(marks()).toEqual([
      ["f-a", "9 minutes"],
      ["f-b", "weekly review"],
    ]);
  });

  it("draws no mark for a quote that is markup and nothing else", () => {
    const source = "| A | B |\n|---|---|\n| 1 | 2 |";
    const { marks } = show(source, [range(source, "|---|---|")]);

    expect(marks()).toEqual([]);
  });
});

describe("what a rendered document will not do", () => {
  it("shows a link without following it, an image as its alt text, and HTML as text", () => {
    const source = [
      "See [the runbook](https://intranet.example.invalid/runbook) first.",
      "",
      "![rack diagram](https://intranet.example.invalid/rack.png)",
      "",
      "<script>alert(1)</script>",
      "",
      'Inline <img src="https://intranet.example.invalid/pixel.gif"> too.',
    ].join("\n");
    const { container } = show(source);

    // Nothing is fetched and nothing navigates: a source document holds
    // internal addresses, and reading one must not send a request to it.
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector(".md-link")?.textContent).toBe("the runbook");
    expect(container.querySelector(".md-link")?.getAttribute("title")).toBe(
      "https://intranet.example.invalid/runbook",
    );
    expect(container.textContent).toContain("[image: rack diagram]");
    expect(container.textContent).toContain("<script>alert(1)</script>");
  });
});

describe("the contents of a document", () => {
  it("lists headings of level 1 to 3 in order, as plain text", () => {
    const tree = parseMarkdown("# One\n\n## Two **bold**\n\n### Three\n\n#### Four\n\n## Five")!;

    expect(contents(tree).map((entry) => [entry.depth, entry.text])).toEqual([
      [1, "One"],
      [2, "Two bold"],
      [3, "Three"],
      [2, "Five"],
    ]);
  });

  it("gives each heading an id of its own, and the rendered heading carries it", () => {
    const source = "## Same\n\ntext\n\n## Same";
    const tree = parseMarkdown(source)!;
    const ids = contents(tree).map((entry) => entry.id);
    const { container } = show(source);

    expect(new Set(ids).size).toBe(2);
    expect([...container.querySelectorAll<HTMLElement>("[data-heading]")].map((h) => h.dataset.heading)).toEqual(ids);
  });

  it("leaves out a heading inside a list item, which is not a section", () => {
    expect(contents(parseMarkdown("# Top\n\n- item\n\n  ## Inside")!).map((entry) => entry.text)).toEqual(["Top"]);
  });
});

describe("a quoted passage, cut out of the document", () => {
  const text = (source: string, quote: string) => {
    const at = range(source, quote);
    const cut = quoteExcerpt(parseMarkdown(source)!, source, at.start, at.end);
    return cut === null ? null : render(<p>{cut}</p>).container.textContent;
  };

  it("keeps inline formatting and drops its markup", () => {
    expect(text("Cut it from **40 minutes** to `9m`.", "from **40 minutes** to `9m`")).toBe("from 40 minutes to 9m");
  });

  it.each([
    ["inline image", "![rack diagram](https://example.invalid/rack.png)"],
    ["reference image", "![rack diagram][rack]"],
  ])("renders a %s within prose and alone", (_name, image) => {
    const source = `${image} and reduced wait time.\n\n[rack]: https://example.invalid/rack.png`;
    expect(text(source, `${image} and reduced wait time.`)).toBe("[image: rack diagram] and reduced wait time.");
    expect(text(source, image)).toBe("[image: rack diagram]");
  });

  it("puts a line break between blocks and a dot between cells", () => {
    const source = "## Numbers\n\n| Batch | 40 min | 9 min |\n|---|---|---|\n| Cost | 30% | 12% |";
    const at = range(source, "| Cost | 30% | 12% |");
    const { container } = render(<p>{quoteExcerpt(parseMarkdown(source)!, source, at.start, at.end)}</p>);
    expect(container.textContent).toBe("Cost · 30% · 12%");

    const across = "- first item\n- second item";
    const both = range(across, "first item\n- second");
    const stacked = render(<p>{quoteExcerpt(parseMarkdown(across)!, across, both.start, both.end)}</p>).container;
    expect(stacked.textContent).toBe("first itemsecond");
    expect(stacked.querySelectorAll("br")).toHaveLength(1);
  });

  it("is nothing for a passage that is only markup", () => {
    expect(text("| A | B |\n|---|---|\n| 1 | 2 |", "|---|---|")).toBeNull();
  });
});
