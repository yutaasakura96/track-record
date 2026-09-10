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
  /**
   * The employer this fact is filed under, by id as well as by name. The id is
   * what ties it to the matching entry in `RenderSpec.employers`, so grouping
   * is a join rather than a name match on prose.
   */
  employer?: {
    id: string;
    name: string;
    startedOn: string;
    endedOn: string | null;
    industry?: string | null;
  };
  project?: { name: string; summary?: string | null };
}

export interface RenderSpec {
  kind: RenderKind;
  language: "en" | "ja";
  /** The name the document is headed with. Every render needs one. */
  subjectName: string;
  /** Register instruction. The same fact renders two ways; that is a prompt difference. */
  register: string;
  /**
   * The employer sections a render is built from, and the ONLY source of their
   * names, order and dates. Before this list was populated the model inferred
   * all three from claim prose, which held only while every claim happened to
   * name its employer (`docs/06`, 2026-09-04).
   */
  employers: {
    id: string;
    name: string;
    industry: string | null;
    startedOn: string;
    endedOn: string | null;
    businessDescription: string | null;
    /** Titles held there, most recent first. A promotion is a second role. */
    roles: { title: string; startedOn: string; endedOn: string | null }[];
  }[];
  projects: { id: string; name: string; employerId: string | null; summary: string | null }[];
  /**
   * `profiles.desired_role_note`, in the author's own words — the seed for the
   * 履歴書's 本人希望欄 (`docs/04` §4). Null when the author has stated nothing,
   * which is the ordinary case and has a conventional answer of its own.
   *
   * It is not a fact and never becomes one: it is a preference the author
   * typed, so a block written from it carries no `factIds`, exactly as a row
   * copied from the employer list does.
   */
  desiredRoleNote: string | null;
  /**
   * 学歴 as rows rather than as prose, for the same reason `employers` is a
   * list: the institution, the dates and the OUTCOME are data. An outcome
   * inferred from the wording of a fact is a misrepresentation, not a
   * formatting slip (`docs/04` §3.8).
   */
  educations: {
    id: string;
    institution: string;
    faculty: string | null;
    degree: string | null;
    fieldOfStudy: string | null;
    /** Null when the record holds only the month the course finished. */
    startedOn: string | null;
    endedOn: string | null;
    outcome: "graduated" | "completed" | "withdrawn" | "expected";
    /**
     * The rung. It decides whether the row belongs in a given document — it is
     * never written into the row. Null on a row entered before the column
     * existed; such a row is printed rather than dropped.
     */
    level: "secondary_lower" | "secondary_upper" | "vocational" | "tertiary" | "postgraduate" | null;
  }[];
  /**
   * 免許・資格. Without this list a certification could reach a render only as
   * whatever a fact happened to say about it, which is how fourteen of them
   * became one sentence and then left the document entirely (`docs/06`,
   * 2026-09-06).
   */
  certifications: {
    id: string;
    name: string;
    issuingOrganization: string;
    issuedOn: string | null;
    expiresOn: string | null;
    technologies: string[];
  }[];
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
