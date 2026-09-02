/**
 * Markdown, generated from the same stored `RenderContent` the `.docx` is built
 * from, for on-screen reading and for the `?format=md` download.
 *
 * Assembled on demand and never stored (`docs/03-technical-design.md` §6).
 */
import type { RenderContent, RenderKind } from "~/shared/render-content";
import { identityLines, type RenderIdentity } from "./identity";

export function toMarkdown(
  content: RenderContent,
  title: string,
  kind: RenderKind,
  identity: RenderIdentity,
): string {
  const lines: string[] = [`# ${title}`, ""];
  // The same identity block the `.docx` carries, from the same source, so the
  // two formats of one version cannot disagree about whose document it is.
  const header = identityLines(kind, identity);
  if (header.length > 0) lines.push(`**${header[0]}**`, ...header.slice(1), "");
  for (const section of content.sections) {
    if (section.blocks.length === 0) continue;
    lines.push(`## ${section.heading}`, "");
    for (const block of section.blocks) {
      lines.push(block.kind === "bullet" ? `- ${block.text}` : block.text, "");
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
