/**
 * THE SEAM. Two functions, and nothing else.
 *
 * Nothing outside `src/model/` imports an SDK or knows a provider name
 * (`docs/03-technical-design.md` §4). Swapping providers is a configuration
 * value plus one adapter file.
 */
import type { RenderContent, RenderKind } from "~/shared/render-content";

/**
 * A candidate as the model returns it — before quote anchoring, before the
 * scrub, before deduplication. It is not a fact yet and has no id.
 */
export interface CandidateFact {
  /** Stored plainly. Impact framing is applied at render time, never here. */
  claim: string;
  /** The VERBATIM span from the source that supports the claim. */
  quote: string;
  technologies: string[];
}

/**
 * What one model call cost, in tokens. The four fields are the provider's own
 * `usage` accounting and nothing else — no prices, no derived totals. Money is
 * a function of these numbers, a model id and a rate card, and rate cards
 * change; the durable thing to record is the count.
 *
 * These are counts, never content, so they are safe to log and safe to store.
 */
export interface ModelUsage {
  /** Uncached input. Billed at full rate. */
  inputTokens: number;
  outputTokens: number;
  /** Input written to the cache on this call (~1.25×). */
  cacheCreationInputTokens: number;
  /**
   * Input served FROM the cache (~0.1×). This is the number that says whether
   * the 1-hour breakpoint in `providers/anthropic.ts` is actually paying off.
   * Zero across a multi-chunk import means something is invalidating the
   * prefix.
   */
  cacheReadInputTokens: number;
}

export interface ExtractionContext {
  /**
   * Is a human waiting on this call?
   *
   * M1 has exactly one setting for it — interactive import — and no batch path
   * is built (`docs/06`, 2026-08-29). The obligation now is only that the
   * signature can express "nobody is watching" without a rewrite, because bulk
   * re-extraction after a parser upgrade is a recurring cost that Message
   * Batches halve permanently.
   */
  waiting: "interactive" | "batch";
  /**
   * Called as each candidate arrives, so review cards appear incrementally
   * rather than after one long silence. Interactive calls stream; batch calls
   * do not, and leave this unset.
   */
  onCandidate?: (candidate: CandidateFact) => void;
  /**
   * Called once, after the call completes, with what it cost. Not called when
   * the call throws — a failed call's usage is not recoverable from the SDK's
   * error, and inventing a zero row would understate the bill.
   */
  onUsage?: (usage: ModelUsage) => void;
  signal?: AbortSignal;
}

/** What generation is given. Never a source document, and never a Private fact. */
export interface RenderFact {
  id: string;
  claim: string;
  provenance: "measured" | "attested" | "generated";
  disclosure: "public" | "restricted";
  technologies: string[];
  employer?: { name: string; startedOn: string; endedOn: string | null; industry?: string | null };
  project?: { name: string; summary?: string | null };
}

export interface RenderSpec {
  kind: RenderKind;
  language: "en" | "ja";
  /** The name the document is headed with. Every render needs one. */
  subjectName: string;
  /** Register instruction. The same fact renders two ways; that is a prompt difference. */
  register: string;
  employers: {
    id: string;
    name: string;
    industry: string | null;
    startedOn: string;
    endedOn: string | null;
    businessDescription: string | null;
  }[];
  projects: { id: string; name: string; employerId: string | null; summary: string | null }[];
}

/**
 * Generation's counterpart to `ExtractionContext`. It carries one field and is
 * optional, so the seam is still two functions — this is a reporting channel,
 * not a third capability.
 */
export interface GenerationContext {
  onUsage?: (usage: ModelUsage) => void;
}

export interface ModelSeam {
  extractFacts(sourceText: string, ctx: ExtractionContext): Promise<CandidateFact[]>;
  generateRender(
    facts: RenderFact[],
    spec: RenderSpec,
    ctx?: GenerationContext,
  ): Promise<RenderContent>;
}

/** Thrown when the provider is unreachable or answers unusably. Always retryable. */
export class ModelUnavailableError extends Error {
  /** A status code or short label. NEVER a provider response body. */
  readonly detail?: unknown;

  constructor(message: string, detail?: unknown) {
    super(message);
    this.name = "ModelUnavailableError";
    this.detail = detail;
  }
}
