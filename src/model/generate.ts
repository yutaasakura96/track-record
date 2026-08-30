/**
 * The generation contract (`docs/03-technical-design.md` §4.2).
 *
 * Returns structured content, never a file and never a prose blob. `factIds` on
 * every block is what makes a weak bullet traceable to the weak fact behind it.
 *
 * Facts are sent plainly; register is applied by the spec. The same fact renders
 * as an action-verb bullet in the English résumé and in the flat factual voice
 * 職務経歴書 expects — a prompt difference, not a data difference.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { ModelUnavailableError, type RenderSpec } from "./types";
import type { Block, BlockKind, RenderContent } from "~/shared/render-content";

export const EMIT_RENDER_TOOL = {
  name: "emit_render",
  description: "Return the finished document as structured sections and blocks.",
  input_schema: {
    type: "object",
    properties: {
      sections: {
        type: "array",
        items: {
          type: "object",
          properties: {
            key: { type: "string", description: "Stable machine key, e.g. \"experience\"." },
            heading: { type: "string", description: "The heading as it should appear." },
            blocks: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  kind: { type: "string", enum: ["paragraph", "bullet", "row"] },
                  text: { type: "string" },
                  factIds: {
                    type: "array",
                    items: { type: "string" },
                    description:
                      "Every fact id this block was written from. Empty only for fixed scaffolding.",
                  },
                },
                required: ["kind", "text", "factIds"],
              },
            },
          },
          required: ["key", "heading", "blocks"],
        },
      },
    },
    required: ["sections"],
  },
} satisfies Anthropic.Tool;

export function buildGenerationPrompt(spec: RenderSpec): string {
  const employers = spec.employers
    .map(
      (e) =>
        `- id ${e.id} · ${e.name}${e.industry ? ` (${e.industry})` : ""} · ${monthOf(e.startedOn)} – ${
          e.endedOn ? monthOf(e.endedOn) : "present"
        }${e.businessDescription ? ` · ${e.businessDescription}` : ""}`,
    )
    .join("\n");
  const projects = spec.projects
    .map((p) => `- id ${p.id} · ${p.name}${p.employerId ? ` · at ${p.employerId}` : " · independent"}${p.summary ? ` · ${p.summary}` : ""}`)
    .join("\n");

  return `You are producing one career document for ${spec.subjectName}.

${spec.register}

You are given a list of facts. Each has an id, a claim, a provenance and the employer or project it belongs to. Write the document from those facts and nothing else.

Rules:
- Every block you emit must list the ids of the facts it was written from, in factIds. A block written from no fact is a defect unless it is fixed scaffolding.
- Do not introduce a number, a date, a technology or an outcome that no fact states.
- Do not merge two facts into a claim stronger than either.
- Facts marked restricted must be generalised: describe the work without naming the client or any system that identifies them.
- Never emit a date more precise than a month.
- Use the call it "${spec.language === "ja" ? "Japanese" : "English"}" register throughout.

Employers:
${employers || "- none recorded"}

Projects:
${projects || "- none recorded"}

Call emit_render exactly once.`;
}

const monthOf = (isoDate: string) => isoDate.slice(0, 7);

const KINDS = new Set<BlockKind>(["paragraph", "bullet", "row"]);

/**
 * Block ids are assigned here rather than by the model: the diff addresses
 * blocks by id, and an id the model chose would not be stable across a
 * regeneration.
 */
export function parseRenderContent(input: unknown): RenderContent {
  if (typeof input !== "object" || input === null || !Array.isArray((input as { sections?: unknown }).sections)) {
    throw new ModelUnavailableError("The model returned a document in an unusable shape.");
  }
  let n = 0;
  const sections = (input as { sections: unknown[] }).sections.flatMap((raw) => {
    if (typeof raw !== "object" || raw === null) return [];
    const { key, heading, blocks } = raw as Record<string, unknown>;
    if (typeof key !== "string" || typeof heading !== "string" || !Array.isArray(blocks)) return [];
    const parsed: Block[] = blocks.flatMap((b) => {
      if (typeof b !== "object" || b === null) return [];
      const { kind, text, factIds } = b as Record<string, unknown>;
      if (typeof text !== "string" || text.trim() === "") return [];
      return [
        {
          id: `blk_${++n}`,
          kind: KINDS.has(kind as BlockKind) ? (kind as BlockKind) : "paragraph",
          text: text.trim(),
          factIds: Array.isArray(factIds) ? factIds.filter((f): f is string => typeof f === "string") : [],
        },
      ];
    });
    return [{ key, heading, blocks: parsed }];
  });

  if (sections.every((s) => s.blocks.length === 0)) {
    throw new ModelUnavailableError("The model returned an empty document.");
  }
  return { sections };
}
