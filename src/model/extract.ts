/**
 * The extraction contract — a strict-schema tool call, and one tool
 * (`docs/03-technical-design.md` §4.1).
 *
 * Kept small and mostly-required on purpose: Anthropic's strict-schema
 * complexity limits are headroom only while extraction stays one small tool
 * (`docs/03` §11, item 3b).
 */
import type Anthropic from "@anthropic-ai/sdk";

export const EXTRACT_FACT_TOOL = {
  name: "extract_fact",
  description:
    "Record one claim about the author's work that the document supports. Call once per claim.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      claim: {
        type: "string",
        description:
          "The claim, stated plainly in one sentence. No impact framing, no action-verb styling — that is applied when a document is produced, not here.",
      },
      quote: {
        type: "string",
        description:
          "The VERBATIM span from the document that supports the claim, copied character for character. It is located in the stored document by exact string match; a quote that is not found is discarded.",
      },
      technologies: {
        type: "array",
        items: { type: "string" },
        description: "Named technologies the claim involves. Empty array when none are named.",
      },
    },
    required: ["claim", "quote", "technologies"],
    additionalProperties: false,
  },
} satisfies Anthropic.Tool;

export const EXTRACTION_SYSTEM_PROMPT = `You read one passage from a working professional's own case study and record the claims it supports about their work.

Call the extract_fact tool once per claim. Do not write prose; the tool call is the entire output.

Rules:
- The "quote" must be copied VERBATIM from the passage — character for character, including punctuation and spacing. Do not paraphrase, normalise, translate, join across an ellipsis, or repair it. A quote that does not appear in the passage exactly is discarded.
- Keep quotes to the shortest span that actually supports the claim, and never longer than a few sentences.
- State the claim plainly. "Reduced nightly batch runtime from 6 hours to 90 minutes", not "Spearheaded a transformative overhaul".
- Record what the passage says. Do not infer a number the passage does not state, and do not combine two figures into a third.
- One claim per call. A sentence carrying two distinct outcomes is two calls.
- Prefer claims about what the author did and what resulted. Skip background about the employer, the industry, or the technology in general.
- If the passage supports no claim about the author's work, make no tool calls.`;
