/**
 * The API client and the TanStack Query hooks over it.
 *
 * One rule the whole SPA rests on: a `401` from any endpoint means the session
 * is gone, and the app shows the sign-in screen. It does not deep-link back
 * afterwards — there are three screens and it is not worth the state handling
 * (`docs/08-auth-and-permissions.md` §4).
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";
import { useState } from "react";
import { RENDER_KINDS, RENDER_TITLE, type DownloadFormat, type RenderContent, type RenderKind } from "~/shared/render-content";
import type { MasterDocument, MasterLanguage } from "~/shared/master-document";
import type { CareerTimeline } from "~/shared/career-timeline";
import type { ApplicationStatus, Figures, Standing } from "~/shared/application";
import type { Interview, InterviewRound } from "~/shared/interview";
import { keptFileName } from "~/shared/recording";
import type { NamedVersion, SendableKind } from "~/shared/application-documents";
import type { FactEvidence } from "~/shared/evidence";
import type { LastUsed } from "~/shared/skills";
import type { SentPage } from "~/render/sent-page";

export interface ApiErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> & { fields?: string[] } };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: string[] = [],
    /**
     * The rest of `error.details`, verbatim. A refusal that names WHICH facts
     * or WHICH proposal is in the way is only actionable if the screen can read
     * them — a restore refused at `422` lists ids and a reason per id
     * (`docs/10` Screen 5), and none of that fits `fields`.
     */
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * The server's own words when a model call failed for want of credits, else
 * `null`. Screens that word a model failure themselves (and fall back to
 * typing it in) use it so the member is told the true reason (`docs/12` §9).
 */
export function creditsMessage(error: unknown): string | null {
  return error instanceof ApiError && error.details.reason === "credits_exhausted" ? error.message : null;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { "content-type": "application/json" }),
      ...init?.headers,
    },
  });

  if (response.status === 204) return undefined as T;
  const isJson = response.headers.get("content-type")?.includes("application/json");
  if (!response.ok) {
    // Optional all the way down: not every JSON error is ours. Better Auth's own
    // refusals (a `403` for an untrusted origin) carry no `error` object, and a
    // TypeError here would hide the status from every caller.
    const body = isJson ? ((await response.json()) as Partial<ApiErrorBody>) : null;
    throw new ApiError(
      response.status,
      body?.error?.code ?? "internal",
      body?.error?.message ?? "Something went wrong.",
      body?.error?.details?.fields ?? [],
      body?.error?.details ?? {},
    );
  }
  return (isJson ? await response.json() : await response.text()) as T;
}

/**
 * What a screen says when a write it awaited was refused, or never arrived. The
 * server's own message where there is one: a `409` names what is in the way.
 */
export const failureText = (error: unknown) =>
  error instanceof ApiError ? error.message : "The server could not be reached. Try again.";

/**
 * What a screen says when a read it needs failed. It stands beside a Retry
 * control, so where the server was never reached it does not also say to try
 * again: a write's "Try again." means press the same button, and a read had none.
 */
export const readFailureText = (error: unknown) =>
  error instanceof ApiError ? error.message : "The server could not be reached.";

const json = (body: unknown) => ({ body: JSON.stringify(body) });

/* ------------------------------------------------------------------- types */

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

export interface Profile {
  id: string;
  familyNameKanji: string;
  givenNameKanji: string;
  familyNameKana: string;
  givenNameKana: string;
  nameLatin: string;
  dateOfBirth: string;
  gender: string | null;
  phone: string;
  email: string;
  postalCode: string;
  address: string;
  addressKana: string;
  contactSameAsAddress: boolean;
  /** The English résumé's page. */
  paperSize: "a4" | "letter";
  hasPhoto: boolean;
  /**
   * Changes whenever the photo does, and null when there is none. The photo's
   * address carries it, so a page asks for the new photo and not a kept one.
   */
  photoVersion: string | null;
  /** The English résumé's header (issue #108); each null until filled. */
  resumeHeadline: string | null;
  resumeCity: string | null;
  resumeCountry: string | null;
  resumePhone: string | null;
  resumeLinkedinUrl: string | null;
  resumeGithubUrl: string | null;
  resumePortfolioUrl: string | null;
}

export interface Fact {
  id: string;
  claim: string;
  provenance: "measured" | "attested" | "generated";
  disclosure: "public" | "restricted" | "private";
  status: "candidate" | "accepted" | "rejected";
  /**
   * Which employer the fact is filed under: its hand-set one, then its
   * document's, then its project's. `null` when none is.
   */
  employerId: string | null;
  /** True once set on the card; the fact then keeps it whatever its document does. */
  employerSetByHand: boolean;
  projectId: string | null;
  /** `YYYY-MM`, when the author said when at quick capture. `null` on an imported fact. */
  month: string | null;
  /** When the fact entered the record, ISO 8601. */
  createdAt: string;
  evidence: {
    sourceDocumentVersionId: string;
    lineNumber: number;
    quoteStart: number;
    quoteEnd: number;
  } | null;
  technologies: string[];
  isClientIdentifying: boolean;
  /**
   * False on an accepted fact whose provenance nobody chose, neither the author
   * nor the importer: the 112 of the 2026-09-04 import until each is re-graded
   * (`docs/07` §6).
   */
  graded: boolean;
  /** True on a fact the importer accepted on its own, whatever the author did next. */
  autoAccepted: boolean;
  /** Whose grade the provenance is. `null` is the agent's default nobody chose. */
  gradedBy: "author" | "importer" | null;
  /** Why the fact is worth a look. Empty on most facts. */
  flags: Flag[];
  /**
   * Accepted facts at the same employer this one likely restates, best first.
   * Empty once the author has ruled on the fact. No score, by design.
   */
  likelyMatches: LikelyMatch[];
}

/** One reason a fact is on the list to check (issue #57). Advice; it never removes the fact. */
export interface Flag {
  id: string;
  kind: "confidential" | "number" | "unsure" | "repeat";
  /** Short, and always there. */
  reason: string;
  /** The longer account, written when `Explain this` is pressed. `null` until then. */
  explanation: string | null;
  checked: boolean;
}

/** A flag on the Flagged list, with the fact it is on and where that fact is opened. */
export interface FlaggedItem extends Flag {
  fact: {
    id: string;
    claim: string;
    provenance: Fact["provenance"];
    disclosure: Fact["disclosure"];
    lineNumber: number | null;
    importId: string | null;
    filename: string | null;
  };
}

export interface FlagsListing {
  counts: { open: number; checked: number };
  items: FlaggedItem[];
}

/** An existing fact a candidate likely restates (`docs/07` §6). */
export interface LikelyMatch {
  id: string;
  claim: string;
  /** With `graded`, what the card's re-grade line reads (issue #37). */
  provenance: Fact["provenance"];
  graded: boolean;
  /** `null` for a fact with no source document. */
  document: { importId: string; filename: string; versionNo: number } | null;
  /** Both claims carry numbers, and neither's contain the other's. */
  conflict: boolean;
}

export interface Employer {
  id: string;
  nameJa: string;
  nameLatin: string | null;
  industryJa: string | null;
  city: string | null;
  businessDescription: string | null;
  capitalYen: number | null;
  headcount: number | null;
  employmentType: "full_time" | "contract" | "dispatch" | "part_time" | "independent";
  startedOn: string;
  endedOn: string | null;
  leavingReasonJa: string | null;
  sortOrder: number;
}

export interface Role {
  id: string;
  employerId: string;
  titleJa: string | null;
  titleLatin: string | null;
  shokushuJa: string | null;
  startedOn: string;
  endedOn: string | null;
}

export interface Project {
  id: string;
  name: string;
  nameJa: string | null;
  employerId: string | null;
  summary: string | null;
  summaryJa: string | null;
  startedOn: string | null;
  endedOn: string | null;
  clientIsNamed: boolean;
}

export interface Education {
  id: string;
  institution: string;
  institutionJa: string | null;
  faculty: string | null;
  degree: string | null;
  fieldOfStudy: string | null;
  /** Null when the record holds only the month the course finished. */
  startedOn: string | null;
  endedOn: string | null;
  outcome: "graduated" | "completed" | "withdrawn" | "expected";
  /** Null only on a row entered before the column existed. */
  level: "secondary_lower" | "secondary_upper" | "vocational" | "tertiary" | "postgraduate" | null;
}

