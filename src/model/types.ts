/**
 * THE SEAM. Six functions, and nothing else: read a passage into facts, write
 * a document from facts, grade facts extracted before grading existed,
 * explain one flag (`docs/06`, 2026-10-08), read a pasted job posting
 * (`docs/06`, 2026-10-11), and split a typed sentence or two into claims
 * (`docs/06`, 2026-10-16).
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
  /**
   * The importer's grade (issue #57). Judged against the quote alone, and it is
   * the grade the fact is accepted with. Absent means the provider returned
   * none: the fact is then kept Generated and flagged, never dropped.
   */
  provenance?: FactGrade["provenance"];
  /** Names a client, a person or an internal system. Stored Private, and flagged. */
  confidential?: boolean;
  /** The importer is not confident in the claim or its grade. Kept, and flagged. */
  unsure?: boolean;
  /** Why it is confidential or unsure, in one plain sentence. Empty when neither. */
  note?: string;
}

/** What the importer decides about one fact. The author can change every part of it. */
export interface FactGrade {
  provenance: "measured" | "attested" | "generated";
  confidential: boolean;
  unsure: boolean;
  note: string;
}

/** A fact as grading is given it: the claim, and the passage it was read from. */
export interface GradableFact {
  id: string;
  claim: string;
  /** `null` on a fact with no passage behind it, which cannot be Measured. */
  quote: string | null;
}

/** What `Explain this` is asked about: one flag, and the fact it is on. */
export interface FlagToExplain {
  kind: "confidential" | "number" | "unsure" | "repeat";
  /** The short reason the flag already shows. */
  reason: string;
  claim: string;
  quote: string | null;
  provenance: FactGrade["provenance"];
  disclosure: "public" | "restricted" | "private";
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
    /** 雇用形態. Printed beside the employer in every prompt; the 職務経歴書 writes it (issue #117). */
    employmentType: "full_time" | "contract" | "dispatch" | "part_time" | "independent";
    /**
     * 資本金, in yen, and 従業員数. Conventional required fields of a 職務経歴書
     * with no English-résumé equivalent (`docs/06`, 2026-08-12), which is why
     * they are on the employer row rather than being facts. Null is ordinary
     * and prints nothing: a private company does not always publish either, and
     * a figure invented to fill the line is worse than an absent line.
     */
    capitalYen: number | null;
    headcount: number | null;
    /** Titles held there, most recent first. A promotion is a second role. */
    roles: { title: string; startedOn: string; endedOn: string | null }[];
    /** Where the job was, in English. Printed in the résumé's job header, never sent to be written. */
    city: string | null;
    /**
     * How many bullets the English résumé writes for this employer (issue
     * #107). Set on that render alone, and computed here rather than left to
     * the model: what makes two pages is an age, and an age is arithmetic.
     */
    bullets?: { min: number; max: number };
  }[];
  projects: {
    id: string;
    name: string;
    employerId: string | null;
    summary: string | null;
    startedOn: string | null;
    endedOn: string | null;
  }[];
  /**
   * Does the record hold work that belongs to no employer?
   *
   * A fact filed to no employer, or a project belonging to none. Read by
   * `src/render/chapters.ts` alone, and it decides whether a career story is
   * planned with a chapter for work done outside employment. Keyed off the
   * FACTS as well as the projects because the first story generated had six
   * facts about a personal project and no project row to hang them on, and the
   * register's rule against citing an unfiled fact under an employer had
   * nowhere to send them (`docs/06`, 2026-09-13).
   */
  workOutsideEmployment: boolean;
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
    /** `certifications.kind`. Null is an unclassified row, which prints as a technical one. */
    kind: "technical" | "language" | "other" | null;
    technologies: string[];
  }[];
  /**
   * The author's curated skills, in their groups and order (S9). `null` means
   * nothing is curated, or this render has no skills section, and the register
   * falls back to listing what the facts name. An empty list is a curation
   * that leaves this render nothing it may name, and the section is omitted:
   * a skill no fact given to this render states is not written, however it was
   * chosen (`docs/06`, 2026-09-13).
   */
  curatedSkills: { name: string; nameJa: string | null; skills: string[] }[] | null;
  /**
   * The job a tailored résumé is written toward (issue #57), as the author
   * pasted it. `null` for a main document, which is tailored to nothing.
   *
   * It decides what the document leads with and what it leaves out. It is
   * never a source of facts: a skill the posting asks for and no fact states is
   * not written, exactly as a skill no fact states is not written anywhere.
   */
  jobDescription: string | null;
}

