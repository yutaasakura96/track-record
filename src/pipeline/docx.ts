/**
 * A Word `.docx` as text (`docs/03-technical-design.md` §5.1, #94).
 *
 * Parsed here rather than through `mammoth`, because paragraph boundaries are
 * what line numbering is built on: a library that changed its paragraph
 * handling in a minor release would silently move every line number in the
 * record. Unzipped with PizZip, which the 履歴書 render already runs on workerd.
 *
 * **The rule, `docx-1`.** Only `word/document.xml` is read — not headers,
 * footers, footnotes or comments. Every `w:p` is one line, in document order,
 * table cells included, and an empty paragraph is an empty line. Inside a
 * paragraph, `w:t` is its text, `w:tab` a tab, and `w:br` or `w:cr` a line
 * break of its own, except a page or column break, which is nothing. Deleted
 * text (`w:delText`), field codes (`w:instrText`), paragraph and run
 * properties, and the `mc:Fallback` copy of a text box are not read. Changing
 * any of this is a new extractor version.
 */
import PizZip from "pizzip";
import { UnreadableDocument } from "./unreadable";

export const DOCX_EXTRACTOR_VERSION = "docx-1";

const TOKEN = /<(\/?)([A-Za-z][\w.-]*:)?([\w.-]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|([^<]+)/g;

/**
 * Never read. The two property elements are here because a paragraph's tab
 * stops are `w:tab` elements too, and are not tabs in its text.
 */
const SKIPPED = new Set(["mc:Fallback", "w:del", "w:delText", "w:instrText", "w:pPr", "w:rPr"]);
const WORD_NAMESPACE = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const COMPATIBILITY_NAMESPACE = "http://schemas.openxmlformats.org/markup-compatibility/2006";

const ENTITY = /&(?:#(\d+)|#x([0-9A-Fa-f]+)|(amp|lt|gt|quot|apos));/g;
const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

const decode = (text: string) =>
  text.replace(ENTITY, (_, dec?: string, hex?: string, name?: string) =>
    name ? NAMED[name]! : String.fromCodePoint(dec ? Number(dec) : parseInt(hex!, 16)),
  );

export function extractDocx(bytes: ArrayBuffer): string {
  try {
    const document = new PizZip(bytes).file("word/document.xml");
    if (!document) throw new Error("no document part");
    return paragraphsOf(document.asText()).join("\n");
  } catch {
    throw new UnreadableDocument("That Word file could not be read. It may be damaged, or not a .docx.");
  }
}

/** The `w:p` elements of `word/document.xml`, each as one line. */
export function paragraphsOf(xml: string): string[] {
  const lines: string[] = [];
  // A text box inside a paragraph holds paragraphs of its own: they close
  // before the one around them, and are emitted in that order.
  const open: string[] = [];
  let inText = false;
  /** Depth inside an element whose content is never read. */
  let skipping = 0;
  let wordPrefixes = new Set(["w"]);
  let compatibilityPrefixes = new Set(["mc"]);
  let rootRead = false;

  for (const match of xml.matchAll(TOKEN)) {
    const [, closing, prefix = "", name, attributes = "", selfClosing, cdata, chars] = match;
    if (chars !== undefined || cdata !== undefined) {
      if (inText && !skipping && open.length) open[open.length - 1] += cdata ?? decode(chars!);
      continue;
    }
    if (name === undefined) continue; // a comment or a declaration
    if (!rootRead && !closing) {
      rootRead = true;
      const declarations = [...attributes.matchAll(/\bxmlns:([A-Za-z][\w.-]*)\s*=\s*(["'])(.*?)\2/g)];
      const word = declarations.filter((declaration) => declaration[3] === WORD_NAMESPACE).map((declaration) => declaration[1]!);
      const compatibility = declarations.filter((declaration) => declaration[3] === COMPATIBILITY_NAMESPACE).map((declaration) => declaration[1]!);
      if (word.length) wordPrefixes = new Set(word);
      if (compatibility.length) compatibilityPrefixes = new Set(compatibility);
    }
    const namespace = prefix.slice(0, -1);
    const tag = wordPrefixes.has(namespace) ? `w:${name}`
      : compatibilityPrefixes.has(namespace) ? `mc:${name}` : prefix + name;

    if (SKIPPED.has(tag)) {
      if (selfClosing) continue;
      skipping += closing ? -1 : 1;
      continue;
    }
    if (skipping) continue;

    if (tag === "w:p") {
      if (selfClosing) lines.push("");
      else if (closing) lines.push(open.pop() ?? "");
      else open.push("");
      continue;
    }
    if (tag === "w:t") {
      inText = !closing && !selfClosing;
      continue;
    }
    if (!open.length || closing) continue;
    if (tag === "w:tab") open[open.length - 1] += "\t";
    else if (tag === "w:br" || tag === "w:cr") {
      const pageOrColumn = [...attributes.matchAll(/\b([A-Za-z][\w.-]*):type\s*=\s*["'](page|column)["']/g)]
        .some((attribute) => wordPrefixes.has(attribute[1]!));
      if (!pageOrColumn) open[open.length - 1] += "\n";
    } else if (tag === "w:noBreakHyphen") open[open.length - 1] += "-";
  }
  return lines;
}