export interface Certification {
  id: string;
  name: string;
  nameJa: string | null;
  issuingOrganization: string;
  issuedOn: string | null;
  expiresOn: string | null;
  kind: "technical" | "language" | "other";
  credentialId: string | null;
  credentialUrl: string | null;
  technologies: string[];
}

/** The five hand-entered entity types, keyed by their collection path. */
export type EntityKey = "employers" | "roles" | "projects" | "educations" | "certifications";

export interface ImportStatus {
  importId: string;
  sourceDocumentId: string;
  versionNo: number;
  status: "queued" | "extracting" | "ready" | "failed";
  chunksTotal: number;
  chunksDone: number;
  candidatesExtracted: number;
  candidatesDiscarded: number;
  candidatesSuppressed: number;
  wordCount: number;
  changedRegionShare: number | null;
  error: { code: string; message: string } | null;
  failedAtChunk: number | null;
}

export interface SourceText {
  sourceDocumentVersionId: string;
  filename: string;
  project: { id: string; name: string } | null;
  wordCount: number;
  importedAt: string;
  text: string;
}

/** One version of a source document on Screen 8. Counts only, never text. */
export interface DocumentVersion {
  importId: string;
  versionNo: number;
  importedAt: string;
  status: ImportStatus["status"];
  wordCount: number;
  changedRegionShare: number | null;
  chunksTotal: number;
  chunksDone: number;
  extractorVersion: string;
  facts: { accepted: number; rejected: number; open: number };
  /** Set only when `status` is `failed`. The same shape as `ImportStatus.error`. */
  error: { code: string; message: string } | null;
}

export interface SourceDocumentRow {
  sourceDocumentId: string;
  filename: string;
  mimeType: string;
  project: { id: string; name: string } | null;
  /** The document's own employer, never its project's. Its facts read it through the document. */
  employer: { id: string; name: string } | null;
  lastImportedAt: string;
  openCandidates: number;
  /** False exactly when the newest version is `queued` or `extracting`. */
  reimportable: boolean;
  /** Newest first. */
  versions: DocumentVersion[];
}

export interface DocumentsListing {
  /** The sidebar count. Screen 8 reads it from here; the sidebar does not. */
  openCandidates: number;
  documents: SourceDocumentRow[];
}

/** The sidebar's badge, and whether anything is still worth polling for. */
export interface ImportSummary {
  openCandidates: number;
  running: boolean;
  /** Flags not yet marked checked. */
  openFlags: number;
}

export interface RenderRow {
  id: string | null;
  /** What the render routes address it by: its kind, or a tailored résumé's id. */
  ref: string;
  /** A tailored résumé's name and when it was made. `null` on a main document. */
  tailored: { label: string; createdAt: string } | null;
  kind: RenderKind;
  language: "en" | "ja";
  title: string;
  buildable: boolean;
  currentVersionId: string | null;
  currentVersionNo: number | null;
  generatedAt: string | null;
  status: "never_generated" | "up_to_date" | "stale" | "proposal_pending" | "proposal_generating";
  newFactsSince: number | null;
  /** Facts the current version was generated from that a document may no longer use. */
  withdrawnFactsSince: number | null;
  pendingProposalId: string | null;
}

export interface Overview {
  lastImportAt: string | null;
  /** The version being read, or the next to be, and the document it is a version of. */
  activeImport: (ImportStatus & { filename: string }) | null;
  /**
   * Imports waiting behind it, in the order they will be read: one document is
   * read at a time (#93).
   */
  waitingImports: { importId: string; filename: string }[];
  latestImportSet?: { importId: string; filename: string; status: "queued" | "extracting" | "ready" | "failed"; chunksTotal: number; chunksDone: number; error: string | null }[];
  tiles: Record<"employers" | "roles" | "projects" | "credentials", { count: number; note: string | null }>;
  factsByProvenance: { measured: number; attested: number; generated: number };
  /** Flags not yet marked checked. Advice, never a block. */
  flagged: number;
  /**
   * Facts still waiting from before the importer accepted on its own, across
   * every version of every document, how many documents they sit in, and the
   * newest version holding any. `null` when nothing waits.
   */
  review: { openCandidates: number; documents: number; importId: string; filename: string } | null;
  /** The newest version holding an accepted fact that is still Generated. */
  unconfirmed: { importId: string; count: number; total: number } | null;
  /**
   * What the monthly capture prompt is decided from (issue #116): when the
   * record last gained a fact, the employer not left (the one joined last, of
   * two), and the month the prompt was put away for, `YYYY-MM-01`.
   */
  capturePrompt?: {
    lastFactAt: string | null;
    employer: { id: string; name: string } | null;
    dismissedOn: string | null;
  };
  documents: RenderRow[];
  /** False when no accepted fact may be used in a document. */
  canGenerate: boolean;
  isEmpty: boolean;
}

export interface Proposal {
  id: string;
  renderKind: RenderKind;
  /** What the render routes address this document by, and what it is called. */
  renderRef: string;
  title: string;
  /** The application a tailored résumé belongs to. `null` on a main document. */
  applicationId: string | null;
  status: "generating" | "failed" | "pending" | "accepted" | "dismissed";
  generationStatus: "generating" | "ready" | "failed";
  error: { code: string; message: string } | null;
  basedOnVersionNo: number | null;
  proposedVersionNo: number;
  generatedAt: string;
  reason: string | null;
  warnings: string[];
  unchanged: boolean;
  withheld: { privateFactCount: number; generatedFactCount: number };
}

/** One row of the version history (`docs/10` Screen 5). */
export interface RenderVersion {
  id: string;
  versionNo: number;
  origin: "accepted" | "restored" | "edited";
  sourceVersionId: string | null;
  /** Resolved server-side: the row says `Restored from v2`, never an id. */
  sourceVersionNo: number | null;
  acceptedAt: string;
  isCurrent: boolean;
}

/**
 * One stored version, structure included. The editor reads THIS rather than the
 * download, which assembles a `.docx` that cannot be edited and returned
 * (`docs/10` Screen 6).
 */
export interface StoredVersion {
  id: string;
  renderKind: RenderKind;
  versionNo: number;
  origin: RenderVersion["origin"];
  sourceVersionId: string | null;
  acceptedAt: string;
  content: RenderContent;
}

/**
 * What a saved edit says back. `warnings` is the reason the editor is a screen
 * with a saved state rather than a control that navigates away: they arrive
 * with the `201` and have nowhere else to land (`docs/10` Screen 6 §Saved).
 */
export interface EditResult {
  renderKind: RenderKind;
  newVersionNo: number;
  origin: "edited";
  sourceVersionId: string;
  acceptedAt: string;
  warnings: string[];
}

export interface VersionHistory {
  renderKind: RenderKind;
  renderRef: string;
  /** The document's name: a main document's title, or `Résumé for …`. */
  title: string;
  tailored: boolean;
  buildable: boolean;
  currentVersionId: string | null;
  currentVersionNo: number | null;
  items: RenderVersion[];
}

/**
 * A proposal as the history reads it. The screen shows the DISMISSED ones —
 * an accepted proposal is already in the history as the version it became.
 */
export interface ProposalRow {
  id: string;
  status: "pending" | "accepted" | "dismissed";
  generationStatus: "generating" | "ready" | "failed";
  generatedAt: string;
  decidedAt: string | null;
  reason: string | null;
}

export interface DiffChange {
  changeId: string;
  /** A section heading is a change of its own, with no blocks behind it. */
  target: "block" | "heading";
  sectionKey: string;
  currentBlockId: string | null;
  proposedBlockId: string | null;
  tokens: { op: "equal" | "add" | "remove"; text: string }[];
  rationale: { kind: string; text: string; factIds: string[] };
}

export interface RenderDiff {
  additions: number;
  removals: number;
  changes: DiffChange[];
}

/* ------------------------------------------------------------------ queries */

