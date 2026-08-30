/**
 * Markdown, generated from the same stored `RenderContent` the `.docx` is built
 * from, for on-screen reading and for the `?format=md` download.
 *
 * Assembled on demand and never stored (`docs/03-technical-design.md` §6).
 */
import type { RenderContent } from "~/shared/render-content";

export function toMarkdown(content: RenderContent, title: string): string {
  const lines: string[] = [`# ${title}`, ""];
  for (const section of content.sections) {
    if (section.blocks.length === 0) continue;
    lines.push(`## ${section.heading}`, "");
    for (const block of section.blocks) {
      lines.push(block.kind === "bullet" ? `- ${block.text}` : block.text, "");
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
