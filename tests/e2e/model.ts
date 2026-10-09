/**
 * The model, stubbed for the browser smoke test (`docs/11-testing-plan.md` §2.9).
 *
 * Stateless on purpose: `wrangler dev` may build a fresh isolate between the
 * import and the generation, so nothing here queues a response for a later call.
 * The answer is a function of what the call is given.
 *
 * The extraction quote is cut from the source text the call receives, not
 * restated, so the verbatim-quote rule (`src/pipeline/quote.ts`) is exercised
 * against the bytes the browser uploaded.
 */
import type { ModelSeam } from "~/model";
import { CLAIM, CLAIM_SENTENCE } from "./fixture";

export const e2eModel: ModelSeam = {
  async extractFacts(sourceText, ctx) {
    if (!sourceText.includes(CLAIM_SENTENCE)) return [];
    const candidate = {
      claim: CLAIM,
      quote: CLAIM_SENTENCE,
      technologies: ["PostgreSQL"],
      provenance: "measured" as const,
      confidential: false,
      unsure: false,
      note: "",
    };
    ctx.onCandidate?.(candidate);
    return [candidate];
  },

  async generateRender(facts) {
    return {
      sections: [
        {
          key: "experience",
          heading: "Experience",
          blocks: facts.map((fact, index) => ({
            id: `blk_${index + 1}`,
            kind: "bullet" as const,
            text: fact.claim,
            factIds: [fact.id],
          })),
        },
      ],
    };
  },

  async gradeFacts(facts) {
    return new Map(
      facts.map((fact) => [fact.id, { provenance: "attested" as const, confidential: false, unsure: false, note: "" }]),
    );
  },

  async explainFlag(flag) {
    return `It was flagged because: ${flag.reason}`;
  },
};