export const keys = {
  session: ["session"] as const,
  profile: ["profile"] as const,
  overview: ["overview"] as const,
  renders: ["renders"] as const,
  entity: (key: EntityKey) => [key] as const,
  inclusions: ["render-inclusions"] as const,
  skills: ["skills-curation"] as const,
  documents: ["documents"] as const,
  // Deliberately UNDER `documents`: invalidation is by key prefix, so every
  // mutation that already re-reads the listing re-reads the sidebar's badge too.
  // The count and the listing it must agree with cannot go stale separately.
  importSummary: ["documents", "summary"] as const,
  importStatus: (id: string) => ["import", id] as const,
  // Every import's fact list is under `allFacts`: a candidate's likely matches
  // come from other imports, so a decision on one screen changes another's.
  allFacts: ["facts"] as const,
  facts: (importId: string) => ["facts", importId] as const,
  // Under `allFacts`, so a ruling on any card refreshes it.
  capturedFacts: ["facts", "captured"] as const,
  // Under `allFacts`: a ruling on a fact changes what the list holds.
  flags: (state: "open" | "checked") => ["facts", "flags", state] as const,
  masterDocument: (language: MasterLanguage) => ["facts", "master-document", language] as const,
  // Under `allFacts`, so a ruling on any card refreshes its counts; the record
  // screen's own writes refresh it by name, since they move its gaps.
  careerTimeline: ["facts", "career-timeline"] as const,
  sourceText: (documentId: string, versionNo: number) =>
    ["source", documentId, versionNo] as const,
  proposal: (id: string) => ["proposal", id] as const,
  diff: (id: string) => ["proposal", id, "diff"] as const,
  // `ref` is what the render routes take: a kind, or a tailored résumé's id.
  versions: (ref: string) => ["renders", ref, "versions"] as const,
  // Deliberately NOT under `versions`: invalidating the list on a save would
  // otherwise invalidate the immutable version the editor is holding.
  version: (ref: string, id: string) => ["renders", ref, "version", id] as const,
  proposals: (ref: string) => ["renders", ref, "proposals"] as const,
  // Under `renders`: a new version or a proposal arriving changes what the page says.
  page: (ref: string, versionId: string) => ["renders", ref, "page", versionId] as const,
  versionDiff: (ref: string, from: string, to: string) =>
    ["renders", ref, "diff", from, to] as const,
  // Under `renders`: an application shows its résumé's version and status, so
  // whatever refreshes the documents refreshes these.
  applications: ["renders", "applications"] as const,
  application: (id: string) => ["renders", "applications", id] as const,
  sentCopies: (applicationId: string) => ["renders", "applications", applicationId, "sent"] as const,
};

/** `1.5 s` while a resource is non-terminal (`docs/07` §1). */
export const POLL_MS = 1500;

/** An import is still working, and its resources are still worth re-reading. */
export const isImportRunning = (status: ImportStatus["status"] | undefined) =>
  status === "queued" || status === "extracting";

export const useSession = () =>
  useQuery({
    queryKey: keys.session,
    queryFn: () => api<{ user: SessionUser }>("/api/auth/session"),
    retry: false,
  });

/**
 * The profile, or `null` when there is not one yet.
 *
 * A first run has no profile, and the server says so with a 404. That is a
 * STATE, not a failure, and it must be modelled as data: a query that never
 * holds data is reset to `pending` by React Query on every refetch, which makes
 * `isLoading` true again, which unmounts whatever the gate was rendering, which
 * remounts and refetches — an unbreakable loop. Returning `null` settles the
 * query and the question with it.
 */
export const useProfile = () =>
  useQuery({
    queryKey: keys.profile,
    queryFn: async () => {
      try {
        return await api<Profile>("/api/profile");
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
    retry: false,
  });

/**
 * One of the five hand-entered collections.
 *
 * They are read together on the record screen and they reference one another —
 * a role needs its employer's name, a project may name one — so each is its own
 * query keyed by its collection name and nothing composes them on the server.
 */
export function useEntities<T>(key: EntityKey) {
  return useQuery(entityQuery<T>(key));
}

const entityQuery = <T,>(key: EntityKey) => ({
  queryKey: keys.entity(key),
  queryFn: () => api<{ items: T[] }>(`/api/${key}`),
});

/**
 * One collection, read at the moment it is needed rather than off the render.
 *
 * The import picker decides whether to offer a project the instant a file is
 * chosen. Reading a query that had not settled yet would import with no project
 * offered and leave no sign that a choice was skipped, so the caller waits for
 * the answer instead of guessing it. A settled query returns from cache.
 */
export function useEntitiesOnDemand<T>(key: EntityKey) {
  const queryClient = useQueryClient();
  return () => queryClient.ensureQueryData(entityQuery<T>(key));
}

/**
 * Create, edit and delete for one collection.
 *
 * Deleting an employer that something still points at answers `409 conflict`
 * with the counts of what is attached. That is surfaced as it arrives rather
 * than pre-empted by a check in the client: the server owns the rule, and a
 * client that guessed it would drift (`docs/07` §4).
 */
export function useEntityActions(key: EntityKey) {
  const queryClient = useQueryClient();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: keys.entity(key) });
    void queryClient.invalidateQueries({ queryKey: keys.overview });
    // An employer's name and dates are part of every render's structure, so
    // changing one is what makes a generated document out of date.
    void queryClient.invalidateQueries({ queryKey: keys.renders });
    // Dates move the 履歴書's gaps, and a deleted row takes its counts.
    void queryClient.invalidateQueries({ queryKey: keys.careerTimeline });
  };

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api<{ id: string }>(`/api/${key}`, { method: "POST", ...json(body) }),
    onSuccess: refresh,
  });
  const update = useMutation({
    mutationFn: (input: { id: string; body: Record<string, unknown> }) =>
      api<{ id: string }>(`/api/${key}/${input.id}`, { method: "PATCH", ...json(input.body) }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api<void>(`/api/${key}/${id}`, { method: "DELETE" }),
    onSuccess: refresh,
  });

  return { create, update, remove };
}

export type IncludableEntity = "employer" | "education" | "project";

export interface RenderInclusion {
  entityType: IncludableEntity;
  entityId: string;
  kind: RenderKind;
  included: boolean;
}

/**
 * Which renders each employer, project and education appears in (S13).
 *
 * The server stores only the departures from the default, so an entry with no
 * row is in every render and the screen reads it that way.
 */
export const useRenderInclusions = () =>
  useQuery({
    queryKey: keys.inclusions,
    queryFn: () => api<{ items: RenderInclusion[] }>("/api/render-inclusions"),
  });

export function useSetRenderInclusion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: RenderInclusion) =>
      api<RenderInclusion>("/api/render-inclusions", { method: "PUT", ...json(body) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.inclusions });
      // A row left out of the 履歴書 is a row its gap warning no longer counts.
      void queryClient.invalidateQueries({ queryKey: keys.careerTimeline });
    },
  });
}

/**
 * What the career timeline shows beside the rows (issue #113): achievement
 * counts per employer and project, and the 履歴書's gaps.
 */
export const useCareerTimeline = () =>
  useQuery({
    queryKey: keys.careerTimeline,
    queryFn: () => api<CareerTimeline>("/api/career-timeline"),
  });

export interface CuratedSkill {
  name: string;
  factCount: number;
  certificationCount: number;
  /** The latest a fact or certification naming it reaches. */
  lastUsed: LastUsed;
  /** No accepted, render-eligible fact and no certification names it any longer. Flagged, never removed. */
  stale: boolean;
}

export interface SkillCandidate {
  name: string;
  factCount: number;
  certificationCount: number;
  lastUsed: LastUsed;
  curated: boolean;
  /**
   * The group it is offered: the one it is most often named beside, else the one
   * sharing the most employers, else the largest. Null when curated, or when
   * there is no group.
   */
  suggestedGroup: string | null;
}

export interface SkillCuration {
  groups: { name: string; nameJa: string | null; skills: CuratedSkill[] }[];
  candidates: SkillCandidate[];
  /** What the English résumé may name in its Skills section, ranked as its uncurated line is. */
  printable: string[];
}

