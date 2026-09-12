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
import type { RenderContent, RenderKind } from "~/shared/render-content";

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
    const body = isJson ? ((await response.json()) as ApiErrorBody) : null;
    throw new ApiError(
      response.status,
      body?.error.code ?? "internal",
      body?.error.message ?? "Something went wrong.",
      body?.error.details?.fields ?? [],
      body?.error.details ?? {},
    );
  }
  return (isJson ? await response.json() : await response.text()) as T;
}

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
  hasPhoto: boolean;
}

export interface Fact {
  id: string;
  claim: string;
  provenance: "measured" | "attested" | "generated";
  disclosure: "public" | "restricted" | "private";
  status: "candidate" | "accepted" | "rejected";
  /** Which employer the fact is filed under. `null` until it is linked. */
  employerId: string | null;
  projectId: string | null;
  evidence: {
    sourceDocumentVersionId: string;
    lineNumber: number;
    quoteStart: number;
    quoteEnd: number;
  } | null;
  technologies: string[];
  isClientIdentifying: boolean;
}

export interface Employer {
  id: string;
  nameJa: string;
  nameLatin: string | null;
  industryJa: string | null;
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
  wordCount: number;
  changedRegionShare: number | null;
  error: { code: string; message: string } | null;
  failedAtChunk: number | null;
}

export interface SourceText {
  sourceDocumentVersionId: string;
  filename: string;
  wordCount: number;
  importedAt: string;
  text: string;
}

export interface RenderRow {
  id: string | null;
  kind: RenderKind;
  language: "en" | "ja";
  title: string;
  buildable: boolean;
  currentVersionId: string | null;
  currentVersionNo: number | null;
  generatedAt: string | null;
  status: "never_generated" | "up_to_date" | "stale" | "proposal_pending";
  newFactsSince: number | null;
  pendingProposalId: string | null;
}

export interface Overview {
  lastImportAt: string | null;
  activeImport: ImportStatus | null;
  tiles: Record<"employers" | "roles" | "projects" | "credentials", { count: number; note: string | null }>;
  factsByProvenance: { measured: number; attested: number; generated: number };
  documents: RenderRow[];
  /** False when no accepted fact may be used in a document. */
  canGenerate: boolean;
  isEmpty: boolean;
}

export interface Proposal {
  id: string;
  renderKind: RenderKind;
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
  importStatus: (id: string) => ["import", id] as const,
  facts: (importId: string) => ["facts", importId] as const,
  sourceText: (documentId: string, versionNo: number) =>
    ["source", documentId, versionNo] as const,
  proposal: (id: string) => ["proposal", id] as const,
  diff: (id: string) => ["proposal", id, "diff"] as const,
  versions: (kind: RenderKind) => ["renders", kind, "versions"] as const,
  // Deliberately NOT under `versions`: invalidating the list on a save would
  // otherwise invalidate the immutable version the editor is holding.
  version: (kind: RenderKind, id: string) => ["renders", kind, "version", id] as const,
  proposals: (kind: RenderKind) => ["renders", kind, "proposals"] as const,
  versionDiff: (kind: RenderKind, from: string, to: string) =>
    ["renders", kind, "diff", from, to] as const,
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
  return useQuery({
    queryKey: keys.entity(key),
    queryFn: () => api<{ items: T[] }>(`/api/${key}`),
  });
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

export const useOverview = () =>
  useQuery({ queryKey: keys.overview, queryFn: () => api<Overview>("/api/overview") });

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

export function useFacts(importId: string, options?: Partial<UseQueryOptions<{ items: Fact[] }>>) {
  return useQuery({
    queryKey: keys.facts(importId),
    queryFn: () => api<{ items: Fact[] }>(`/api/facts?importId=${importId}`),
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
export const useVersionHistory = (kind: RenderKind) =>
  useQuery({
    queryKey: keys.versions(kind),
    queryFn: () => api<VersionHistory>(`/api/renders/${kind}/versions`),
  });

/** A version's stored structure, by id. `null` means there is nothing to edit. */
export const useStoredVersion = (kind: RenderKind, versionId: string | null) =>
  useQuery({
    queryKey: keys.version(kind, versionId ?? ""),
    queryFn: () => api<StoredVersion>(`/api/renders/${kind}/versions/${versionId}`),
    enabled: versionId !== null,
    // A stored version is immutable; re-reading it would only risk replacing
    // the document under an editor that has unsaved work in it.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

export const useRenderProposals = (kind: RenderKind) =>
  useQuery({
    queryKey: keys.proposals(kind),
    queryFn: () => api<{ items: ProposalRow[] }>(`/api/proposals?kind=${kind}`),
  });

/**
 * The restore preview's diff. `from` is the current version, so the split view
 * reports what committing the restore will CHANGE rather than what it undoes.
 */
export const useVersionDiff = (kind: RenderKind, from: string | null, to: string | null) =>
  useQuery({
    queryKey: keys.versionDiff(kind, from ?? "", to ?? ""),
    queryFn: () => api<RenderDiff>(`/api/renders/${kind}/diff?from=${from}&to=${to}`),
    enabled: from !== null && to !== null,
  });

export const useDiff = (proposalId: string, enabled: boolean) =>
  useQuery({
    queryKey: keys.diff(proposalId),
    queryFn: () => api<RenderDiff>(`/api/proposals/${proposalId}/diff`),
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
    },
  });
}

export function useStartImport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { file: File; projectId?: string }) => {
      const form = new FormData();
      form.set("file", input.file);
      if (input.projectId) form.set("projectId", input.projectId);
      return api<{ importId: string; sourceDocumentId: string; versionNo: number }>("/api/imports", {
        method: "POST",
        body: form,
      });
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.overview }),
  });
}