/**
 * What was read from a pasted job posting (issue #73). It describes a job,
 * never the author: it is proposed on a confirmation step and is not a fact.
 * An empty string or an empty list is "the text does not say".
 */
export interface PostingReading {
  company: string;
  position: string;
  requirements: string[];
}

/** What quick capture asks about a claim when the text does not say it (`docs/09` Flow 6). */
export type CaptureQuestion = "when" | "employer" | "change" | "proof";

/**
 * One claim split out of what the author typed (issue #95). A proposal they
 * confirm or correct before it is saved: no quote, no grade, no disclosure.
 */
export interface CapturedClaim {
  /** Stored plainly, as an imported claim is. */
  claim: string;
  /** `YYYY-MM` when the text says when; `null` when it does not. */
  month: string | null;
  /** An id from `CaptureContext.employers`, or `null`. Never both this and `projectId`. */
  employerId: string | null;
  /** An id from `CaptureContext.projects`, or `null`. */
  projectId: string | null;
  technologies: string[];
  /** What the screen asks for, because the text does not say it. */
  missing: CaptureQuestion[];
}

/** What a captured claim may be filed under, and the month "last month" is read against. */
export interface CaptureContext {
  /** `YYYY-MM`. */
  today: string;
  employers: { id: string; name: string }[];
  projects: { id: string; name: string }[];
}

/**
 * Generation's counterpart to `ExtractionContext`, and what grading,
 * explaining, reading a posting and capturing report through too. It carries one field and is optional — this
 * is a reporting channel, not a capability of its own.
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
  /**
   * Grades facts that were extracted before the importer graded them. One
   * grade per fact it was given, keyed by id; a fact it returns nothing for is
   * the caller's to keep and flag.
   */
  gradeFacts(facts: GradableFact[], ctx?: GenerationContext): Promise<Map<string, FactGrade>>;
  /**
   * Why a fact is flagged, in plain words. Called only when the author presses
   * `Explain this`, never on a list read.
   */
  explainFlag(flag: FlagToExplain, ctx?: GenerationContext): Promise<string>;
  /**
   * The company, the position and the key requirements a pasted posting
   * states. Called only when the author presses `Read it`; what it returns is
   * a proposal to check and is stored nowhere by this call.
   */
  readPosting(jobDescription: string, ctx?: GenerationContext): Promise<PostingReading>;
  /**
   * The claims a typed sentence or two makes, each worded plainly, with the
   * month and the employer or project the text names and what it leaves out.
   * Called only when the author presses `Read it` on Quick capture; what it
   * returns is a proposal to confirm and is stored nowhere by this call.
   */
  captureClaims(text: string, context: CaptureContext, ctx?: GenerationContext): Promise<CapturedClaim[]>;
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

/**
 * Said to the member wherever a model call fails for want of credits. Plain
 * words, no provider name, and it promises nothing the member has to wait on
 * us for: the owner tops up, or the next month's credits arrive (`docs/06`,
 * 2026-10-24).
 */
export const CREDITS_EXHAUSTED_MESSAGE =
  "Generation is paused: the model service has run out of credits. It resumes once credits are topped up or next month's credits arrive. Nothing was lost; try again then.";

/**
 * The provider refused because the organisation has no credits left. A kind of
 * {@link ModelUnavailableError}, so every place that already treats an
 * unavailable model as retryable keeps doing so; the ones that tell the member
 * why look for this subclass first.
 */
export class ModelCreditsExhaustedError extends ModelUnavailableError {
  constructor() {
    super(CREDITS_EXHAUSTED_MESSAGE, 400);
    this.name = "ModelCreditsExhaustedError";
  }
}