/** What `PUT /api/skills/curation` takes: the whole list, names only. */
export type SkillCurationInput = { name: string; nameJa: string | null; skills: string[] }[];

/** The skills curation (S9). An empty `groups` means nothing is curated. */
export const useSkillCuration = () =>
  useQuery({
    queryKey: keys.skills,
    queryFn: () => api<SkillCuration>("/api/skills/curation"),
  });

export function useSaveSkillCuration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (groups: SkillCurationInput) =>
      api<SkillCuration>("/api/skills/curation", { method: "PUT", ...json({ groups }) }),
    onSuccess: (data) => queryClient.setQueryData(keys.skills, data),
    // A refused save re-reads, so the screen shows what is stored rather than
    // what was attempted (`docs/10` Screen 7).
    onError: () => void queryClient.invalidateQueries({ queryKey: keys.skills }),
  });
}

/**
 * Screen 3. Polls while an import runs or a proposal is being written, so its
 * progress moves, and the new version becomes ready, without a reload.
 */
export const useOverview = () =>
  useQuery({
    queryKey: keys.overview,
    queryFn: () => api<Overview>("/api/overview"),
    refetchInterval: (query) =>
      isImportRunning(query.state.data?.activeImport?.status) ||
      (query.state.data?.latestImportSet ?? []).some((row) => isImportRunning(row.status)) ||
      (query.state.data?.documents ?? []).some((row) => row.status === "proposal_generating")
        ? POLL_MS
        : false,
  });

export const useRenders = () =>
  useQuery({
    queryKey: keys.renders,
    queryFn: () => api<{ items: RenderRow[] }>("/api/renders"),
  });

export function useImportStatus(importId: string) {
  return useQuery({
    queryKey: keys.importStatus(importId),
    queryFn: () => api<ImportStatus>(`/api/imports/${importId}`),
    refetchInterval: (query) => (isImportRunning(query.state.data?.status) ? POLL_MS : false),
  });
}

/** Screen 8. Polls while any version runs. */
export const useDocuments = () =>
  useQuery({
    queryKey: keys.documents,
    queryFn: () => api<DocumentsListing>("/api/imports"),
    refetchInterval: (query) =>
      query.state.data?.documents.some((d) => d.versions.some((v) => isImportRunning(v.status)))
        ? POLL_MS
        : false,
  });

/**
 * The sidebar's open-candidate badge, which is on screen on EVERY sidebar
 * screen. Deliberately not `useDocuments`: that fetched every document, every
 * version and every fact count on Home, Record and Skills for one number, and
 * polled all of it while an import ran.
 */
export const useImportSummary = () =>
  useQuery({
    queryKey: keys.importSummary,
    queryFn: () => api<ImportSummary>("/api/imports/summary"),
    refetchInterval: (query) => (query.state.data?.running ? POLL_MS : false),
  });

export function useFacts(importId: string, options?: Partial<UseQueryOptions<{ items: Fact[] }>>) {
  return useQuery({
    queryKey: keys.facts(importId),
    // Every page. The API pages at 100 and an import can hold more — the
    // 2026-09-04 import holds 112, and its last dozen were never on the rail.
    queryFn: async () => {
      const items: Fact[] = [];
      let cursor: string | null = null;
      do {
        const page: { items: Fact[]; nextCursor: string | null } = await api(
          `/api/facts?importId=${importId}${cursor ? `&cursor=${cursor}` : ""}`,
        );
        items.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor);
      return { items };
    },
    ...options,
  });
}

/**
 * `enabled` is not an optimisation. The caller learns the document id from the
 * import status, so on the first render it has none, and an unguarded query
 * requests `/api/source-documents//versions/1/text` — a 404 in the console and
 * the worker log, in exactly the place a real 404 would need to be noticed
 * (issue #11).
 */
export const useSourceText = (documentId: string, versionNo: number) =>
  useQuery({
    queryKey: keys.sourceText(documentId, versionNo),
    queryFn: () => api<SourceText>(`/api/source-documents/${documentId}/versions/${versionNo}/text`),
    enabled: documentId !== "",
  });

export function useProposal(proposalId: string) {
  return useQuery({
    queryKey: keys.proposal(proposalId),
    queryFn: () => api<Proposal>(`/api/proposals/${proposalId}`),
    refetchInterval: (query) =>
      query.state.data?.generationStatus === "generating" ? POLL_MS : false,
  });
}

/**
 * The two halves of the history, read separately and merged in the one place
 * that needs them merged (`docs/06`, 2026-09-12).
 */
export const useVersionHistory = (ref: string) =>
  useQuery({
    queryKey: keys.versions(ref),
    queryFn: () => api<VersionHistory>(`/api/renders/${ref}/versions`),
    // A `404` is the answer "there is no such document", not a blip to retry.
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 3,
  });

/** A document as the render routes address it and the screens name it. */
export interface Doc {
  /** A kind for a main document, or a tailored résumé's id. */
  ref: string;
  kind: RenderKind;
  title: string;
}

/**
 * The document a `/renders/$ref/…` screen is about. A main document is known
 * from its kind alone, at once. A tailored résumé is named by the server, so
 * its screens wait for the history read; `missing` is that read answering that
 * there is no such document.
 */
export function useDoc(ref: string): {
  doc: Doc | null;
  missing: boolean;
  failure: { error: unknown; refetch: () => unknown } | null;
} {
  const history = useVersionHistory(ref);
  if (history.isError && !history.data) {
    const missing = history.error instanceof ApiError && history.error.status === 404;
    return { doc: null, missing, failure: missing ? null : history };
  }
  if ((RENDER_KINDS as readonly string[]).includes(ref)) {
    const kind = ref as RenderKind;
    return { doc: { ref, kind, title: RENDER_TITLE[kind] }, missing: false, failure: null };
  }
  if (history.data) {
    return { doc: { ref, kind: history.data.renderKind, title: history.data.title }, missing: false, failure: null };
  }
  return { doc: null, missing: false, failure: null };
}