/**
 * Every accept, reject and edit is saved as it is made rather than at the end,
 * so closing the tab mid-review loses nothing.
 */
export function useFactAction(importId: string) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.facts(importId) });

  const patch = useMutation({
    mutationFn: (input: {
      id: string;
      body: Partial<Pick<Fact, "claim" | "provenance" | "disclosure" | "employerId">>;
    }) =>
      api<Fact>(`/api/facts/${input.id}`, { method: "PATCH", ...json(input.body) }),
    onSuccess: () => void refresh(),
  });
  const resolve = useMutation({
    mutationFn: (input: { id: string; action: "accept" | "reject" | "undo" }) =>
      api<Fact>(`/api/facts/${input.id}/${input.action}`, { method: "POST" }),
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
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.importStatus(importId) }),
  });

  return { patch, resolve, finish, retry };
}

export function useGenerate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (kind: RenderKind) =>
      api<{ proposalId: string }>(`/api/renders/${kind}/generate`, { method: "POST" }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.renders }),
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
export function useRestoreVersion(kind: RenderKind) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (versionId: string) =>
      api<{ newVersionNo: number; sourceVersionNo: number }>(
        `/api/renders/${kind}/versions/${versionId}/restore`,
        { method: "POST" },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.versions(kind) });
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
export function useEditVersion(kind: RenderKind) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { basedOnVersionId: string; content: RenderContent }) =>
      api<EditResult>(`/api/renders/${kind}/versions`, { method: "POST", ...json(body) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.versions(kind) });
      void queryClient.invalidateQueries({ queryKey: keys.renders });
      void queryClient.invalidateQueries({ queryKey: keys.overview });
    },
  });
}

/** `versionId` omitted means the current version — the server's own default. */
const downloadUrl = (kind: RenderKind, format: "docx" | "md", versionId?: string) =>
  `/api/renders/${kind}/download?format=${format}${versionId ? `&versionId=${versionId}` : ""}`;

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
export async function downloadRender(
  kind: RenderKind,
  format: "docx" | "md",
  versionId?: string,
): Promise<void> {
  const response = await fetch(downloadUrl(kind, format, versionId));
  if (!response.ok) {
    const isJson = response.headers.get("content-type")?.includes("application/json");
    const body = isJson ? ((await response.json()) as ApiErrorBody) : null;
    throw new ApiError(
      response.status,
      body?.error.code ?? "internal",
      body?.error.message ?? "That document could not be downloaded.",
      body?.error.details?.fields ?? [],
      body?.error.details ?? {},
    );
  }

  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filenameFrom(response.headers.get("content-disposition"), kind, format);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** The server names the file; this is the fallback when the header is absent. */
function filenameFrom(disposition: string | null, kind: RenderKind, format: string): string {
  const match = disposition?.match(/filename="([^"]+)"/);
  return match?.[1] ?? `${kind}.${format}`;
}

export type { RenderContent };
