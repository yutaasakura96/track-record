/**
 * The only file in the repository that knows a provider name.
 *
 * Everything above it talks to {@link ModelSeam}. Swapping providers is this
 * file plus a configuration value (`docs/03-technical-design.md` §4).
 */
import Anthropic from "@anthropic-ai/sdk";
import {
  ModelUnavailableError,
  type CandidateFact,
  type ExtractionContext,
  type ModelSeam,
  type RenderFact,
  type RenderSpec,
} from "../types";
import type { RenderContent } from "~/shared/render-content";
import { EXTRACTION_SYSTEM_PROMPT, EXTRACT_FACT_TOOL } from "../extract";
import { EMIT_RENDER_TOOL, buildGenerationPrompt, parseRenderContent } from "../generate";

export interface AnthropicSeamConfig {
  apiKey: string;
  model: string;
}

export function createAnthropicSeam(config: AnthropicSeamConfig): ModelSeam {
  const client = new Anthropic({ apiKey: config.apiKey });

  return {
    async extractFacts(sourceText: string, ctx: ExtractionContext): Promise<CandidateFact[]> {
      if (ctx.waiting === "batch") {
        // Message Batches at 50% — the M2 bulk path. The signature can express
        // it; no batch path is built in M1 (`docs/06`, 2026-08-29).
        throw new Error("Batch extraction is not built. See docs/03 §4.");
      }

      const candidates: CandidateFact[] = [];
      try {
        const stream = client.messages.stream(
          {
            model: config.model,
            max_tokens: 32000,
            system: [
              {
                type: "text",
                text: EXTRACTION_SYSTEM_PROMPT,
                // 1-hour TTL, not the 5-minute default: chunks run as separate
                // durable steps and may be spread over more than five minutes,
                // especially after a retry. Paying 2× once beats paying 1.25×
                // per chunk (`docs/03` §4.3).
                cache_control: { type: "ephemeral", ttl: "1h" },
              },
            ],
            tools: [EXTRACT_FACT_TOOL],
            messages: [{ role: "user", content: sourceText }],
          },
          { signal: ctx.signal },
        );

        // Accumulated per content-block index. Only documented event shapes are
        // used, so nothing here depends on an SDK convenience helper.
        const partial = new Map<number, { name: string; json: string }>();

        for await (const event of stream) {
          if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
            partial.set(event.index, { name: event.content_block.name, json: "" });
          } else if (event.type === "content_block_delta" && event.delta.type === "input_json_delta") {
            const open = partial.get(event.index);
            if (open) open.json += event.delta.partial_json;
          } else if (event.type === "content_block_stop") {
            const open = partial.get(event.index);
            partial.delete(event.index);
            if (!open || open.name !== EXTRACT_FACT_TOOL.name) continue;
            const candidate = readCandidate(open.json);
            if (!candidate) continue;
            candidates.push(candidate);
            // Cards appear as extraction progresses rather than after one long
            // silence (`docs/09` Flow 2).
            ctx.onCandidate?.(candidate);
          }
        }
        await stream.done();
      } catch (err) {
        throw asModelError(err);
      }
      return candidates;
    },

    async generateRender(facts: RenderFact[], spec: RenderSpec): Promise<RenderContent> {
      try {
        const message = await client.messages.create({
          model: config.model,
          max_tokens: 32000,
          system: [{ type: "text", text: buildGenerationPrompt(spec), cache_control: { type: "ephemeral" } }],
          tools: [EMIT_RENDER_TOOL],
          tool_choice: { type: "tool", name: EMIT_RENDER_TOOL.name },
          messages: [{ role: "user", content: JSON.stringify({ facts }) }],
        });
        const block = message.content.find((b) => b.type === "tool_use" && b.name === EMIT_RENDER_TOOL.name);
        if (!block || block.type !== "tool_use") {
          throw new ModelUnavailableError("The model did not return a document.");
        }
        return parseRenderContent(block.input);
      } catch (err) {
        throw asModelError(err);
      }
    },
  };
}

/**
 * Tool inputs may be escaped differently across models, so the accumulated
 * fragments are always parsed rather than string-matched. A block that does not
 * parse is dropped: a malformed candidate is indistinguishable from one whose
 * quote will not verify, and both are discarded silently.
 */
function readCandidate(json: string): CandidateFact | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { claim, quote, technologies } = parsed as Record<string, unknown>;
  if (typeof claim !== "string" || typeof quote !== "string") return null;
  return {
    claim,
    quote,
    technologies: Array.isArray(technologies) ? technologies.filter((t): t is string => typeof t === "string") : [],
  };
}

function asModelError(err: unknown): Error {
  if (err instanceof ModelUnavailableError) return err;
  if (err instanceof Anthropic.APIError) {
    // The provider and status are safe to carry. The response body is not — it
    // can echo the prompt, which is source text (`docs/03` §7, point 4).
    return new ModelUnavailableError(`The model service returned ${err.status}.`, err.status);
  }
  return new ModelUnavailableError("The model service could not be reached.");
}