/** A version's stored structure, by id. `null` means there is nothing to edit. */
export const useStoredVersion = (ref: string, versionId: string | null) =>
  useQuery({
    queryKey: keys.version(ref, versionId ?? ""),
    queryFn: () => api<StoredVersion>(`/api/renders/${ref}/versions/${versionId}`),
    enabled: versionId !== null,
    // A stored version is immutable; re-reading it would only risk replacing
    // the document under an editor that has unsaved work in it.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

/** One version as it would print today (`docs/10` Screen 17, issue #106). */
export interface RenderPage {
  renderKind: RenderKind;
  renderRef: string;
  title: string;
  language: "en" | "ja";
  tailored: boolean;
  /** The application a tailored résumé belongs to. `null` on a main document. */
  applicationId: string | null;
  /** The document's row, as Home or its application shows it. */
  document: RenderRow;
  canGenerate: boolean;
  version: Pick<RenderVersion, "id" | "versionNo" | "origin" | "acceptedAt" | "isCurrent">;
  page: SentPage;
  /** Every fact the page's lines cite, for "Show where each line comes from" (issue #110). */
  evidence: FactEvidence[];
}

/** `versionId` absent reads the current version. A refusal is an answer, not a blip to retry. */
export const useRenderPage = (ref: string, versionId: string | undefined, enabled = true) =>
  useQuery({
    queryKey: keys.page(ref, versionId ?? "current"),
    enabled,
    queryFn: () =>
      api<RenderPage>(`/api/renders/${ref}/page${versionId ? `?versionId=${encodeURIComponent(versionId)}` : ""}`),
    retry: (count, error) => !(error instanceof ApiError && (error.status === 404 || error.status === 409)) && count < 3,
    refetchInterval: (query) => (query.state.data?.document.status === "proposal_generating" ? POLL_MS : false),
  });

export const useRenderProposals = (ref: string) =>
  useQuery({
    queryKey: keys.proposals(ref),
    queryFn: () => api<{ items: ProposalRow[] }>(`/api/proposals?kind=${ref}`),
  });

/* ------------------------------------------------------------ applications */

/** What the list shows of one application (issue #70). Every figure is worked out on read. */
export interface ApplicationSummary extends Standing, Figures {
  id: string;
  company: string;
  /** Empty on an application carried over from a tailored résumé, until it is filled in. */
  position: string;
  postingUrl: string | null;
  /** When the author last changed it. The list is ordered by this. */
  lastActivityAt: string;
}

export interface ApplicationRow extends ApplicationSummary {
  /**
   * The latest sent copy of each document. With nothing sent, the documents
   * chosen, and `sent` is false.
   */
  resume: { documents: NamedVersion[]; sent: boolean };
}

/** A document on an application (issue #71): the same document as on Home, pointed at. */
export interface ApplicationDocument {
  /** What the render routes address it by: its kind, or the tailored résumé's id. */
  ref: string;
  kind: RenderKind;
  tailored: boolean;
  title: string;
  language: "en" | "ja";
  currentVersionId: string | null;
  currentVersionNo: number | null;
  status: RenderRow["status"];
  newFactsSince: number | null;
  withdrawnFactsSince: number | null;
  pendingProposalId: string | null;
}

/** A document that could be ticked: the three, and this application's tailored résumé. */
export interface DocumentChoice extends ApplicationDocument {
  onApplication: boolean;
}

/** One copy that was sent. The file and its page are read from its own routes. */
export interface SentCopy {
  id: string;
  ref: string;
  kind: RenderKind;
  title: string;
  versionNo: number;
  sentOn: string;
  recordedAt: string;
}

export interface Application extends ApplicationSummary {
  requirements: string[];
  jobDescription: string;
  documents: ApplicationDocument[];
  choices: DocumentChoice[];
  /** Every copy, most recently recorded first. */
  sentCopies: SentCopy[];
  canGenerate: boolean;
  /** Its interview entries, newest day first (issue #72). */
  interviews: Interview[];
  /** Today in Japan, which every figure is counted to. */
  today: string;
  /** On the answer to a change that froze documents: which ones. */
  frozen?: NamedVersion[];
}

/** A sent copy as it is read (`docs/10` Screen 15). */
export interface SentCopyPage extends Omit<SentCopy, "ref"> {
  applicationId: string;
  company: string;
  language: "en" | "ja";
  filename: string;
  page: SentPage;
}

export interface ApplicationFields {
  company: string;
  position: string;
  postingUrl: string | null;
  requirements: string[];
}

/** Every application, newest activity first. */
export const useApplications = () =>
  useQuery({
    queryKey: keys.applications,
    queryFn: () => api<{ items: ApplicationRow[]; today: string }>("/api/applications"),
  });

export const useApplication = (id: string) =>
  useQuery({
    queryKey: keys.application(id),
    queryFn: () => api<Application>(`/api/applications/${id}`),
    // A `404` is the answer "there is no such application", not a blip to retry.
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 3,
    refetchInterval: (query) =>
      query.state.data?.documents.some((document) => document.status === "proposal_generating") ? POLL_MS : false,
  });

export const useSentCopy = (applicationId: string, copyId: string) =>
  useQuery({
    queryKey: [...keys.sentCopies(applicationId), copyId] as const,
    queryFn: () => api<SentCopyPage>(`/api/applications/${applicationId}/sent-copies/${copyId}`),
    retry: (count, error) => !(error instanceof ApiError && error.status === 404) && count < 3,
    // The file as it was that day: it does not change while it is being read.
    // Its date, its company and whether it is there at all follow the application.
    staleTime: Infinity,
  });

/** The stored file of a sent copy. Fetched, so a refusal is said on the screen and not in a tab of JSON. */
export const downloadSentCopy = (applicationId: string, copyId: string): Promise<void> =>
  saveResponse(
    `/api/applications/${applicationId}/sent-copies/${copyId}/download`,
    "sent-copy.docx",
    "That copy could not be downloaded.",
  );

export function useCreateApplication() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ApplicationFields & { jobDescription: string }) =>
      api<Application>("/api/applications", { method: "POST", ...json(body) }),
    onSuccess: (made) => {
      queryClient.setQueryData(keys.application(made.id), made);
      void queryClient.invalidateQueries({ queryKey: keys.applications, exact: true });
    },
  });
}

/** What was read from a pasted posting: a proposal to check, and nothing saved (issue #73). */
export interface PostingProposal {
  company: string;
  position: string;
  requirements: string[];
}

/** Reads a pasted posting. It writes nothing, so there is nothing to refresh afterwards. */
export const useReadPosting = () =>
  useMutation({
    mutationFn: (jobDescription: string) =>
      api<PostingProposal>("/api/applications/read-posting", { method: "POST", ...json({ jobDescription }) }),
  });

/** What quick capture asks about a claim when the text does not say it. */
export type CaptureQuestion = "when" | "employer" | "change" | "proof";

/** One claim split out of what was typed: a proposal to confirm, and nothing saved (issue #95). */
export interface CapturedClaim {
  claim: string;
  month: string | null;
  employerId: string | null;
  projectId: string | null;
  technologies: string[];
  missing: CaptureQuestion[];
}

/** A claim as it is saved. `employerId: null` is a chosen `No employer`; absent is not said. */
export interface CaptureSave {
  claim: string;
  month: string | null;
  employerId?: string | null;
  projectId?: string;
  technologies: string[];
}

/** Splits what was typed into claims. It writes nothing, so there is nothing to refresh afterwards. */
export const useReadCapture = () =>
  useMutation({
    mutationFn: (input: { text: string; today: string }) =>
      api<{ claims: CapturedClaim[] }>("/api/capture/read", { method: "POST", ...json(input) }),
  });

/** Saves confirmed claims into the record. Home counts them, and every list of facts may hold them. */
export function useSaveCapture() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (claims: CaptureSave[]) =>
      api<{ items: Fact[] }>("/api/capture", { method: "POST", ...json({ claims }) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.overview });
      void queryClient.invalidateQueries({ queryKey: keys.allFacts });
    },
  });
}

/**
 * Puts the monthly capture prompt away until the author's month ends. The
 * answer is written into the overview held here, so the Next step moves on
 * without a read again.
 */
export function useDismissCapturePrompt() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (month: string) =>
      api<{ dismissedOn: string }>("/api/capture/prompt/dismiss", { method: "POST", ...json({ month }) }),
    onSuccess: ({ dismissedOn }) =>
      queryClient.setQueryData<Overview>(keys.overview, (held) =>
        held?.capturePrompt ? { ...held, capturePrompt: { ...held.capturePrompt, dismissedOn } } : held,
      ),
  });
}

/** The facts quick capture saved, accepted and rejected alike, so each keeps a card to change it on. */
export function useCapturedFacts() {
  return useQuery({
    queryKey: keys.capturedFacts,
    queryFn: async () => {
      const items: Fact[] = [];
      let cursor: string | null = null;
      do {
        const page: { items: Fact[]; nextCursor: string | null } = await api(
          `/api/facts?captured=true${cursor ? `&cursor=${cursor}` : ""}`,
        );
        items.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor);
      return { items };
    },
  });
}

/** One change to where an application stands. Each answers with the application as it is afterwards. */
export type StandingChange =
  | { change: "set"; status: ApplicationStatus }
  | { change: "date"; status: ApplicationStatus; date: string }
  | { change: "reopen" }
  /** Undo: the standing from before a change, put back whole. */
  | { change: "restore"; standing: Standing };

