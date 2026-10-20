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
import { ModelUnavailableError, type CaptureQuestion, type ModelSeam } from "~/model";
import { CLAIM, CLAIM_SENTENCE } from "./fixture";
import { CLAIM as DOCUMENT_VIEW_CLAIM, CLAIM_SENTENCE as DOCUMENT_VIEW_SENTENCE } from "./document-view-fixture";
import { READING_EN, READING_JA } from "../fixtures/postings";

export const e2eModel: ModelSeam = {
  async extractFacts(sourceText, ctx) {
    const fixture = sourceText.includes(CLAIM_SENTENCE)
      ? { claim: CLAIM, sentence: CLAIM_SENTENCE }
      : sourceText.includes(DOCUMENT_VIEW_SENTENCE)
        ? { claim: DOCUMENT_VIEW_CLAIM, sentence: DOCUMENT_VIEW_SENTENCE }
        : null;
    if (!fixture) return [];
    const candidate = {
      claim: fixture.claim,
      quote: fixture.sentence,
      technologies: ["PostgreSQL"],
      provenance: "measured" as const,
      confidential: false,
      unsure: false,
      note: "",
    };
    ctx.onCandidate?.(candidate);
    return [candidate];
  },

  async generateRender(facts, spec) {
    if (spec.kind === "english_resume") {
      return {
        sections: [
          {
            key: "summary",
            heading: "Summary",
            blocks: [{ id: "blk_summary", kind: "paragraph" as const, text: facts[0]?.claim ?? "Backend engineer improving reliable settlement systems.", factIds: facts.map((fact) => fact.id) }],
          },
          ...spec.employers.map((employer, index) => ({
            key: `employer:${employer.id}`,
            heading: employer.name,
            blocks: [{ id: `blk_employer_${index}`, kind: "bullet" as const, text: CLAIM, factIds: facts.map((fact) => fact.id) }],
          })),
        ],
      };
    }
    return {
      sections: [
        {
          key: "experience",
          heading: facts.some((fact) => fact.claim.includes("revised")) ? "Selected Experience" : "Experience",
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

  /** The two fixture postings read cleanly; any other text states nothing. */
  async readPosting(jobDescription) {
    const read = [READING_EN, READING_JA].find((reading) => jobDescription.includes(reading.company));
    return read ?? { company: "", position: "", requirements: [] };
  },

  /**
   * One claim a sentence. An employer is matched when the sentence names it,
   * the month when it says `last month` or `先月`, and the answer fails
   * outright when the text says `unreadable`, which is how the browser reaches
   * the plain form.
   */
  async captureClaims(text, context) {
    if (text.includes("unreadable")) throw new ModelUnavailableError("The stub was asked to fail.");
    const [year, month] = context.today.split("-").map(Number) as [number, number];
    const lastMonth = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;
    return text
      .split(/(?<=[.!?。])\s*/)
      .map((sentence) => sentence.trim())
      .filter(Boolean)
      .map((claim) => {
        const employer = context.employers.find((e) => e.name.split(" / ").some((name) => claim.includes(name)));
        const when = /last month|先月/i.test(claim) ? lastMonth : null;
        const missing: CaptureQuestion[] = [
          ...(when ? [] : ["when" as const]),
          ...(employer ? [] : ["employer" as const]),
          ...(/\p{Nd}/u.test(claim) ? [] : ["proof" as const]),
        ];
        return { claim, month: when, employerId: employer?.id ?? null, projectId: null, technologies: [], missing };
      });
  },
};
