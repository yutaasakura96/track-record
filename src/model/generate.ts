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
                      "Every fact id this block was written from — several, when the block was composed from several. Empty only for fixed scaffolding and for rows copied from the employer, education or certification lists.",
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
    .map((e) => {
      const held = e.roles
        .map(
          (r) =>
            `\n    - ${r.title} · ${monthOf(r.startedOn)} – ${r.endedOn ? monthOf(r.endedOn) : "present"}`,
        )
        .join("");
      return `- id ${e.id} · ${e.name}${e.industry ? ` (${e.industry})` : ""} · ${monthOf(e.startedOn)} – ${
        e.endedOn ? monthOf(e.endedOn) : "present"
      }${e.businessDescription ? ` · ${e.businessDescription}` : ""}${held}`;
    })
    .join("\n");
  const projects = spec.projects
    .map((p) => `- id ${p.id} · ${p.name}${p.employerId ? ` · at ${p.employerId}` : " · independent"}${p.summary ? ` · ${p.summary}` : ""}`)
    .join("\n");
  // 学歴 and 免許・資格. A row here is the ONLY source of an institution name,
  // an award date and — the one that matters — an education's outcome: 中退 is
  // not 卒業, and a model asked to infer which from a claim will guess.
  const educations = spec.educations
    .map(
      (e) =>
        `- id ${e.id} · ${e.institution}${e.faculty ? ` · ${e.faculty}` : ""}${
          e.degree ? ` · ${e.degree}` : ""
        }${e.fieldOfStudy ? ` · ${e.fieldOfStudy}` : ""} · ${monthOf(e.startedOn)} – ${
          e.endedOn ? monthOf(e.endedOn) : "present"
        } · ${OUTCOME_WORDING[e.outcome]}`,
    )
    .join("\n");
  const certifications = spec.certifications
    .map(
      (c) =>
        `- id ${c.id} · ${c.name} · ${c.issuingOrganization}${
          c.issuedOn ? ` · issued ${monthOf(c.issuedOn)}` : ""
        }${c.expiresOn ? ` · expires ${monthOf(c.expiresOn)}` : ""}`,
    )
    .join("\n");

  return `You are producing one career document for ${spec.subjectName}.

${spec.register}

You are given a list of facts. Each has an id, a claim, a provenance and the employer or project it belongs to. Write the document from those facts and nothing else.

Rules:
- Every block you emit must list the ids of the facts it was written from, in factIds. A block written from no fact is a defect unless it is fixed scaffolding or a row copied from the Employers, Education or Certifications lists below.
- Do not introduce a number, a date, a technology or an outcome that no fact states.
- Employer names, role titles and every employment date come from the Employers list below and from nowhere else. Do not infer any of them from the wording of a fact, and do not restate a date less precisely than the list gives it.
- Group a fact under the employer whose id it carries. A fact carrying no employer id must not be placed under one.
- You may write one block from several facts, and the register below says when to. What you may not do is state something the facts together do not support: no cause they do not claim, no total they do not add up to, no outcome stronger than the strongest of them.
- Facts marked restricted must be generalised: describe the work without naming the client or any system that identifies them.
- Never emit a date more precise than a month.
- Use the call it "${spec.language === "ja" ? "Japanese" : "English"}" register throughout.

Employers, most recent first, with the roles held at each:
${employers || "- none recorded"}

Projects:
${projects || "- none recorded"}

Education, oldest first:
${educations || "- none recorded"}

Certifications, most recently awarded first:
${certifications || "- none recorded"}

Call emit_render exactly once.`;
}

const monthOf = (isoDate: string) => isoDate.slice(0, 7);

/**
 * The outcome, spelled out. `withdrawn` is the reason this map exists: a
 * withdrawal that renders as a graduation is a misrepresentation rather than a
 * formatting slip (`docs/04` §3.8), and the enum value alone invites the model
 * to paraphrase it into whichever word reads better.
 */
const OUTCOME_WORDING: Record<RenderSpec["educations"][number]["outcome"], string> = {
  graduated: "graduated",
  completed: "completed",
  withdrawn: "withdrew before completing — never write this as a graduation",
  expected: "in progress, expected to finish on the end date given",
};

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