export function useApplicationActions(id: string) {
  const queryClient = useQueryClient();
  const base = `/api/applications/${id}`;
  const settled = (next: Application) => {
    queryClient.setQueryData(keys.application(id), next);
    void queryClient.invalidateQueries({ queryKey: keys.applications, exact: true });
    void queryClient.invalidateQueries({ queryKey: keys.sentCopies(id) });
  };
  const edit = useMutation({
    mutationFn: (body: ApplicationFields) => api<Application>(base, { method: "PATCH", ...json(body) }),
    onSuccess: settled,
  });
  const stand = useMutation({
    mutationFn: (action: StandingChange) =>
      action.change === "set"
        ? api<Application>(`${base}/steps`, { method: "POST", ...json({ status: action.status }) })
        : action.change === "date"
          ? api<Application>(`${base}/steps/${action.status}`, { method: "PATCH", ...json({ date: action.date }) })
          : action.change === "reopen"
            ? api<Application>(`${base}/reopen`, { method: "POST" })
            : api<Application>(`${base}/standing`, { method: "PUT", ...json(action.standing) }),
    onSuccess: settled,
  });
  /** What changes the documents on it, or records what was sent (issue #71). */
  const documents = useMutation({
    mutationFn: (action: DocumentChange) =>
      action.change === "choose"
        ? api<Application>(`${base}/documents`, { method: "PUT", ...json({ documents: action.kinds }) })
        : action.change === "take-off"
          ? api<Application>(`${base}/documents/${action.ref}`, { method: "DELETE" })
          : action.change === "tailor"
            ? api<Application>(`${base}/tailored-resume`, { method: "POST" })
            : api<Application>(`${base}/sent-copies`, { method: "POST", ...json({ documents: action.refs }) }),
    onSuccess: settled,
  });
  return { edit, stand, documents };
}

/** An interview entry as the form sends it. Each question is its own item, in order. */
export interface InterviewFields {
  date: string;
  round: InterviewRound;
  who: string;
  howItWent: string;
  questions: string[];
}

/**
 * Adds an interview entry. The answer is the application afterwards, which has
 * moved to the entry's round when that round was a later step.
 */
export function useAddInterview(applicationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: InterviewFields) =>
      api<Application>(`/api/applications/${applicationId}/interviews`, { method: "POST", ...json(body) }),
    onSuccess: (next) => {
      queryClient.setQueryData(keys.application(applicationId), next);
      void queryClient.invalidateQueries({ queryKey: keys.applications, exact: true });
    },
  });
}

/** A saved entry as its correction sends it: a question it keeps goes under its id, a new one without. */
export type InterviewCorrection = Omit<InterviewFields, "questions"> & { questions: { id?: string; text: string }[] };

/**
 * A saved interview entry corrected (issue #81), named by `interviewId`. The
 * answer is the application afterwards; a corrected day or round can have
 * changed where it stands.
 */
export function useCorrectInterview(applicationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ interviewId, ...body }: InterviewCorrection & { interviewId: string }) =>
      api<Application>(`/api/applications/${applicationId}/interviews/${interviewId}`, { method: "PUT", ...json(body) }),
    onSuccess: (next) => {
      queryClient.setQueryData(keys.application(applicationId), next);
      void queryClient.invalidateQueries({ queryKey: keys.applications, exact: true });
    },
  });
}

/** A saved interview entry deleted (issue #81). The answer is the application afterwards. */
export function useDeleteInterview(applicationId: string, interviewId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<Application>(`/api/applications/${applicationId}/interviews/${interviewId}`, { method: "DELETE" }),
    onSuccess: (next) => {
      queryClient.setQueryData(keys.application(applicationId), next);
      void queryClient.invalidateQueries({ queryKey: keys.applications, exact: true });
    },
  });
}
export type DocumentChange =
  /** Before Applied: which of the three are on the application, whole. */
  | { change: "choose"; kinds: SendableKind[] }
  | { change: "take-off"; ref: string }
  /** Stores the tailored résumé and puts it on the application. Generating it is `useGenerate`. */
  | { change: "tailor" }
  /** From Applied onward: each is frozen as a further sent copy, always. */
  | { change: "record"; refs: string[] };

/** How far an upload has got, in bytes. */
export interface UploadProgress {
  loaded: number;
  total: number;
}

/**
 * An upload that never got an answer: the connection dropped, the page went
 * offline, or the server stopped part way. Nothing was kept.
 */
export class UploadInterrupted extends Error {
  constructor() {
    super("The upload stopped before it finished.");
    this.name = "UploadInterrupted";
  }
}

/**
 * Sends an audio file as the raw body of one request, with its progress.
 * `XMLHttpRequest` and not `fetch`, because only it reports how much of a
 * request body has gone. Refusals become the same `ApiError` as {@link api}'s.
 */
function sendAudio(
  path: string,
  file: File,
  durationSeconds: number | null,
  onProgress: (progress: UploadProgress) => void,
): Promise<Application> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", path);
    request.responseType = "json";
    request.setRequestHeader("content-type", file.type || "application/octet-stream");
    request.setRequestHeader("x-file-name", encodeURIComponent(file.name));
    if (durationSeconds !== null) request.setRequestHeader("x-duration-seconds", String(durationSeconds));
    request.upload.onprogress = (event) => onProgress({ loaded: event.loaded, total: event.lengthComputable ? event.total : file.size });
    request.onerror = () => reject(new UploadInterrupted());
    request.onabort = () => reject(new UploadInterrupted());
    request.ontimeout = () => reject(new UploadInterrupted());
    request.onload = () => {
      const body = request.response as (Application & Partial<ApiErrorBody>) | null;
      if (request.status >= 200 && request.status < 300 && body) return resolve(body);
      // An answer that is not ours, or a server that gave up mid-file: either way nothing was kept.
      if (!body?.error || request.status >= 500) return reject(new UploadInterrupted());
      reject(
        new ApiError(
          request.status,
          body.error.code ?? "internal",
          body.error.message ?? "Something went wrong.",
          body.error.details?.fields ?? [],
          body.error.details ?? {},
        ),
      );
    };
    request.send(file);
  });
}

/** Where an uploaded recording is played from, and with `download` where it is saved from. */
export const recordingAudioPath = (applicationId: string, interviewId: string, recordingId: string) =>
  `/api/applications/${applicationId}/interviews/${interviewId}/recordings/${recordingId}/audio`;

/**
 * The recordings of one interview entry: a link added (issue #74), an audio
 * file uploaded (#76), and a recording removed for good. Each answers with the
 * application afterwards.
 */
export function useRecordings(applicationId: string, interviewId: string) {
  const queryClient = useQueryClient();
  const base = `/api/applications/${applicationId}/interviews/${interviewId}/recordings`;
  const settled = (next: Application) => {
    queryClient.setQueryData(keys.application(applicationId), next);
    void queryClient.invalidateQueries({ queryKey: keys.applications, exact: true });
  };
  const addLink = useMutation({
    mutationFn: (body: { url: string; label: string }) => api<Application>(base, { method: "POST", ...json(body) }),
    onSuccess: settled,
  });
  const upload = useMutation({
    mutationFn: async ({
      file,
      durationSeconds,
      onProgress,
    }: {
      file: File;
      durationSeconds: number | null;
      onProgress: (progress: UploadProgress) => void;
    }) => {
      const before = new Set(
        queryClient
          .getQueryData<Application>(keys.application(applicationId))
          ?.interviews.find((entry) => entry.id === interviewId)
          ?.recordings.map((recording) => recording.id),
      );
      try {
        return await sendAudio(`${base}/audio`, file, durationSeconds, onProgress);
      } catch (error) {
        if (!(error instanceof UploadInterrupted)) throw error;
        // The connection can drop after the server stored the file and before its answer arrived.
        // Read the application again before saying nothing was kept; a failed read says it anyway.
        const next = await api<Application>(`/api/applications/${applicationId}`).catch(() => null);
        const landed = next?.interviews
          .find((entry) => entry.id === interviewId)
          ?.recordings.some(
            (recording) =>
              recording.kind === "upload" &&
              !before.has(recording.id) &&
              recording.fileName === keptFileName(file.name) &&
              recording.byteSize === file.size,
          );
        if (next && landed) return next;
        throw error;
      }
    },
    onSuccess: settled,
  });
  const remove = useMutation({
    mutationFn: (recordingId: string) => api<Application>(`${base}/${recordingId}`, { method: "DELETE" }),
    onSuccess: settled,
  });
  return { addLink, upload, remove };
}

/**
 * The restore preview's diff. `from` is the current version, so the split view
 * reports what committing the restore will CHANGE rather than what it undoes.
 */
export const useVersionDiff = (ref: string, from: string | null, to: string | null) =>
  useQuery({
    queryKey: keys.versionDiff(ref, from ?? "", to ?? ""),
    queryFn: () => api<RenderDiff>(`/api/renders/${ref}/diff?from=${from}&to=${to}`),
    enabled: from !== null && to !== null,
  });

export const useDiff = (proposalId: string, enabled: boolean) =>
  useQuery({
    queryKey: keys.diff(proposalId),
    queryFn: () =>
      api<RenderDiff & { preview: { title: string; page: SentPage } | null }>(`/api/proposals/${proposalId}/diff`),
    enabled,
  });

/* ---------------------------------------------------------------- mutations */

export function useSaveProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (profile: Record<string, unknown>) =>
      api<Profile>("/api/profile", { method: "PUT", ...json(profile) }),
    onSuccess: (saved) => {
      // Seed the cache with the saved profile rather than only invalidating it.
      // The first save is followed immediately by a navigation away from the
      // form, and the gate redirects back while the profile still reads as
      // missing — so an invalidate alone leaves the first run stranded on the
      // form until a refetch it never waits for. Writing the answer in makes
      // the gate correct on the very next render.
      queryClient.setQueryData(keys.profile, saved);
      void queryClient.invalidateQueries({ queryKey: keys.overview });
      void queryClient.invalidateQueries({ queryKey: keys.renders });
    },
  });
}

/**
 * The profile photo's address for an `<img>`, or null when there is none. The
 * image is fetched on its own and never rides in a JSON body (`docs/07` §4).
 */
export function useProfilePhotoSrc(): string | null {
  const profile = useProfile();
  const version = profile.data?.photoVersion;
  return version ? `/api/profile/photo?v=${version}` : null;
}

/**
 * A photo saved or removed changes the 履歴書 everywhere it is read: its page
 * on View and on Home's card, the first-version preview, and the review
 * footer's note that the cell is empty.
 */
function photoChanged(queryClient: ReturnType<typeof useQueryClient>, saved: Profile) {
  queryClient.setQueryData(keys.profile, saved);
  void queryClient.invalidateQueries({ queryKey: keys.renders });
  void queryClient.invalidateQueries({ queryKey: ["proposal"] });
}

/** Puts the cropped photo on the profile. The body is the JPEG itself, never a form. */
export function useSaveProfilePhoto() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (photo: Blob) =>
      api<Profile>("/api/profile/photo", { method: "PUT", body: photo, headers: { "content-type": photo.type || "image/jpeg" } }),
    onSuccess: (saved) => photoChanged(queryClient, saved),
  });
}

export function useRemoveProfilePhoto() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<Profile>("/api/profile/photo", { method: "DELETE" }),
    onSuccess: (saved) => photoChanged(queryClient, saved),
  });
}

export function useStartImport() {
  const queryClient = useQueryClient();
  return useMutation({
    /** `sourceDocumentId` makes this a re-import: a new version of that document. */
    mutationFn: (input: { file: File; projectId?: string; employerId?: string; sourceDocumentId?: string }) => {
      const form = new FormData();
      form.set("file", input.file);
      if (input.projectId) form.set("projectId", input.projectId);
      if (input.employerId) form.set("employerId", input.employerId);
      if (input.sourceDocumentId) form.set("sourceDocumentId", input.sourceDocumentId);
      return api<{ importId: string; sourceDocumentId: string; versionNo: number }>("/api/imports", {
        method: "POST",
        body: form,
      });
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.overview }),
    // A refused re-import re-reads the list as well: the 409 means it was stale.
    onSettled: () => void queryClient.invalidateQueries({ queryKey: keys.documents }),
  });
}

export function useStartImportBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (rows: { file: File; projectId?: string; employerId?: string }[]) => {
      const form = new FormData();
      for (const row of rows) {
        form.append("file", row.file);
        form.append("filing", JSON.stringify({ projectId: row.projectId, employerId: row.employerId }));
      }
      return api<{ results: { importId?: string; reason?: string }[] }>("/api/imports/batch", {
        method: "POST", body: form,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.overview });
      void queryClient.invalidateQueries({ queryKey: keys.documents });
    },
  });
}

/**
 * Refiling a document under a project, an employer or both, which moves its
 * facts with it. Only what changed is sent: a field left out stays as it is.
 *
 * The source-text query carries the Fact Review breadcrumb's project, so it is
 * invalidated by document prefix rather than by the one version on screen. The
 * facts are invalidated too, because each one that reads its employer through
 * the document now reads a different one.
 */
export function useRefileDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      sourceDocumentId,
      ...body
    }: {
      sourceDocumentId: string;
      projectId?: string | null;
      employerId?: string | null;
    }) =>
      api<{
        sourceDocumentId: string;
        project: { id: string; name: string } | null;
        employer: { id: string; name: string } | null;
        facts: number;
        employerSetByHand: number;
      }>(`/api/source-documents/${sourceDocumentId}`, { method: "PATCH", ...json(body) }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["source", result.sourceDocumentId] });
      void queryClient.invalidateQueries({ queryKey: keys.overview });
      void queryClient.invalidateQueries({ queryKey: keys.allFacts });
    },
    // A refused refile re-reads the list as well: the 409 means it was stale.
    onSettled: () => void queryClient.invalidateQueries({ queryKey: keys.documents }),
  });
}

export function useRetryImport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (importId: string) => api<ImportStatus>(`/api/imports/${importId}/retry`, { method: "POST" }),
    onSuccess: (status) => {
      void queryClient.invalidateQueries({ queryKey: keys.importStatus(status.importId) });
      void queryClient.invalidateQueries({ queryKey: keys.overview });
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: keys.documents }),
  });
}

/**
 * Every accept, reject and edit is saved as it is made rather than at the end,
 * so closing the tab mid-review loses nothing.
 */
export function useFactAction(importId: string) {
  const queryClient = useQueryClient();
  // Every import's list, not only this one's: rejecting a fact here drops it
  // from the likely matches on another document's cards. The overview too:
  // Home counts these facts, and holds its Next step back only once told.
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: keys.overview });
    void queryClient.invalidateQueries({ queryKey: keys.renders });
    return queryClient.invalidateQueries({ queryKey: keys.allFacts });
  };

  const patch = useMutation({
    mutationFn: (input: {
      id: string;
      body: Partial<Pick<Fact, "claim" | "provenance" | "disclosure" | "employerId" | "month">>;
    }) =>
      api<Fact>(`/api/facts/${input.id}`, { method: "PATCH", ...json(input.body) }),
    onSuccess: () => void refresh(),
  });
  const resolve = useMutation({
    mutationFn: (input: { id: string; action: "accept" | "reject" | "undo" }) =>
      api<Fact>(`/api/facts/${input.id}/${input.action}`, { method: "POST" }),
    onSuccess: () => {
      void refresh();
      // The sidebar's open count is derived from candidates.
      void queryClient.invalidateQueries({ queryKey: keys.documents });
    },
  });
  /** An accepted fact's provenance, set by the author (`docs/07` §6, issue #37). */
  const regrade = useMutation({
    mutationFn: (input: { id: string; provenance: Fact["provenance"] }) =>
      api<Fact>(`/api/facts/${input.id}/regrade`, {
        method: "POST",
        ...json({ provenance: input.provenance }),
      }),
    onSuccess: () => void refresh(),
  });
  const finish = useMutation({
    mutationFn: () => api<{ acceptedFacts: number }>(`/api/imports/${importId}/finish`, { method: "POST" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.overview });
      void queryClient.invalidateQueries({ queryKey: keys.renders });
    },
  });
  const retry = useMutation({
    mutationFn: () => api<ImportStatus>(`/api/imports/${importId}/retry`, { method: "POST" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.importStatus(importId) });
      void queryClient.invalidateQueries({ queryKey: keys.documents });
      void queryClient.invalidateQueries({ queryKey: keys.overview });
    },
  });

  return { patch, resolve, regrade, finish, retry };
}

export function useGenerate() {
  const queryClient = useQueryClient();
  return useMutation({
    /** `ref` is a kind for a main document, or a tailored résumé's id. */
    mutationFn: (ref: string) =>
      api<{ proposalId: string }>(`/api/renders/${ref}/generate`, { method: "POST" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.renders });
      void queryClient.invalidateQueries({ queryKey: keys.overview });
    },
  });
}

export function useDecideProposal(proposalId: string) {
  const queryClient = useQueryClient();
  const after = () => {
    void queryClient.invalidateQueries({ queryKey: keys.proposal(proposalId) });
    void queryClient.invalidateQueries({ queryKey: keys.renders });
    void queryClient.invalidateQueries({ queryKey: keys.overview });
  };
  const accept = useMutation({
    mutationFn: () =>
      api<{ newVersionNo: number }>(`/api/proposals/${proposalId}/accept`, { method: "POST" }),
    onSuccess: after,
    onError: after,
  });
  const dismiss = useMutation({
    mutationFn: () => api<{ status: string }>(`/api/proposals/${proposalId}/dismiss`, { method: "POST" }),
    onSuccess: after,
    onError: after,
  });
  return { accept, dismiss };
}

/**
 * Restore (S14). It APPENDS a version rather than erasing the ones after it,
 * so everything that reads a version list or a render's status is refreshed.
 */
export function useRestoreVersion(ref: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (versionId: string) =>
      api<{ newVersionNo: number; sourceVersionNo: number }>(
        `/api/renders/${ref}/versions/${versionId}/restore`,
        { method: "POST" },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.versions(ref) });
      void queryClient.invalidateQueries({ queryKey: keys.renders });
      void queryClient.invalidateQueries({ queryKey: keys.overview });
    },
  });
}

/**
 * A hand edit (S16). Like restore it APPENDS, so everything that reads a
 * version list or a render's status is refreshed — but the version it was made
 * from is deliberately NOT invalidated: it is immutable and still readable.
 */
export function useEditVersion(ref: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { basedOnVersionId: string; content: RenderContent }) =>
      api<EditResult>(`/api/renders/${ref}/versions`, { method: "POST", ...json(body) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.versions(ref) });
      void queryClient.invalidateQueries({ queryKey: keys.renders });
      void queryClient.invalidateQueries({ queryKey: keys.overview });
    },
  });
}

/** `versionId` omitted means the current version — the server's own default. */
const downloadUrl = (ref: string, format: DownloadFormat, versionId?: string) =>
  `/api/renders/${ref}/download?format=${format}${versionId ? `&versionId=${versionId}` : ""}`;

/**
 * A download is FETCHED rather than navigated to, which is the whole reason
 * this exists. The route re-checks citations on every request and refuses with
 * `409` naming the fact ids (`docs/07` §7), and a plain `<a href>` would land
 * that refusal in a browser tab as raw JSON. Fetching turns it back into an
 * `ApiError` the screen can state.
 *
 * The file is saved through an object URL because the response body is the
 * document and there is no second request to spend on it. The URL is revoked
 * immediately; the click has already handed the bytes to the browser.
 */
export const downloadRender = (ref: string, format: DownloadFormat, versionId?: string): Promise<void> =>
  saveResponse(downloadUrl(ref, format, versionId), `${ref}.${format}`, "That document could not be downloaded.");

/** Fetches a file the server names and hands it to the browser to save. */
async function saveResponse(url: string, fallbackName: string, failure: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    const isJson = response.headers.get("content-type")?.includes("application/json");
    const body = isJson ? ((await response.json()) as ApiErrorBody) : null;
    throw new ApiError(
      response.status,
      body?.error.code ?? "internal",
      body?.error.message ?? failure,
      body?.error.details?.fields ?? [],
      body?.error.details ?? {},
    );
  }

  const objectUrl = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filenameFrom(response.headers.get("content-disposition"), fallbackName);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

/**
 * The server names the file; this is the fallback when the header is absent.
 * A Japanese name arrives as RFC 6266's `filename*`, UTF-8 and percent-encoded,
 * beside an ASCII `filename`, and is preferred over it (issue #117).
 */
export function filenameFrom(disposition: string | null, fallback: string): string {
  const encoded = disposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded.trim());
    } catch {
      // A malformed encoding falls through to the plain name.
    }
  }
  const match = disposition?.match(/filename="([^"]+)"/);
  return match?.[1] ?? fallback;
}

/* -------------------------------------------------- flags, sorting, master */

/** The Flagged list. No model call is made to read it. */
export const useFlags = (state: "open" | "checked") =>
  useQuery({
    queryKey: keys.flags(state),
    queryFn: () => api<FlagsListing>(`/api/flags${state === "checked" ? "?state=checked" : ""}`),
  });

/**
 * What can be done to a flag. `explain` is the one action that spends tokens,
 * and it is a mutation so that nothing but a press can start it.
 */
export function useFlagAction() {
  const queryClient = useQueryClient();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: keys.overview });
    void queryClient.invalidateQueries({ queryKey: keys.importSummary });
    return queryClient.invalidateQueries({ queryKey: keys.allFacts });
  };
  const explain = useMutation({
    mutationFn: (id: string) => api<Flag>(`/api/flags/${id}/explain`, { method: "POST" }),
    onSuccess: () => void refresh(),
  });
  const setChecked = useMutation({
    mutationFn: (input: { id: string; checked: boolean }) =>
      api<Flag>(`/api/flags/${input.id}/${input.checked ? "check" : "uncheck"}`, { method: "POST" }),
    onSuccess: () => void refresh(),
  });
  return { explain, setChecked };
}

export interface SortProgress {
  running: boolean;
  /** Facts sorted so far by this run. */
  sorted: number;
  /** Facts flagged so far by this run. */
  flagged: number;
  /** `null` until the first answer says how many are left. */
  remaining: number | null;
  failure: string | null;
}

const SORT_IDLE_LIMIT = 3;
const SORT_STALLED = "Some facts could not be sorted just now. Nothing was lost; try again.";

/**
 * Sorts the facts still waiting from before the importer accepted on its own.
 * The server sorts a batch per request, one model call each, and this asks
 * again until none are left. A failure stops it where it is: everything
 * already sorted stays sorted, and pressing again resumes.
 */
export function useSortFacts(importId?: string) {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<SortProgress>({
    running: false,
    sorted: 0,
    flagged: 0,
    remaining: null,
    failure: null,
  });

  const run = async () => {
    if (progress.running) return;
    let sorted = 0;
    let flagged = 0;
    let idle = 0;
    setProgress({ running: true, sorted, flagged, remaining: null, failure: null });
    try {
      for (;;) {
        const step = await api<{ sorted: number; flagged: number; remaining: number }>("/api/facts/sort", {
          method: "POST",
          ...json(importId ? { importId } : {}),
        });
        sorted += step.sorted;
        flagged += step.flagged;
        const done = step.remaining === 0;
        idle = step.sorted === 0 ? idle + 1 : 0;
        const stalled = !done && idle === SORT_IDLE_LIMIT;
        setProgress({
          running: !done && !stalled,
          sorted,
          flagged,
          remaining: step.remaining,
          failure: stalled ? SORT_STALLED : null,
        });
        if (done || stalled) break;
      }
    } catch (error) {
      setProgress((current) => ({ ...current, running: false, failure: failureText(error) }));
    }
    void queryClient.invalidateQueries({ queryKey: keys.overview });
    void queryClient.invalidateQueries({ queryKey: keys.documents });
    void queryClient.invalidateQueries({ queryKey: keys.renders });
    void queryClient.invalidateQueries({ queryKey: keys.allFacts });
  };

  return { progress, run };
}

/** English is the route with nothing asked of it; 日本語 is asked for (`docs/07` §9). */
const masterQuery = (language: MasterLanguage) => (language === "ja" ? "?language=ja" : "");

/** One language's career record (the master document): built from the record on each read, by no model. */
export const useMasterDocument = (language: MasterLanguage) =>
  useQuery({
    queryKey: keys.masterDocument(language),
    queryFn: () => api<MasterDocument>(`/api/master-document${masterQuery(language)}`),
  });

/** The career record as a file. It contains Private facts; the screen says so beside the button. */
export const downloadMasterDocument = (language: MasterLanguage) =>
  saveResponse(
    `/api/master-document/download${masterQuery(language)}`,
    `career-record-${language}.md`,
    "The career record could not be downloaded.",
  );

export type { RenderContent };
